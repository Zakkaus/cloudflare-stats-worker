import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { Dimension } from "../../api/types";
import { AutocompleteInput } from "../AutocompleteInput";
import { DIMENSIONS, dimensionValues } from "../../duck/db";
import { MATCH_LABELS, type MatchOp } from "../../duck/sql";
import { addReportFilter, clearReportFilters, reportAdvanced, reportFilters, removeReportFilter } from "../../state/reports";
import { DIMENSION_LABELS } from "../../state/store";
import { countryName } from "../../utils/countryName";

// Filter chips plus a builder for the richer filters DuckDB can evaluate:
// several values per filter (comma-separated, OR-ed), substring / prefix /
// regex matching, and a raw SQL WHERE for anything else.
export function ReportFilterBar({ dataVersion }: { dataVersion: number }) {
  const dim = useSignal<Dimension>("path");
  const op = useSignal<"include" | "exclude">("include");
  const match = useSignal<MatchOp>("equals");
  const text = useSignal("");
  const showAdvanced = useSignal(reportAdvanced.value !== "");
  const advancedDraft = useSignal(reportAdvanced.value);
  const valuePool = useSignal<string[]>([]);

  // Refetch whenever the chosen dimension changes, and whenever ReportsView loads
  // another month into DuckDB (the value pool is empty until then).
  useEffect(() => {
    if (!dataVersion) return;
    let cancelled = false;
    dimensionValues(dim.value)
      .then((v) => !cancelled && (valuePool.value = v))
      .catch(() => !cancelled && (valuePool.value = []));
    return () => {
      cancelled = true;
    };
  }, [dim.value, dataVersion]);

  const add = (e: Event) => {
    e.preventDefault();
    // Regex values may legitimately contain commas, so only split the others.
    const values = match.value === "regex" ? [text.value] : text.value.split(",");
    addReportFilter(dim.value, op.value, match.value, values);
    text.value = "";
  };

  const active = reportFilters.value;
  const label = (d: Dimension, v: string) => (d === "country" ? countryName(v) : v);

  return (
    <div class="mom-filters">
      <form class="mom-filter-builder" onSubmit={add}>
        <select class="dim-select" value={dim.value} onChange={(e) => (dim.value = (e.target as HTMLSelectElement).value as Dimension)}>
          {DIMENSIONS.map((d) => (
            <option value={d}>{DIMENSION_LABELS[d]}</option>
          ))}
        </select>
        <select class="dim-select" value={op.value} onChange={(e) => (op.value = (e.target as HTMLSelectElement).value as "include" | "exclude")}>
          <option value="include">include</option>
          <option value="exclude">exclude</option>
        </select>
        <select class="dim-select" value={match.value} onChange={(e) => (match.value = (e.target as HTMLSelectElement).value as MatchOp)}>
          {(Object.keys(MATCH_LABELS) as MatchOp[]).map((m) => (
            <option value={m}>{MATCH_LABELS[m]}</option>
          ))}
        </select>
        <AutocompleteInput
          class="mom-input"
          placeholder={match.value === "regex" ? "regular expression" : "value, value, …"}
          value={text.value}
          onInput={(v) => (text.value = v)}
          suggestions={match.value === "regex" ? [] : valuePool.value}
        />
        <button class="btn" type="submit" disabled={!text.value.trim()}>
          Add filter
        </button>
        <button class="btn" type="button" onClick={() => (showAdvanced.value = !showAdvanced.value)}>
          {showAdvanced.value ? "Hide SQL" : "SQL…"}
        </button>
      </form>

      {showAdvanced.value && (
        <div class="mom-advanced">
          <textarea
            class="mom-input"
            rows={2}
            spellcheck={false}
            placeholder="Extra WHERE condition, e.g. country IN ('JP','TW') AND NOT regexp_matches(path, '^/tag/')"
            value={advancedDraft.value}
            onInput={(e) => (advancedDraft.value = (e.target as HTMLTextAreaElement).value)}
          />
          <div class="mom-advanced-actions">
            <button class="btn" onClick={() => (reportAdvanced.value = advancedDraft.value)}>
              Apply
            </button>
            <span class="muted">
              Columns: day (yyyymmdd), visitor_id, {DIMENSIONS.join(", ")}. Runs locally in DuckDB.
            </span>
          </div>
        </div>
      )}

      {(active.length > 0 || reportAdvanced.value) && (
        <div class="chips">
          {active.map((f) => (
            <span class={`chip ${f.op}`} title={`${f.op} ${f.dimension} ${MATCH_LABELS[f.match]} ${f.values.join(" or ")}`}>
              {f.op === "exclude" ? "≠ " : ""}
              {DIMENSION_LABELS[f.dimension]}
              {f.match === "equals" ? ": " : ` ${MATCH_LABELS[f.match]} `}
              {f.values.map((v) => label(f.dimension, v)).join(" | ")}
              <button aria-label="Remove filter" onClick={() => removeReportFilter(f.id)}>
                ×
              </button>
            </span>
          ))}
          {reportAdvanced.value && (
            <span class="chip" title={reportAdvanced.value}>
              SQL: {reportAdvanced.value.length > 48 ? `${reportAdvanced.value.slice(0, 48)}…` : reportAdvanced.value}
              <button
                aria-label="Remove SQL condition"
                onClick={() => {
                  reportAdvanced.value = "";
                  advancedDraft.value = "";
                }}
              >
                ×
              </button>
            </span>
          )}
          <button
            class="btn"
            onClick={() => {
              clearReportFilters();
              advancedDraft.value = "";
            }}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
