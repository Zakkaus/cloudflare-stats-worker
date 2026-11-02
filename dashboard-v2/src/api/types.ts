// Contract shared with the worker query API (src/routes/).

export type Metric = "visitors" | "pageviews";

export type Dimension =
  | "path"
  | "referrer_domain"
  | "country"
  | "browser"
  | "browser_version"
  | "os"
  | "os_version"
  | "device_type"
  | "device_vendor"
  | "device_model";

export type FilterOp = "include" | "exclude";

export interface Filter {
  dimension: Dimension;
  op: FilterOp;
  value: string;
}

export type Preset = "today" | "yesterday" | "last7d" | "last28d";

export interface TimeRange {
  preset: Preset | "custom";
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export interface AggregateRow {
  key: string;
  value: number;
}

// One row of a multi-dimension breakdown: the whole tuple, outermost first.
export interface TupleRow {
  keys: string[];
  value: number;
}

// A node in a dimension hierarchy (sunburst), assembled client-side from the
// tuples returned by a single multi-dimension query.
export interface HierarchyNode {
  key: string;
  value: number;
  dim: Dimension;
  children?: HierarchyNode[];
}

export interface QueryResponse {
  metric: Metric;
  range: { from: string; to: string; timezone: string };
  group_by: Dimension;
  results: AggregateRow[];
  total: number;
  note?: string;
}

// Response shape when group_by names more than one dimension.
export interface TupleQueryResponse {
  metric: Metric;
  range: { from: string; to: string; timezone: string };
  group_by: Dimension[];
  results: TupleRow[];
  total: number;
  note?: string;
}

export interface TimeseriesResponse {
  metric: Metric;
  interval: "day";
  results: { date: string; value: number }[];
}

// Pageview figures are live and exact. Unique-visitor figures are live only for
// `today`; the rest come from a snapshot the worker's nightly cron writes, dated
// by `uv_as_of` (null until that cron has run at least once).
export interface SummaryResponse {
  timezone: string;
  today: { pv: number; uv: number };
  last7d: { pv: number; uv: number | null };
  last30d: { pv: number; uv: number | null };
  allTime: { pv: number; uv: number | null; uv_note?: string };
  uv_as_of: string | null;
}

export interface QueryParams {
  metric: Metric;
  from: string;
  to: string;
  groupBy: Dimension | Dimension[];
  filters: Filter[];
  limit?: number;
}
