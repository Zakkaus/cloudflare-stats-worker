// Date-range math for the pickers. Pure: every function takes `today`
// (yyyy-mm-dd in the server's timezone) instead of reading a clock, so it is
// deterministic and `range.test.ts` can run it under `node --test`. No imports,
// for the same reason: Node resolves them literally and strips the types.

export type RangePreset =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "last7d"
  | "lastWeek"
  | "last28d"
  | "last30d"
  | "thisMonth"
  | "custom";

export type ComparePreset = "prevPeriod" | "prevPeriodDow" | "prevYear" | "prevYearDow" | "custom";

export type WeekStart = "sun" | "mon";

export interface DateRange {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
}

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  last7d: "Last 7 days",
  lastWeek: "Last week",
  last28d: "Last 28 days",
  last30d: "Last 30 days",
  thisMonth: "This month",
  custom: "Custom",
};

export const COMPARE_LABELS: Record<ComparePreset, string> = {
  prevPeriod: "Previous period",
  prevPeriodDow: "Previous period (same weekdays)",
  prevYear: "Previous year",
  prevYearDow: "Previous year (same weekdays)",
  custom: "Custom",
};

// Offered by Overview (D1, at most 7 days) and by Reports (anything).
export const OVERVIEW_PRESETS: RangePreset[] = ["today", "yesterday", "thisWeek", "last7d", "lastWeek", "custom"];
export const REPORT_PRESETS: RangePreset[] = [
  "today",
  "yesterday",
  "thisWeek",
  "last7d",
  "lastWeek",
  "last28d",
  "last30d",
  "thisMonth",
  "custom",
];
export const COMPARE_PRESETS: ComparePreset[] = ["prevPeriod", "prevPeriodDow", "prevYear", "prevYearDow", "custom"];

const DAY_MS = 86400000;

const parse = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const format = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// A real calendar date in YYYY-MM-DD form ("2026-02-30" is not one).
export function isValidDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return format(parse(day)) === day;
}

export function shiftDays(day: string, days: number): string {
  return format(parse(day) + days * DAY_MS);
}

// Days in [from, to], inclusive.
export function rangeLength(range: DateRange): number {
  return Math.round((parse(range.to) - parse(range.from)) / DAY_MS) + 1;
}

// 0 = Sunday .. 6 = Saturday.
export function weekday(day: string): number {
  return new Date(parse(day)).getUTCDay();
}

// First day of the week containing `day`.
export function weekStartOf(day: string, weekStart: WeekStart): string {
  const dow = weekday(day);
  const back = weekStart === "sun" ? dow : (dow + 6) % 7;
  return shiftDays(day, -back);
}

// The same calendar date one year earlier. Feb 29 has no counterpart in a
// common year, so it lands on Feb 28.
export function sameDayLastYear(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const feb29 = m === 2 && d === 29;
  return `${String(y - 1).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(feb29 ? 28 : d).padStart(2, "0")}`;
}

// Resolve a preset to inclusive bounds. `custom` has no bounds of its own: the
// caller supplies them, so it returns null.
export function rangeForPreset(preset: RangePreset, today: string, weekStart: WeekStart): DateRange | null {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = shiftDays(today, -1);
      return { from: y, to: y };
    }
    case "thisWeek":
      return { from: weekStartOf(today, weekStart), to: today };
    case "last7d":
      return { from: shiftDays(today, -6), to: today };
    case "lastWeek": {
      const thisStart = weekStartOf(today, weekStart);
      return { from: shiftDays(thisStart, -7), to: shiftDays(thisStart, -1) };
    }
    case "last28d":
      return { from: shiftDays(today, -27), to: today };
    case "last30d":
      return { from: shiftDays(today, -29), to: today };
    case "thisMonth":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "custom":
      return null;
  }
}

// The range a compare preset points at, for a given primary range. `custom` has
// no bounds of its own, so it returns null.
export function compareRangeFor(preset: ComparePreset, primary: DateRange): DateRange | null {
  const len = rangeLength(primary);
  const back = (days: number): DateRange => ({ from: shiftDays(primary.from, -days), to: shiftDays(primary.to, -days) });
  switch (preset) {
    case "prevPeriod":
      return back(len);
    case "prevPeriodDow":
      return back(7 * Math.ceil(len / 7));
    case "prevYear":
      return { from: sameDayLastYear(primary.from), to: sameDayLastYear(primary.to) };
    case "prevYearDow":
      return back(364);
    case "custom":
      return null;
  }
}

// What the picker checks before enabling Apply. Returns a message, or null.
export function validateRange(
  range: DateRange,
  opts: { maxDays?: number; minDay?: string; maxDay?: string } = {}
): string | null {
  if (!isValidDay(range.from) || !isValidDay(range.to)) return "Enter a valid date";
  if (range.from > range.to) return "Start is after end";
  if (opts.maxDays && rangeLength(range) > opts.maxDays) return `At most ${opts.maxDays} days`;
  if (opts.minDay && range.from < opts.minDay) return `No data before ${opts.minDay}`;
  if (opts.maxDay && range.to > opts.maxDay) return `No data after ${opts.maxDay}`;
  return null;
}

// "Oct 1 – Oct 7", with the year when the range does not sit in `today`'s year.
export function formatRange(range: DateRange, today?: string): string {
  const fmt = (day: string, withYear: boolean) =>
    new Date(parse(day)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  const year = today ? today.slice(0, 4) : null;
  const withYear = year !== null && (range.from.slice(0, 4) !== year || range.to.slice(0, 4) !== year);
  return range.from === range.to ? fmt(range.from, withYear) : `${fmt(range.from, withYear)} – ${fmt(range.to, withYear)}`;
}
