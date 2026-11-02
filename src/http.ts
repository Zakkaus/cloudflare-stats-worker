// Response helpers and the cache policy.
//
// Cache lifetimes. A date range that ended before today can never change again,
// so it is cached for a day; anything touching today gets a short window. These
// are served to Workers Cache (see `[cache]` in wrangler.toml), which -- unlike
// the Cache API -- does work on *.workers.dev.
import { localDay, type Config } from "./config.ts";

export const CACHE_TTL_CLOSED = 86400; // fully-past range: immutable
export const CACHE_TTL_LIVE = 300; // range includes today
export const CACHE_TTL_CONFIG = 3600; // /api/config: just the timezone
export const CACHE_SWR = 3600; // serve stale this long while revalidating

// Workers Cache applies heuristic freshness to any response that does not say
// otherwise, so anything not meant to be cached has to opt out explicitly.
export const NO_STORE = { "Cache-Control": "no-store" };

export function jsonResponse(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

// A range that ended before today can never change again, so it is cached for a
// day; anything touching today gets a short window. `stale-while-revalidate`
// lets Workers Cache serve the previous answer instantly and refresh behind it,
// which is why `s-maxage` is deliberately not used (it disables SWR).
export function cacheHeaders(to: number, config: Config): Record<string, string> {
  const ttl = to < localDay(config.timezone) ? CACHE_TTL_CLOSED : CACHE_TTL_LIVE;
  return { "Cache-Control": `public, max-age=${ttl}, stale-while-revalidate=${CACHE_SWR}` };
}
