// Retention: raw events older than 6 whole months are folded into
// events_monthly_tab and deleted, together with their rollup rows.
//
// The delete is spread over nights. A D1 delete bills a written row per index
// entry just like an insert does, so removing a whole month at once (127K rows
// x 4 on the busiest deployment) is several times the account's 100K/day write
// budget -- and an exhausted budget makes ingest drop real pageviews on every
// site sharing the account. Instead each run deletes oldest day first until a
// write budget is spent, and carries on the next night.
import { DIMENSIONS, nullLabelFor } from "../dimensions.ts";
import type { Db } from "../db/client.ts";
import { firstDayOfNextMonth } from "../lib/days.ts";
import { HIERARCHIES } from "./rollup.ts";
import { archiveCovers } from "./archive-export.ts";
import { META_MIN_DAY, META_PRUNE_AGG_MONTH, invalidateMetaCache, raiseMetaMax, readMeta } from "./meta.ts";

// Written rows one nightly prune may spend (events + index entries + rollup rows
// + the monthly aggregate), across the whole run. Ingest is the other consumer of
// the account-wide 100K/day: ~4 writes per pageview, ~13K pageviews on the
// busiest day seen so far. Steady state needs only ~ingest per night, so this
// leaves a backlog (a month is ~125K rows) draining over about a fortnight
// without ever being the thing that exhausts the day.
export const PRUNE_WRITES_PER_RUN = 30000;

// First day that is still hot: days strictly before it are expired.
export function retentionCutoff(today: number): number {
  let cy = Math.floor(today / 10000);
  let cm = Math.floor((today % 10000) / 100) - 6;
  while (cm <= 0) {
    cm += 12;
    cy -= 1;
  }
  return (cy * 100 + cm) * 100;
}

// Tables the prune writes to, and what one inserted or deleted row costs if the
// schema cannot be read (the pre-0001 events_tab; events_monthly_tab's rowid +
// composite primary key + two indexes).
const COST_FALLBACK = {
  events_tab: 5,
  events_monthly_tab: 4,
  site_daily_tab: 1,
  dim_daily_tab: 1,
  hier_daily_tab: 1,
} as const;
type WriteCosts = Record<keyof typeof COST_FALLBACK, number>;

// Written rows per inserted or deleted row, by table: the row plus one per index.
// That includes the implicit index of a rowid table with a composite primary key
// (sqlite_autoindex_*); a WITHOUT ROWID table has none, and an INTEGER PRIMARY
// KEY is the rowid itself. Read from the schema, so events_tab's cost drops when
// the composite indexes go.
async function writeCosts(d1: D1Database): Promise<WriteCosts> {
  const tables = Object.keys(COST_FALLBACK) as (keyof WriteCosts)[];
  try {
    const { results } = await d1
      .prepare(
        `SELECT tbl_name AS t, COUNT(*) AS n FROM sqlite_master
         WHERE type = 'index' AND tbl_name IN (${tables.map(() => "?").join(", ")}) GROUP BY tbl_name`
      )
      .bind(...tables)
      .all<{ t: string; n: number }>();
    const indexes = new Map(results.map((r) => [r.t, Number(r.n)]));
    return Object.fromEntries(tables.map((t) => [t, 1 + (indexes.get(t) ?? 0)])) as WriteCosts;
  } catch {
    return { ...COST_FALLBACK };
  }
}

const changes = (r: D1Result | undefined): number => Number(r?.meta?.changes ?? 0);
const sumChanges = (results: D1Result[]): number => results.reduce((s, r) => s + changes(r), 0);

