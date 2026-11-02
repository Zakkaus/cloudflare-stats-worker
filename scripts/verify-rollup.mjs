#!/usr/bin/env node
// Prove the rollups changed no numbers.
//
// Computes ground truth directly from the raw events (a `wrangler d1 export`
// dump, or prod_backup.sql) and diffs it against what the API returns. Because
// the rollup path is only taken for unfiltered pageview queries, each dimension
// is checked twice -- once as served (rollup) and once with an artificial
// exclude filter that forces the raw path -- and both must match ground truth.
//
//   node scripts/verify-rollup.mjs [dump.sql]
//   STATS_HOST=http://127.0.0.1:8787 node scripts/verify-rollup.mjs
//
// Exits non-zero on the first mismatch.

import { readFileSync } from "node:fs";

const HOST = process.env.STATS_HOST || "http://127.0.0.1:8787";
const DUMP = process.argv[2] || "prod_backup.sql";

// events_tab column order, mirroring src/db/schema.ts.
const COLUMNS = [
  "id", "day", "visitor_id", "path_id", "ref_domain_id", "country_id",
  "browser_id", "browser_ver_id", "os_id", "os_ver_id",
  "device_type_id", "device_vendor_id", "device_model_id",
];
const DIMENSIONS = {
  path: "path_id",
  referrer_domain: "ref_domain_id",
  country: "country_id",
  browser: "browser_id",
  browser_version: "browser_ver_id",
  os: "os_id",
  os_version: "os_ver_id",
  device_type: "device_type_id",
  device_vendor: "device_vendor_id",
  device_model: "device_model_id",
};
const DIM_TABLE = {
  path: "dim_path_tab",
  referrer_domain: "dim_ref_domain_tab",
  country: "dim_country_tab",
  browser: "dim_browser_tab",
  browser_version: "dim_browser_ver_tab",
  os: "dim_os_tab",
  os_version: "dim_os_ver_tab",
  device_type: "dim_device_type_tab",
  device_vendor: "dim_device_vendor_tab",
  device_model: "dim_device_model_tab",
};

function parseDump(text) {
  const events = [];
  const labels = new Map(); // "table:id" -> value
  const evRe = /INSERT INTO "events_tab" \([^)]*\) VALUES\(([^;]*)\);/g;
  let m;
  while ((m = evRe.exec(text))) {
    const parts = splitValues(m[1]);
    if (parts.length !== COLUMNS.length) continue;
    const row = {};
    COLUMNS.forEach((c, i) => {
      row[c] = parts[i] === "NULL" ? null : Number(parts[i]);
    });
    events.push(row);
  }
  const dimRe = /INSERT INTO "(dim_\w+)" \([^)]*\) VALUES\((\d+),(.*)\);/g;
  while ((m = dimRe.exec(text))) {
    labels.set(`${m[1]}:${m[2]}`, unquote(m[3].trim()));
  }
  return { events, labels };
}

