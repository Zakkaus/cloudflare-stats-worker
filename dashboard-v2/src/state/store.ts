import { batch, computed, signal } from "@preact/signals";
import type { Dimension, Metric } from "../api/types";
import { todayInTz } from "./dates";
import { rangeForPreset, type DateRange, type RangePreset, type WeekStart } from "./range";

// --- Configuration (timezone) fetched once at boot ---
export const timezone = signal<string>("Asia/Tokyo");

// Week start for "This week" / "Last week": one switch, shared by both tabs'
// pickers and remembered across visits.
const WEEK_START_KEY = "stats-week-start";
function loadWeekStart(): WeekStart {
  try {
    return localStorage.getItem(WEEK_START_KEY) === "sun" ? "sun" : "mon";
  } catch {
    return "mon";
  }
}
export const weekStart = signal<WeekStart>(loadWeekStart());

export function setWeekStart(w: WeekStart) {
  weekStart.value = w;
  try {
    localStorage.setItem(WEEK_START_KEY, w);
  } catch {
    /* private mode: the switch just is not remembered */
  }
}

// --- Overview state ---
// Overview reads D1 only, for at most 7 days, with no global filters: anything
// that needs a filter or a longer range lives in Reports (DuckDB, 0 D1 rows).
export const metric = signal<Metric>("pageviews");
export const preset = signal<RangePreset>("last7d");
export const customRange = signal<DateRange | null>(null);
export const theme = signal<"light" | "dark">(
  (localStorage.getItem("stats-theme") as "light" | "dark") || "dark"
);

// Detail drawer: which dimension is expanded (null = closed).
export const drawerDimension = signal<Dimension | null>(null);

// Which top-level view is showing: the D1-backed Overview, the in-memory live
// view (components/live/LiveView.tsx), or Reports over the Parquet archive
// (components/reports/).
export type View = "overview" | "live" | "reports";
export const view = signal<View>("overview");

// Old names for the same tabs ("history", "mom") are still accepted.
export function setView(v: View | "history" | "mom") {
  view.value = v === "history" ? "overview" : v === "mom" ? "reports" : v;
}

// A coarse clock, so `today` rolls over at midnight in a tab left open. The
// computed below only notifies when the date string actually changes, so the
// tick costs nothing until then -- and then every preset re-resolves (and
// Overview refetches) on its own.
const CLOCK_TICK_MS = 60000;
const clock = signal(Date.now());
setInterval(() => (clock.value = Date.now()), CLOCK_TICK_MS);

export const today = computed(() => todayInTz(timezone.value, new Date(clock.value)));

// Derived time range from the active preset + timezone, or a custom range.
export const timeRange = computed<DateRange>(() => {
  if (preset.value === "custom" && customRange.value) return customRange.value;
  return rangeForPreset(preset.value, today.value, weekStart.value) ?? rangeForPreset("last7d", today.value, weekStart.value)!;
});

// A cache/dependency key that changes whenever the query inputs change.
export const queryKey = computed(() => {
  const r = timeRange.value;
  return JSON.stringify({ m: metric.value, from: r.from, to: r.to });
});

export function setMetric(m: Metric) {
  metric.value = m;
}

// Commit the picker's Apply: one signal batch, so one query per panel.
export function applyOverviewRange(p: RangePreset, range: DateRange, w: WeekStart) {
  batch(() => {
    setWeekStart(w);
    preset.value = p;
    customRange.value = p === "custom" ? range : null;
  });
}

export function openDrawer(dimension: Dimension) {
  drawerDimension.value = dimension;
}

export function closeDrawer() {
  drawerDimension.value = null;
}

export function toggleTheme() {
  const next = theme.value === "dark" ? "light" : "dark";
  theme.value = next;
  localStorage.setItem("stats-theme", next);
  document.documentElement.dataset.theme = next;
}

// Human-readable labels for dimensions.
export const DIMENSION_LABELS: Record<Dimension, string> = {
  path: "Path",
  referrer_domain: "Referrer",
  country: "Country",
  browser: "Browser",
  browser_version: "Browser version",
  os: "OS",
  os_version: "OS version",
  device_type: "Device type",
  device_vendor: "Device vendor",
  device_model: "Device model",
};

// Default homepage panels.
export const PANEL_DIMENSIONS: Dimension[] = [
  "referrer_domain",
  "path",
  "country",
  "browser",
  "os",
  "device_type",
];

// Dimensions selectable inside the detail drawer. Child dims of a hierarchy
// (browser_version, os_version, device_vendor, device_model) are intentionally
// excluded — they are reached by expanding levels inside a hierarchy root.
export const DRAWER_DIMENSIONS: Dimension[] = [
  "path",
  "referrer_domain",
  "country",
  "browser",
  "os",
  "device_type",
];

// Hierarchical dimensions rendered as a sunburst in the drawer. Each entry maps
// a root dimension to its ordered levels (root first). Levels are fetched via
// client-side fan-out over /api/query, so counts stay exact at every ring.
export const HIERARCHY: Partial<Record<Dimension, Dimension[]>> = {
  device_type: ["device_type", "device_vendor", "device_model"],
  browser: ["browser", "browser_version"],
  os: ["os", "os_version"],
};
