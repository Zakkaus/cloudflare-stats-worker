// GET /api/query -- grouped breakdown by up to 3 dimensions.
import { Hono } from "hono";
import type { Config } from "../config.ts";
import { isDimension, type DimensionName } from "../dimensions.ts";
import type { AppEnv } from "../env.ts";
import { NO_STORE, cacheHeaders, jsonResponse } from "../http.ts";
import { dayIntToISO } from "../lib/days.ts";
import { clampInt, metricParam, resolveRange } from "../lib/params.ts";
import { resolveFilters } from "../services/filters.ts";
import {
  planQuery,
  queryViaRaw,
  queryViaRollup,
  type Metric,
  type ResultRow,
} from "../services/query-plan.ts";
import { withDb } from "../middleware.ts";

const MAX_GROUP_BY_DIMS = 3; // hierarchy views ask for at most 3 levels at once

export const query = new Hono<AppEnv>();

// Every read route is registered with `.all`: the pre-Hono worker routed on the
// pathname alone, so any method answered, and `.get` would turn POST into a 404.
query.all("/api/query", withDb, async (c) => {
  const { config, db } = c.var;
  const url = new URL(c.req.url);

  const metric = metricParam(url);
  const requested = (url.searchParams.get("group_by") || "path").split(",").map((s) => s.trim()).filter(Boolean);
  if (requested.length === 0 || requested.length > MAX_GROUP_BY_DIMS) {
    return jsonResponse({ error: `group_by must name 1-${MAX_GROUP_BY_DIMS} dimensions` }, 400, NO_STORE);
  }
  const groupBy: DimensionName[] = [];
  for (const name of requested) {
    if (!isDimension(name)) return jsonResponse({ error: `Unknown group_by: ${name}` }, 400, NO_STORE);
    groupBy.push(name);
  }
  const { from, to } = resolveRange(url, config);
  // A tuple breakdown feeds a hierarchy the client truncates per ring, so it
  // needs far more rows than a flat top-N list. Both come from one statement,
  // and rows returned are not what costs -- rows scanned is.
  const limit = clampInt(url.searchParams.get("limit"), 10, 1, groupBy.length > 1 ? 2000 : 200);

  const filters = await resolveFilters(db, url);
  // Including a value that was never recorded -> no rows match.
  if (filters.matchesNothing) return queryResponse(metric, from, to, config, groupBy, [], 0);

  const plan = await planQuery(db, config, { metric, groupBy, from, to, filtered: filters.binds.length > 0 });
  const { rows, total } = plan.rollup
    ? await queryViaRollup(db, plan, limit)
    : await queryViaRaw(db, plan, filters.clause, filters.binds, limit);

  return queryResponse(metric, from, to, config, groupBy, rows, total);
});

function queryResponse(
  metric: Metric,
  from: number,
  to: number,
  config: Config,
  groupBy: DimensionName[],
  rows: ResultRow[],
  total: number
): Response {
  const envelope: Record<string, unknown> = {
    metric,
    range: { from: dayIntToISO(from), to: dayIntToISO(to), timezone: config.timezone },
    group_by: groupBy.length === 1 ? groupBy[0] : groupBy,
    // Single-dimension results keep the historical { key, value } shape;
    // multi-dimension results carry the whole tuple.
    results: rows.map((r) => (groupBy.length === 1 ? { key: r.keys[0], value: r.value } : { keys: r.keys, value: r.value })),
    total,
  };
  if (metric === "visitors") {
    envelope.note = "total is distinct visitors over the filtered set; it is not the sum of per-group values (UV is not additive).";
  }
  return jsonResponse(envelope, 200, cacheHeaders(to, config));
}
