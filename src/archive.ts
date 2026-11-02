// Parquet archive of raw pageviews -- one immutable file per closed day in R2.
//
// Every file is self-contained and denormalized: dimension *strings* are stored
// (Parquet dictionary-encodes them, so a repeated path costs a few bits per
// row, not its bytes), never the per-deployment dim ids. A daily file, the live
// file, a month the dashboard exports and a file it imports back all share this
// one schema, so DuckDB can union any of them.
//
//   day         INT32   yyyymmdd in the configured timezone
//   visitor_id  INT64   52-bit hash, as in events_tab
//   <dimension> STRING  one nullable column per DIMENSIONS key; NULL = direct/unknown
//
// Shared by the worker (nightly export, live endpoint) and the Node scripts
// (backfill, verify, bench), so every producer writes byte-identical layouts.
//
// Encoding used to be hand-rolled (dictionary columns written directly against
// D1's dim ids) because it ran inline in the Worker's fetch handler, capped at
// 10ms CPU on Workers Free. It now runs in the ArchiveWriter Durable Object,
// which gets 30s CPU per invocation regardless of plan -- measured well over
// 100x that even with hyparquet-writer's generic parquetWriteBuffer() doing
// its own dictionary discovery (bench-archive.mjs; real DO cpuTimeMs seen in
// production tops out around 15ms for a day's rows). So this just calls it
// directly instead of maintaining a hand-rolled encoder for a limit that no
// longer applies.

// Submodule path, not the bare "hyparquet-writer" specifier: the package's
// "." export conditionally resolves to src/node.js (imports Node's `fs` for
// parquetWriteFile), which this file has no reason to pull in.
import type { ColumnSource } from "hyparquet-writer";
import { parquetWriteBuffer } from "hyparquet-writer/src/write.js";
import { DIMENSIONS, type DimensionName } from "./dimensions.ts";

export const ARCHIVE_SCHEMA_VERSION = "1";
export const ARCHIVE_PREFIX = `events/v${ARCHIVE_SCHEMA_VERSION}/`;
export const ARCHIVE_CONTENT_TYPE = "application/vnd.apache.parquet";

export const DIMENSION_NAMES = Object.keys(DIMENSIONS) as DimensionName[];
const DIM_ENTRIES = Object.values(DIMENSIONS);

// One events_tab row as D1's `.raw()` returns it: [day, visitor_id, ...dim ids].
export type FactRow = [day: number, visitorId: number, ...dimIds: (number | null)[]];

// events_tab column order the encoder expects from fetchDayRows().
export const FACT_COLUMNS = ["day", "visitor_id", ...DIM_ENTRIES.map((d) => d.col)];

// yyyymmdd -> "events/v1/YYYY/MM/YYYYMMDD.parquet"
export function archiveKey(day: number): string {
  const s = String(day);
  return `${ARCHIVE_PREFIX}${s.slice(0, 4)}/${s.slice(4, 6)}/${s}.parquet`;
}

// Inverse of archiveKey; null for anything that is not a day file.
export function dayFromKey(key: string): number | null {
  const m = /\/(\d{8})\.parquet$/.exec(key);
  return m ? Number(m[1]) : null;
}

// One statement, `.raw()` so D1 hands back arrays instead of building an
// object per row. Uses idx_events_day; reads one row per pageview.
export async function fetchDayRows(db: D1Database, from: number, to: number): Promise<FactRow[]> {
  return db
    .prepare(`SELECT ${FACT_COLUMNS.join(", ")} FROM events_tab WHERE day BETWEEN ? AND ?`)
    .bind(from, to)
    .raw<FactRow>();
}

// id -> value for only the dim rows these events reference. The ids travel as
// one JSON parameter (json_each), which sidesteps D1's 100-bound-parameter cap
// and keeps rows read to the number of *distinct* values, not events.
export async function fetchDimMaps(db: D1Database, rows: FactRow[]): Promise<Map<number, string>[]> {
  const idSets = DIM_ENTRIES.map(() => new Set<number>());
  for (const row of rows) {
    for (let j = 0; j < DIM_ENTRIES.length; j += 1) {
      const id = row[2 + j];
      if (id !== null) idSets[j].add(id as number);
    }
  }
  const maps = DIM_ENTRIES.map(() => new Map<number, string>());
  const wanted = DIM_ENTRIES.map((dim, j) => ({ dim, j })).filter(({ j }) => idSets[j].size > 0);
  if (wanted.length === 0) return maps;
  const results = await db.batch<{ id: number; value: string }>(
    wanted.map(({ dim, j }) =>
      db
        .prepare(`SELECT id, value FROM ${dim.table} WHERE id IN (SELECT value FROM json_each(?))`)
        .bind(JSON.stringify([...idSets[j]]))
    )
  );
  wanted.forEach(({ j }, k) => {
    for (const r of results[k].results) maps[j].set(r.id, r.value);
  });
  return maps;
}

// rows: arrays in FACT_COLUMNS order. dimMaps: one id->value Map per dimension,
// in DIMENSIONS order. Returns the Parquet file bytes.
export function encodeEvents(
  rows: FactRow[],
  dimMaps: Map<number, string>[],
  { timezone = "", site = "" }: { timezone?: string; site?: string } = {}
): Uint8Array {
  const n = rows.length;
  const day = new Int32Array(n);
  const visitorId = new Array<bigint>(n);
  for (let i = 0; i < n; i += 1) {
    day[i] = rows[i][0];
    visitorId[i] = BigInt(rows[i][1]);
  }
  const columnData: ColumnSource[] = [
    { name: "day", type: "INT32", nullable: false, data: day },
    { name: "visitor_id", type: "INT64", nullable: false, data: visitorId },
  ];
  DIMENSION_NAMES.forEach((name, j) => {
    const map = dimMaps[j];
    const values = new Array<string | null>(n);
    for (let i = 0; i < n; i += 1) {
      const id = rows[i][2 + j];
      if (id === null) {
        values[i] = null;
        continue;
      }
      const value = map.get(id);
      // Dim rows are never deleted, so a miss is a bug -- fail loudly rather
      // than silently archiving the event as "(unknown)".
      if (value === undefined) throw new Error(`archive: no ${name} value for id ${id}`);
      values[i] = value;
    }
    columnData.push({ name, type: "STRING", nullable: true, data: values });
  });
  const buffer = parquetWriteBuffer({
    columnData,
    codec: "UNCOMPRESSED", // bit-packed dictionary indices already beat snappy on this shape
    kvMetadata: [
      { key: "schema_version", value: ARCHIVE_SCHEMA_VERSION },
      { key: "timezone", value: timezone },
      { key: "site", value: site },
    ],
  });
  return new Uint8Array(buffer);
}
