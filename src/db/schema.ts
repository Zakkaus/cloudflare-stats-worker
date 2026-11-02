// D1 schema (database: cloudflare_stats_db) -- the source of truth that
// `drizzle-kit generate` turns into migrations under ./drizzle.
//
// Naming convention: database uses "_db" suffix, every table uses "_tab" suffix.
//
// Storage model:
//   * events_tab         raw one-row-per-pageview fact table (hot 6-month window)
//   * dim_*_tab          dictionary/lookup tables (categorical dimensions -> integer FK)
//   * site_daily_tab     per-day PV/UV rollup (headline cards + trend chart)
//   * dim_daily_tab      per-day, per-dimension rollup (dimension breakdowns)
//   * hier_daily_tab     per-day rollup of the 3 drill-down hierarchies (sunburst)
//   * meta_tab           rollup coverage bounds + periodic all-time UV snapshot
//   * events_monthly_tab archive of data older than 6 months (EAV long-format)
//
// PV = COUNT(*) over events_tab. UV = COUNT(DISTINCT visitor_id) over events_tab
// (not additive across dimensions, which is why raw visitor_id rows are kept for
// the hot window).
//
// READ PATH: no dashboard endpoint scans the full events_tab. The rollups cover
// every sealed (past) day; today is read live from events_tab and merged in at
// query time. events_tab is scanned over the whole range only when a query is
// filtered, or asks for exact unique visitors across more than one day.
//
// !! WITHOUT ROWID !!  dim_daily_tab, hier_daily_tab and meta_tab are
// `WITHOUT ROWID` in the deployed databases: a rowid table with a composite
// primary key carries a separate PK index and bills TWO written rows per upsert
// (the nightly seal writes thousands), where WITHOUT ROWID bills one. drizzle
// cannot express this, so the generated migration is edited by hand and
// scripts/check-migrations.mjs fails the build if the clause goes missing. If
// you ever change one of those tables' primary key, drizzle-kit will emit a
// table-recreate that silently drops it -- re-apply the edit.
//
// The legacy V1 tables (page_stats, site_daily_stats) are deliberately not
// modelled: nothing writes them, and drizzle never drops what it does not know.
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { DIMENSIONS, type DimensionName } from "../dimensions.ts";

// ---------------------------------------------------------------------------
// Dimension lookup tables (dictionary encoding). Real ids start at 1; 0 is the
// "dimension absent" sentinel the rollups use (see NULL_VALUE_ID).
// ---------------------------------------------------------------------------
// Typed with a plain `string` name so every dimension table shares one type and
// can be indexed by dimension name without a union of table types.
const dimTable = (name: string) =>
  sqliteTable(name, {
    id: integer("id").primaryKey(),
    value: text("value").notNull().unique(),
  });

// The table names come from DIMENSIONS, which the raw SQL (rollups, labels, the
// archive) interpolates -- so the query builder and the raw statements cannot
// end up on different tables. Each table stays its own named export because
// drizzle-kit only discovers tables that are exported by name.
export const dimPathTab = dimTable(DIMENSIONS.path.table);
export const dimRefDomainTab = dimTable(DIMENSIONS.referrer_domain.table);
export const dimCountryTab = dimTable(DIMENSIONS.country.table);
export const dimBrowserTab = dimTable(DIMENSIONS.browser.table);
export const dimBrowserVerTab = dimTable(DIMENSIONS.browser_version.table);
export const dimOsTab = dimTable(DIMENSIONS.os.table);
export const dimOsVerTab = dimTable(DIMENSIONS.os_version.table);
export const dimDeviceTypeTab = dimTable(DIMENSIONS.device_type.table);
export const dimDeviceVendorTab = dimTable(DIMENSIONS.device_vendor.table);
export const dimDeviceModelTab = dimTable(DIMENSIONS.device_model.table);

// Keyed like DIMENSIONS (src/dimensions.ts).
export const dimTables: Record<DimensionName, typeof dimPathTab> = {
  path: dimPathTab,
  referrer_domain: dimRefDomainTab,
  country: dimCountryTab,
  browser: dimBrowserTab,
  browser_version: dimBrowserVerTab,
  os: dimOsTab,
  os_version: dimOsVerTab,
  device_type: dimDeviceTypeTab,
  device_vendor: dimDeviceVendorTab,
  device_model: dimDeviceModelTab,
};

