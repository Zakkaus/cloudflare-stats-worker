// node --test dashboard-v2/src/state/range.test.ts   (Node strips the types)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OVERVIEW_PRESETS,
  REPORT_PRESETS,
  COMPARE_PRESETS,
  compareRangeFor,
  formatRange,
  isValidDay,
  rangeForPreset,
  rangeLength,
  sameDayLastYear,
  shiftDays,
  validateRange,
  weekStartOf,
  weekday,
} from "./range.ts";

const range = (preset: Parameters<typeof rangeForPreset>[0], today: string, ws: "sun" | "mon" = "mon") => {
  const r = rangeForPreset(preset, today, ws);
  assert.ok(r, `${preset} has bounds`);
  return r;
};

test("shiftDays crosses month, year and leap-day boundaries", () => {
  assert.equal(shiftDays("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDays("2028-03-01", -1), "2028-02-29");
  assert.equal(shiftDays("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDays("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDays("2026-11-02", 0), "2026-11-02");
});

test("isValidDay rejects impossible dates", () => {
  assert.ok(isValidDay("2028-02-29"));
  assert.ok(!isValidDay("2026-02-29"));
  assert.ok(!isValidDay("2026-13-01"));
  assert.ok(!isValidDay("2026-1-01"));
  assert.ok(!isValidDay("0002-02-30"));
});

test("weekStartOf on every weekday, both week starts", () => {
  // 2026-11-01 is a Sunday.
  assert.equal(weekday("2026-11-01"), 0);
  const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"];
  days.forEach((d, i) => {
    assert.equal(weekStartOf(d, "sun"), "2026-11-01", `sun-start week of ${d}`);
    assert.equal(weekStartOf(d, "mon"), i === 0 ? "2026-10-26" : "2026-11-02", `mon-start week of ${d}`);
  });
  assert.equal(weekStartOf("2026-11-08", "mon"), "2026-11-02");
});

test("this week / last week for both week starts", () => {
  // Wednesday 2026-11-04.
  assert.deepEqual(range("thisWeek", "2026-11-04", "mon"), { from: "2026-11-02", to: "2026-11-04" });
  assert.deepEqual(range("thisWeek", "2026-11-04", "sun"), { from: "2026-11-01", to: "2026-11-04" });
  assert.deepEqual(range("lastWeek", "2026-11-04", "mon"), { from: "2026-10-26", to: "2026-11-01" });
  assert.deepEqual(range("lastWeek", "2026-11-04", "sun"), { from: "2026-10-25", to: "2026-10-31" });
  // On the first day of a week, "this week" is one day and "last week" is the full week before.
  assert.deepEqual(range("thisWeek", "2026-11-02", "mon"), { from: "2026-11-02", to: "2026-11-02" });
  assert.deepEqual(range("lastWeek", "2026-11-02", "mon"), { from: "2026-10-26", to: "2026-11-01" });
});

test("simple presets", () => {
  assert.deepEqual(range("today", "2026-11-02"), { from: "2026-11-02", to: "2026-11-02" });
  assert.deepEqual(range("yesterday", "2026-11-01"), { from: "2026-10-31", to: "2026-10-31" });
  assert.deepEqual(range("last7d", "2026-11-02"), { from: "2026-10-27", to: "2026-11-02" });
  assert.deepEqual(range("last28d", "2026-03-01"), { from: "2026-02-02", to: "2026-03-01" });
  assert.deepEqual(range("last30d", "2026-01-15"), { from: "2025-12-17", to: "2026-01-15" });
  assert.deepEqual(range("thisMonth", "2026-11-02"), { from: "2026-11-01", to: "2026-11-02" });
  assert.equal(rangeForPreset("custom", "2026-11-02", "mon"), null);
});

test("every Overview preset is at most 7 days, on every day of two years, either week start", () => {
  let day = "2026-01-01";
  for (let i = 0; i < 730; i += 1, day = shiftDays(day, 1)) {
    for (const ws of ["sun", "mon"] as const) {
      for (const p of OVERVIEW_PRESETS) {
        const r = rangeForPreset(p, day, ws);
        if (!r) continue;
        assert.ok(rangeLength(r) <= 7, `${p} on ${day} (${ws}) spans ${rangeLength(r)} days`);
        assert.ok(r.from <= r.to);
        assert.ok(r.to <= day, `${p} on ${day} reaches into the future`);
      }
    }
  }
});

test("every Reports preset is a valid, non-future range", () => {
  for (const day of ["2026-02-28", "2028-02-29", "2026-12-31", "2027-01-01"]) {
    for (const p of REPORT_PRESETS) {
      const r = rangeForPreset(p, day, "mon");
      if (!r) continue;
      assert.ok(isValidDay(r.from) && isValidDay(r.to));
      assert.ok(r.from <= r.to && r.to <= day);
    }
  }
});

test("prevPeriod shifts back by the range length", () => {
  const primary = { from: "2026-10-01", to: "2026-10-07" };
  assert.deepEqual(compareRangeFor("prevPeriod", primary), { from: "2026-09-24", to: "2026-09-30" });
  const one = { from: "2026-11-02", to: "2026-11-02" };
  assert.deepEqual(compareRangeFor("prevPeriod", one), { from: "2026-11-01", to: "2026-11-01" });
  const quarter = { from: "2026-07-01", to: "2026-09-30" };
  assert.deepEqual(compareRangeFor("prevPeriod", quarter), { from: "2026-03-31", to: "2026-06-30" });
});

test("prevPeriodDow keeps weekdays aligned", () => {
  for (const [from, to] of [
    ["2026-10-01", "2026-10-07"],
    ["2026-10-01", "2026-10-03"],
    ["2026-10-01", "2026-10-10"],
    ["2026-09-01", "2026-09-30"],
  ]) {
    const primary = { from, to };
    const prev = compareRangeFor("prevPeriodDow", primary)!;
    assert.equal(weekday(prev.from), weekday(primary.from), `${from}..${to}`);
    assert.equal(rangeLength(prev), rangeLength(primary));
    assert.ok(prev.to < primary.from, "previous period does not overlap");
  }
  // 7 days: identical to prevPeriod. 10 days: shifted by 14.
  assert.deepEqual(compareRangeFor("prevPeriodDow", { from: "2026-10-01", to: "2026-10-07" }), { from: "2026-09-24", to: "2026-09-30" });
  assert.deepEqual(compareRangeFor("prevPeriodDow", { from: "2026-10-01", to: "2026-10-10" }), { from: "2026-09-17", to: "2026-09-26" });
});

test("prevYear uses the same calendar dates; Feb 29 becomes Feb 28", () => {
  assert.deepEqual(compareRangeFor("prevYear", { from: "2026-10-01", to: "2026-10-07" }), { from: "2025-10-01", to: "2025-10-07" });
  assert.equal(sameDayLastYear("2028-02-29"), "2027-02-28");
  assert.equal(sameDayLastYear("2028-03-01"), "2027-03-01");
  assert.deepEqual(compareRangeFor("prevYear", { from: "2028-02-27", to: "2028-03-02" }), { from: "2027-02-27", to: "2027-03-02" });
  assert.deepEqual(compareRangeFor("prevYear", { from: "2029-01-01", to: "2029-01-01" }), { from: "2028-01-01", to: "2028-01-01" });
});

test("prevYearDow shifts back 364 days, keeping weekdays", () => {
  const primary = { from: "2026-10-01", to: "2026-10-07" };
  const prev = compareRangeFor("prevYearDow", primary)!;
  assert.deepEqual(prev, { from: "2025-10-02", to: "2025-10-08" });
  assert.equal(weekday(prev.from), weekday(primary.from));
});

test("every compare preset except custom resolves; custom has no bounds", () => {
  const primary = { from: "2026-10-01", to: "2026-10-07" };
  for (const p of COMPARE_PRESETS) {
    const r = compareRangeFor(p, primary);
    if (p === "custom") assert.equal(r, null);
    else assert.ok(r && isValidDay(r.from) && isValidDay(r.to));
  }
});

test("validateRange", () => {
  assert.equal(validateRange({ from: "2026-10-01", to: "2026-10-07" }, { maxDays: 7 }), null);
  assert.match(validateRange({ from: "2026-10-01", to: "2026-10-08" }, { maxDays: 7 })!, /7 days/);
  assert.match(validateRange({ from: "2026-10-08", to: "2026-10-01" })!, /after/);
  assert.match(validateRange({ from: "2025-10-01", to: "2026-10-01" }, { minDay: "2026-01-01" })!, /No data before/);
  // A half-typed year ("0002-…") is not a date yet.
  assert.match(validateRange({ from: "0002-10-01", to: "2026-10-01" })!, /valid/);
  assert.match(validateRange({ from: "2026-10-01", to: "2026-12-01" }, { maxDay: "2026-11-02" })!, /No data after/);
  assert.match(validateRange({ from: "2026-02-30", to: "2026-03-01" })!, /valid/);
});

test("formatRange shows the year only when it differs from today's", () => {
  assert.equal(formatRange({ from: "2026-10-01", to: "2026-10-07" }, "2026-11-02"), "Oct 1 – Oct 7");
  assert.equal(formatRange({ from: "2026-11-02", to: "2026-11-02" }, "2026-11-02"), "Nov 2");
  assert.equal(formatRange({ from: "2025-12-28", to: "2026-01-03" }, "2026-01-05"), "Dec 28, 2025 – Jan 3, 2026");
});
