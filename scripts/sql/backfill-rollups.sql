-- One-time backfill of the read-path rollups. Needs the rollup tables, i.e. any
-- database that has had its migrations applied (see drizzle/):
--   python scripts/manage.py run-sql backfill-rollups [deployment]
--   wrangler d1 execute cloudflare_stats_db --remote --file=scripts/sql/backfill-rollups.sql
--
-- ## COST -- read this before running
--
-- This makes 14 passes over the selected window. At 7.5K PV/day and the default
-- 31-day window that is ~3.2M rows read: roughly 2/3 of a day's free budget, in
-- one shot. Run it right after the daily quota resets (00:00 UTC) with the
-- dashboard closed. It writes only ~30K rows, well inside the 100K/day limit.
--
-- The free alternative is to build the rollup offline from a database export and
-- upload the resulting INSERTs -- see `scripts/export.sh`. That costs no read
-- quota at all and can cover the full 180-day history in one go.
--
-- ## SCOPE
--
-- 31 days, which covers every dashboard preset (today / yesterday / 7d / 28d).
-- Today is deliberately NOT sealed: it is always read live from events_tab and
-- merged at query time, so it is never stale. Older days are sealed backwards a
-- few per night by the cron (runMaintenance -> extendRollupHistory); until they
-- are covered, queries reaching further back fall back to raw scans and stay
-- exactly as correct as they are today.
--
-- Re-running this file is safe -- every write is an idempotent upsert keyed on
-- the natural key, so a day is recomputed rather than double-counted.
--
-- Window bounds below use date('now'), which is UTC. With a UTC+N display
-- timezone that can land a day early, which only ever seals one day fewer than
-- it could -- never a partial day. Deliberately conservative.

-- --------------------------------------------------------------------------
-- 1) Per-dimension rollup. COALESCE(<col>, 0) maps "dimension absent" onto the
--    0 sentinel; a NULL key would never match ON CONFLICT and would duplicate.
-- --------------------------------------------------------------------------
INSERT INTO dim_daily_tab (dimension, day, value_id, pv)
SELECT 'path', day, COALESCE(path_id, 0), COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, path_id
ON CONFLICT(dimension, day, value_id) DO UPDATE SET pv = excluded.pv;

INSERT INTO dim_daily_tab (dimension, day, value_id, pv)
SELECT 'referrer_domain', day, COALESCE(ref_domain_id, 0), COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, ref_domain_id
ON CONFLICT(dimension, day, value_id) DO UPDATE SET pv = excluded.pv;

INSERT INTO dim_daily_tab (dimension, day, value_id, pv)
SELECT 'country', day, COALESCE(country_id, 0), COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, country_id
ON CONFLICT(dimension, day, value_id) DO UPDATE SET pv = excluded.pv;

INSERT INTO dim_daily_tab (dimension, day, value_id, pv)
SELECT 'browser', day, COALESCE(browser_id, 0), COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, browser_id
ON CONFLICT(dimension, day, value_id) DO UPDATE SET pv = excluded.pv;

INSERT INTO dim_daily_tab (dimension, day, value_id, pv)
SELECT 'browser_version', day, COALESCE(browser_ver_id, 0), COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, browser_ver_id
ON CONFLICT(dimension, day, value_id) DO UPDATE SET pv = excluded.pv;

INSERT INTO dim_daily_tab (dimension, day, value_id, pv)
SELECT 'os', day, COALESCE(os_id, 0), COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, os_id
ON CONFLICT(dimension, day, value_id) DO UPDATE SET pv = excluded.pv;

INSERT INTO dim_daily_tab (dimension, day, value_id, pv)
SELECT 'os_version', day, COALESCE(os_ver_id, 0), COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, os_ver_id
ON CONFLICT(dimension, day, value_id) DO UPDATE SET pv = excluded.pv;

INSERT INTO dim_daily_tab (dimension, day, value_id, pv)
SELECT 'device_type', day, COALESCE(device_type_id, 0), COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, device_type_id
ON CONFLICT(dimension, day, value_id) DO UPDATE SET pv = excluded.pv;

INSERT INTO dim_daily_tab (dimension, day, value_id, pv)
SELECT 'device_vendor', day, COALESCE(device_vendor_id, 0), COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, device_vendor_id
ON CONFLICT(dimension, day, value_id) DO UPDATE SET pv = excluded.pv;

INSERT INTO dim_daily_tab (dimension, day, value_id, pv)
SELECT 'device_model', day, COALESCE(device_model_id, 0), COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, device_model_id
ON CONFLICT(dimension, day, value_id) DO UPDATE SET pv = excluded.pv;

-- --------------------------------------------------------------------------
-- 2) Hierarchy tuples for the sunburst.
-- --------------------------------------------------------------------------
INSERT INTO hier_daily_tab (hier, day, k0, k1, k2, pv)
SELECT 'browser', day, COALESCE(browser_id, 0), COALESCE(browser_ver_id, 0), 0,
       COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, browser_id, browser_ver_id
ON CONFLICT(hier, day, k0, k1, k2) DO UPDATE SET pv = excluded.pv;

INSERT INTO hier_daily_tab (hier, day, k0, k1, k2, pv)
SELECT 'os', day, COALESCE(os_id, 0), COALESCE(os_ver_id, 0), 0,
       COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, os_id, os_ver_id
ON CONFLICT(hier, day, k0, k1, k2) DO UPDATE SET pv = excluded.pv;

INSERT INTO hier_daily_tab (hier, day, k0, k1, k2, pv)
SELECT 'device', day, COALESCE(device_type_id, 0), COALESCE(device_vendor_id, 0), COALESCE(device_model_id, 0),
       COUNT(*) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day, device_type_id, device_vendor_id, device_model_id
ON CONFLICT(hier, day, k0, k1, k2) DO UPDATE SET pv = excluded.pv;

-- --------------------------------------------------------------------------
-- 3) Site-wide daily PV/UV. site_daily_tab already exists but has only ever
--    been filled for yesterday+today, so it has gaps. It is the source for the
--    trend chart and the headline cards -- and it is the ONLY rollup carrying
--    uv, because per-day site-wide distinct visitors is the one UV figure that
--    is both cheap to precompute and never summed across days by the read path.
-- --------------------------------------------------------------------------
INSERT INTO site_daily_tab (day, pv, uv)
SELECT day, COUNT(*), COUNT(DISTINCT visitor_id) FROM events_tab
WHERE day BETWEEN CAST(strftime('%Y%m%d', date('now', '-31 days')) AS INTEGER)
              AND CAST(strftime('%Y%m%d', date('now', '-1 day')) AS INTEGER)
GROUP BY day
ON CONFLICT(day) DO UPDATE SET pv = excluded.pv, uv = excluded.uv;

-- --------------------------------------------------------------------------
-- 4) Record the covered window. A query starting before rollup_min_day bypasses
--    the rollups entirely rather than returning a partial count.
-- --------------------------------------------------------------------------
INSERT INTO meta_tab (key, value)
VALUES ('rollup_min_day', (SELECT CAST(COALESCE(MIN(day), 0) AS TEXT) FROM dim_daily_tab))
ON CONFLICT(key) DO UPDATE SET value = excluded.value;

INSERT INTO meta_tab (key, value)
VALUES ('rollup_max_day', (SELECT CAST(COALESCE(MAX(day), 0) AS TEXT) FROM dim_daily_tab))
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
