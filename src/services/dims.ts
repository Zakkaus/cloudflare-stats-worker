// Dimension dictionary: value <-> integer id, per dimension table.
import { eq } from "drizzle-orm";
import { dimTables } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import type { DimensionName } from "../dimensions.ts";

// Abuse bounds. Attacker-influenced values (dimension strings, filter tokens)
// must never grow unbounded -- these cap per-request work and per-isolate memory.
const MAX_DIM_VALUE_LEN = 512; // clamp any single dimension string before it hits D1
const MAX_DIM_CACHE_ENTRIES = 10000; // FIFO cap on the isolate-global dim-id cache

// Isolate-global dimension-id cache (dimension::value -> id). Dims are small and
// stable, so after warm-up the ingest path only runs the event INSERT.
const dimCache = new Map<string, number>();

// Clamp length so an attacker can't bloat dim tables / the cache with huge
// strings. Applied on both write and lookup so filters resolve to the stored value.
function clampDimValue(value: unknown): string {
  const s = `${value}`;
  return s.length > MAX_DIM_VALUE_LEN ? s.slice(0, MAX_DIM_VALUE_LEN) : s;
}

// Get-or-create a dimension id.
export async function getDimId(db: Db, dimension: DimensionName, value: unknown): Promise<number | null> {
  if (value === null || value === undefined || value === "") return null;
  const v = clampDimValue(value);
  const key = `${dimension}::${v}`;
  const cached = dimCache.get(key);
  if (cached !== undefined) return cached;

  const table = dimTables[dimension];
  const find = () => db.select({ id: table.id }).from(table).where(eq(table.value, v)).get();

  // Read before write. The previous form was a single
  //   INSERT ... ON CONFLICT(value) DO UPDATE SET value=excluded.value RETURNING id
  // which is elegant but expensive in the wrong currency: on conflict it
  // REWRITES the row (and its unique index entry) to the value it already had,
  // so every isolate-cache miss cost ~2 rows written x 10 dimensions. Dimension
  // values are tiny, stable sets that almost always already exist, so that was
  // pure waste -- and it dominated the ingest write cost.
  //
  // D1's free tier gives 5M rows READ but only 100K rows WRITTEN per day,
  // account-wide, and exhausted writes mean dropped pageviews. Trading a write
  // for a read is therefore strongly favourable: the hit path below is now
  // read-only, and only a genuinely new value writes anything.
  let row = await find();
  if (!row) {
    // DO NOTHING (not DO UPDATE) so a concurrent insert of the same value does
    // not rewrite the row. It also returns no row when it loses that race,
    // which the re-read below resolves.
    row = await db
      .insert(table)
      .values({ value: v })
      .onConflictDoNothing({ target: table.value })
      .returning({ id: table.id })
      .get();
    if (!row) row = await find();
  }
  const id = row ? row.id : null;
  if (id !== null) {
    // FIFO cap: bound the isolate-global cache so unbounded distinct values
    // can't exhaust isolate memory.
    if (dimCache.size >= MAX_DIM_CACHE_ENTRIES) {
      dimCache.delete(dimCache.keys().next().value as string);
    }
    dimCache.set(key, id);
  }
  return id;
}

// Read-only id lookup, for resolving request filters. Never creates anything.
export async function lookupDimId(db: Db, dimension: DimensionName, value: unknown): Promise<number | null> {
  const table = dimTables[dimension];
  const row = await db.select({ id: table.id }).from(table).where(eq(table.value, clampDimValue(value))).get();
  return row ? row.id : null;
}
