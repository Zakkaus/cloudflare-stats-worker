import {
  applyOverviewRange,
  metric,
  preset,
  setMetric,
  setView,
  theme,
  timeRange,
  today,
  toggleTheme,
  view,
  weekStart,
} from "../state/store";
import { OVERVIEW_PRESETS } from "../state/range";
import { DateRangePicker } from "./DateRangePicker";
import type { Metric } from "../api/types";

function MetricSwitcher() {
  const m = metric.value;
  const opt = (id: Metric, label: string) => (
    <button class={m === id ? "active" : ""} onClick={() => setMetric(id)}>
      {label}
    </button>
  );
  return (
    <div class="segmented" role="group" aria-label="Metric">
      {opt("pageviews", "Page Views")}
      {opt("visitors", "Visitors")}
    </div>
  );
}

function ViewSwitcher() {
  const v = view.value;
  return (
    <div class="segmented" role="group" aria-label="View">
      <button class={v === "overview" ? "active" : ""} onClick={() => setView("overview")}>
        Overview
      </button>
      <button class={v === "live" ? "active" : ""} onClick={() => setView("live")}>
        Live
      </button>
      <button class={v === "reports" ? "active" : ""} onClick={() => setView("reports")}>
        Reports
      </button>
    </div>
  );
}

export function MenuBar() {
  // Live and Reports have their own time model, metric toggle and picker.
  const isOverview = view.value === "overview";
  return (
    <div class="menubar">
      <h1>Analytics</h1>
      <ViewSwitcher />
      {isOverview && <MetricSwitcher />}
      {isOverview && (
        <DateRangePicker
          value={{ preset: preset.value, range: timeRange.value, compare: null, weekStart: weekStart.value }}
          today={today.value}
          presets={OVERVIEW_PRESETS}
          allowCompare={false}
          maxDays={7}
          onApply={(v) => applyOverviewRange(v.preset, v.range, v.weekStart)}
        />
      )}
      <button class="btn" onClick={toggleTheme} title="Toggle theme">
        {theme.value === "dark" ? "☀ Light" : "☾ Dark"}
      </button>
    </div>
  );
}
