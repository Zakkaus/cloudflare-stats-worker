// Scheduled maintenance (cron `30 15 * * *` = 00:30 Asia/Tokyo): the only
// trigger there is, because the free plan allows 5 cron triggers per account and
// the deployments already use one each.
import { getConfig, localDay } from "../config.ts";
import { createDb, getD1 } from "../db/client.ts";
import { offsetDayInt } from "../lib/days.ts";
import { exportArchive } from "./archive-export.ts";
import { META_MAX_DAY, invalidateMetaCache, readMeta } from "./meta.ts";
import { pruneExpiredDays, retentionCutoff } from "./retention.ts";
import { extendRollupHistory, sealDays } from "./rollup.ts";
import { refreshUvSnapshot } from "./uv-snapshot.ts";

// Forward catch-up bound, for when nightly runs were missed. Keeps the sealed
// window contiguous without letting one run scan an unbounded backlog.
const MAX_SEAL_DAYS_PER_RUN = 7;

export async function runMaintenance(env: Env): Promise<void> {
  const d1 = getD1(env);
  if (!d1) {
    console.warn("[worker] maintenance skipped: D1 database is not bound");
    return;
  }
  const db = createDb(d1);
  const config = getConfig(env);
  const tz = config.timezone;
  const today = localDay(tz);
  const yesterday = offsetDayInt(today, -1);

  // 1) Seal every closed day up to yesterday that is not sealed yet.
  //
  //    Always re-seal at least the last two days: ingest writes are
  //    fire-and-forget (ctx.waitUntil), so a few of yesterday's events can land
  //    after the previous run.
  //
  //    Crucially the sealed window must stay CONTIGUOUS. If a run is missed,
  //    resuming at today-2 would advance rollup_max_day past days that were
  //    never sealed, and queries covering them would silently under-report.
  //    Instead we resume from the last sealed day, capped so one catch-up run
  //    cannot itself blow the read budget; the next night continues.
  const meta = await readMeta(db);
  const lastSealed = Number(meta[META_MAX_DAY] ?? 0);
  const resumeFrom = lastSealed ? offsetDayInt(lastSealed, 1) : offsetDayInt(today, -2);
  const sealFrom = Math.min(resumeFrom, offsetDayInt(today, -2));
  const sealTo = Math.min(yesterday, offsetDayInt(sealFrom, MAX_SEAL_DAYS_PER_RUN - 1));
  await sealDays(db, sealFrom, sealTo);
  invalidateMetaCache();

  // 2) Walk the sealed window backwards a few days per night until it covers the
  //    whole retention window. Everything below rollup_min_day still answers
  //    correctly, just via a raw scan, so this is a pure speed-up over time.
  await extendRollupHistory(db, retentionCutoff(today));

  // 3) Refresh the unique-visitor snapshot the headline cards read.
  await refreshUvSnapshot(db, tz, today);

  // 4) Archive + prune raw events older than 6 whole months, oldest day first,
  //    within a nightly write budget (a month can take a fortnight to drain).
  await pruneExpiredDays(env, db, today);

  // 5) Write closed days to the Parquet archive in R2. Last on purpose: it is
  //    the only step that can fail for reasons outside D1 (R2, the Durable
  //    Object), and nothing above depends on it -- except the prune guard,
  //    which fails safe by keeping data.
  await exportArchive(env, db, config, today);
}