// Split a VALUES list on top-level commas, respecting SQL single-quoted strings
// (where '' is an escaped quote).
function splitValues(s) {
  const out = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (ch === "'" && s[i + 1] === "'") { cur += "''"; i += 1; continue; }
      if (ch === "'") { inStr = false; cur += ch; continue; }
      cur += ch;
    } else if (ch === "'") {
      inStr = true; cur += ch;
    } else if (ch === ",") {
      out.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function unquote(v) {
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  return v;
}

const nullLabel = (dim) => (dim.startsWith("referrer") ? "(direct)" : "(unknown)");

function groundTruth({ events, labels }, dimension, from, to) {
  const col = DIMENSIONS[dimension];
  const counts = new Map();
  let total = 0;
  for (const e of events) {
    if (e.day < from || e.day > to) continue;
    total += 1;
    const key = e[col] === null ? nullLabel(dimension) : labels.get(`${DIM_TABLE[dimension]}:${e[col]}`) ?? String(e[col]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { counts, total };
}

function groundTruthDays({ events }, from, to) {
  const pv = new Map();
  const uv = new Map();
  for (const e of events) {
    if (e.day < from || e.day > to) continue;
    pv.set(e.day, (pv.get(e.day) || 0) + 1);
    if (!uv.has(e.day)) uv.set(e.day, new Set());
    uv.get(e.day).add(e.visitor_id);
  }
  return { pv, uv };
}

const iso = (d) => `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}`;

async function get(path) {
  const res = await fetch(new URL(path, HOST));
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return { body: await res.json(), cacheControl: res.headers.get("cache-control") };
}

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  expected ${expected}, got ${actual}`}`);
};

const data = parseDump(readFileSync(DUMP, "utf8"));
const days = [...new Set(data.events.map((e) => e.day))].sort();
const FROM = days[0];
const TO = days[days.length - 1];
console.log(`Ground truth: ${data.events.length} events, ${iso(FROM)}..${iso(TO)}, target ${HOST}\n`);

// --- Dimension breakdowns: rollup-served vs raw-served vs ground truth -------
for (const dimension of Object.keys(DIMENSIONS)) {
  const truth = groundTruth(data, dimension, FROM, TO);
  console.log(`${dimension} (${truth.counts.size} distinct, ${truth.total} pv)`);

  // As served. Unfiltered pageviews -> rollup path when coverage allows.
  const served = await get(
    `/api/query?metric=pageviews&group_by=${dimension}&from=${iso(FROM)}&to=${iso(TO)}&limit=200`
  );
  check(`${dimension} total`, served.body.total, truth.total);

  // Forced raw path: excluding a value that was never recorded matches every
  // row, so the result must be identical -- but it cannot use the rollup.
  const raw = await get(
    `/api/query?metric=pageviews&group_by=${dimension}&from=${iso(FROM)}&to=${iso(TO)}&limit=200` +
      `&exclude=${dimension}:__nonexistent_sentinel__`
  );
  check(`${dimension} total (raw path)`, raw.body.total, truth.total);

  const top = [...truth.counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200);
  const servedMap = new Map(served.body.results.map((r) => [r.key, r.value]));
  const rawMap = new Map(raw.body.results.map((r) => [r.key, r.value]));
  let mismatched = 0;
  for (const [key, value] of top) {
    if (servedMap.get(key) !== value || rawMap.get(key) !== value) mismatched += 1;
  }
  check(`${dimension} per-value counts`, mismatched, 0);
}

// --- Trend chart -------------------------------------------------------------
console.log("\ntimeseries");
const dayTruth = groundTruthDays(data, FROM, TO);
for (const metric of ["pageviews", "visitors"]) {
  const res = await get(`/api/timeseries?metric=${metric}&from=${iso(FROM)}&to=${iso(TO)}`);
  let bad = 0;
  for (const row of res.body.results) {
    const day = Number(row.date.replaceAll("-", ""));
    const want = metric === "visitors" ? dayTruth.uv.get(day)?.size ?? 0 : dayTruth.pv.get(day) ?? 0;
    if (row.value !== want) bad += 1;
  }
  check(`timeseries ${metric} per-day`, bad, 0);
}

// --- Multi-dimension group_by (the sunburst's single query) ------------------
console.log("\nhierarchy (multi-dimension group_by)");
for (const levels of [["browser", "browser_version"], ["device_type", "device_vendor", "device_model"]]) {
  const res = await get(
    `/api/query?metric=pageviews&group_by=${levels.join(",")}&from=${iso(FROM)}&to=${iso(TO)}&limit=2000`
  );
  const sum = res.body.results.reduce((a, r) => a + r.value, 0);
  check(`${levels.join(">")} tuples sum to total`, sum, res.body.total);
  check(`${levels.join(">")} total`, res.body.total, groundTruth(data, levels[0], FROM, TO).total);
  const arity = new Set(res.body.results.map((r) => r.keys?.length));
  check(`${levels.join(">")} tuple arity`, [...arity].join(","), String(levels.length));
}

// --- Cache-Control policy ----------------------------------------------------
console.log("\ncache headers");
const closed = await get(`/api/query?group_by=path&from=${iso(FROM)}&to=${iso(TO)}`);
check("closed range max-age", /max-age=86400/.test(closed.cacheControl || ""), true);
const todayIso = new Date().toISOString().slice(0, 10);
const live = await get(`/api/query?group_by=path&from=${todayIso}&to=${todayIso}`);
check("live range max-age", /max-age=300/.test(live.cacheControl || ""), true);

// --- Summary -----------------------------------------------------------------
console.log("\nsummary");
const summary = await get("/api/summary");
check("all-time pv", summary.body.allTime.pv, data.events.length);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