// Archive + prune expired raw events, oldest day first, spending at most
// `budget` written rows. Stops at the first day the Parquet archive does not
// cover yet, so raw rows are never destroyed before they reach R2.
export async function pruneExpiredDays(env: Env, db: Db, today: number, budget = PRUNE_WRITES_PER_RUN): Promise<void> {
  const d1 = db.$client;
  const cutoffDay = retentionCutoff(today);
  const cost = await writeCosts(d1);
  let spent = 0;
  let days = 0;
  let events = 0;

  while (spent < budget) {
    // Oldest remaining expired day. An index min lookup: the old
    // SELECT DISTINCT (day / 100) form wrapped the column in an expression and
    // full-scanned events_tab (~1.35M rows) every night.
    const row = await d1
      .prepare("SELECT MIN(day) AS day FROM events_tab WHERE day < ?")
      .bind(cutoffDay)
      .first<{ day: number | null }>();
    if (!row || row.day === null) break;
    const day = Number(row.day);
    const month = Math.floor(day / 100);

    // The Parquet archive is the only thing that keeps events at row level.
    if (!(await archiveCovers(env, db, day, day))) {
      console.warn(`[worker] not pruning day ${day}: Parquet archive does not cover it yet`);
      break;
    }

    // First day of a month to be pruned: write the whole month's aggregate while
    // every one of its raw rows is still there, and take the month out of the
    // rollups in the same transaction. After this events_monthly_tab owns the
    // month's totals, so a site_daily_tab row left behind would make the
    // all-time PV card count that day twice for as long as the raw rows linger.
    // rollup_min_day and prune_agg_month move past the month, so /api/query and
    // /api/timeseries stop reading it at all (meta.ts retainedFloor) rather than
    // count whatever raw rows are left mid-drain.
    const meta = await readMeta(db);
    if (Number(meta[META_PRUNE_AGG_MONTH] ?? 0) < month) {
      if (!(await archiveCovers(env, db, day, month * 100 + 31))) {
        console.warn(`[worker] not pruning month ${month}: Parquet archive does not cover all of it yet`);
        break;
      }
      spent += await writeMonthAggregate(db, month, cost);
      invalidateMetaCache();
    }

    // This day's dim/hier rollup rows (they are only cleanup: nothing reads them
    // once rollup_min_day has moved on), then its events, bounded by what is left.
    const dims = Object.keys(DIMENSIONS);
    const rollupResults = await d1.batch([
      ...dims.map((dimension) => d1.prepare("DELETE FROM dim_daily_tab WHERE dimension = ? AND day = ?").bind(dimension, day)),
      ...Object.keys(HIERARCHIES).map((hier) => d1.prepare("DELETE FROM hier_daily_tab WHERE hier = ? AND day = ?").bind(hier, day)),
    ]);
    spent +=
      sumChanges(rollupResults.slice(0, dims.length)) * cost.dim_daily_tab +
      sumChanges(rollupResults.slice(dims.length)) * cost.hier_daily_tab;

    const room = Math.floor((budget - spent) / cost.events_tab);
    if (room < 1) break;
    const del = await d1
      .prepare("DELETE FROM events_tab WHERE id IN (SELECT id FROM events_tab WHERE day = ? LIMIT ?)")
      .bind(day, room)
      .run();
    const deleted = changes(del);
    // MIN(day) just found a row on this day, so a delete that reports nothing
    // means the next pass would find the same day and spend nothing either:
    // stop rather than spin until the runtime kills the cron.
    if (deleted < 1) {
      console.warn(`[worker] prune made no progress on day ${day}; stopping`);
      break;
    }
    spent += deleted * cost.events_tab;
    events += deleted;
    days += 1;
    // A full batch may or may not have emptied the day; the next iteration's
    // MIN(day) answers that, and the loop ends once the budget is gone.
  }

  if (days > 0) console.log(`[worker] pruned ${events} events across ${days} day(s), ~${spent}/${budget} writes`);
}

// Returns the written rows it spent.
async function writeMonthAggregate(db: Db, month: number, cost: WriteCosts): Promise<number> {
  const d1 = db.$client;
  const start = month * 100 + 1;
  const end = month * 100 + 31;

  const statements: D1PreparedStatement[] = [
    d1
      .prepare(
        `INSERT INTO events_monthly_tab (month, dimension, value, pv, uv)
         SELECT ?, 'total', '', COUNT(*), COUNT(DISTINCT visitor_id) FROM events_tab WHERE day BETWEEN ? AND ?
         ON CONFLICT(month, dimension, value) DO UPDATE SET pv = excluded.pv, uv = excluded.uv`
      )
      .bind(month, start, end),
  ];

  for (const [dimension, dim] of Object.entries(DIMENSIONS)) {
    statements.push(
      d1
        .prepare(
          // LEFT JOIN, not JOIN: an inner join silently dropped every row whose
          // dimension FK was NULL — all direct traffic, for one — so the
          // archived per-dimension PV did not add up to the 'total' row.
          `INSERT INTO events_monthly_tab (month, dimension, value, pv, uv)
           SELECT ?, ?, COALESCE(d.value, ?), COUNT(*), COUNT(DISTINCT e.visitor_id)
           FROM events_tab e LEFT JOIN ${dim.table} d ON d.id = e.${dim.col}
           WHERE e.day BETWEEN ? AND ? GROUP BY e.${dim.col}
           ON CONFLICT(month, dimension, value) DO UPDATE SET pv = excluded.pv, uv = excluded.uv`
        )
        .bind(month, dimension, nullLabelFor(dimension), start, end)
    );
  }
  const aggregateCount = statements.length;

  statements.push(
    d1.prepare("DELETE FROM site_daily_tab WHERE day BETWEEN ? AND ?").bind(start, end),
    raiseMetaMax(d1, META_MIN_DAY, firstDayOfNextMonth(month)),
    raiseMetaMax(d1, META_PRUNE_AGG_MONTH, month)
  );

  const results = await d1.batch(statements);
  console.log(`[worker] aggregated month ${month}`);
  // Each aggregate row is a rowid insert plus an entry in every index on the
  // table, not one written row; the two meta_tab bounds are one each.
  return (
    sumChanges(results.slice(0, aggregateCount)) * cost.events_monthly_tab +
    changes(results[aggregateCount]) * cost.site_daily_tab +
    sumChanges(results.slice(aggregateCount + 1))
  );
}
