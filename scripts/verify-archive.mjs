#!/usr/bin/env node
// Prove the Parquet archive holds exactly what D1 holds.
//
// Downloads every archived day in [from, to] through the worker's own
// /api/archive endpoints, recounts it from the Parquet files alone, and diffs
// against /api/query -- per dimension, for both pageviews and visitors. The
// query side is forced onto the raw events_tab path with a no-op exclude token
// (as verify-rollup.mjs does), so this compares the archive to the raw rows,
// not to a rollup of them.
//
//   node scripts/verify-archive.mjs [from] [to]      (YYYY-MM-DD; default: every archived day)
//   STATS_HOST=https://stats.example.com node scripts/verify-archive.mjs 2026-07-01 2026-07-31
//
// Only days that exist in both places can be compared: D1 prunes raw events
// after 6 months, and days after archive_max_day are not archived yet.
// Exits non-zero on any mismatch.

import { parquetReadObjects } from "hyparquet";
import { DIMENSION_NAMES } from "../src/archive.ts";

const HOST = process.env.STATS_HOST || "http://127.0.0.1:8787";
const NULL_LABEL = (dim) => (dim.startsWith("referrer") ? "(direct)" : "(unknown)");

async function getJSON(path) {
  const res = await fetch(`${HOST}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const manifest = await getJSON(`/api/archive/manifest?nocache=${Date.now()}`);
const from = process.argv[2] || manifest.days[0]?.day;
const to = process.argv[3] || manifest.days.at(-1)?.day;
const days = manifest.days.filter((d) => d.day >= from && d.day <= to);
if (days.length === 0) {
  console.error(`No archived days in ${from}..${to}`);
  process.exit(1);
}
console.log(`Checking ${days.length} archived day(s) ${from}..${to} against ${HOST}`);

const rows = [];
for (const d of days) {
  const res = await fetch(`${HOST}/api/archive/file?day=${d.day}&v=${d.etag}`);
  if (!res.ok) throw new Error(`file ${d.day} -> ${res.status}`);
  const file = await res.arrayBuffer();
  const part = await parquetReadObjects({ file });
  for (const r of part) {
    if (String(r.day) !== d.day.replaceAll("-", "")) throw new Error(`file ${d.day} contains a row for day ${r.day}`);
  }
  rows.push(...part);
}

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) return;
  failures += 1;
  console.error(`  MISMATCH ${label}: ${detail}`);
};

// Totals.
const pv = await getJSON(
  `/api/timeseries?metric=pageviews&from=${from}&to=${to}&exclude=path:__nonexistent_sentinel__`
);
const apiTotal = pv.results.reduce((s, r) => s + r.value, 0);
check("total pageviews", apiTotal === rows.length, `api=${apiTotal} parquet=${rows.length}`);

// Per-dimension breakdowns, pageviews and exact unique visitors.
for (const dim of DIMENSION_NAMES) {
  const pvBy = new Map();
  const uvBy = new Map();
  for (const r of rows) {
    const key = r[dim] ?? NULL_LABEL(dim);
    pvBy.set(key, (pvBy.get(key) ?? 0) + 1);
    if (!uvBy.has(key)) uvBy.set(key, new Set());
    uvBy.get(key).add(r.visitor_id);
  }
  for (const metric of ["pageviews", "visitors"]) {
    const api = await getJSON(
      `/api/query?metric=${metric}&from=${from}&to=${to}&group_by=${dim}&limit=200` +
        `&exclude=${dim}:__nonexistent_sentinel__`
    );
    const mine = metric === "pageviews" ? pvBy : new Map([...uvBy].map(([k, s]) => [k, s.size]));
    // The API caps at 200 groups; compare exactly those, and the group count
    // whenever it is below the cap.
    for (const { key, value } of api.results) {
      check(`${dim} ${metric} "${key}"`, mine.get(key) === value, `api=${value} parquet=${mine.get(key)}`);
    }
    if (api.results.length < 200) {
      check(`${dim} ${metric} group count`, api.results.length === mine.size, `api=${api.results.length} parquet=${mine.size}`);
    }
  }
  console.log(`  ${dim.padEnd(16)} ${pvBy.size} values`);
}

if (failures) {
  console.error(`FAILED: ${failures} mismatch(es)`);
  process.exit(1);
}
console.log(`OK: ${rows.length} pageviews match D1 exactly across ${DIMENSION_NAMES.length} dimensions (PV + UV).`);
