// Day arithmetic on yyyymmdd integers -- the representation events_tab, every
// rollup and the meta bounds use. Calendar-correct and timezone-free: callers
// pass in days already resolved in the configured timezone (see config.ts).

// yyyymmdd int -> "YYYY-MM-DD"
export function dayIntToISO(day: number): string {
  const s = String(day);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// "YYYY-MM-DD" (or "YYYYMMDD") -> yyyymmdd int; null for anything else.
export function parseDayParam(value: string | null | undefined): number | null {
  if (!value) return null;
  const digits = value.replaceAll("-", "");
  if (!/^\d{8}$/.test(digits)) return null;
  return Number(digits);
}

// Iterate yyyymmdd ints inclusively from `from` to `to` (calendar-correct).
export function* eachDay(from: number, to: number): Generator<number> {
  const y = Math.floor(from / 10000);
  const m = Math.floor((from % 10000) / 100);
  const d = from % 100;
  const cur = new Date(Date.UTC(y, m - 1, d));
  while (true) {
    const day = cur.getUTCFullYear() * 10000 + (cur.getUTCMonth() + 1) * 100 + cur.getUTCDate();
    if (day > to) break;
    yield day;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

// Number of calendar days in [from, to], inclusive.
export function eachDaySpan(from: number, to: number): number {
  const a = Date.UTC(Math.floor(from / 10000), Math.floor((from % 10000) / 100) - 1, from % 100);
  const b = Date.UTC(Math.floor(to / 10000), Math.floor((to % 10000) / 100) - 1, to % 100);
  return Math.round((b - a) / 86400000) + 1;
}

export function offsetDayInt(day: number, deltaDays: number): number {
  const base = new Date(Date.UTC(Math.floor(day / 10000), Math.floor((day % 10000) / 100) - 1, day % 100));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.getUTCFullYear() * 10000 + (base.getUTCMonth() + 1) * 100 + base.getUTCDate();
}

// yyyymm -> the yyyymmdd of the 1st of the following month.
export function firstDayOfNextMonth(month: number): number {
  const y = Math.floor(month / 100);
  const m = month % 100;
  return (m === 12 ? (y + 1) * 100 + 1 : month + 1) * 100 + 1;
}
