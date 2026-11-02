#!/usr/bin/env node
// Record every observable aspect of the API -- status, selected headers and
// body -- for a fixed list of requests, so a refactor can be proven to have
// changed nothing: snapshot before, snapshot after, `diff` the two files.
//
//   node scripts/snapshot-api.mjs out.json [from-day to-day]
//   STATS_HOST=http://127.0.0.1:8787 node scripts/snapshot-api.mjs out.json 2026-07-19 2026-07-22
//
// [from-day, to-day] is the range holding data in the target database (default:
// the last 7 days). Requests mutate nothing: the ingest cases only exercise the
// paths that are rejected or dropped before anything is written.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const HOST = process.env.STATS_HOST || "http://127.0.0.1:8787";
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: snapshot-api.mjs out.json [from to]");
  process.exit(2);
}

const iso = (d) => d.toISOString().slice(0, 10);
const FROM = process.argv[3] || iso(new Date(Date.now() - 6 * 86400000));
const TO = process.argv[4] || iso(new Date());
const range = `from=${FROM}&to=${TO}`;
// One day inside the range, and a span reaching before any sealed coverage.
const oneDay = `from=${TO}&to=${TO}`;
const early = `from=2026-01-01&to=${TO}`;

const DIMS = [
  "path", "referrer_domain", "country", "browser", "browser_version",
  "os", "os_version", "device_type", "device_vendor", "device_model",
];
const HIERARCHIES = [
  "browser,browser_version",
  "os,os_version",
  "device_type,device_vendor,device_model",
  "device_type,device_vendor", // partial hierarchy
  "browser,os", // ad-hoc tuple -> raw only
];

const ALLOWED = "https://blog.example.com";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const cases = [];
const get = (path, init) => cases.push({ name: `GET ${path}`, path, init });

get("/health");
get("/api/config");
get("/api/summary");
get("/api/nope");
// Routing is by path alone, not method: these answered before the Hono move.
cases.push({ name: "POST /health", path: "/health", init: { method: "POST" } });
cases.push({ name: "POST /api/config", path: "/api/config", init: { method: "POST" } });
cases.push({ name: "POST /api/query", path: "/api/query?group_by=path", init: { method: "POST" } });

for (const metric of ["pageviews", "visitors"]) {
  for (const r of [range, oneDay, early, ""]) {
    get(`/api/timeseries?metric=${metric}&${r}`);
    get(`/api/timeseries?metric=${metric}&${r}&filter=country:JP`);
    get(`/api/timeseries?metric=${metric}&${r}&exclude=browser:Safari`);
  }
  for (const dim of DIMS) {
    for (const r of [range, oneDay, early]) {
      get(`/api/query?metric=${metric}&group_by=${dim}&${r}`);
    }
    get(`/api/query?metric=${metric}&group_by=${dim}&${range}&limit=3`);
    get(`/api/query?metric=${metric}&group_by=${dim}&${range}&exclude=${dim}:__none__`);
  }
  for (const h of HIERARCHIES) {
    get(`/api/query?metric=${metric}&group_by=${h}&${range}&limit=2000`);
  }
  get(`/api/query?metric=${metric}&group_by=path&${range}&filter=country:JP`);
  get(`/api/query?metric=${metric}&group_by=path&${range}&filter=country:JP,os:Windows&exclude=browser:Safari`);
  get(`/api/query?metric=${metric}&group_by=path&${range}&filter=country:ZZ-never-seen`); // short-circuit: no rows
  get(`/api/query?metric=${metric}&group_by=country&${range}&filter=referrer_domain:google.com`);
}

// Parameter edge cases.
get(`/api/query?${range}`); // defaults
get(`/api/query?group_by=bogus&${range}`);
get(`/api/query?group_by=path,country,os,browser&${range}`);
get(`/api/query?group_by=&${range}`);
get(`/api/query?group_by=path&from=garbage&to=garbage`);
get(`/api/query?group_by=path&from=${TO}&to=${FROM}`); // inverted
get(`/api/query?group_by=path&from=2020-01-01&to=${TO}`); // span past MAX_QUERY_DAYS
get(`/api/query?group_by=path&${range}&limit=99999`);
get(`/api/query?group_by=path&${range}&filter=nocolon,:empty,country:`);

