// Parquet encoding runs here, not in the Worker, purely for the CPU budget.
//
// Workers Free allows 10ms CPU per invocation -- cron included -- which the
// Worker's own fetch handler could never spend on a day's worth of encoding.
// A Durable Object invocation gets its own CPU allowance of 30s on every plan
// (SQLite-backed classes run on Free), so the nightly cron and
// /api/archive/live hand the work to this singleton over RPC. It keeps no
// state: no ctx.storage, no fields -- D1 in, R2 out.
import { DurableObject } from "cloudflare:workers";
import { archiveKey, encodeEvents, fetchDayRows, fetchDimMaps, ARCHIVE_CONTENT_TYPE } from "./archive.ts";

export interface ArchiveMeta {
  timezone: string;
  site: string;
}

export class ArchiveWriter extends DurableObject<Env> {
  // Encode and store each day as its own immutable R2 object. A day with no
  // pageviews gets no file; the manifest simply has no entry for it.
  // Returns [{ day, bytes }] for the days processed.
  async exportDays(days: number[], meta: ArchiveMeta): Promise<{ day: number; bytes: number }[]> {
    const db = this.env.DB;
    const out: { day: number; bytes: number }[] = [];
    for (const day of days) {
      const bytes = await encodeRange(db, day, day, meta);
      if (bytes) {
        await this.env.ARCHIVE.put(archiveKey(day), bytes, {
          httpMetadata: { contentType: ARCHIVE_CONTENT_TYPE },
        });
      }
      out.push({ day, bytes: bytes ? bytes.byteLength : 0 });
    }
    return out;
  }

  // The not-yet-archived tail (normally just today), encoded on the fly.
  // Returns the file bytes, or null when there are no events yet.
  async encodeLive(from: number, to: number, meta: ArchiveMeta): Promise<Uint8Array | null> {
    return encodeRange(this.env.DB, from, to, meta);
  }
}

async function encodeRange(db: D1Database, from: number, to: number, meta: ArchiveMeta): Promise<Uint8Array | null> {
  const rows = await fetchDayRows(db, from, to);
  if (rows.length === 0) return null;
  const dimMaps = await fetchDimMaps(db, rows);
  return encodeEvents(rows, dimMaps, meta);
}
