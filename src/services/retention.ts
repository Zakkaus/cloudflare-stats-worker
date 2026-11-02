// Retention: raw events older than 6 whole months are folded into
// events_monthly_tab and deleted, together with their rollup rows.
import { DIMENSIONS, nullLabelFor } from "../dimensions.ts";
import type { Db } from "../db/client.ts";
import { firstDayOfNextMonth } from "../lib/days.ts";
import { archiveCovers } from "./archive-export.ts";
import { META_MIN_DAY, invalidateMetaCache, raiseMetaMax } from "./meta.ts";

// Archive + prune raw events older than 6 whole months, one month at a time,
// oldest first. Stops at the first month the Parquet archive does not cover yet.
export async function pruneExpiredMonths(env: Env, db: Db, today: number): Promise<void> {
  let cy = Math.floor(today / 10000);
  let cm = Math.floor((today % 10000) / 100) - 6;
  while (cm <= 0) {
    cm += 12;
    cy -= 1;
  }
  const cutoffDay = (cy * 100 + cm) * 100; // days strictly < this are archived

  // Ask for the OLDEST remaining day below the cutoff, one month at a time.
  // The previous form -- SELECT DISTINCT (day / 100) WHERE (day / 100) < ? --
  // wrapped the indexed column in an expression, so idx_events_day could not be
  // used and it full-scanned events_tab (~1.35M rows) every single night even
  // when there was nothing to archive. This is an index min lookup.
  for (;;) {
    const row = await db.$client
      .prepare("SELECT MIN(day) AS day FROM events_tab WHERE day < ?")
      .bind(cutoffDay)
      .first<{ day: number | null }>();
    if (!row || row.day === null) break;
    const month = Math.floor(Number(row.day) / 100);
    // Pruning destroys the raw rows, and the Parquet archive is the only thing
    // that keeps them at event level. Never prune a month R2 does not hold yet;
    // the backward walk in exportArchive gets there within a few nights.
    if (!(await archiveCovers(env, db, Number(row.day), month * 100 + 31))) {
      console.warn(`[worker] not pruning month ${month}: Parquet archive does not cover it yet`);
      break;
    }
    await archiveMonth(db, month);
  }
}

async function archiveMonth(db: Db, month: number): Promise<void> {
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

  await d1.batch(statements);

  // Drop the raw rows and every rollup row for the archived month. The rollups
  // must not outlive the raw data they summarise: events_monthly_tab now owns
  // this month's totals, and leaving site_daily_tab rows behind would make the
  // all-time PV card count the month twice.
  await d1.batch([
    d1.prepare("DELETE FROM events_tab WHERE day BETWEEN ? AND ?").bind(start, end),
    d1.prepare("DELETE FROM site_daily_tab WHERE day BETWEEN ? AND ?").bind(start, end),
    d1.prepare("DELETE FROM dim_daily_tab WHERE day BETWEEN ? AND ?").bind(start, end),
    d1.prepare("DELETE FROM hier_daily_tab WHERE day BETWEEN ? AND ?").bind(start, end),
    raiseMetaMax(d1, META_MIN_DAY, firstDayOfNextMonth(month)),
  ]);
  invalidateMetaCache();
  console.log(`[worker] archived + pruned month ${month}`);
}
