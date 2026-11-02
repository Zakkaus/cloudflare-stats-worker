// Reports: any date range, every filter, optional comparison -- all answered by
// DuckDB-Wasm over Parquet day files, so none of it costs a D1 row. (Overview is
// the cheap, D1-backed counterpart: at most 7 days and no filters.)
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AggregateRow, Dimension, TupleRow } from "../../api/types";
import {
  coverageBounds,
  dayCoverage,
  dayToIso,
  exportRange,
  fetchManifest,
  getDb,
  importFiles,
  loadDays,
  pendingLoad,
  toInt,
  type DayRange,
  type ImportedSource,
  type Manifest,
} from "../../duck/db";
import {
  alignTrend,
  breakdown,
  mergeBreakdown,
  mergeTuples,
  totals,
  trend,
  tuples,
  type CountRow,
  type Totals,
  type TrendPoint,
} from "../../duck/report";
import { compileFilters } from "../../duck/sql";
import type { AsyncState } from "../../hooks";
import {
  reportAdvanced,
  reportDrawer,
  reportFilters,
  reportMetric,
  reportPicker,
  toggleRowFilter,
} from "../../state/reports";
import { PANEL_DIMENSIONS, setWeekStart, today as storeToday, weekStart } from "../../state/store";
import { REPORT_PRESETS, compareRangeFor, formatRange, rangeForPreset, rangeLength, shiftDays, type DateRange } from "../../state/range";
import { fmtNum } from "../../utils/format";
import { DateRangePicker, type PickerValue } from "../DateRangePicker";
import { Drawer, type DrawerSource } from "../Drawer";
import { PanelCard } from "../PanelCard";
import { ReportCards } from "./ReportCards";
import { ReportFilterBar } from "./ReportFilterBar";
import { ReportTrend } from "./ReportTrend";

type Phase = "starting" | "ready" | "error";

// Past this many megabytes of day files, ask before downloading.
const CONFIRM_BYTES = 50 * 1024 * 1024;

const fmtBytes = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const toRange = (r: DateRange): DayRange => ({ from: toInt(r.from), to: toInt(r.to) });
const datesOf = (r: DateRange): string[] => Array.from({ length: rangeLength(r) }, (_, i) => shiftDays(r.from, i));

// The bounds a picker value's presets point at for `today`, with the primary
// range clipped to what the archive has. A custom range is kept as it is.
function resolvePreset(v: PickerValue, today: string, minDay: string | undefined): PickerValue {
  const r = rangeForPreset(v.preset, today, v.weekStart);
  const range = r ? { from: minDay && r.from < minDay && minDay <= r.to ? minDay : r.from, to: r.to } : v.range;
  const c = v.compare;
  const compare = c && c.preset !== "custom" ? { preset: c.preset, range: compareRangeFor(c.preset, range)! } : c;
  return { ...v, range, compare };
}

interface Side {
  totals: Totals;
  trend: TrendPoint[];
  panels: Record<string, CountRow[]>;
}

// Ranges whose day files are all in DuckDB. Queries only ever run against these,
// never against a selection still downloading, which would count whichever of
// its days happen to be cached already.
interface Loaded {
  key: string;
  picker: PickerValue;
  primary: DayRange;
  compare: DayRange | null;
}

interface Result {
  cur: Side;
  prev: Side | null;
  loaded: Loaded; // what was queried: labels and the trend axis come from here
}

async function querySide(range: DayRange, where: ReturnType<typeof compileFilters>): Promise<Side> {
  const [t, tr, ...rows] = await Promise.all([
    totals(range, where),
    trend(range, where),
    ...PANEL_DIMENSIONS.map((d) => breakdown(range, d, where)),
  ]);
  return { totals: t, trend: tr, panels: Object.fromEntries(PANEL_DIMENSIONS.map((d, i) => [d, rows[i]])) };
}

