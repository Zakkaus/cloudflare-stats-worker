// One breakdown card: rows in, bars out. Overview feeds it from the D1 API and
// Reports from DuckDB (with `prev` set, each row also shows its change).
import { DIMENSION_LABELS } from "../state/store";
import { countryName } from "../utils/countryName";
import { fmtChange } from "../utils/format";
import type { AggregateRow, Dimension } from "../api/types";

function PanelRow({ dimension, row, max, onClick, comparing }: { dimension: Dimension; row: AggregateRow; max: number; onClick: () => void; comparing: boolean }) {
  const pct = max > 0 ? (row.value / max) * 100 : 0;
  const label = dimension === "country" ? countryName(row.key) : row.key;
  const delta = row.value - (row.prev ?? 0);
  return (
    <div class="row clickable" role="button" tabIndex={0} title="Show details" onClick={onClick} onKeyDown={(e) => e.key === "Enter" && onClick()}>
      <div class="bar" style={`width:${pct}%`} />
      <span class="key" title={label}>
        {label}
      </span>
      <span class="val">{row.value.toLocaleString()}</span>
      {comparing && (
        <span class={`val mom-delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`}>{fmtChange(row.prev ?? 0, row.value)}</span>
      )}
    </div>
  );
}

export function PanelCard({
  dimension,
  rows,
  loading,
  error,
  comparing = false,
  onDetails,
}: {
  dimension: Dimension;
  rows: AggregateRow[];
  loading: boolean;
  error: string | null;
  comparing?: boolean;
  onDetails: () => void;
}) {
  const shown = rows.filter((r) => r.key !== "(direct)" || dimension.startsWith("referrer")).slice(0, 8);
  const max = shown.reduce((m, r) => Math.max(m, r.value), 0);

  return (
    <div class="panel">
      <div class="panel-head">
        <h3>{DIMENSION_LABELS[dimension]}</h3>
        <button class="expand" onClick={onDetails}>
          Details →
        </button>
      </div>
      {loading && <div class="loading">Loading…</div>}
      {error && <div class="empty">Error: {error}</div>}
      {!loading && !error && shown.length === 0 && <div class="empty">No data</div>}
      <div class="rows">
        {shown.map((r) => (
          <PanelRow dimension={dimension} row={r} max={max} comparing={comparing} onClick={onDetails} />
        ))}
      </div>
    </div>
  );
}
