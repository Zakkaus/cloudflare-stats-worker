import type { Totals } from "../../duck/report";
import { fmtChange, fmtNum, fmtSigned } from "../../utils/format";

function Delta({ a, b, digits = 0 }: { a: number; b: number; digits?: number }) {
  const cls = b > a ? "up" : b < a ? "down" : "";
  return (
    <span class={`mom-delta ${cls}`}>
      {fmtSigned(b - a, digits)} ({fmtChange(a, b)})
    </span>
  );
}

const fmt = (v: number, digits = 0) => v.toLocaleString(undefined, { maximumFractionDigits: digits });

// Headline figures for the range, and -- when comparing -- the change against
// the comparison range. Per-day averages are shown because the two ranges can
// differ in length (and a partial range would otherwise always "lose").
export function ReportCards({
  cur,
  prev,
  labelPrev,
}: {
  cur: Totals;
  prev: Totals | null;
  labelPrev: string;
}) {
  const perDay = (t: Totals) => (t.days ? t.pv / t.days : 0);
  const card = (label: string, vc: number, vp: number | null, digits = 0) => (
    <div class="card">
      <div class="label">{label}</div>
      <div class="value">{fmt(vc, digits)}</div>
      {vp !== null && (
        <>
          <div class="sub">
            <Delta a={vp} b={vc} digits={digits} />
          </div>
          <div class="sub">
            {labelPrev}: {fmt(vp, digits)}
          </div>
        </>
      )}
    </div>
  );
  return (
    <div class="cards">
      {card("Page views", cur.pv, prev ? prev.pv : null)}
      {card("Unique visitors", cur.uv, prev ? prev.uv : null)}
      {card("Page views / day", perDay(cur), prev ? perDay(prev) : null, 1)}
      {card("Days with data", cur.days, prev ? prev.days : null)}
    </div>
  );
}

export { fmtNum };
