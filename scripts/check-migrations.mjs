#!/usr/bin/env node
// Guard for the one thing drizzle-kit cannot express: `WITHOUT ROWID`.
//
// dim_daily_tab, hier_daily_tab and meta_tab must be WITHOUT ROWID -- a rowid
// table with a composite primary key bills two written rows per upsert instead
// of one (see src/db/schema.ts). drizzle-kit has no switch for it, so the
// generated SQL is edited by hand, and a later `drizzle-kit generate` that
// recreates one of these tables (e.g. a primary-key change) would silently drop
// the clause again.
//
// This replays every migration in order and checks the LAST statement that
// creates each table. Exits non-zero if a guarded table lost its clause.
//
//   node scripts/check-migrations.mjs        (also runs as part of `pnpm db:generate`)

import { readdirSync, readFileSync } from "node:fs";

const DIR = new URL("../drizzle/", import.meta.url);
const WITHOUT_ROWID = ["dim_daily_tab", "hier_daily_tab", "meta_tab"];

const files = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const created = new Map(); // table -> its latest CREATE TABLE statement

for (const file of files) {
  const sql = readFileSync(new URL(file, DIR), "utf8");
  for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*?)\n?\)\s*(WITHOUT ROWID)?\s*;/gi)) {
    created.set(m[1], { file, withoutRowid: Boolean(m[3]) });
  }
}

let failed = 0;
for (const table of WITHOUT_ROWID) {
  const entry = created.get(table);
  if (!entry) {
    console.error(`FAIL  ${table}: no CREATE TABLE found in drizzle/*.sql`);
    failed += 1;
  } else if (!entry.withoutRowid) {
    console.error(`FAIL  ${table}: missing WITHOUT ROWID in ${entry.file} -- re-apply the hand edit`);
    failed += 1;
  }
}
if (failed) process.exit(1);
console.log(`OK  ${WITHOUT_ROWID.length} tables keep WITHOUT ROWID across ${files.length} migration(s)`);
