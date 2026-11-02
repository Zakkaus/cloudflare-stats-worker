// Include/exclude filter tokens (`dimension:value`) -> a SQL fragment over events_tab.
import { DIMENSIONS, isDimension } from "../dimensions.ts";
import type { Db } from "../db/client.ts";
import { eachDaySpan } from "../lib/days.ts";
import { lookupDimId } from "./dims.ts";

// Cap honored tokens: each filter is a sequential D1 lookup, so an unbounded
// list would amplify one request into many DB round-trips.
const MAX_FILTERS = 20; // max include/exclude tokens honored per query

export interface FilterToken {
  dimension: string;
  value: string;
}

export function parseFilterParam(url: URL, name: string): FilterToken[] {
  const out: FilterToken[] = [];
  for (const raw of url.searchParams.getAll(name)) {
    for (const token of raw.split(",")) {
      if (out.length >= MAX_FILTERS) return out;
      const t = token.trim();
      if (!t) continue;
      const idx = t.indexOf(":");
      if (idx <= 0) continue;
      out.push({ dimension: t.slice(0, idx), value: t.slice(idx + 1) });
    }
  }
  return out;
}

// A filtered query always scans events_tab over its whole range. The Overview
// tab never asks for more than 7 days; 8 leaves room for a timezone edge case.
// Anything wider belongs to Reports (Parquet in the browser, 0 D1 rows), and the
// cap also stops a scripted client from walking months of raw rows.
export const MAX_FILTERED_QUERY_DAYS = 8;

// The 400 message when the request carries a filter or exclude on a known
// dimension and its range is too wide to scan, else null. Unknown dimensions are
// ignored by resolveFilters, so they do not count here either.
export function filteredRangeError(url: URL, from: number, to: number): string | null {
  if (eachDaySpan(from, to) <= MAX_FILTERED_QUERY_DAYS) return null;
  const filtered = ["filter", "exclude"].some((name) => parseFilterParam(url, name).some((t) => isDimension(t.dimension)));
  return filtered ? `Filtered queries are limited to ${MAX_FILTERED_QUERY_DAYS} days; use Reports for longer ranges` : null;
}

export interface ResolvedFilters {
  // ` AND e.col = ?` / ` AND (e.col IS NULL OR e.col <> ?)` fragments, to append
  // to a WHERE over `events_tab e`. Empty when there are no usable filters.
  clause: string;
  binds: number[];
  // An include filter named a value that was never recorded: nothing can match.
  matchesNothing: boolean;
}

// Resolve the request's `filter=` (include) and `exclude=` tokens to dimension
// ids. Unknown dimensions are ignored; an unknown *include* value short-circuits.
export async function resolveFilters(db: Db, url: URL): Promise<ResolvedFilters> {
  const includes = parseFilterParam(url, "filter");
  const excludes = parseFilterParam(url, "exclude");
  const binds: number[] = [];
  let clause = "";

  for (const f of includes) {
    if (!isDimension(f.dimension)) continue;
    const id = await lookupDimId(db, f.dimension, f.value);
    // Including a value that was never recorded -> no rows match.
    if (id === null) return { clause: "", binds: [], matchesNothing: true };
    clause += ` AND e.${DIMENSIONS[f.dimension].col} = ?`;
    binds.push(id);
  }
  for (const f of excludes) {
    if (!isDimension(f.dimension)) continue;
    const id = await lookupDimId(db, f.dimension, f.value);
    if (id === null) continue;
    const col = DIMENSIONS[f.dimension].col;
    clause += ` AND (e.${col} IS NULL OR e.${col} <> ?)`;
    binds.push(id);
  }
  return { clause, binds, matchesNothing: false };
}
