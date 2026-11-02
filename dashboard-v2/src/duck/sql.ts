// Month-over-Month filters -> a parameterized DuckDB WHERE clause.
//
// Richer than the History view's filters (which are single equals tokens the
// worker resolves against D1): several values per filter, substring / prefix /
// regex matching, and a free-form SQL escape hatch. It is all evaluated in the
// browser, so none of it costs D1 reads.
import type { Dimension } from "../api/types";

export type MatchOp = "equals" | "contains" | "prefix" | "regex";

export interface ReportFilter {
  id: number;
  dimension: Dimension;
  op: "include" | "exclude";
  match: MatchOp;
  values: string[]; // OR-ed together
}

// The label the API and the tables use for a NULL dimension. Filtering on it
// means "IS NULL", mirroring nullLabelFor() in src/dimensions.ts.
export function nullLabel(dim: Dimension): string {
  return dim.startsWith("referrer") ? "(direct)" : "(unknown)";
}

export const MATCH_LABELS: Record<MatchOp, string> = {
  equals: "is",
  contains: "contains",
  prefix: "starts with",
  regex: "matches regex",
};

function valueTest(col: string, match: MatchOp, value: string, dim: Dimension, params: unknown[]): string {
  if (match === "equals" && value === nullLabel(dim)) return `${col} IS NULL`;
  params.push(value);
  switch (match) {
    case "equals":
      return `${col} = ?`;
    case "contains":
      return `contains(lower(${col}), lower(?))`;
    case "prefix":
      return `starts_with(${col}, ?)`;
    case "regex":
      return `regexp_matches(${col}, ?)`;
  }
}

// Filters on different dimensions are AND-ed; values within one filter are
// OR-ed. Exclude keeps NULL rows (a direct visit is not "from google.com"),
// matching the API's exclude semantics.
export function compileFilters(filters: ReportFilter[], advanced: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts: string[] = [];
  for (const f of filters) {
    if (!f.values.length) continue;
    const col = f.dimension; // whitelisted Dimension, safe as an identifier
    const any = `(${f.values.map((v) => valueTest(col, f.match, v, f.dimension, params)).join(" OR ")})`;
    parts.push(f.op === "include" ? `COALESCE(${any}, false)` : `NOT COALESCE(${any}, false)`);
  }
  // Runs only in this browser's in-memory database, against data it already
  // holds -- the user's own SQL, not an injection surface.
  if (advanced.trim()) parts.push(`(${advanced.trim()})`);
  return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
}