// Re-run `run` whenever `key` changes; stale answers are dropped.
function useReportQuery<T>(key: string, run: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    run()
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      .catch((err) => !cancelled && setState({ data: null, loading: false, error: String(err?.message ?? err) }));
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state;
}

export default function ReportsView() {
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Starting DuckDB…");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [imports, setImports] = useState<ImportedSource[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const picker = reportPicker.value;
  const metric = reportMetric.value;
  const where = useMemo(() => compileFilters(reportFilters.value, reportAdvanced.value), [reportFilters.value, reportAdvanced.value]);
  const bounds = useMemo(() => coverageBounds(manifest, imports), [manifest, imports]);

  // Boot: engine + manifest in parallel.
  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    Promise.all([getDb(), fetchManifest()])
      .then(([, m]) => {
        if (cancelled) return;
        setManifest(m);
        setPhase("ready");
        setStatus(`DuckDB ready in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
      })
      .catch((err) => {
        if (cancelled) return;
        setPhase("error");
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // "Today" is the server's idea of it: the end of the live tail.
  const today = manifest?.live.to ?? "";

  // A new day on the client clock that the manifest does not reach yet: fetch
  // it, so the live tail (and the presets below) move on to the new day.
  const clockToday = storeToday.value;
  useEffect(() => {
    if (!manifest || clockToday <= manifest.live.to) return;
    fetchManifest()
      .then(setManifest)
      .catch(() => undefined); // the next tick or ↻ tries again
  }, [clockToday]);

  // Default range: the last 30 days, clipped to what the archive has. After
  // that, a preset (and a preset comparison) is re-resolved against each new
  // manifest, so "Last 7 days" still means that once the day has rolled over.
  useEffect(() => {
    if (!manifest) return;
    const current = reportPicker.value ?? { preset: "last30d" as const, range: { from: today, to: today }, compare: null, weekStart: weekStart.value };
    const next = resolvePreset(current, today, bounds?.min);
    if (JSON.stringify(next) !== JSON.stringify(reportPicker.value)) reportPicker.value = next;
  }, [manifest]);

  const primary = picker ? toRange(picker.range) : null;
  const compare = picker?.compare ? toRange(picker.compare.range) : null;
  const rangesKey = JSON.stringify([primary, compare]);

  // Download whatever the selected ranges still need.
  useEffect(() => {
    if (!manifest || !primary || !picker) return;
    let cancelled = false;
    const t0 = performance.now();
    const next: Loaded = { key: rangesKey, picker, primary, compare };
    loadDays(manifest, compare ? [primary, compare] : [primary], { onProgress: (done, total) => !cancelled && setProgress({ done, total }) })
      .then((files) => {
        if (cancelled) return;
        setProgress(null);
        if (files) setStatus(`Loaded ${files} day file(s) in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
        setLoaded(next);
        setDataVersion((v) => v + 1);
      })
      .catch((err) => {
        if (cancelled) return;
        setProgress(null);
        setError(`Loading archive failed: ${err.message ?? err}`);
      });
    return () => {
      cancelled = true;
    };
  }, [manifest, rangesKey]);

  // Headline, trend and panels. Re-runs on any filter change, and on a range
  // change once its days are loaded; all in-memory. Until then the previous
  // result stays up, labelled with its own ranges.
  const queryKey = JSON.stringify([dataVersion, loaded?.key, where.sql, where.params]);
  useEffect(() => {
    if (!dataVersion || !loaded) return;
    let cancelled = false;
    (async () => {
      const [cur, prev] = await Promise.all([
        querySide(loaded.primary, where),
        loaded.compare ? querySide(loaded.compare, where) : Promise.resolve(null),
      ]);
      if (!cancelled) {
        setResult({ cur, prev, loaded });
        setError(null);
      }
    })().catch((err) => !cancelled && setError(`Query failed: ${err.message ?? err}`));
    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  const drawerCtx = queryKey + metric;
  const source: DrawerSource | null = loaded && {
    useFlat: (dimension: Dimension) =>
      useReportQuery<AggregateRow[]>(drawerCtx + dimension, async () => {
        const [cur, prev] = await Promise.all([
          breakdown(loaded.primary, dimension, where),
          loaded.compare ? breakdown(loaded.compare, dimension, where) : null,
        ]);
        return mergeBreakdown(cur, prev, metric);
      }),
    useTuples: (levels: Dimension[]) =>
      useReportQuery<TupleRow[]>(drawerCtx + levels.join(">"), async () => {
        const [cur, prev] = await Promise.all([
          tuples(loaded.primary, levels, where),
          loaded.compare ? tuples(loaded.compare, levels, where) : null,
        ]);
        return mergeTuples(cur, prev, metric);
      }),
    exact: true,
    comparing: loaded.compare !== null,
    metricLabel: metric === "uv" ? "Visitors" : "Page Views",
    onRowFilter: toggleRowFilter,
    onDimensionChange: (d) => (reportDrawer.value = d),
    onClose: () => (reportDrawer.value = null),
  };

  const apply = (v: PickerValue) => {
    if (manifest) {
      const ranges = [toRange(v.range), ...(v.compare ? [toRange(v.compare.range)] : [])];
      const pending = pendingLoad(manifest, ranges);
      if (
        pending.bytes > CONFIRM_BYTES &&
        !window.confirm(`This range needs ${pending.files} day files (${fmtBytes(pending.bytes)}) that are not in your browser yet. Download them?`)
      ) {
        return;
      }
    }
    setWeekStart(v.weekStart);
    reportPicker.value = v;
  };

  const onFiles = async (list: FileList | File[] | null) => {
    const files = [...(list ?? [])].filter((f) => f.name.toLowerCase().endsWith(".parquet"));
    if (!files.length) return;
    setStatus(`Importing ${files.length} file(s)…`);
    try {
      await getDb();
      const imp = await importFiles(files);
      setImports((prev) => [...prev, imp]);
      setStatus(`Imported ${fmtNum(imp.rows)} pageviews (${imp.days} days) from ${imp.name}; they fill days the server does not have`);
      if (imp.minDay) {
        // Show what was just imported.
        reportPicker.value = {
          preset: "custom",
          range: { from: dayToIso(imp.minDay), to: dayToIso(imp.maxDay) },
          compare: null,
          weekStart: weekStart.value,
        };
      }
      setDataVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Exports the loaded range (what is on screen), never one still downloading.
  const onExport = async () => {
    if (!loaded) return;
    const { range } = loaded.picker;
    setStatus(`Exporting ${formatRange(range)}…`);
    try {
      await exportRange(loaded.primary, `stats-${range.from}_${range.to}.parquet`);
      setStatus(`Exported ${formatRange(range)}`);
    } catch (err) {
      setError(`Export failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const onRefresh = async () => {
    if (!primary) return;
    try {
      const m = await fetchManifest();
      setManifest(m);
      await loadDays(m, compare ? [primary, compare] : [primary], { refreshLive: true });
      setDataVersion((v) => v + 1);
      setStatus("Refreshed");
    } catch (err) {
      setError(`Refresh failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  if (phase === "starting") return <div class="live-message">Starting DuckDB…</div>;
  if (phase === "error") return <div class="live-message">Reports are unavailable: {error}</div>;

  const covLine = (label: string, r: DayRange) => {
    const c = dayCoverage(r);
    const parts = [`${c.server} from the archive`];
    if (c.imported) parts.push(`${c.imported} imported`);
    if (c.missing) parts.push(`${c.missing} with no data`);
    return `${label}: ${c.days} days — ${parts.join(", ")}`;
  };

  // Everything below the toolbar describes the result, not the selection: while a
  // new range downloads, the old figures keep their own labels and axis.
  const shown = result?.loaded;
  const labelCur = shown ? formatRange(shown.picker.range, today) : "";
  const labelPrev = shown?.picker.compare ? formatRange(shown.picker.compare.range, today) : "";
  const comparing = result?.prev != null;
  const curRange = shown?.picker.range;
  const prevRange = shown?.picker.compare?.range;

  return (
    <div
      class={`mom${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(e.dataTransfer?.files ?? null);
      }}
    >
      <div class="mom-toolbar">
        {picker && (
          <DateRangePicker
            value={picker}
            today={today}
            presets={REPORT_PRESETS}
            allowCompare
            minDay={bounds?.min}
            maxDay={bounds?.max}
            note={(range, cmp) => {
              if (!manifest) return null;
              const p = pendingLoad(manifest, [toRange(range), ...(cmp ? [toRange(cmp)] : [])]);
              return (
                <div class="muted drp-hint">
                  {p.files ? `${p.files} file(s) · ${fmtBytes(p.bytes)} to download` : "Already in your browser"}
                  {p.live ? " · plus today's live data" : ""}
                </div>
              );
            }}
            onApply={apply}
          />
        )}
        <div class="segmented" role="group" aria-label="Metric">
          <button class={metric === "pv" ? "active" : ""} onClick={() => (reportMetric.value = "pv")}>
            Page Views
          </button>
          <button class={metric === "uv" ? "active" : ""} onClick={() => (reportMetric.value = "uv")}>
            Visitors
          </button>
        </div>
        <span class="spacer" />
        <button class="btn" onClick={() => fileInput.current?.click()} title="Import exported .parquet files (or drop them here)">
          Import…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".parquet"
          multiple
          hidden
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            onFiles(input.files);
            input.value = "";
          }}
        />
        <button class="btn" onClick={onExport} title="Download the loaded range as one Parquet file" disabled={!loaded}>
          ⬇ Export
        </button>
        <button class="btn" onClick={onRefresh} title="Re-fetch the manifest and today's live data">
          ↻
        </button>
      </div>

      {progress && progress.total > 0 && (
        <div class="mom-progress">
          <progress value={progress.done} max={progress.total} />
          <span class="muted">
            Loading day files {progress.done}/{progress.total}
          </span>
        </div>
      )}
      <div class="mom-status muted">
        {status}
        {" · all filtering runs in your browser (0 D1 reads)"}
      </div>
      {primary && (
        <div class="mom-status muted">
          {covLine("Range", primary)}
          {compare ? ` · ${covLine("Comparison", compare)}` : ""}
        </div>
      )}
      {error && <div class="mom-error">{error}</div>}

      <ReportFilterBar dataVersion={dataVersion} />

      {!bounds && <div class="live-message">Nothing archived yet. The nightly cron writes one file per closed day.</div>}

      {result && curRange && (
        <>
          <ReportCards cur={result.cur.totals} prev={result.prev?.totals ?? null} labelPrev={labelPrev} />
          <div class="chart-card">
            <div class="panel-head">
              <h3>Daily trend</h3>
            </div>
            <ReportTrend
              dates={datesOf(curRange)}
              cur={alignTrend(result.cur.trend, result.loaded.primary, metric, rangeLength(curRange))}
              prev={
                comparing && result.loaded.compare
                  ? alignTrend(result.prev!.trend, result.loaded.compare, metric, rangeLength(curRange))
                  : null
              }
              prevDates={prevRange ? datesOf(prevRange) : []}
              labelCur={labelCur}
              labelPrev={labelPrev}
            />
          </div>
          <div class="panel-grid">
            {PANEL_DIMENSIONS.map((d) => (
              <PanelCard
                dimension={d}
                rows={mergeBreakdown(result.cur.panels[d], result.prev?.panels[d] ?? null, metric)}
                loading={false}
                error={null}
                comparing={comparing}
                onDetails={() => (reportDrawer.value = d)}
              />
            ))}
          </div>
        </>
      )}

      {reportDrawer.value && source && <Drawer dimension={reportDrawer.value} source={source} />}
    </div>
  );
}
