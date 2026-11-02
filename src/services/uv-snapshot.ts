// Unique-visitor figures for the headline cards.
//
// 7d/30d refresh nightly (~280K rows). All-time is a full COUNT(DISTINCT) over
// events_tab -- ~1.35M rows, over a quarter of the daily budget -- so it
// refreshes weekly and rides inside the existing nightly trigger. The free plan
// allows 5 cron triggers per account and the three deployments already use one
// each, so a second schedule is not available even if we wanted one.
import { localDayOffset } from "../config.ts";
import { metaTab } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { META_UV_SNAPSHOT, invalidateMetaCache, parseJson, readMeta } from "./meta.ts";

// The all-time snapshot refreshes on Sundays (UTC).
const UV_SNAPSHOT_WEEKDAY = 0;

export interface UvSnapshot {
  as_of?: number;
  last7d?: number;
  last30d?: number;
  allTime?: number | null;
  all_time_as_of?: number | null;
}

export async function refreshUvSnapshot(db: Db, tz: string, today: number): Promise<void> {
  const meta = await readMeta(db);
  const previous = parseJson<UvSnapshot>(meta[META_UV_SNAPSHOT]) || {};
  const uvFor = async (from: number): Promise<number> => {
    const row = await db.$client
      .prepare("SELECT COUNT(DISTINCT visitor_id) AS uv FROM events_tab WHERE day BETWEEN ? AND ?")
      .bind(from, today)
      .first<{ uv: number }>();
    return row ? Number(row.uv) : 0;
  };

  const snapshot: UvSnapshot = {
    as_of: today,
    last7d: await uvFor(localDayOffset(tz, 6)),
    last30d: await uvFor(localDayOffset(tz, 29)),
    allTime: previous.allTime ?? null,
  };

  const isWeekly = new Date().getUTCDay() === UV_SNAPSHOT_WEEKDAY;
  if (isWeekly || snapshot.allTime === null) {
    const row = await db.$client
      .prepare("SELECT COUNT(DISTINCT visitor_id) AS uv FROM events_tab")
      .first<{ uv: number }>();
    snapshot.allTime = row ? Number(row.uv) : 0;
    snapshot.all_time_as_of = today;
  } else {
    snapshot.all_time_as_of = previous.all_time_as_of ?? null;
  }

  const value = JSON.stringify(snapshot);
  await db
    .insert(metaTab)
    .values({ key: META_UV_SNAPSHOT, value })
    .onConflictDoUpdate({ target: metaTab.key, set: { value } });
  invalidateMetaCache();
}
