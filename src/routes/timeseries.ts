// GET /api/timeseries -- daily trend.
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { cacheHeaders, jsonResponse } from "../http.ts";
import { dayIntToISO, eachDay, offsetDayInt } from "../lib/days.ts";
import { metricParam, resolveRange } from "../lib/params.ts";
import { withDb } from "../middleware.ts";
import { resolveFilters } from "../services/filters.ts";
import { META_MAX_DAY, META_MIN_DAY, readMeta } from "../services/meta.ts";
import type { Metric } from "../services/query-plan.ts";

export const timeseries = new Hono<AppEnv>();

timeseries.all("/api/timeseries", withDb, async (c) => {
  const { config, db } = c.var;
  const url = new URL(c.req.url);
  const metric = metricParam(url);
  const { from, to } = resolveRange(url, config);

  const filters = await resolveFilters(db, url);
  if (filters.matchesNothing) {
    return jsonResponse(seriesEnvelope(from, to, metric, new Map()), 200, cacheHeaders(to, config));
  }
  const filtered = filters.binds.length > 0;
  const d1 = db.$client;

  // Unfiltered trend is exactly what site_daily_tab stores, one row per day.
  // Per-day UV is safe to read straight out of it: the chart plots each day
  // independently and never sums unique visitors across days.
  const column = metric === "visitors" ? "uv" : "pv";
  const liveAgg = metric === "visitors" ? "COUNT(DISTINCT e.visitor_id)" : "COUNT(*)";
  let results: { day: number; value: number }[] | undefined;
  if (!filtered) {
    const meta = await readMeta(db);
    const minDay = Number(meta[META_MIN_DAY] ?? 0);
    const sealedTo = Math.min(to, Number(meta[META_MAX_DAY] ?? 0));
    if (minDay && from >= minDay && sealedTo >= from) {
      const parts = [`SELECT day, ${column} AS value FROM site_daily_tab WHERE day BETWEEN ? AND ?`];
      const args = [from, sealedTo];
      const liveFrom = offsetDayInt(sealedTo, 1);
      if (liveFrom <= to) {
        parts.push(`SELECT e.day AS day, ${liveAgg} AS value FROM events_tab e WHERE e.day BETWEEN ? AND ? GROUP BY e.day`);
        args.push(liveFrom, to);
      }
      ({ results } = await d1
        .prepare(parts.join(" UNION ALL "))
        .bind(...args)
        .all<{ day: number; value: number }>());
    }
  }
  if (!results) {
    ({ results } = await d1
      .prepare(
        `SELECT e.day AS day, ${liveAgg} AS value FROM events_tab e ` +
          `WHERE e.day BETWEEN ? AND ?${filters.clause} GROUP BY e.day`
      )
      .bind(from, to, ...filters.binds)
      .all<{ day: number; value: number }>());
  }

  const byDay = new Map(results.map((r) => [Number(r.day), Number(r.value)]));
  return jsonResponse(seriesEnvelope(from, to, metric, byDay), 200, cacheHeaders(to, config));
});

function seriesEnvelope(from: number, to: number, metric: Metric, byDay: Map<number, number>) {
  const results: { date: string; value: number }[] = [];
  for (const day of eachDay(from, to)) {
    results.push({ date: dayIntToISO(day), value: byDay.get(day) || 0 });
  }
  return { metric, interval: "day", results };
}
