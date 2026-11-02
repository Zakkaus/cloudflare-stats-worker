// meta_tab: the small key/value store holding rollup coverage, the Parquet
// archive window and the UV snapshot (see src/db/schema.ts).
import { metaTab } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { firstDayOfNextMonth } from "../lib/days.ts";

export const META_MIN_DAY = "rollup_min_day"; // earliest sealed day; before it -> raw
export const META_MAX_DAY = "rollup_max_day"; // latest sealed day (normally yesterday)
export const META_UV_SNAPSHOT = "uv_snapshot"; // JSON { as_of, uv } for the all-time card
// Latest month (yyyymm) whose events_monthly_tab aggregate has been written. A
// month is pruned over several nights, so this is what stops the aggregate being
// recomputed from a half-deleted month.
export const META_PRUNE_AGG_MONTH = "prune_agg_month";
export const META_ARCHIVE_MIN_DAY = "archive_min_day";
export const META_ARCHIVE_MAX_DAY = "archive_max_day";

export type Meta = Record<string, string>;

// Sealed days are immutable, so the coverage bounds only move once a night.
// Caching them per isolate keeps the routing decision off the hot path.
const META_CACHE_MS = 60000;

// meta_tab is a handful of rows and its values only move once a night, so this
// keeps the rollup routing decision off the hot path. A stale read is always an
// OLDER (smaller) rollup_max_day, which can only push days onto the live path --
// it can never make a query skip a day that is not actually sealed yet.
let metaCache: { at: number; value: Meta | null } = { at: 0, value: null };

// Call after writing any bound, so the same isolate reads its own write.
export function invalidateMetaCache(): void {
  metaCache = { at: 0, value: null };
}

export async function readMeta(db: Db): Promise<Meta> {
  const now = Date.now();
  if (metaCache.value && now - metaCache.at < META_CACHE_MS) return metaCache.value;
  const out: Meta = {};
  try {
    for (const row of await db.select().from(metaTab).all()) out[row.key] = row.value;
  } catch {
    // meta_tab absent (deployment predates the rollup migration) -> no coverage,
    // so every query takes the raw path and stays correct.
  }
  metaCache = { at: now, value: out };
  return out;
}

// First day a range read may scan; 0 when nothing has been pruned. Every month up
// to prune_agg_month belongs to events_monthly_tab, but its raw rows drain over
// several nights, so reading them would return a silently partial count. Days
// below this floor answer as empty, exactly as they did when a month was deleted
// in one go.
export function retainedFloor(meta: Meta): number {
  const month = Number(meta[META_PRUNE_AGG_MONTH] ?? 0);
  return month ? firstDayOfNextMonth(month) : 0;
}

// Coverage bounds only ever move outwards: the max never goes down, the min never
// goes up. Raw statements (not the query builder) because callers add them to a
// D1 batch alongside the rollup writes.
const boundStatement = (cmp: ">" | "<") =>
  `INSERT INTO meta_tab (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = CASE
     WHEN CAST(excluded.value AS INTEGER) ${cmp} CAST(meta_tab.value AS INTEGER) THEN excluded.value
     ELSE meta_tab.value END`;

export function raiseMetaMax(d1: D1Database, key: string, value: number): D1PreparedStatement {
  return d1.prepare(boundStatement(">")).bind(key, String(value));
}

export function lowerMetaMin(d1: D1Database, key: string, value: number): D1PreparedStatement {
  return d1.prepare(boundStatement("<")).bind(key, String(value));
}

export function parseJson<T = Record<string, unknown>>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
