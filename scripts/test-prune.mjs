#!/usr/bin/env node
// The nightly prune spreads a month over several runs. Prove that doing so
// changes no number: the monthly aggregate, the all-time PV card and what is
// left in the rollups must match what the old delete-the-month-at-once prune
// produced, and the all-time PV must be unchanged after EVERY run, not just the
// last one (a half-pruned month must not be counted twice).
//
//   node scripts/test-prune.mjs
//
// Runs against a throwaway local D1 (miniflare, via wrangler's getPlatformProxy)
// with the repo's migrations applied. Nothing remote is touched.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { createDb } from "../src/db/client.ts";
import { pruneExpiredDays, retentionCutoff } from "../src/services/retention.ts";
import { sealDays, extendRollupHistory } from "../src/services/rollup.ts";
import { invalidateMetaCache, readMeta, retainedFloor } from "../src/services/meta.ts";

const dir = mkdtempSync(join(tmpdir(), "prune-test-"));
const configPath = join(dir, "wrangler.toml");
writeFileSync(
  configPath,
  `name = "prune-test"\ncompatibility_date = "2025-10-07"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "prune_test_db"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n`
);

const { env, dispose } = await getPlatformProxy({ configPath, persist: { path: join(dir, "state") } });
try {
  await main(env.DB);
  console.log("OK: prune over several nights matches the one-batch result");
} finally {
  await dispose();
  rmSync(dir, { recursive: true, force: true });
}

async function main(d1) {
  // Schema: the repo's own migrations.
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(file, migrations), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      await d1.prepare(stmt).run();
    }
  }
  const db = createDb(d1);

  // today = 2027-02-01 => cutoff 20260800: July is expired, August onward is hot.
  const today = 20270201;
  const cutoff = retentionCutoff(today);
  assert.equal(cutoff, 20260800);

  const first = (sql, ...binds) => d1.prepare(sql).bind(...binds).first();
  for (const t of ["dim_path_tab", "dim_country_tab"]) {
    for (const v of ["a", "b", "c", "d"]) await d1.prepare(`INSERT INTO ${t} (value) VALUES (?)`).bind(v).run();
  }

  // Expired July 29-31 (uneven sizes, one day larger than the per-run budget
  // allows), plus August 1-2 that must survive untouched.
  const perDay = { 20260729: 40, 20260730: 7, 20260731: 90, 20260801: 12, 20260802: 5 };
  let id = 0;
  let total = 0;
  const statements = [];
  for (const [day, n] of Object.entries(perDay)) {
    for (let i = 0; i < n; i += 1) {
      id += 1;
      statements.push(
        d1
          .prepare("INSERT INTO events_tab (day, visitor_id, path_id, country_id) VALUES (?, ?, ?, ?)")
          .bind(Number(day), id % 23, (id % 4) + 1, id % 3 === 0 ? null : (id % 4) + 1)
      );
    }
    total += n;
  }
  for (let i = 0; i < statements.length; i += 50) await d1.batch(statements.slice(i, i + 50));
  const julyTotal = perDay[20260729] + perDay[20260730] + perDay[20260731];

  await sealDays(db, 20260729, 20260802);
  invalidateMetaCache();

  const allTimePv = async () =>
    Number((await first("SELECT COALESCE(SUM(pv),0) AS n FROM site_daily_tab")).n) +
    Number((await first("SELECT COALESCE(SUM(pv),0) AS n FROM events_monthly_tab WHERE dimension = 'total'")).n);
  assert.equal(await allTimePv(), total, "all-time PV before pruning");

  // A tiny budget: 2 written rows per event (row + idx_events_day) plus rollup rows.
  const budget = 100;
  let runs = 0;
  for (; runs < 100; runs += 1) {
    const left = Number((await first("SELECT COUNT(*) AS n FROM events_tab WHERE day < ?", cutoff)).n);
    if (left === 0) break;
    await pruneExpiredDays({}, db, today, budget);
    invalidateMetaCache();
    assert.equal(await allTimePv(), total, `all-time PV changed after run ${runs + 1}`);
    // From the first run on, range reads skip July entirely instead of counting
    // whatever is left of it.
    assert.equal(retainedFloor(await readMeta(db)), 20260801, `read floor after run ${runs + 1}`);
    // The rollup backfill must not re-seal days whose month is already aggregated.
    await extendRollupHistory(db, cutoff);
    invalidateMetaCache();
    assert.equal(await allTimePv(), total, `all-time PV changed after extend, run ${runs + 1}`);
  }
  assert.ok(runs > 3, `expected the month to take several runs, took ${runs}`);
  assert.ok(runs < 100, "prune never finished");

  // Same end state as the old one-batch prune.
  assert.equal(Number((await first("SELECT COUNT(*) AS n FROM events_tab WHERE day < ?", cutoff)).n), 0, "expired events left");
  assert.equal(Number((await first("SELECT COUNT(*) AS n FROM events_tab")).n), total - julyTotal, "hot events touched");
  const monthly = await first("SELECT pv FROM events_monthly_tab WHERE month = 202607 AND dimension = 'total'");
  assert.equal(Number(monthly.pv), julyTotal, "July total");
  for (const dim of ["path", "country"]) {
    const sum = await first("SELECT SUM(pv) AS n FROM events_monthly_tab WHERE month = 202607 AND dimension = ?", dim);
    assert.equal(Number(sum.n), julyTotal, `July ${dim} rows add up to the total`);
  }
  for (const t of ["site_daily_tab", "dim_daily_tab", "hier_daily_tab"]) {
    const n = await first(`SELECT COUNT(*) AS n FROM ${t} WHERE day < ?`, cutoff);
    assert.equal(Number(n.n), 0, `${t} still holds expired days`);
    const hot = await first(`SELECT COUNT(*) AS n FROM ${t} WHERE day >= ?`, cutoff);
    assert.ok(Number(hot.n) > 0, `${t} lost its hot days`);
  }
  assert.equal(Number((await first("SELECT value AS v FROM meta_tab WHERE key = 'prune_agg_month'")).v), 202607);
  console.log(`  July (${julyTotal} events) pruned over ${runs} runs with a ${budget}-write budget`);

  // Re-running with nothing expired is a no-op.
  await pruneExpiredDays({}, db, today, budget);
  assert.equal(await allTimePv(), total);
}
