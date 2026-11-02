import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { CACHE_SWR, CACHE_TTL_CONFIG, NO_STORE, jsonResponse } from "../http.ts";

export const WORKER_VERSION = "2.1.0";

export const system = new Hono<AppEnv>();

// Never cache: this is a liveness/version probe, and Workers Cache applies
// heuristic freshness to any response that does not say otherwise -- which made
// /health report the previous deploy's version.
system.all("/health", () =>
  jsonResponse({ status: "ok", version: WORKER_VERSION, timestamp: new Date().toISOString() }, 200, NO_STORE)
);

system.all("/api/config", (c) =>
  jsonResponse({ timezone: c.var.config.timezone }, 200, {
    "Cache-Control": `public, max-age=${CACHE_TTL_CONFIG}, stale-while-revalidate=${CACHE_SWR}`,
  })
);
