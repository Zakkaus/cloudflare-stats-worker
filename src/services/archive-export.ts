// Parquet archive, write side: the nightly export of closed days to R2.
// (The read side is routes/archive.ts; the encoder is src/archive.ts, run inside
// the ArchiveWriter Durable Object for its CPU allowance.)
import { localDay, type Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import type { ArchiveMeta } from "../archive-do.ts";
import { eachDay, offsetDayInt } from "../lib/days.ts";
import {
  META_ARCHIVE_MAX_DAY,
  META_ARCHIVE_MIN_DAY,
  invalidateMetaCache,
  lowerMetaMin,
  raiseMetaMax,
  readMeta,
  type Meta,
} from "./meta.ts";

// [archive_min_day, archive_max_day] is the contiguous window of days already
// written to R2, one file per day. Like the rollups, it moves forwards nightly
// and walks backwards over history a few days per run.
//
// Each archived day costs ~1 D1 row read per pageview plus the distinct dim
// values (~7.5K at current traffic), and 3 subrequests inside the
// ArchiveWriter invocation (rows, dim values, R2 put). 3 forward + 10 backward
// = 39 subrequests, under the Free plan's 50, and ~100K rows read (2% of the
// daily budget) only while history is still being backfilled.
const MAX_ARCHIVE_DAYS_PER_RUN = 3;
const ARCHIVE_BACKFILL_DAYS_PER_RUN = 10;
// /api/archive/live covers days after archive_max_day up to today -- normally
// just today. Bounded so a stalled archive cannot turn it into a long scan.
const MAX_LIVE_DAYS = 3;

export function archiveMeta(config: Config): ArchiveMeta {
  return { timezone: config.timezone, site: config.allowedOrigin };
}

export function archiveWriter(env: Env) {
  return env.ARCHIVER.get(env.ARCHIVER.idFromName("archive"));
}

// Days after the archived window, up to today, capped at MAX_LIVE_DAYS.
export function liveRange(meta: Meta, config: Config): { from: number; to: number } {
  const today = localDay(config.timezone);
  const maxDay = Number(meta[META_ARCHIVE_MAX_DAY] ?? 0);
  const floor = offsetDayInt(today, -(MAX_LIVE_DAYS - 1));
  const from = maxDay ? Math.max(offsetDayInt(maxDay, 1), floor) : today;
  return { from: Math.min(from, today), to: today };
}

// True when [from, to] lies inside the archived window. Deployments without an
// R2 bucket keep the old behaviour (prune without archiving).
export async function archiveCovers(env: Env, db: Db, from: number, to: number): Promise<boolean> {
  if (!env.ARCHIVE || !env.ARCHIVER) return true;
  const meta = await readMeta(db);
  const min = Number(meta[META_ARCHIVE_MIN_DAY] ?? 0);
  const max = Number(meta[META_ARCHIVE_MAX_DAY] ?? 0);
  return Boolean(min && max && min <= from && max >= to);
}

// Extend the archived window forwards to yesterday and backwards towards the
// oldest raw event, bounded per run. Files are immutable once written; a day
// is rewritten only if it is exported again (idempotent overwrite).
export async function exportArchive(env: Env, db: Db, config: Config, today: number): Promise<void> {
  if (!env.ARCHIVE || !env.ARCHIVER) return;
  const d1 = db.$client;
  const yesterday = offsetDayInt(today, -1);
  const meta = await readMeta(db);
  const maxDay = Number(meta[META_ARCHIVE_MAX_DAY] ?? 0);
  const minDay = Number(meta[META_ARCHIVE_MIN_DAY] ?? 0);

  // Forward: resume after the last archived day, or start at yesterday.
  const forward: number[] = [];
  for (const day of eachDay(maxDay ? offsetDayInt(maxDay, 1) : yesterday, yesterday)) {
    if (forward.length >= MAX_ARCHIVE_DAYS_PER_RUN) break;
    forward.push(day);
  }

  // Backward: walk from the window's start towards the oldest retained event.
  const backward: number[] = [];
  const start = minDay || forward[0];
  const oldest = await d1.prepare("SELECT MIN(day) AS day FROM events_tab").first<{ day: number | null }>();
  if (start && oldest && oldest.day !== null && Number(oldest.day) < start) {
    const to = offsetDayInt(start, -1);
    const from = Math.max(Number(oldest.day), offsetDayInt(to, -(ARCHIVE_BACKFILL_DAYS_PER_RUN - 1)));
    backward.push(...eachDay(from, to));
  }

  const days = [...backward, ...forward];
  if (days.length === 0) return;
  const result = await archiveWriter(env).exportDays(days, archiveMeta(config));

  const newMax = forward.length ? forward[forward.length - 1] : maxDay;
  const newMin = backward.length ? backward[0] : start;
  await d1.batch([
    raiseMetaMax(d1, META_ARCHIVE_MAX_DAY, newMax),
    lowerMetaMin(d1, META_ARCHIVE_MIN_DAY, newMin),
  ]);
  invalidateMetaCache();
  const written = result.filter((r) => r.bytes > 0);
  console.log(
    `[worker] archived ${written.length}/${days.length} days to R2 (${days[0]}..${days[days.length - 1]}), ` +
      `window ${newMin}..${newMax}`
  );
}
