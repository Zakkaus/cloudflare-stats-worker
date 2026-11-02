// /api/query: decide where a breakdown is answered from, and run it.
import { localDay, type Config } from "../config.ts";
import { DIMENSIONS, nullLabelFor, type DimensionName } from "../dimensions.ts";
import type { Db } from "../db/client.ts";
import { offsetDayInt } from "../lib/days.ts";
import { META_MAX_DAY, META_MIN_DAY, readMeta } from "./meta.ts";
import { HIERARCHIES, NULL_VALUE_ID } from "./rollup.ts";

export type Metric = "pageviews" | "visitors";

interface Hierarchy {
  name: string;
  depth: number;
}

interface PlanBase {
  metric: Metric;
  groupBy: DimensionName[];
  from: number;
  to: number;
  today: number;
}
export interface RawPlan extends PlanBase {
  rollup: false;
}
export interface RollupPlan extends PlanBase {
  rollup: true;
  hier: Hierarchy | null;
  sealedFrom: number;
  sealedTo: number;
  liveFrom: number;
  liveTo: number;
}
export type QueryPlan = RawPlan | RollupPlan;

export interface ResultRow {
  keys: string[];
  value: number;
}

// Decide where a query is answered from, and split the range accordingly.
//
// Rollup-eligible queries read sealed days from dim_daily_tab/hier_daily_tab and
// UNION today's live rows from events_tab in the SAME statement, so "today" is
// never stale. Everything else scans events_tab exactly as it always has.
//
// Not eligible:
//   * any include/exclude filter -- the rollups hold no cross-dimension tuples
//   * metric=visitors -- the rollups store PV only, precisely so that no code
//                        path can silently sum COUNT(DISTINCT) across days (or,
//                        for a partial hierarchy, across its deeper levels).
//                        Unique visitors are always exact, via events_tab.
//   * a range starting before the sealed window -- partial data would silently
//                        under-report, so fall back rather than lie
export async function planQuery(
  db: Db,
  config: Config,
  { metric, groupBy, from, to, filtered }: { metric: Metric; groupBy: DimensionName[]; from: number; to: number; filtered: boolean }
): Promise<QueryPlan> {
  const today = localDay(config.timezone);
  const base: RawPlan = { metric, groupBy, from, to, today, rollup: false };
  if (filtered || metric === "visitors") return base;

  const hier = groupBy.length > 1 ? hierarchyFor(groupBy) : null;
  if (groupBy.length > 1 && !hier) return base; // ad-hoc tuple: raw only

  const meta = await readMeta(db);
  const minDay = Number(meta[META_MIN_DAY] ?? 0);
  const maxDay = Number(meta[META_MAX_DAY] ?? 0);
  if (!minDay || from < minDay) return base;

  // Sealed portion of the range, plus whichever trailing days are not sealed yet
  // (normally just today; more if a nightly run was missed).
  const sealedTo = Math.min(to, maxDay);
  const liveFrom = offsetDayInt(sealedTo, 1);
  if (sealedTo < from) return base; // nothing sealed in range -> plain raw scan
  return { ...base, rollup: true, hier, sealedFrom: from, sealedTo, liveFrom, liveTo: to };
}

function hierarchyFor(groupBy: DimensionName[]): Hierarchy | null {
  for (const [name, levels] of Object.entries(HIERARCHIES)) {
    if (levels.length >= groupBy.length && groupBy.every((d, i) => levels[i] === d)) {
      return { name, depth: groupBy.length };
    }
  }
  return null;
}

type KeyedRow = Record<string, number>;

// Rollup path. One statement: sealed rows from the rollup table UNION ALL live
// rows for any not-yet-sealed day, aggregated together, with the grand total
// carried as a window function so it survives LIMIT without a second scan.
export async function queryViaRollup(
  db: Db,
  plan: RollupPlan,
  limit: number
): Promise<{ rows: ResultRow[]; total: number }> {
  const { groupBy, hier, sealedFrom, sealedTo, liveFrom, liveTo } = plan;
  const cols = groupBy.map((d) => DIMENSIONS[d].col);
  const keyCount = cols.length;
  const keyNames = cols.map((_, i) => `k${i}`);
  const binds: (string | number)[] = [];

  let sealed: string;
  if (hier) {
    // A partial hierarchy (e.g. device_type+device_vendor out of three levels)
    // selects only the leading keys; the outer GROUP BY sums the rest away.
    // Safe because pv is additive -- which is why this table stores no uv.
    sealed =
      `SELECT ${keyNames.join(", ")}, pv AS n FROM hier_daily_tab ` + `WHERE hier = ? AND day BETWEEN ? AND ?`;
    binds.push(hier.name, sealedFrom, sealedTo);
  } else {
    sealed = `SELECT value_id AS k0, pv AS n FROM dim_daily_tab WHERE dimension = ? AND day BETWEEN ? AND ?`;
    binds.push(groupBy[0], sealedFrom, sealedTo);
  }

  let live = "";
  if (liveFrom <= liveTo) {
    const sel = cols.map((c, i) => `COALESCE(e.${c}, ${NULL_VALUE_ID}) AS k${i}`).join(", ");
    const grp = cols.map((c) => `e.${c}`).join(", ");
    live =
      ` UNION ALL SELECT ${sel}, COUNT(*) AS n FROM events_tab e ` +
      `WHERE e.day BETWEEN ? AND ? GROUP BY ${grp}`;
    binds.push(liveFrom, liveTo);
  }

  const keyList = keyNames.join(", ");
  const sql =
    `WITH agg AS (${sealed}${live}) ` +
    `SELECT ${keyList}, SUM(n) AS value, SUM(SUM(n)) OVER () AS total ` +
    `FROM agg GROUP BY ${keyList} ORDER BY value DESC LIMIT ?`;
  binds.push(limit);

  const { results } = await db.$client
    .prepare(sql)
    .bind(...binds)
    .all<KeyedRow>();
  if (results.length === 0) return { rows: [], total: 0 };

  // Resolve ids -> labels only for the rows actually returned: at most `limit`
  // primary-key lookups, versus joining across the whole pre-LIMIT aggregate.
  const labels = await resolveLabels(db, groupBy, results, keyCount);
  const rows = results.map((r) => ({
    keys: groupBy.map((d, i) => labels[i].get(Number(r[`k${i}`])) ?? nullLabelFor(d)),
    value: Number(r.value),
  }));
  return { rows, total: Number(results[0].total) };
}

