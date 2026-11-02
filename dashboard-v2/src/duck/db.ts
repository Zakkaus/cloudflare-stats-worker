// In-browser DuckDB over the worker's Parquet archive.
//
// Every Reports query runs here, against day files downloaded once from R2 -- so
// arbitrary filters, excludes and exact unique-visitor counts cost 0 D1 rows.
// Only the live tail (today) comes from D1, via /api/archive/live, and it is
// re-fetched on reload rather than cached.
//
// The engine is loaded from jsDelivr, pinned to the installed package version:
// its .wasm (~36 MB) is over the Workers static-asset size limit (25 MiB). Its
// parquet extension comes from extensions.duckdb.org.
import * as duckdb from "@duckdb/duckdb-wasm";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { Dimension } from "../api/types";

export const DIMENSIONS: Dimension[] = [
  "path",
  "referrer_domain",
  "country",
  "browser",
  "browser_version",
  "os",
  "os_version",
  "device_type",
  "device_vendor",
  "device_model",
];

// Archive schema v1 (src/archive.ts). Every table here uses exactly this
// column list, so server days, the live tail and imported files all union.
const COLUMNS_DDL = [
  "day INTEGER",
  "visitor_id BIGINT",
  ...DIMENSIONS.map((d) => `${d} VARCHAR`),
].join(", ");
const COLUMN_LIST = ["day", "visitor_id", ...DIMENSIONS].join(", ");
const CAST_LIST = [
  "CAST(day AS INTEGER) AS day",
  "CAST(visitor_id AS BIGINT) AS visitor_id",
  ...DIMENSIONS.map((d) => `CAST(${d} AS VARCHAR) AS ${d}`),
].join(", ");

export interface ManifestDay {
  day: string; // YYYY-MM-DD
  size: number;
  etag: string;
}
export interface Manifest {
  timezone: string;
  days: ManifestDay[];
  live: { from: string; to: string };
}

export interface ImportedSource {
  id: string; // table name, e.g. "imp_1"
  name: string; // file name(s) shown in the UI
  minDay: number; // yyyymmdd
  maxDay: number;
  days: number; // distinct days with data
  rows: number;
}

// An inclusive range of yyyymmdd ints.
export interface DayRange {
  from: number;
  to: number;
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let connPromise: Promise<AsyncDuckDBConnection> | null = null;

async function createDb(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  // A cross-origin Worker cannot be constructed from the CDN URL directly;
  // the documented workaround is a same-origin blob that importScripts() it.
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  const conn = await db.connect();
  // Parquet ships as an extension in duckdb-wasm, fetched from
  // extensions.duckdb.org on first use. Load it up front so a blocked or
  // failed download surfaces here, not as a mid-query error.
  await conn.query("LOAD parquet");
  await conn.query(`CREATE TABLE IF NOT EXISTS server (${COLUMNS_DDL})`);
  await conn.query(`CREATE OR REPLACE VIEW events AS SELECT ${COLUMN_LIST} FROM server`);
  await conn.close();
  return db;
}

// Distinct known values for a dimension, across everything loaded so far. Used
// only for autocomplete suggestions -- 0 D1 rows, all local to DuckDB-Wasm.
export async function dimensionValues(dim: Dimension): Promise<string[]> {
  if (!DIMENSIONS.includes(dim)) throw new Error(`bad dimension ${dim}`);
  const rows = await query<{ v: string }>(`SELECT DISTINCT ${dim} AS v FROM events WHERE ${dim} IS NOT NULL LIMIT 500`);
  return rows.map((r) => r.v);
}

export function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = createDb();
    dbPromise.catch(() => {
      dbPromise = null; // let a later attempt retry
    });
  }
  return dbPromise;
}

async function conn(): Promise<AsyncDuckDBConnection> {
  if (!connPromise) connPromise = getDb().then((db) => db.connect());
  return connPromise;
}

// Run a parameterized query and return plain JS rows. BIGINT counts arrive as
// bigint from Arrow; they are converted to number (counts here are far below
// 2^53).
export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await conn();
  let table;
  if (params.length) {
    const stmt = await c.prepare(sql);
    try {
      table = await stmt.query(...params);
    } finally {
      await stmt.close();
    }
  } else {
    table = await c.query(sql);
  }
  return table.toArray().map((row: any) => {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row.toJSON())) obj[k] = typeof v === "bigint" ? Number(v) : v;
    return obj as T;
  });
}

// --- Server (R2) source ------------------------------------------------------

