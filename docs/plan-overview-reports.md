# Plan: Overview / Reports split, date range picker, D1 write reductions

Agreed 2026-11-02. Implemented the same day on branch `hono-drizzle`, uncommitted. Status:

| Phase | State |
|---|---|
| 0 Measure | Done 2026-11-03. Results below; they change 4a and 4b.1 and unblock 4b.2 |
| 1 Range math + picker | Done. `range.test.ts` passes (14 tests) |
| 2 Overview | Done. Drawer filters locally with its own chips (grid column filter still drives chart/map); server cap = 400 above 8 days when filtered; single-dimension `limit` clamp raised 200 -> 2000 |
| 3 Reports | Done. Range loading, size preflight (confirm above 50 MB), progress, imports fill gaps via the `events` view, ROLLUP exact UV, compare overlay. `MomCards` / `MomTrend` became `ReportCards` / `ReportTrend` rather than folding into the Overview components; the panel grid and drawer are shared. URL-hash state not done |
| 4a Budgeted prune | Done, `node scripts/test-prune.mjs`. Differs from the plan: the month's `site_daily_tab` rows go with the aggregate (not per day), because deleting them per day double counts all-time PV while the month drains. Not yet exercised on a remote DB |
| 4b.1 Drop composite indexes | Migration `drizzle/0001_*.sql` written, **not applied** anywhere |
| 4b.2 Skip no-op seal writes | Not done: needs the Phase 0 answer on whether a guarded no-op bills 0 |
| 4b.3 Stop extending dim rollups | Not done: `rollup_min_day` is one bound shared by all three rollups, so splitting it is a design change of its own |


## Why

The History tab always queries D1. A filter or exclude there forces the raw `events_tab` path over the whole range, so users avoid filtering for fear of burning the 5M rows/day read budget. Meanwhile the write budget (100K rows/day, account-wide) is the tighter limit: on the peak day (liveahero-wiki-stats, 8–9 Oct 2026, ~13K pageviews) Cloudflare warned at 77% of daily writes.

The fix is to split the dashboard by data source:

- **Overview** (was History): D1, cheap, at most 7 days, no global filters.
- **Reports** (was Month vs Month): Parquet in DuckDB, any range, every filter, optional comparison. Costs 0 D1 rows.

Once nothing filters on D1 over long ranges, the composite indexes on `events_tab` can go, which is the largest write saving available.

## Decisions

| Question | Decision |
|---|---|
| Week start for This week / Last week | One persisted Sun / Mon switch, applied to both presets |
| Compare in Overview | Not in v1 |
| Overview panels in Visitors mode | Keep the raw scan; it is bounded by the 7-day cap |
| Imported Parquet files in Reports | Fill days the server does not have; server data wins on overlap |
| Parquet monthly compaction | Deferred (see the last section) |

## Phases

| # | Phase | Depends on | Deadline |
|---|---|---|---|
| 0 | Measure writes and verify D1 billing | — | — |
| 1 | Date math module + date range popover | — | — |
| 2 | Overview | 1 | — |
| 3 | Reports | 1 | — |
| 4a | Budgeted day-by-day retention prune | 0 | **before 2027-02-01** |
| 4b | Other write reductions (drop indexes, seal guard, shorter backfill) | 0, 2 (and 3 for the index drop) | — |
| — | Parquet compaction | deferred | — |

2 and 3 can run in parallel once 1 lands. 4a is independent of the UI work and can be pulled forward at any point.

---

## Phase 0 — Measure

Every write estimate in this plan is arithmetic from the schema. Replace it with numbers before changing anything.

