// Calendar day in the given IANA timezone as "YYYY-MM-DD". Everything else about
// ranges is pure and lives in range.ts.
export function todayInTz(timezone: string, date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
