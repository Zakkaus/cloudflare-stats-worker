// cloudflare-stats-worker V2 -- dimensional analytics on Cloudflare Workers.
//
// D1 is the single source of truth (raw event fact table `events_tab`). The
// dashboard SPA is served from Workers Static Assets (env.ASSETS) at `/`.
//
//   POST /api/send     ingest one pageview (beacon)
//   GET  /api/query       grouped breakdown by any dimension
//   GET  /api/timeseries  daily trend
//   GET  /api/summary     headline cards (today / 7d / 30d / all-time)
//   GET  /api/config      { timezone } for client-side date math
//   GET  /api/realtime    WebSocket upgrade for the live (in-memory) dashboard
//   GET  /api/archive/manifest  archived Parquet days (R2) + the live tail range
//   GET  /api/archive/file      one archived day as Parquet
//   GET  /api/archive/live      not-yet-archived days (normally today) as Parquet
//   GET  /health          { status, version, timestamp }
//   *                     static assets (SPA)
//
// This file only wires things together: routes/ hold the handlers, services/
// the logic behind them (including the nightly `scheduled` maintenance).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ArchiveWriter } from "./archive-do.ts";
import type { AppEnv } from "./env.ts";
import { NO_STORE, jsonResponse } from "./http.ts";
import { withConfig } from "./middleware.ts";
import { RealtimeHub } from "./realtime.ts";
import { archive } from "./routes/archive.ts";
import { serveAsset } from "./routes/assets.ts";
import { collect } from "./routes/collect.ts";
import { query } from "./routes/query.ts";
import { realtime } from "./routes/realtime.ts";
import { summary } from "./routes/summary.ts";
import { system } from "./routes/system.ts";
import { timeseries } from "./routes/timeseries.ts";
import { runMaintenance } from "./services/maintenance.ts";

export { RealtimeHub, ArchiveWriter };

// No cache lookup here on purpose. `caches.default` is a no-op on *.workers.dev
// -- put() resolves, match() always misses. Caching is handled in front of the
// Worker by Workers Cache (`[cache] enabled = true` in wrangler.toml), which
// does work on workers.dev and keys on the full URL. Handlers drive it via the
// Cache-Control they emit; see cacheHeaders() in http.ts.
const app = new Hono<AppEnv>();

app.use("*", withConfig);

app.route("/", system);
app.route("/", collect);
app.route("/", query);
app.route("/", timeseries);
app.route("/", summary);
app.route("/", realtime);
app.route("/", archive);

// Anything that is not an API route is the dashboard (SPA fallback included).
app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    return jsonResponse({ error: "Not Found" }, 404, NO_STORE);
  }
  return serveAsset(c);
});

app.onError((error, c) => {
  console.error("[worker] error", error);
  // Only surface messages we set deliberately (HTTPException). Unexpected
  // failures (D1 driver text, internal invariants) are masked so we don't leak
  // internals to clients. no-store so a transient failure never gets cached in
  // place of real data.
  if (error instanceof HTTPException) {
    return jsonResponse({ error: error.message }, error.status, NO_STORE);
  }
  return jsonResponse({ error: "Internal Error" }, 500, NO_STORE);
});

export default {
  fetch: app.fetch,

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