// Raw path -- extended to group by up to 3 dimensions in a single statement.
// Replaces the sunburst's per-node fan-out (which issued up to 261 requests / 522
// range scans for one click) with one scan.
export async function queryViaRaw(
  db: Db,
  plan: QueryPlan,
  where: string,
  binds: number[],
  limit: number
): Promise<{ rows: ResultRow[]; total: number }> {
  const { groupBy, from, to, metric } = plan;
  const d1 = db.$client;
  const cols = groupBy.map((d) => DIMENSIONS[d].col);
  const sel = cols.map((c, i) => `COALESCE(e.${c}, ${NULL_VALUE_ID}) AS k${i}`).join(", ");
  const grp = cols.map((c) => `e.${c}`).join(", ");
  const agg = metric === "visitors" ? "COUNT(DISTINCT e.visitor_id)" : "COUNT(*)";

  // COUNT(DISTINCT) is not summable, so visitors still needs its own total
  // statement. COUNT(*) rides along as a window function for free.
  const totalExpr = metric === "visitors" ? "" : ", SUM(COUNT(*)) OVER () AS total";
  const sql =
    `SELECT ${sel}, ${agg} AS value${totalExpr} FROM events_tab e ` +
    `WHERE e.day BETWEEN ? AND ?${where} GROUP BY ${grp} ORDER BY value DESC LIMIT ?`;
  const { results } = await d1
    .prepare(sql)
    .bind(from, to, ...binds, limit)
    .all<KeyedRow>();

  let total = 0;
  if (metric === "visitors") {
    const row = await d1
      .prepare(`SELECT COUNT(DISTINCT e.visitor_id) AS value FROM events_tab e WHERE e.day BETWEEN ? AND ?${where}`)
      .bind(from, to, ...binds)
      .first<{ value: number }>();
    total = row ? Number(row.value) : 0;
  } else if (results.length > 0) {
    total = Number(results[0].total);
  }

  if (results.length === 0) return { rows: [], total };
  const labels = await resolveLabels(db, groupBy, results, cols.length);
  const rows = results.map((r) => ({
    keys: groupBy.map((d, i) => labels[i].get(Number(r[`k${i}`])) ?? nullLabelFor(d)),
    value: Number(r.value),
  }));
  return { rows, total };
}

// One `WHERE id IN (...)` per grouped dimension, over the returned rows only.
//
// The ids are interpolated rather than bound: D1 allows at most 100 bound
// parameters per statement, and a tuple query can legitimately return thousands
// of distinct ids. (This is also why it is raw SQL and not the query builder's
// inArray(), which binds.) It is safe because every id is round-tripped through
// Number() and rejected unless it is a finite integer -- these values come from
// our own primary keys, never from the request.
async function resolveLabels(
  db: Db,
  groupBy: DimensionName[],
  results: KeyedRow[],
  keyCount: number
): Promise<Map<number, string>[]> {
  const maps: Map<number, string>[] = [];
  const lookups: Promise<void>[] = [];
  for (let i = 0; i < keyCount; i += 1) {
    const ids = [
      ...new Set(
        results.map((r) => Number(r[`k${i}`])).filter((n) => Number.isInteger(n) && n !== NULL_VALUE_ID)
      ),
    ];
    const map = new Map<number, string>();
    maps.push(map);
    if (ids.length === 0) continue;
    const table = DIMENSIONS[groupBy[i]].table;
    lookups.push(
      db.$client
        .prepare(`SELECT id, value FROM ${table} WHERE id IN (${ids.join(",")})`)
        .all<{ id: number; value: string }>()
        .then(({ results: rows }) => {
          for (const row of rows) map.set(Number(row.id), row.value);
        })
    );
  }
  await Promise.all(lookups);
  return maps;
}
