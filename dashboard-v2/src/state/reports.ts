// State for the Reports view. Kept apart from store.ts: Reports filters are far
// richer than anything Overview offers, and they apply to the days loaded into
// DuckDB rather than to D1 queries.
import { signal } from "@preact/signals";
import type { Dimension, Filter } from "../api/types";
import type { PickerValue } from "../components/DateRangePicker";
import type { DateRange } from "./range";
import type { MatchOp, ReportFilter } from "../duck/sql";
import { setView, weekStart } from "./store";

// The applied range (and optional comparison). null until ReportsView has the
// archive's coverage to pick a default from.
export const reportPicker = signal<PickerValue | null>(null);
export const reportFilters = signal<ReportFilter[]>([]);
export const reportAdvanced = signal<string>("");
export const reportMetric = signal<"pv" | "uv">("pv");
export const reportDrawer = signal<Dimension | null>(null);

let nextId = 1;

export function addReportFilter(dimension: Dimension, op: "include" | "exclude", match: MatchOp, values: string[]) {
  const clean = values.map((v) => v.trim()).filter(Boolean);
  if (!clean.length) return;
  reportFilters.value = [...reportFilters.value, { id: nextId++, dimension, op, match, values: clean }];
}

// From a table row: an exact-match filter, toggled off if it already exists,
// and replacing the opposite op for the same value.
export function toggleRowFilter(dimension: Dimension, op: "include" | "exclude", value: string) {
  const same = (f: ReportFilter) => f.dimension === dimension && f.match === "equals" && f.values.length === 1 && f.values[0] === value;
  const existing = reportFilters.value.find(same);
  const kept = reportFilters.value.filter((f) => !same(f));
  reportFilters.value = existing?.op === op ? kept : [...kept, { id: nextId++, dimension, op, match: "equals", values: [value] }];
}

export function removeReportFilter(id: number) {
  reportFilters.value = reportFilters.value.filter((f) => f.id !== id);
}

export function clearReportFilters() {
  reportFilters.value = [];
  reportAdvanced.value = "";
}

// Overview's "Open in Reports": the same range, and whatever the drawer was
// filtered to as exact-match Reports filters.
export function openInReports(range: DateRange, filters: Filter[]) {
  reportPicker.value = { preset: "custom", range, compare: null, weekStart: weekStart.value };
  reportFilters.value = filters.map((f) => ({ id: nextId++, dimension: f.dimension, op: f.op, match: "equals" as const, values: [f.value] }));
  reportAdvanced.value = "";
  setView("reports");
}
