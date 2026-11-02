// GET /api/realtime -- WebSocket upgrade for the live (in-memory) dashboard.
import { Hono } from "hono";
import { isDevOrigin, resolveRequestOrigin } from "../config.ts";
import type { AppEnv } from "../env.ts";
import { NO_STORE, jsonResponse } from "../http.ts";
import { getRealtimeHub } from "../services/realtime-hub.ts";

export const realtime = new Hono<AppEnv>();

// Unlike /api/send (which is called FROM the tracked website, so it's restricted
// to config.allowedOrigin), this is called from the dashboard SPA itself --
// served by this same worker at its OWN domain, which is a different origin from
// the tracked website. The correct check is same-origin, not config.allowedOrigin.
realtime.all("/api/realtime", (c) => {
  const request = c.req.raw;
  const origin = resolveRequestOrigin(request);
  const selfOrigin = new URL(request.url).origin;
  if (origin !== selfOrigin && !isDevOrigin(origin)) {
    return jsonResponse({ error: "Origin not allowed" }, 403, NO_STORE);
  }
  const hub = getRealtimeHub(c.env);
  if (!hub) {
    return jsonResponse({ error: "Realtime is not configured" }, 503, NO_STORE);
  }
  // The raw request goes straight through so the WebSocket upgrade survives.
  return hub.fetch(request);
});
