// Query-string parsing shared by the read endpoints. Deliberately lenient: an
// unparseable value falls back to a default rather than failing the request.
import { localDay, localDayOffset, type Config } from "../config.ts";
import { eachDaySpan, offsetDayInt, parseDayParam } from "./days.ts";

// Raw rows are pruned at 6 months, so a 366-day window only ever guarantees an
// expensive scan over days that no longer exist.
export const MAX_QUERY_DAYS = 185;

export function clampInt(value: string | null | undefined, def: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export function resolveRange(url: URL, config: Config): { from: number; to: number } {
  const toParam = parseDayParam(url.searchParams.get("to"));
  const fromParam = parseDayParam(url.searchParams.get("from"));
  const to = toParam ?? localDay(config.timezone);
  let from = fromParam ?? localDayOffset(config.timezone, 6);
  if (from > to) from = to;
  // Cap the span to protect D1 from pathological full-history distinct scans.
  const cappedFrom = eachDaySpan(from, to) > MAX_QUERY_DAYS ? offsetDayInt(to, -(MAX_QUERY_DAYS - 1)) : from;
  return { from: cappedFrom, to };
}

export function metricParam(url: URL): "pageviews" | "visitors" {
  return url.searchParams.get("metric") === "visitors" ? "visitors" : "pageviews";
}