// Archive (the manifest depends on how many cron runs the target has seen).
get("/api/archive/manifest");
get("/api/archive/live");
get(`/api/archive/file?day=${TO}`);
get("/api/archive/file?day=bogus");
get("/api/archive/file?day=2001-01-01");

// Ingest gates. None of these reach a database write.
const send = (name, init) => cases.push({ name, path: "/api/send", init });
send("OPTIONS /api/send (allowed origin)", { method: "OPTIONS", headers: { Origin: ALLOWED } });
send("OPTIONS /api/send (foreign origin)", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
send("OPTIONS /api/send (no origin)", { method: "OPTIONS" });
cases.push({ name: "OPTIONS /api/query", path: "/api/query", init: { method: "OPTIONS", headers: { Origin: ALLOWED } } });
cases.push({ name: "OPTIONS / (asset path)", path: "/", init: { method: "OPTIONS", headers: { Origin: ALLOWED } } });
send("GET /api/send", { method: "GET", headers: { Origin: ALLOWED } });
send("PUT /api/send", { method: "PUT", headers: { Origin: ALLOWED } });
send("POST /api/send (foreign origin)", { method: "POST", headers: { Origin: "https://evil.example", "User-Agent": BROWSER_UA }, body: "{}" });
send("POST /api/send (no origin)", { method: "POST", headers: { "User-Agent": BROWSER_UA }, body: "{}" });
send("POST /api/send (bot UA)", { method: "POST", headers: { Origin: ALLOWED, "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }, body: '{"path":"/"}' });

// Realtime: no Upgrade header, so each stops at a gate.
cases.push({ name: "GET /api/realtime (foreign origin)", path: "/api/realtime", init: { headers: { Origin: "https://evil.example" } } });
cases.push({ name: "GET /api/realtime (no upgrade, dev origin)", path: "/api/realtime", init: { headers: { Origin: "http://localhost:5173" } } });

// Static assets + SPA fallback + security headers.
get("/");
get("/some/client/route");
get("/report.js");

const KEEP_HEADERS = [
  "content-type", "cache-control", "vary", "etag", "content-disposition",
  "access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers",
  "access-control-max-age", "content-security-policy", "x-content-type-options",
  "referrer-policy", "x-archive-from", "x-archive-to",
];

const snapshot = {};
for (const c of cases) {
  const key = c.name;
  const n = (snapshot[key] ? Object.keys(snapshot).filter((k) => k.startsWith(key)).length : 0);
  const id = n ? `${key} #${n + 1}` : key;
  let entry;
  try {
    const res = await fetch(new URL(c.path, HOST), { redirect: "manual", ...c.init });
    const headers = {};
    for (const h of KEEP_HEADERS) {
      const v = res.headers.get(h);
      if (v !== null) headers[h] = v;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") || "";
    let body;
    if (type.includes("json")) {
      body = buf.toString("utf8");
      if (c.path === "/health") body = JSON.parse(body) && { ...JSON.parse(body), timestamp: "<redacted>" };
    } else if (type.startsWith("text/") && buf.length < 4096) {
      body = buf.toString("utf8");
    } else {
      body = `sha256:${createHash("sha256").update(buf).digest("hex")} (${buf.length} bytes)`;
    }
    entry = { status: res.status, headers, body };
  } catch (err) {
    entry = { error: String(err) };
  }
  snapshot[id] = entry;
}

writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
const failed = Object.values(snapshot).filter((e) => e.error).length;
console.log(`${cases.length} requests -> ${OUT}${failed ? ` (${failed} transport errors)` : ""}`);
process.exit(failed ? 1 : 0);