1. Per database: `wrangler d1 info <db>` (`rows_written_24h`) and `wrangler d1 insights <db> --sort-by writes`. This shows which statements spend the budget: ingest inserts, `getDimId` inserts, seal upserts, archive meta writes.
2. Billing experiment on a throwaway **remote** D1 (miniflare does not report `rows_written`). Use `wrangler d1 execute --remote --json` and read `meta.rows_written` for:
   - `INSERT` of N rows into a table with k = 0, 1, 3 secondary indexes.
   - `DELETE` of N rows from the same tables. **This decides the prune cost.** The plan assumes a delete bills 1 + k rows like an insert; that is inferred, not verified.
   - `DROP INDEX` on an N-row table.
   - `DROP TABLE` on an N-row table (decides whether partitioned tables are worth considering).
   - `INSERT ... ON CONFLICT DO UPDATE SET pv = excluded.pv WHERE pv <> excluded.pv` where nothing changes (does the guarded no-op bill 0?).
   - Cost: a few × 10K writes with N = 10K. Run it on a quiet day, and delete the database afterwards.
3. Read the real Parquet day sizes from `/api/archive/manifest` for both sites, including the October peak days. These replace the compaction estimates below.

**Done when:** a short table of measured writes per pageview and per nightly job exists for both databases, and the five billing questions above have answers.

### Phase 0 results (2026-11-03)

**Billing experiment** (throwaway remote D1, N = 1,000 rows per test, `meta.rows_written` from `wrangler d1 execute --remote --json`; script not kept in the repo):