export async function fetchManifest(): Promise<Manifest> {
  const res = await fetch("/api/archive/manifest");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Archive manifest failed (${res.status})`);
  }
  return res.json();
}

export const toInt = (iso: string) => Number(iso.replace(/-/g, ""));
export const dayToIso = (d: number) => `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}`;

export function* eachDayInt(from: number, to: number) {
  const cur = new Date(Date.UTC(Math.floor(from / 10000), Math.floor((from % 10000) / 100) - 1, from % 100));
  for (;;) {
    const d = cur.getUTCFullYear() * 10000 + (cur.getUTCMonth() + 1) * 100 + cur.getUTCDate();
    if (d > to) return;
    yield d;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

// Days (yyyymmdd) held in the `server` table, by where they came from. A live
// day is a partial snapshot: it is replaced on refresh, and superseded by its
// archived file once the nightly cron has written one.
const archivedDays = new Set<number>();
const liveDays = new Set<number>();
// Days each imported file holds, in import order.
const importedDays = new Map<string, Set<number>>();
let fileSeq = 0;
// Loads share one table, so they run one at a time.
let loadQueue: Promise<unknown> = Promise.resolve();

// Every report query reads the `events` view: all server rows, plus imported
// rows only for days the server does not have (and, between imports, the first
// import to hold a day wins), so overlapping sources never double count. A view
// is re-evaluated on every read, so loading more server days needs nothing here;
// only a new import table changes its definition.
async function rebuildEventsView(): Promise<void> {
  const seen = ["SELECT DISTINCT day FROM server"];
  const parts = [`SELECT ${COLUMN_LIST} FROM server`];
  for (const id of importedDays.keys()) {
    parts.push(`SELECT ${COLUMN_LIST} FROM ${id} WHERE day NOT IN (${seen.join(" UNION ")})`);
    seen.push(`SELECT DISTINCT day FROM ${id}`);
  }
  await query(`CREATE OR REPLACE VIEW events AS ${parts.join(" UNION ALL ")}`);
}

async function insertParquet(table: string, buffers: Uint8Array[]): Promise<void> {
  if (!buffers.length) return;
  const db = await getDb();
  const names = buffers.map(() => `f${++fileSeq}.parquet`);
  await Promise.all(names.map((n, i) => db.registerFileBuffer(n, buffers[i])));
  try {
    const list = names.map((n) => `'${n}'`).join(", ");
    await query(`INSERT INTO ${table} SELECT ${CAST_LIST} FROM read_parquet([${list}])`);
  } finally {
    await Promise.all(names.map((n) => db.dropFile(n)));
  }
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url);
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Run `fn` over `items` with at most `limit` in flight, keeping result order.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const DOWNLOAD_CONCURRENCY = 6;
// Day files are registered with DuckDB in batches: bounded memory, and progress
// that keeps moving while a long range loads.
const INSERT_BATCH = 24;

export interface Pending {
  files: number;
  bytes: number;
  live: boolean; // today's partial file (not cached, always re-fetched)
}

function inAny(day: number, ranges: DayRange[]) {
  return ranges.some((r) => day >= r.from && day <= r.to);
}

// What loading `ranges` would still download: the archived day files not in the
// browser yet, with their sizes, so the picker can show it before Apply.
export function pendingLoad(manifest: Manifest, ranges: DayRange[]): Pending {
  let files = 0;
  let bytes = 0;
  for (const d of manifest.days) {
    const day = toInt(d.day);
    if (inAny(day, ranges) && !archivedDays.has(day)) {
      files += 1;
      bytes += d.size;
    }
  }
  const liveFrom = toInt(manifest.live.from);
  const liveTo = toInt(manifest.live.to);
  const live = ranges.some((r) => r.from <= liveTo && r.to >= liveFrom) && !liveDays.has(liveTo);
  return { files, bytes, live };
}

// Make sure every archived day inside `ranges` is loaded, plus the live tail if a
// range reaches it. Returns the number of day files downloaded.
export function loadDays(
  manifest: Manifest,
  ranges: DayRange[],
  { refreshLive = false, onProgress }: { refreshLive?: boolean; onProgress?: (done: number, total: number) => void } = {}
): Promise<number> {
  const run = loadQueue.then(() => loadDaysNow(manifest, ranges, refreshLive, onProgress));
  loadQueue = run.catch(() => undefined);
  return run;
}

async function loadDaysNow(
  manifest: Manifest,
  ranges: DayRange[],
  refreshLive: boolean,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const wanted = manifest.days.filter((d) => inAny(toInt(d.day), ranges) && !archivedDays.has(toInt(d.day)));
  let done = 0;
  onProgress?.(0, wanted.length);
  for (let i = 0; i < wanted.length; i += INSERT_BATCH) {
    const batch = wanted.slice(i, i + INSERT_BATCH);
    const buffers = await mapPool(batch, DOWNLOAD_CONCURRENCY, async (d) => {
      const bytes = await fetchBytes(`/api/archive/file?day=${d.day}&v=${encodeURIComponent(d.etag)}`);
      onProgress?.(++done, wanted.length);
      return bytes;
    });
    // An archived file replaces any live snapshot previously loaded for its day.
    for (const d of batch.map((x) => toInt(x.day)).filter((x) => liveDays.has(x))) {
      await query("DELETE FROM server WHERE day = ?", [d]);
      liveDays.delete(d);
    }
    await insertParquet("server", buffers.filter((b): b is Uint8Array => b !== null));
    for (const d of batch) archivedDays.add(toInt(d.day));
  }

  const liveFrom = toInt(manifest.live.from);
  const liveTo = toInt(manifest.live.to);
  const liveTouches = ranges.some((r) => r.from <= liveTo && r.to >= liveFrom);
  if (liveTouches && (refreshLive || !liveDays.has(liveTo))) {
    const bytes = await fetchBytes(`/api/archive/live${refreshLive ? `?t=${Date.now()}` : ""}`);
    await query("DELETE FROM server WHERE day BETWEEN ? AND ?", [liveFrom, liveTo]);
    if (bytes) await insertParquet("server", [bytes]);
    for (const d of eachDayInt(liveFrom, liveTo)) liveDays.add(d);
  }
  return wanted.length;
}

// --- Coverage -----------------------------------------------------------------

export interface DayCoverage {
  days: number;
  server: number; // from the archive (or today's live file)
  imported: number; // only in an imported file
  missing: number; // in neither: no events that day, or not archived yet
}

// Where each day of a range came from, for the coverage line under the picker.
export function dayCoverage(range: DayRange): DayCoverage {
  const out: DayCoverage = { days: 0, server: 0, imported: 0, missing: 0 };
  for (const day of eachDayInt(range.from, range.to)) {
    out.days += 1;
    if (archivedDays.has(day) || liveDays.has(day)) out.server += 1;
    else if ([...importedDays.values()].some((s) => s.has(day))) out.imported += 1;
    else out.missing += 1;
  }
  return out;
}

// The span the picker may choose from: everything the server has plus every
// imported file, as yyyy-mm-dd. null while neither has any data.
export function coverageBounds(manifest: Manifest | null, imports: ImportedSource[]): { min: string; max: string } | null {
  const mins: number[] = [];
  const maxs: number[] = [];
  if (manifest) {
    // With only a live tail there is no archive yet: the earliest day is the live one.
    mins.push(manifest.days.length ? toInt(manifest.days[0].day) : toInt(manifest.live.from));
    maxs.push(toInt(manifest.live.to));
  }
  for (const i of imports) {
    mins.push(i.minDay);
    maxs.push(i.maxDay);
  }
  if (!mins.length || !maxs.length) return null;
  return { min: dayToIso(Math.min(...mins)), max: dayToIso(Math.max(...maxs)) };
}

// --- Imported files ----------------------------------------------------------

let importSeq = 0;

export async function importFiles(files: File[]): Promise<ImportedSource> {
  const db = await getDb();
  const id = `imp_${++importSeq}`;
  const names = files.map((f, i) => `${id}_${i}.parquet`);
  await Promise.all(
    files.map(async (f, i) => db.registerFileBuffer(names[i], new Uint8Array(await f.arrayBuffer())))
  );
  try {
    const list = names.map((n) => `'${n}'`).join(", ");
    try {
      await query(`CREATE TABLE ${id} AS SELECT ${CAST_LIST} FROM read_parquet([${list}], union_by_name = true)`);
    } catch (err) {
      throw new Error(
        `Not an archive file (expected columns ${COLUMN_LIST}): ${err instanceof Error ? err.message : err}`
      );
    }
  } finally {
    await Promise.all(names.map((n) => db.dropFile(n)));
  }
  const days = (await query<{ d: number }>(`SELECT DISTINCT day AS d FROM ${id} ORDER BY d`)).map((r) => r.d);
  const [{ n }] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${id}`);
  importedDays.set(id, new Set(days));
  await rebuildEventsView();
  return { id, name: files.map((f) => f.name).join(", "), minDay: days[0] ?? 0, maxDay: days.at(-1) ?? 0, days: days.length, rows: n };
}

// --- Export ------------------------------------------------------------------

// Write a range of everything loaded (server days and imports merged) as one
// self-contained Parquet file in the archive schema, so it can be imported back
// later (or read by any engine). Bounds are validated ints, interpolated because
// COPY does not take parameters.
export async function exportRange(range: DayRange, filename: string): Promise<void> {
  const db = await getDb();
  const from = Math.trunc(range.from);
  const to = Math.trunc(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("bad range");
  const out = `export_${++fileSeq}.parquet`;
  await query(
    `COPY (SELECT ${COLUMN_LIST} FROM events WHERE day BETWEEN ${from} AND ${to}
     ORDER BY day) TO '${out}' (FORMAT parquet, COMPRESSION zstd, KV_METADATA {schema_version: '1'})`
  );
  const bytes = await db.copyFileToBuffer(out);
  await db.dropFile(out);
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.apache.parquet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
