#!/usr/bin/env node
// Rough CPU proxy for the nightly Parquet export (src/archive.ts encodeEvents).
//
// Encoding runs in the ArchiveWriter Durable Object, which gets 30s CPU per
// invocation, so this is a sanity check rather than a hard budget the way it
// was when encoding ran inline in the 10ms Worker fetch handler. This builds
// synthetic days with realistic cardinalities and times the encode. The
// *first* run matters most: a cron invocation usually lands in a cold
// isolate, before the JIT warms up.
//
//   node scripts/bench-archive.mjs [rows...]      (default: 7500 15000)

import { encodeEvents, DIMENSION_NAMES } from "../src/archive.ts";

const CARDINALITY = {
  path: 2000,
  referrer_domain: 120,
  country: 90,
  browser: 20,
  browser_version: 250,
  os: 10,
  os_version: 80,
  device_type: 4,
  device_vendor: 40,
  device_model: 500,
};
const NULL_RATE = { referrer_domain: 0.55, device_vendor: 0.3, device_model: 0.35 };

// Zipf-ish: small ids dominate, like real traffic.
const pick = (n) => 1 + Math.floor(n * Math.pow(Math.random(), 3));

// "heavy" is deliberately pessimistic (a long path tail, ~45% one-pageview
// visitors); "typical" is scaled from the real local data (~280 paths and one
// visitor per ~6 pageviews on a 3K-row day).
const PROFILES = {
  heavy: { scale: 1, visitorRatio: 0.45 },
  typical: { scale: 0.4, visitorRatio: 0.18 },
};

function syntheticDay(n, { scale, visitorRatio }, day = 20260815) {
  const card = (name) => Math.max(4, Math.round(CARDINALITY[name] * scale));
  const dimMaps = DIMENSION_NAMES.map((name) => {
    const m = new Map();
    for (let id = 1; id <= card(name); id += 1) m.set(id, `${name}-value-${id}-${"x".repeat(id % 23)}`);
    return m;
  });
  const visitors = Array.from({ length: Math.ceil(n * visitorRatio) }, () => Math.floor(Math.random() * 2 ** 52));
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const row = [day, visitors[Math.floor(Math.random() * visitors.length)]];
    for (const name of DIMENSION_NAMES) {
      row.push(Math.random() < (NULL_RATE[name] ?? 0) ? null : pick(card(name)));
    }
    rows.push(row);
  }
  return { rows, dimMaps };
}


const sizes = process.argv.slice(2).map(Number).filter(Boolean);
for (const [profile, opts] of Object.entries(PROFILES)) for (const n of sizes.length ? sizes : [7500, 15000]) {
  const { rows, dimMaps } = syntheticDay(n, opts);
  const times = [];
  let bytes = 0;
  for (let run = 0; run < (process.env.RUNS|0 || 6); run += 1) {
    const t0 = performance.now();
    bytes = encodeEvents(rows, dimMaps).byteLength;
    times.push(performance.now() - t0);
  }
  const warm = times.slice(1).sort((a, b) => a - b);
  console.log(
    `${profile.padEnd(7)} ${n} rows  first=${times[0].toFixed(1)}ms  warm-median=${warm[2].toFixed(1)}ms  size=${(bytes / 1024).toFixed(0)}KB`
  );
}