| Operation | Measured writes | Plan assumed |
|---|---|---|
| `INSERT` N rows, 0 / 1 / 3 secondary indexes | 1,000 / 2,000 / 4,000 (1 + k per row) | 1 + k. Confirmed |
| `DELETE` N rows, 0 / 1 / 3 secondary indexes | **1,000 / 1,000 / 1,000 (1 per row, indexes free)** | 1 + k. **Wrong** |
| `DELETE ... WHERE id IN (SELECT id ... LIMIT 100)` (the prune's pattern) | 100 on a 3-index table | 1 + k |
| `DROP INDEX` on a 1,000-row table | **0** | unknown |
| `DROP TABLE` with 1,000 rows and 2 indexes | **0** | unknown |
| `CREATE INDEX` on a 1,000-row table | 1,001 (N + 1) | N |
| `INSERT ... ON CONFLICT DO UPDATE`, values unchanged, unguarded | 1,000 | 1 per row |
| same, guarded with `WHERE pv <> excluded.pv`, values unchanged | **0** | unknown |
| same, guarded, 10% changed / all changed | 100 / 1,000 | |

**Production, last 24h** (`wrangler d1 info` / `d1 insights --sort-by writes`):

| Database | Pageview inserts | Writes from them | Per pageview | Everything else in the top statements |
|---|---|---|---|---|
| liveahero-wiki-stats-db | 3,244 | 12,976 | **4.0** | ~60 (rollup seal, meta) |
| housamo-skill-db | 1,196 | 5,980 | **5.0** | ~5,000, of which 4,840 is the `path` row of `dim_daily_tab` (4 statements, ~1,210 writes each) |

`rows_written_24h` was 14,303 (liveahero) and 7,840 (housamo) at the time. The `insights` window and `info` window do not line up exactly (housamo's top statements sum to more than its `info` total), so treat the housamo split as approximate.

**Consequences for the plan:**

- **4a prune:** a month is ~127K writes, not ~500K. Still more than one night's 100K, so the day-by-day budget stays, but `writeCosts()` in `src/services/retention.ts` charges every deleted `events_tab` row 1 + k (4 today, 2 after `0001`), so it overstates the cost 4x and the 30K budget removes only ~7.5K rows a night instead of ~30K. **Fixed 2026-11-03:** deletes are now counted at 1 written row each, only the monthly-aggregate insert is charged per index, and the comments, `CLAUDE.md`, the `0001` migration note and `test-prune.mjs` (budget 100 -> 50) match. A month now drains in ~4-5 nights at the unchanged 30K budget; `PRUNE_WRITES_PER_RUN` was left alone.
- **4b.1 drop indexes:** the ingest saving stands (4 -> 2 and 5 -> 2 writes per pageview). The "every prune delete gets 2-2.5x cheaper" part does not. `DROP INDEX` bills nothing, so there is no need to wait for a quiet day.
- **4b.2 guarded seal:** go. A no-op under the guard bills 0, whereas today's re-seal of the last 2 days rewrites every row. housamo's 4,840-write `path` statement is the first place to look.
- **Option the numbers open, not recommended yet:** `DROP TABLE` is free, so one `events_YYYYMM` table per month would make retention cost 0 instead of ~127K a month. It means month-routed tables in every raw-path query, and 4a already bounds the cost; revisit only if prune budget stays a problem.
- **Adding an index later** costs N + 1 writes, as CLAUDE.md already says.

**Cross-check:** the account counter (`d1 info`, 29 write queries) read 20,113 for the experiment against 20,107 summed from `meta.rows_written`, so the per-statement numbers are what is billed, including the free DROPs. The throwaway database has been deleted.

**Parquet day sizes** (`/api/archive/manifest`, 2026-11-03):

| Deployment | Days | Total | Mean / median day | Largest day | Per 30 days | 90 days | 185 days |
|---|---|---|---|---|---|---|---|
| liveahero-wiki-stats | 107 | 5.37 MB | 50 / 43 KB | 140 KB (2026-10-09), then 110 KB (10-08), 100 KB (10-02) | ~1.5 MB | ~4.5 MB | ~9.3 MB |
| housamo-skill | 103 | 2.61 MB | 25 / 23 KB | 58 KB (2026-08-08) | ~0.8 MB | ~2.3 MB | ~4.7 MB |

Consequences: the whole 6-month hot window is under 10 MB per site, so the Phase 3 "confirm above 50 MB" threshold would never fire at current traffic (it only matters after imports or a ~5x traffic rise). Compaction stays deferred: the only cost is request count (one per day file, ~90 for a 3-month range, immutable-cached afterwards), not bytes. The Phase 3 size preflight is still worth keeping as a guard, but it can be a plain "N files · X MB" label.

---

## Phase 1 — Date range popover

### Date math: `dashboard-v2/src/state/range.ts` (new, pure)

All functions take `today` (yyyy-mm-dd in the server timezone, from `todayInTz`) as an argument, so they are deterministic and testable. Existing `dates.ts` keeps `todayInTz` / `shift`; `rangeForPreset` moves here.

Range presets (stored as ids, never as dates, so an open tab rolls over at midnight):

| id | Range |
|---|---|
| `today` | today – today |
| `yesterday` | today−1 – today−1 |
| `thisWeek` | start of this week (Sun or Mon) – today |
| `last7d` | today−6 – today |
| `lastWeek` | the previous full week: Sun–Sat or Mon–Sun |
| `last28d` | today−27 – today |
| `last30d` | today−29 – today |
| `thisMonth` | 1st of this month – today |
| `custom` | the From / To inputs |

Note: the original spec listed Last week as "Sun – Today / Mon – Today". That is This week; Last week is the previous complete week.

Compare presets, with `len` = days in the primary range (inclusive):

| id | Comparison range |
|---|---|
| `prevPeriod` | shift back by `len` days |
| `prevPeriodDow` | shift back by `7 × ceil(len / 7)` days (same weekdays) |
| `prevYear` | same calendar dates one year earlier; Feb 29 → Feb 28 |
| `prevYearDow` | shift back by 364 days (same weekdays) |
| `custom` | the second From / To pair |

Week start: `weekStart: 'sun' | 'mon'`, persisted in `localStorage` (wrapped in try/catch, default `'mon'`).

Tests: `range.test.ts` with Node's built-in runner (`node --test`; Node strips the types, as the archive scripts already rely on). Cover month and year boundaries, Feb 29, both week starts on every weekday, and that every Overview-allowed preset is ≤ 7 days.

### Component: `dashboard-v2/src/components/DateRangePicker.tsx` (new)

Replaces `TimeRangePicker` in `MenuBar.tsx` and the month pickers in `MomView.tsx`.

- Native `popover` attribute on the panel, opened by the trigger button. Light dismiss and Escape act as **Cancel**. Load the `modern-web-guidance` skill before writing it (popover + anchor positioning).
- Draft state lives inside the component. Shortcuts and inputs edit only the draft; **Apply** commits range + compare atomically to the view's signals, and only then does a query run. This removes the current 400 ms debounce.
- Layout: shortcut list on the left; From / To date inputs on the right; a Compare toggle that reveals the compare shortcuts and a second From / To pair; Week starts Sun | Mon switch next to the week shortcuts; Cancel / Apply at the bottom.
- Clicking a shortcut fills the inputs. Editing an input switches the selection to `custom`.
- Props decide what is offered: `maxDays` (7 for Overview, none for Reports), `allowCompare`, `presets`. Inputs get `min` / `max` from the archive coverage (Reports) or `today − 6` relative to From (Overview). Apply is disabled while the draft is invalid.
- The trigger button shows the applied range and, when on, the comparison ("Oct 1 – Oct 7 vs Sep 24 – Sep 30").

**Done when:** both tabs use the picker, nothing queries before Apply, and the range tests pass.

---

## Phase 2 — Overview (was History)

### Dashboard

- Rename the tab "History" → "Overview" (`ViewSwitcher` in `MenuBar.tsx`, `view` value in `store.ts`; keep accepting the old value from any persisted state).
- Picker with `maxDays: 7`, `allowCompare: false`, presets Today / Yesterday / This week / Last 7 days / Last week / Custom.
- Remove `FilterBar` and the global `filters` signal from Overview. Panel row buttons (`Panel.tsx`) no longer call `addFilter`; clicking a row opens the drawer for that dimension instead.
- Metric toggle (Pageviews / Visitors) stays. Visitors breakdowns read raw `events_tab`, bounded by the 7-day cap (~91K rows per panel at 13K PV/day).

### Detail drawer: local filtering

- `DetailDrawer.tsx` keeps its own filter state, created when it opens and discarded when it closes. Nothing it does touches other panels.
- Flat dimensions: AG Grid's MultiFilter on the key column already filters in memory. The Filter / Exclude row buttons set that grid filter instead of calling the global `addFilter`. The bar chart and the country map render from the grid's filtered rows (`onFilterChanged` → `forEachNodeAfterFilter`).
- Hierarchies (device / browser / OS): filter the fetched tuples in memory at any level, then rebuild the sunburst with `buildTree`.
- Fetch the full list: raise the drawer's request limit (e.g. 2,000 for one dimension). On the rollup path, rows read come from the range scan, not from `LIMIT`, so a complete list costs the same D1 reads and makes local filtering complete. The 8-row panels are unchanged.
- **"Open in Reports →"** button in the drawer header: switches to Reports with the same range and, if a row is selected, that value as a Reports filter. This is the bridge for any question Overview cannot answer.

### Server

- `src/lib/params.ts` / `resolveRange`: cap the span of `/api/query` and `/api/timeseries` when `filter` or `exclude` is present (proposed: 8 days, so a 7-day range in any timezone edge case fits). Unfiltered requests keep `MAX_QUERY_DAYS = 185`, which the summary cards and the verification scripts need.
- This also protects the public housamo deployment from scripted long-range filtered scans.
- Check `scripts/verify-rollup.mjs` and `scripts/snapshot-api.mjs` still pass: both use the 4-day `prod_backup.sql` range, so the cap should not affect them. Add a snapshot case for a rejected over-cap filtered request.

**Done when:** Overview shows no global filter UI, the drawer filters locally and resets on close, filtered API requests over the cap return 400, and the snapshot diff shows only the intended changes.

---

## Phase 3 — Reports (was Month vs Month)

### Range-based loading (`dashboard-v2/src/duck/`)

- Replace the month model (`momA` / `momB` = `source:yyyymm`) with `primary: {from, to}` and optional `compare: {from, to}` from the picker. No preset limit; custom range bounded by archive coverage.
- `db.ts`: generalise `loadServerMonth` into `loadDays(from, to)`. It loads the union of the days both ranges need into the `server` table, reusing the existing serialized load queue and `archivedDays` / `liveDays` bookkeeping, and fetches `/api/archive/live` when the range reaches past `archive_max_day`.
- **Size preflight:** sum the manifest's file sizes for the days not loaded yet. Show "N files · X MB" in the picker; above a threshold (e.g. 50 MB), ask before loading.
- Fetch with limited concurrency (e.g. 6 at a time) and show a progress bar. Day files are cached immutable, so a reload is cheap.

### Imports fill gaps

- Imported files stay in their own `imp_N` tables, but queries read from one view, `events`, built as: all `server` rows, plus imported rows for days `server` does not have.
- Coverage UI shows which days came from the server, which from imports, and which are missing for the selected ranges.
- Export (⬇) exports the primary range, not a month.

### Queries (`duck/mom.ts` → `duck/report.ts`)

Each query takes a range and returns rows for one side; the view runs it for primary and, when on, for compare:

- `totals` — PV and UV (both always computed).
- `trend` — per day, aligned by day index from the range start, so ranges of different lengths and weekday-matched comparisons overlay correctly.
- `breakdown(dimension)` — key, PV, UV; joined into Δ columns when comparing.
- `tuples(dims)` — hierarchy via `GROUP BY ROLLUP(...)`, which gives **exact** UV on every sunburst ring (Overview sums child UV, which overcounts).

All of them apply the existing compiled filters (`sql.ts` `compileFilters`: is / contains / prefix / regex, plus advanced SQL).

### Layout and shared components

Reports gets the same shape as Overview, plus comparison:

- Cards with Δ, a trend with the comparison overlaid, the panel grid with Δ, and the drawer with bar chart, country map, sunburst and grid.
- Clicking a value adds a global filter (it costs nothing here). `MomFilterBar` stays as the filter bar.
- Make the visual components pure (rows in, chart out) behind a small data-source interface — `totals`, `trend`, `breakdown`, `tuples` — implemented once over the API (Overview) and once over DuckDB (Reports). Panel, drawer, map, sunburst and grid are then shared, not duplicated.
- `MomCards`, `MomTrend`, `MomDeltaTable` fold into the shared components with an optional comparison series / Δ column.
- Optional: keep Reports state (ranges, compare mode, filters, open drawer) in the URL hash, so a report can be bookmarked or shared.

**Done when:** a 3-month range with a previous-period comparison loads with a size warning and progress, filters apply to every component, the sunburst shows exact UV, imports fill a missing month, and `scripts/verify-archive.mjs` still matches D1.

---

## Phase 4 — D1 write reductions

### Where the writes go today (estimates; Phase 0 replaces them)

Each pageview writes one `events_tab` row plus one row per index:

| Deployment | Indexes | Writes / pageview |
|---|---|---|
| liveahero-wiki-stats | `day`, `day_country`, `day_path` | 4 |
| housamo-skill | `day`, `day_country`, `day_path`, `day_ref` | 5 |

On the peak day, liveahero alone is ~13K × 4 ≈ 52K writes. The rest of the 77% (~25K) is housamo ingest, `getDimId` inserts for new values (2 writes each: the row and its unique index), and the nightly seal. Phase 0's `d1 insights` should account for it.

The quota resets at 00:00 UTC (09:00 JST), so the warning near 00:00 UTC came at the end of the quota day, which spans two JST days.

### 4a. Budgeted retention prune — must land before 2027-02-01

**Problem.** `pruneExpiredMonths` / `archiveMonth` (`src/services/retention.ts`) deletes a whole month of `events_tab` rows, plus its rollup rows, in one batch.

- The first prune runs at the 2027-02-01 cron (00:30 JST) and deletes July 2026; each 1st after that deletes the next month.
- If a delete bills 1 + k rows like an insert (Phase 0 verifies), a liveahero month at ~4.1K/day is ~127K rows × 4 ≈ **~500K writes in one night**, about 5× the account's daily budget. October 2026, with the peak days, is larger still (pruned 2027-05-01).
- Once the budget is exhausted, ingest on **both** sites silently drops pageviews until 00:00 UTC.
- Over a row's life, the current design costs twice its insert cost: once to write, once to delete.

**Fix.**

- Prune by **day**, oldest first, with a nightly write budget (e.g. `PRUNE_ROWS_PER_RUN`, sized from Phase 0 so prune + ingest + seal stay well under 100K across both databases).
- Before deleting the first day of a month, write that month's `events_monthly_tab` aggregate (it must be computed from the complete month). Track progress in `meta_tab` (e.g. `prune_min_day`) so a month can be partially pruned across nights.
- Delete the matching `site_daily_tab` / `dim_daily_tab` / `hier_daily_tab` rows per day in the same batch, so the all-time PV card never double-counts a day (today's month-at-once rule, applied per day).
- Keep the `archiveCovers` guard: never delete a day the Parquet archive does not cover.
- Use `idx_events_day` for the per-day delete (`WHERE day = ?`), and bound each statement by row count if one day can exceed the budget.
- Tests against local D1: a month pruned over several runs yields the same `events_monthly_tab` totals and all-time PV as the old one-batch prune.

### 4b. Other reductions

In order of value:

1. **Drop the composite indexes** `idx_events_day_country`, `idx_events_day_path`, `idx_events_day_ref` (where present). After Phase 2 nothing filters on D1 over more than 8 days, and Reports does not touch D1.
   - Writes per pageview: liveahero 4 → 2, housamo 5 → 2. Peak-day liveahero ingest ≈ 52K → 26K.
   - Every future prune delete also gets 2–2.5× cheaper.
   - Cost: today's live breakdowns for path / country / referrer lose their covering index and scan today's rows through `idx_events_day` instead. Measure reads before and after with `d1 insights --sort-by reads`; today is at most ~13K rows per panel.
   - Ship as a drizzle migration (edit `src/db/schema.ts`, `pnpm db:generate`, read the SQL). Phase 0 tells whether `DROP INDEX` itself bills writes per row; if it does, run it on a quiet day.
2. **Skip no-op seal writes.** `src/services/rollup.ts` re-seals the last 2 days every night. Add `WHERE pv <> excluded.pv` to the `ON CONFLICT ... DO UPDATE` so unchanged rows are not rewritten (~1–2K writes/night at peak volume). Only if Phase 0 confirms a guarded no-op bills 0.
3. **Stop extending dimension rollups backwards** beyond what Overview reads. `extendRollupHistory` walks `dim_daily_tab` / `hier_daily_tab` back 3 days per night; Overview never looks further back than 7 days, and Reports does not use them. `site_daily_tab` still needs full history for the trend and the all-time card. Optionally keep only the total row in `events_monthly_tab`.
4. **Optional, only if traffic grows ~2.5× more:** locate each day's rows by rowid range (recorded per day by the cron) instead of `idx_events_day`, then drop that index too, for 1 write per pageview. Not worth the complexity now.

**Expected peak after 4a + 4b(1–3):** ~26K (liveahero) + housamo at 2/pageview + ~3K nightly ≈ 35–40% of the daily budget, down from 77%. Phase 0 numbers will firm this up.

Keeping the 6-month hot window costs no extra writes, and storage stays well inside D1's 500 MB.

---

## Deferred — Parquet monthly compaction

Not worth doing now.

- **Downloads would barely shrink.** File size is dominated by the `visitor_id` hash column, which does not compress. Visitors rarely return across days (sample: 1,520 summed daily UV vs 1,369 UV over 4 days), so a monthly dictionary saves little.
- **Request count is cheap.** Parallel requests over HTTP/2, day files cached immutable in the browser, and Worker / R2 operation counts far inside the free tier.
- **Costs are real:** a Durable Object would decode and re-encode ~400K rows near the 128 MB memory limit; the manifest and coverage logic would handle two file kinds; browser caches would be invalidated; dailies would need deleting.
- **Do instead:** the Phase 3 size preflight, concurrency limit and progress bar. Check real day sizes (Phase 0).
- **Revisit** when typical reports span more than ~3 months. Sketch then: `events/v1/month/YYYYMM.parquet`, sorted by day with one row group per day (allows HTTP range reads of single days), written after the month closes plus a straggler margin, dailies deleted a month later.

## Docs to update as phases land

- `CLAUDE.md`: tab names, the filtered-range cap, index set and writes-per-pageview floor (currently "4"), prune behaviour.
- `README.md`: dashboard description.
