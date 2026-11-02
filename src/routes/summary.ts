// GET /api/summary -- headline cards (today / 7d / 30d / all-time).
//
// PV is live and exact on every card: it is additive, so sealed days come from
// site_daily_tab (<=180 rows) and today is counted straight off events_tab.
//
// UV is not additive, so window figures cannot be assembled the same way. Only
// today's UV is computed live (a single day's rows); 7d / 30d / all-time come
// from the snapshot the cron writes, and the response carries `uv_as_of` so the
// dashboard can label them. This is the whole point of the rewrite: the old
// version ran an unbounded COUNT(DISTINCT visitor_id) over events_tab on every
// cold load, ~1.35M rows, which alone was a quarter of the daily budget.
import { Hono } from "hono";
import { localDay, localDayOffset } from "../config.ts";
import type { AppEnv } from "../env.ts";
import { cacheHeaders, jsonResponse } from "../http.ts";
import { dayIntToISO, offsetDayInt } from "../lib/days.ts";
import { withDb } from "../middleware.ts";
import { META_MAX_DAY, META_UV_SNAPSHOT, parseJson, readMeta } from "../services/meta.ts";
import type { UvSnapshot } from "../services/uv-snapshot.ts";

export const summary = new Hono<AppEnv>();

type PvRow = { pv: number } | null;

summary.all("/api/summary", withDb, async (c) => {
  const { config, db } = c.var;
  const d1 = db.$client;
  const today = localDay(config.timezone);
  const d7 = localDayOffset(config.timezone, 6);
  const d30 = localDayOffset(config.timezone, 29);

  const meta = await readMeta(db);
  const yesterday = offsetDayInt(today, -1);
  // Days already rolled into site_daily_tab, and the tail that is not yet.
  // Normally the tail is empty and only `today` is live; it grows only if a
  // nightly run was missed.
  const sealedTo = Math.min(yesterday, Number(meta[META_MAX_DAY] ?? 0));
  // Deliberately NOT clamped to the 30-day window: the all-time card sums this
  // too, so clamping would understate it. With a sealed window this is one day
  // or none; before the first backfill it degrades to a full per-day scan --
  // exactly the old cost, and correct, rather than cheap and wrong.
  const unsealedFrom = sealedTo > 0 ? offsetDayInt(sealedTo, 1) : 0;

  const sealedPv = (a: number, b: number): Promise<PvRow> =>
    b < a
      ? Promise.resolve(null)
      : d1
          .prepare("SELECT COALESCE(SUM(pv),0) AS pv FROM site_daily_tab WHERE day BETWEEN ? AND ?")
          .bind(a, b)
          .first<{ pv: number }>();

  const [todayRow, unsealed, sealed7, sealed30, sealedAll, archRow] = await Promise.all([
    d1
      .prepare("SELECT COUNT(*) AS pv, COUNT(DISTINCT visitor_id) AS uv FROM events_tab WHERE day = ?")
      .bind(today)
      .first<{ pv: number; uv: number }>(),
    // Per-day PV for the unsealed tail, so each window can take its own slice.
    unsealedFrom > yesterday
      ? Promise.resolve({ results: [] as { day: number; pv: number }[] })
      : d1
          .prepare("SELECT day, COUNT(*) AS pv FROM events_tab WHERE day BETWEEN ? AND ? GROUP BY day")
          .bind(unsealedFrom, yesterday)
          .all<{ day: number; pv: number }>(),
    sealedPv(d7, sealedTo),
    sealedPv(d30, sealedTo),
    sealedPv(0, sealedTo),
    d1.prepare("SELECT COALESCE(SUM(pv),0) AS pv FROM events_monthly_tab WHERE dimension = 'total'").first<{ pv: number }>(),
  ]);

  const pvOf = (row: PvRow): number => (row ? Number(row.pv) : 0);
  const todayPv = pvOf(todayRow);
  // PV for one window = sealed days + unsealed tail within the window + today.
  const windowPv = (sealedRow: PvRow, from: number): number =>
    pvOf(sealedRow) +
    unsealed.results.reduce((sum, r) => (Number(r.day) >= from ? sum + Number(r.pv) : sum), 0) +
    todayPv;

  const snapshot = parseJson<UvSnapshot>(meta[META_UV_SNAPSHOT]) || {};

  return jsonResponse(
    {
      timezone: config.timezone,
      today: { pv: todayPv, uv: todayRow ? Number(todayRow.uv) : 0 },
      last7d: { pv: windowPv(sealed7, d7), uv: snapshot.last7d ?? null },
      last30d: { pv: windowPv(sealed30, d30), uv: snapshot.last30d ?? null },
      // all-time PV includes pruned months; all-time UV is hot-window only (UV not additive across archives).
      allTime: {
        pv: windowPv(sealedAll, 0) + pvOf(archRow),
        uv: snapshot.allTime ?? null,
        uv_note: "distinct visitors within the retained ~6-month window",
      },
      // today.uv is live; every other uv is as of this day. null until the first
      // nightly run writes a snapshot.
      uv_as_of: snapshot.as_of ? dayIntToISO(snapshot.as_of) : null,
    },
    200,
    cacheHeaders(today, config)
  );
});
