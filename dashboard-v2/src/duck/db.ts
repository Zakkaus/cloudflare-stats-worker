// In-browser DuckDB over the worker's Parquet archive.
//
// Every Month-over-Month query runs here, against day files downloaded once
// from R2 -- so arbitrary filters, excludes and exact unique-visitor counts
// cost 0 D1 rows. Only the live tail (today) comes from D1, via
// /api/archive/live, and it is re-fetched on reload rather than cached.
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

// A month that can be compared: yyyymm from one source table.
export interface MonthOption {
  key: string; // `${source}:${yyyymm}`
  source: string; // "server" or an import id
  month: number; // yyyymm
  label: string;
}

export interface ImportedSource {
  id: string; // table name, e.g. "imp_1"
  name: string; // file name(s) shown in the UI
  months: number[];
  rows: number;
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
  await conn.close();
  return db;
}

// Every table currently holding rows, used to build autocomplete suggestions
// for the MoM filter builder across whatever has been loaded so far.
const sources = new Set<string>(["server"]);

export function knownSources(): string[] {
  return [...sources];
}

// Distinct known values for a dimension, across every loaded source. Used
// only for autocomplete suggestions -- 0 D1 rows, all local to DuckDB-Wasm.
export async function dimensionValues(dim: Dimension): Promise<string[]> {
  if (!DIMENSIONS.includes(dim)) throw new Error(`bad dimension ${dim}`);
  const parts = [...sources].map((t) => `SELECT DISTINCT ${dim} AS v FROM ${t} WHERE ${dim} IS NOT NULL`);
  const rows = await query<{ v: string }>(`${parts.join(" UNION ")} LIMIT 500`);
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

const toInt = (iso: string) => Number(iso.replace(/-/g, ""));
const monthOfIso = (iso: string) => Math.floor(toInt(iso) / 100);

function* eachDayInt(from: number, to: number) {
  const cur = new Date(Date.UTC(Math.floor(from / 10000), Math.floor((from % 10000) / 100) - 1, from % 100));
  for (;;) {
    const d = cur.getUTCFullYear() * 10000 + (cur.getUTCMonth() + 1) * 100 + cur.getUTCDate();
    if (d > to) return;
    yield d;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

export function serverMonths(manifest: Manifest): number[] {
  const months = new Set(manifest.days.map((d) => monthOfIso(d.day)));
  months.add(monthOfIso(manifest.live.from));
  months.add(monthOfIso(manifest.live.to));
  return [...months].sort((a, b) => a - b);
}

// Days (yyyymmdd) held in the `server` table, by where they came from. A live
// day is a partial snapshot: it is replaced on refresh, and superseded by its
// archived file once the nightly cron has written one.
const archivedDays = new Set<number>();
const liveDays = new Set<number>();
let fileSeq = 0;
// Loads share one table, so they run one at a time (both pickers can ask at
// once, and both may want the live tail).
let loadQueue: Promise<unknown> = Promise.resolve();

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

// Make sure every archived day of `month` is loaded, plus the live tail if it
// falls in that month. Returns the number of day files downloaded.
export function loadServerMonth(manifest: Manifest, month: number, { refreshLive = false } = {}): Promise<number> {
  const run = loadQueue.then(() => loadServerMonthNow(manifest, month, refreshLive));
  loadQueue = run.catch(() => undefined);
  return run;
}

async function loadServerMonthNow(manifest: Manifest, month: number, refreshLive: boolean): Promise<number> {
  const wanted = manifest.days.filter((d) => monthOfIso(d.day) === month && !archivedDays.has(toInt(d.day)));
  const buffers = await Promise.all(
    wanted.map((d) => fetchBytes(`/api/archive/file?day=${d.day}&v=${encodeURIComponent(d.etag)}`))
  );
  // An archived file replaces any live snapshot previously loaded for its day.
  const superseded = wanted.map((d) => toInt(d.day)).filter((d) => liveDays.has(d));
  for (const d of superseded) {
    await query("DELETE FROM server WHERE day = ?", [d]);
    liveDays.delete(d);
  }
  await insertParquet("server", buffers.filter((b): b is Uint8Array => b !== null));
  for (const d of wanted) archivedDays.add(toInt(d.day));

  const liveFrom = toInt(manifest.live.from);
  const liveTo = toInt(manifest.live.to);
  const liveTouches = Math.floor(liveFrom / 100) <= month && month <= Math.floor(liveTo / 100);
  if (liveTouches && (refreshLive || !liveDays.has(liveTo))) {
    const bytes = await fetchBytes(`/api/archive/live${refreshLive ? `?t=${Date.now()}` : ""}`);
    await query("DELETE FROM server WHERE day BETWEEN ? AND ?", [liveFrom, liveTo]);
    if (bytes) await insertParquet("server", [bytes]);
    for (const d of eachDayInt(liveFrom, liveTo)) liveDays.add(d);
  }
  return wanted.length;
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
  const months = (await query<{ m: number }>(`SELECT DISTINCT day // 100 AS m FROM ${id} ORDER BY m`)).map((r) => r.m);
  const [{ n }] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${id}`);
  sources.add(id);
  return { id, name: files.map((f) => f.name).join(", "), months, rows: n };
}

// --- Export ------------------------------------------------------------------

// Write one month of a source as a single self-contained Parquet file in the
// archive schema, so it can be imported back later (or read by any engine).
export async function exportMonth(source: string, month: number, filename: string): Promise<void> {
  const db = await getDb();
  const out = `export_${++fileSeq}.parquet`;
  await query(
    `COPY (SELECT ${COLUMN_LIST} FROM ${tableFor(source)} WHERE day BETWEEN ${month * 100 + 1} AND ${month * 100 + 31}
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

// Source ids are generated here ("server" / "imp_<n>"), never user input, but
// validate anyway since they are interpolated as identifiers.
export function tableFor(source: string): string {
  if (source !== "server" && !/^imp_\d+$/.test(source)) throw new Error(`bad source ${source}`);
  return source;
}
