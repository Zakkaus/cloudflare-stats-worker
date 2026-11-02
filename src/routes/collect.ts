// POST /api/send -- ingest one pageview (the client beacon).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { corsHeadersFor, isAllowedOrigin, isDevOrigin, localDay, resolveRequestOrigin } from "../config.ts";
import type { AppEnv } from "../env.ts";
import { jsonResponse } from "../http.ts";
import { normalizePath } from "../lib/path.ts";
import { getRealtimeHub } from "../services/realtime-hub.ts";
import { recordEvent } from "../services/record-event.ts";
import { isBot, parseReferrer, parseUserAgent } from "../ua.ts";
import { withDb } from "../middleware.ts";

export const collect = new Hono<AppEnv>();

collect.post("/api/send", withDb, async (c) => {
  const request = c.req.raw;
  const config = c.var.config;

  const corsHeaders = corsHeadersFor(request, config);
  const origin = resolveRequestOrigin(request);
  if (!isAllowedOrigin(origin, config)) {
    return jsonResponse({ error: "Origin not allowed" }, 403, corsHeaders);
  }

  if (!config.recordLocalhost && isDevOrigin(origin)) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Trust only CF-Connecting-IP: it is set by Cloudflare and cannot be spoofed.
  // (x-forwarded-for is client-supplied -- using it would let attackers rotate
  // the rate-limit key and forge visitor identity.)
  const ip = (request.headers.get("CF-Connecting-IP") || "0.0.0.0").trim();
  await enforceRateLimit(c.env, ip);

  const userAgent = request.headers.get("User-Agent") || "";
  // Bot exclusion is unconditional -- never record bot/crawler traffic.
  if (isBot(userAgent)) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let payload: { path?: unknown; referrer?: unknown } = {};
  try {
    const text = await request.text();
    if (text) payload = JSON.parse(text);
  } catch {
    payload = {};
  }

  const path = normalizePath(payload.path || "/");
  const ua = parseUserAgent(userAgent);
  const ref = parseReferrer(payload.referrer || "", config.allowedOrigin);
  const country: string = (request.cf?.country as string | undefined) || "XX";
  const visitorId = await getVisitorId(ip, userAgent);
  const day = localDay(config.timezone);

  c.executionCtx.waitUntil(
    recordEvent(c.var.db, { day, visitorId, path, ref, country, ua }).catch((err) =>
      console.error("[worker] recordEvent error", err)
    )
  );

  // Best-effort forward to the live-dashboard relay. Fully isolated from the
  // D1 write above: a missing binding, a cold/erroring Durable Object, or a
  // disconnected viewer must never affect ingest or D1 recording.
  const realtime = getRealtimeHub(c.env);
  if (realtime) {
    c.executionCtx.waitUntil(
      realtime
        .ingest({
          path,
          country,
          browser: ua.browser.name,
          browserVersion: ua.browser.version,
          os: ua.os.name,
          osVersion: ua.os.version,
          deviceType: ua.device.type,
          deviceVendor: ua.device.vendor,
          deviceModel: ua.device.model,
          referrerDomain: ref.domain,
          visitorId,
        })
        .catch((err: unknown) => console.error("[worker] realtime ingest error", err))
    );
  }

  return new Response(null, { status: 204, headers: corsHeaders });
});

// Any other method on the ingest path.
collect.all("/api/send", () => jsonResponse({ error: "Method Not Allowed" }, 405));

// Per-IP ingest cap via the Workers Rate Limiting binding (RATE_LIMITER).
// Atomic and edge-enforced (per-colo), unlike the old KV get-then-put which
// was non-atomic and bypassable under bursts. The limit/period live in
// wrangler.toml. Absent binding (e.g. tests) -> no limiting.
async function enforceRateLimit(env: Env, ip: string): Promise<void> {
  const limiter = env.RATE_LIMITER;
  if (!limiter) return;
  const { success } = await limiter.limit({ key: ip });
  if (!success) throw new HTTPException(429, { message: "Rate limit exceeded" });
}

async function getVisitorId(ip: string, userAgent: string): Promise<number> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${userAgent}`));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < 7; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
  return parseInt(hex.slice(0, 13), 16); // 52-bit int, safe for JS Number
}
