import { drizzle } from "drizzle-orm/d1";

// The query builder is used for simple CRUD (ingest, dimension lookups, meta).
// The tuned rollup/UNION/window statements stay raw SQL on the underlying D1
// binding -- `db.$client` -- so their read/write cost is exactly what it was.
export function createDb(d1: D1Database) {
  return drizzle(d1);
}

export type Db = ReturnType<typeof createDb>;

// The D1 binding, or null when the deployment does not bind one (every
// deployment config binds it as `DB`). Callers decide how to fail: the HTTP
// routes answer 503, the cron logs and skips.
export function getD1(env: Env): D1Database | null {
  return env.DB ?? null;
}
