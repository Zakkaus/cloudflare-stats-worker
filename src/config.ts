// Per-deployment configuration, read from wrangler `[vars]` (env).
// Makes the worker reusable for different websites without code changes.

const DEFAULTS = {
  ALLOWED_ORIGIN: "",
  RATE_LIMIT_PER_MINUTE: 120,
  TIMEZONE: "Asia/Tokyo",
  RECORD_LOCALHOST: false,
};

export interface Config {
  allowedOrigin: string;
  rateLimitPerMinute: number;
  timezone: string;
  recordLocalhost: boolean;
}

/** Resolve and validate configuration from env vars. */
export function getConfig(env: Env): Config {
  const rateLimit = Number.parseInt(env.RATE_LIMIT_PER_MINUTE ?? "", 10);
  return {
    allowedOrigin: (env.ALLOWED_ORIGIN || DEFAULTS.ALLOWED_ORIGIN).trim().replace(/\/+$/, ""),
    rateLimitPerMinute: Number.isFinite(rateLimit) && rateLimit > 0 ? rateLimit : DEFAULTS.RATE_LIMIT_PER_MINUTE,
    timezone: (env.TIMEZONE || DEFAULTS.TIMEZONE).trim(),
    recordLocalhost: (env.RECORD_LOCALHOST ?? String(DEFAULTS.RECORD_LOCALHOST)).trim().toLowerCase() === "true",
  };
}

/**
 * The request's origin, from the Origin header, falling back to the Referer's origin.
 * e.g. "https://blog.example.com", or null.
 */
export function resolveRequestOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (origin) {
    return origin.replace(/\/+$/, "");
  }
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

export function isDevOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

/**
 * True if `origin` is the single allowed reporting site, or a local dev host.
 */
export function isAllowedOrigin(origin: string | null, config: Config): origin is string {
  if (!origin) return false;
  if (config.allowedOrigin && origin === config.allowedOrigin) return true;
  return isDevOrigin(origin);
}

/**
 * CORS headers for the ingest endpoint. Echoes back only a matched origin; a
 * non-matching request gets no `Access-Control-Allow-Origin` (browser blocks it).
 */
export function corsHeadersFor(request: Request, config: Config): Record<string, string> {
  const origin = resolveRequestOrigin(request);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (isAllowedOrigin(origin, config)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/**
 * Local calendar day in the configured timezone, as an integer yyyymmdd.
 * Workers run in UTC but ship full ICU, so Intl handles the tz + DST correctly.
 * `timezone` is an IANA tz, e.g. "Asia/Tokyo"; `date` defaults to now.
 */
export function localDay(timezone: string, date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return Number(parts.replaceAll("-", "")); // "2026-07-19" -> 20260719
}

/**
 * yyyymmdd integer for `n` days before the configured-tz "today".
 * Computed by shifting a UTC-noon anchor to avoid DST edge slips.
 */
export function localDayOffset(timezone: string, offsetDays: number, date: Date = new Date()): number {
  const shifted = new Date(date.getTime() - offsetDays * 86400000);
  return localDay(timezone, shifted);
}
