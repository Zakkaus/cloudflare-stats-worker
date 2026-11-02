// Sealed daily rollups (dim_daily_tab, hier_daily_tab, site_daily_tab).
//
// A day is sealed once, by the nightly cron, after it has closed -- never
// incremented at ingest (that would cost ~14 more written rows per pageview
// against a 100K/day budget). Today is always read live and merged at query time.
import { DIMENSIONS, type DimensionName } from "../dimensions.ts";
import type { Db } from "../db/client.ts";
import { offsetDayInt } from "../lib/days.ts";
import { META_MAX_DAY, META_MIN_DAY, invalidateMetaCache, lowerMetaMin, raiseMetaMax, readMeta } from "./meta.ts";

// value_id/k* sentinel for "dimension absent". NOT NULL, because SQLite treats
// NULLs as distinct in a unique index: a NULL key would never match ON CONFLICT
// and would silently duplicate rows on every re-seal.
export const NULL_VALUE_ID = 0;

// Drill-down hierarchies, stored as whole tuples in hier_daily_tab. Keys must
// match HIERARCHY in dashboard-v2/src/state/store.ts.
export const HIERARCHIES: Record<string, DimensionName[]> = {
  browser: ["browser", "browser_version"],
  os: ["os", "os_version"],
  device: ["device_type", "device_vendor", "device_model"],
};

// Nights it takes to seal the whole retention window: the cron walks backwards
// this many days per run. 3 days x 14 passes ~= 315K rows read, ~6% of budget.
const ROLLUP_BACKFILL_DAYS_PER_RUN = 3;

// Recompute the rollups for [from, to] from scratch. Idempotent: every write is
// an upsert keyed on the natural key, so a day is replaced rather than added to.
// Bounds are written last so a reader can never see a coverage claim for rows
// that have not landed yet.
export async function sealDays(db: Db, from: number, to: number): Promise<void> {
  if (from > to) return;
  const d1 = db.$client;
  const statements: D1PreparedStatement[] = [];

  for (const [dimension, dim] of Object.entries(DIMENSIONS)) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO dim_daily_tab (dimension, day, value_id, pv)
           SELECT ?, day, COALESCE(${dim.col}, ${NULL_VALUE_ID}), COUNT(*) FROM events_tab
           WHERE day BETWEEN ? AND ? GROUP BY day, ${dim.col}
           ON CONFLICT(dimension, day, value_id) DO UPDATE SET pv = excluded.pv`
        )
        .bind(dimension, from, to)
    );
  }

  for (const [hier, levels] of Object.entries(HIERARCHIES)) {
    const cols = levels.map((d) => DIMENSIONS[d].col);
    const keys = [0, 1, 2].map((i) => (cols[i] ? `COALESCE(${cols[i]}, ${NULL_VALUE_ID})` : String(NULL_VALUE_ID)));
    statements.push(
      d1
        .prepare(
          `INSERT INTO hier_daily_tab (hier, day, k0, k1, k2, pv)
           SELECT ?, day, ${keys.join(", ")}, COUNT(*) FROM events_tab
           WHERE day BETWEEN ? AND ? GROUP BY day, ${cols.join(", ")}
           ON CONFLICT(hier, day, k0, k1, k2) DO UPDATE SET pv = excluded.pv`
        )
        .bind(hier, from, to)
    );
  }

  statements.push(
    d1
      .prepare(
        `INSERT INTO site_daily_tab (day, pv, uv)
         SELECT day, COUNT(*), COUNT(DISTINCT visitor_id) FROM events_tab
         WHERE day BETWEEN ? AND ? GROUP BY day
         ON CONFLICT(day) DO UPDATE SET pv = excluded.pv, uv = excluded.uv`
      )
      .bind(from, to)
  );

  statements.push(raiseMetaMax(d1, META_MAX_DAY, to));
  statements.push(lowerMetaMin(d1, META_MIN_DAY, from));

  await d1.batch(statements);
}

// Extend coverage backwards, bounded per run so the nightly job never becomes
// the thing that blows the read budget.
export async function extendRollupHistory(db: Db): Promise<void> {
  const meta = await readMeta(db);
  const minDay = Number(meta[META_MIN_DAY] ?? 0);
  if (!minDay) return; // nothing sealed yet -> run scripts/sql/backfill-rollups.sql
  const oldest = await db.$client.prepare("SELECT MIN(day) AS day FROM events_tab").first<{ day: number | null }>();
  if (!oldest || oldest.day === null) return;
  if (Number(oldest.day) >= minDay) return; // already covers everything retained

  const to = offsetDayInt(minDay, -1);
  const from = Math.max(Number(oldest.day), offsetDayInt(to, -(ROLLUP_BACKFILL_DAYS_PER_RUN - 1)));
  await sealDays(db, from, to);
  invalidateMetaCache();
}