// ---------------------------------------------------------------------------
// Raw event fact table (one row per non-bot pageview)
// ---------------------------------------------------------------------------
// Keep indexes deliberately few -- and the reason is WRITES, not storage. D1
// bills one written row per index that covers an inserted column, so every
// index here adds a row to the cost of every single pageview. At 7.5K PV/day
// the four below already cost ~30K of the 100K/day free write budget; a fifth
// would be ~7.5K more. Reads are handled by dim_daily_tab instead, which is
// where the leverage actually is.
//
// These composite (day, <dim>) indexes only matter on the raw-scan fallback
// path (filtered queries and multi-day metric=visitors). `ref_domain_id` earns
// its slot because referrer is the dimension people actually filter on; the
// rest are served from the rollup and never scan events_tab.
//
// idx_events_day_ref is an opt-in on existing deployments
// (scripts/sql/add-referrer-index.sql: ~one written row per existing event),
// but a fresh install gets it from the start.
export const eventsTab = sqliteTable(
  "events_tab",
  {
    id: integer("id").primaryKey(), // rowid
    day: integer("day").notNull(), // yyyymmdd in configured TZ, e.g. 20260719
    visitorId: integer("visitor_id").notNull(), // first 13 hex of SHA-256(ip|ua) as 52-bit int
    pathId: integer("path_id").notNull(),
    refDomainId: integer("ref_domain_id"), // NULL = direct / no referrer
    countryId: integer("country_id"),
    browserId: integer("browser_id"),
    browserVerId: integer("browser_ver_id"), // low-priority
    osId: integer("os_id"),
    osVerId: integer("os_ver_id"), // low-priority
    deviceTypeId: integer("device_type_id"),
    deviceVendorId: integer("device_vendor_id"), // low-priority
    deviceModelId: integer("device_model_id"), // low-priority
  },
  (t) => [
    index("idx_events_day").on(t.day),
    index("idx_events_day_country").on(t.day, t.countryId),
    index("idx_events_day_path").on(t.day, t.pathId),
    index("idx_events_day_ref").on(t.day, t.refDomainId),
  ]
);

// ---------------------------------------------------------------------------
// Per-day site rollup (headline cards + trend chart, filled nightly by cron)
// ---------------------------------------------------------------------------
export const siteDailyTab = sqliteTable("site_daily_tab", {
  day: integer("day").primaryKey(), // yyyymmdd
  pv: integer("pv").notNull().default(0),
  uv: integer("uv").notNull().default(0), // exact per-day distinct visitors
});

// ---------------------------------------------------------------------------
// Per-day, per-dimension rollup -- the read path for dimension breakdowns.
//
// SEALED DAYS ONLY. A row here is written once, by the nightly cron, after the
// day has closed; it is never incremented. Today is always read live from
// events_tab and UNIONed in at query time: zero extra writes per pageview,
// today stays real-time exact, and a closed date range touches no raw rows.
//
// Key order (dimension, day, value_id) makes "one dimension over a date range"
// a single contiguous PK range scan: it reads exactly the rows it returns.
//
// value_id 0 is the sentinel for "dimension absent" ((direct) / (unknown)). It
// cannot be NULL: SQLite compares NULLs as distinct in a unique index, so a NULL
// key would never match ON CONFLICT and would silently duplicate rows.
//
// PV ONLY. A `uv` column would be exact per (dimension, value, day) but is not
// summable across days -- both silent over-counts. Unique visitors are always
// answered from events_tab. WITHOUT ROWID: see the note at the top.
// ---------------------------------------------------------------------------
export const dimDailyTab = sqliteTable(
  "dim_daily_tab",
  {
    dimension: text("dimension").notNull(), // key of DIMENSIONS in src/dimensions.ts
    day: integer("day").notNull(), // yyyymmdd
    valueId: integer("value_id").notNull(), // FK into the matching dim_*_tab; 0 = unknown/direct
    pv: integer("pv").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.dimension, t.day, t.valueId] })]
);

// ---------------------------------------------------------------------------
// Per-day rollup of the three drill-down hierarchies, as whole tuples.
// Tuples cannot be reconstructed from dim_daily_tab, so they are stored; this is
// affordable only because they are near-functional dependencies (~160 rows/day
// for all three). General 2-dimension pair rollups are deliberately NOT built.
// k* use the same 0 sentinel; k2 is 0 for the two-level hierarchies. PV only.
// WITHOUT ROWID: see the note at the top.
// ---------------------------------------------------------------------------
export const hierDailyTab = sqliteTable(
  "hier_daily_tab",
  {
    hier: text("hier").notNull(), // 'browser', 'os', 'device' (keys of HIERARCHIES)
    day: integer("day").notNull(),
    k0: integer("k0").notNull(),
    k1: integer("k1").notNull(),
    k2: integer("k2").notNull().default(0),
    pv: integer("pv").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.hier, t.day, t.k0, t.k1, t.k2] })]
);

// ---------------------------------------------------------------------------
// Small key/value store for rollup bookkeeping and periodic snapshots.
//   rollup_min_day / rollup_max_day   sealed-window bounds
//   uv_snapshot                       JSON { as_of, uv ... } for the headline cards
//   archive_min_day / archive_max_day Parquet archive window
// WITHOUT ROWID: see the note at the top.
// ---------------------------------------------------------------------------
export const metaTab = sqliteTable("meta_tab", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// ---------------------------------------------------------------------------
// Monthly archive for data older than 6 months (raw rows pruned after rollup).
// EAV long-format: one row per (month, dimension, value). uv is EXACT per single
// (dimension, value) but NOT summable and NOT cross-filterable -- that detail is
// destroyed on prune. The per-month grand total lives in the ('total','') row.
// ---------------------------------------------------------------------------
export const eventsMonthlyTab = sqliteTable(
  "events_monthly_tab",
  {
    month: integer("month").notNull(), // yyyymm
    dimension: text("dimension").notNull(), // 'total' or a DIMENSIONS key
    value: text("value").notNull(), // dimension value; '' for the 'total' row
    pv: integer("pv").notNull().default(0),
    uv: integer("uv").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.month, t.dimension, t.value] }),
    index("idx_events_monthly_dim").on(t.month, t.dimension),
    // The all-time card sums WHERE dimension = 'total', which cannot use the
    // index above (its leading column is `month`).
    index("idx_events_monthly_total").on(t.dimension, t.month),
  ]
);
