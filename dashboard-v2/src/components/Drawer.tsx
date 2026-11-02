// The detail drawer, shared by Overview (rows from the D1 API) and Reports (rows
// from DuckDB). It knows nothing about where rows come from: the two views hand
// it a DrawerSource and it renders bar chart / map / sunburst / grid from them.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createGrid } from "ag-grid-community";
import type { ColDef, GridApi, GridOptions } from "ag-grid-community";
import { gridTheme } from "../grid/agGridSetup";
import { MultiFilter } from "../grid/MultiFilter";
import { echarts } from "../charts/echarts";
import { palette, SERIES_COLORS } from "../charts/theme";
import { CountryMap } from "./CountryMap";
import type { AsyncState } from "../hooks";
import { DIMENSION_LABELS, DRAWER_DIMENSIONS, HIERARCHY, theme } from "../state/store";
import { countryName } from "../utils/countryName";
import { fmtChange } from "../utils/format";
import { buildTree } from "../utils/tree";
import type { AggregateRow, Dimension, Filter, FilterOp, HierarchyNode, TupleRow } from "../api/types";

export interface DrawerSource {
  // Rows for a flat dimension, and whole tuples for a hierarchy's levels.
  useFlat(dimension: Dimension): AsyncState<AggregateRow[]>;
  useTuples(levels: Dimension[]): AsyncState<TupleRow[]>;
  // Tuples carry ROLLUP subtotals, so every sunburst ring is exact (Reports).
  exact: boolean;
  // Rows carry `prev`: show the comparison period and Δ columns.
  comparing: boolean;
  // The most rows useFlat / useTuples can return, when the source caps them
  // (Overview: the worker's limit). A list that long is taken to be truncated,
  // and the drawer says so, since its local filters only see what came back.
  rowLimits?: { flat: number; tuples: number };
  metricLabel: string;
  // A row's Filter / Exclude button. Without it the drawer filters its own rows
  // in memory (Overview: nothing outside the drawer may change, and a D1 query
  // per filter is exactly what Overview is not allowed to do).
  onRowFilter?: (dimension: Dimension, op: FilterOp, value: string) => void;
  onDimensionChange: (dimension: Dimension) => void;
  onClose: () => void;
  headerExtra?: (localFilters: Filter[]) => ComponentChildren;
}

const num = (v: number | null | undefined) => (v ?? 0).toLocaleString();

function TruncatedNote({ count, limit, what }: { count: number | undefined; limit: number | undefined; what: string }) {
  if (!limit || (count ?? 0) < limit) return null;
  return (
    <div class="drawer-note">
      Only the top {limit.toLocaleString()} {what} came back, so filters and search here cannot see the rest. Reports has the complete list.
    </div>
  );
}
const signCls = (v: number) => (v === 0 ? "" : v > 0 ? "mom-up" : "mom-down");

// --- Local (in-drawer) filtering ----------------------------------------------

const sameFilter = (a: Filter, b: Filter) => a.dimension === b.dimension && a.op === b.op && a.value === b.value;

function toggleLocal(list: Filter[], next: Filter): Filter[] {
  // Same toggle semantics as a global filter: clicking the same one removes it,
  // and the opposite op on the same value replaces it.
  const kept = list.filter((f) => !(f.dimension === next.dimension && f.value === next.value));
  return list.some((f) => sameFilter(f, next)) ? kept : [...kept, next];
}

function passes(filters: Filter[], levels: Dimension[], keys: string[]): boolean {
  for (const f of filters) {
    const i = levels.indexOf(f.dimension);
    if (i < 0) continue;
    const hit = keys[i] === f.value;
    if (f.op === "include" ? !hit : hit) return false;
  }
  return true;
}

// --- Charts ---------------------------------------------------------------------

function useChart() {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!el.current) return;
    chart.current = echarts.init(el.current);
    const onResize = () => chart.current?.resize();
    window.addEventListener("resize", onResize);
    setReady(true);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);
  return { el, chart, ready };
}

function DetailChart({ rows, comparing }: { rows: AggregateRow[]; comparing: boolean }) {
  const { el, chart, ready } = useChart();
  const themeVal = theme.value;

  useEffect(() => {
    if (!ready || !chart.current) return;
    const p = palette();
    const top = rows.slice(0, 12).reverse();
    chart.current.setOption(
      {
        grid: { left: 8, right: 24, top: comparing ? 28 : 10, bottom: 10, containLabel: true },
        legend: comparing ? { data: ["Current", "Previous"], textStyle: { color: p.muted }, top: 0 } : undefined,
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        xAxis: { type: "value", splitLine: { lineStyle: { color: p.grid } }, axisLabel: { color: p.muted } },
        yAxis: {
          type: "category",
          data: top.map((r) => r.key),
          axisLabel: { color: p.muted, width: 160, overflow: "truncate" },
          axisLine: { lineStyle: { color: p.grid } },
        },
        series: [
          ...(comparing
            ? [
                {
                  name: "Previous",
                  type: "bar",
                  data: top.map((r) => r.prev ?? 0),
                  itemStyle: { color: SERIES_COLORS[2], borderRadius: [0, 4, 4, 0] },
                },
              ]
            : []),
          {
            name: "Current",
            type: "bar",
            data: top.map((r) => r.value),
            itemStyle: { color: SERIES_COLORS[0], borderRadius: [0, 4, 4, 0] },
          },
        ],
      },
      true
    );
  }, [ready, rows, comparing, themeVal]);

  return <div ref={el} style="width:100%;height:360px;" />;
}

// --- Flat grid ------------------------------------------------------------------

// A class renderer (init / getGui) -- AG Grid always handles those, whereas a
// plain function returning an element did not render in this grid.
function rowButtons(onFilter: (op: FilterOp, data: any) => void) {
  return class RowButtons {
    private gui!: HTMLElement;
    init(p: any) {
      this.gui = document.createElement("div");
      const mk = (label: string, op: FilterOp) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.className = "btn";
        b.style.cssText = "margin-right:4px;cursor:pointer;font-size:11px;padding:1px 6px;";
        b.onclick = () => onFilter(op, p.data);
        return b;
      };
      this.gui.appendChild(mk("Filter", "include"));
      this.gui.appendChild(mk("Exclude", "exclude"));
    }
    getGui() {
      return this.gui;
    }
  };
}

const deltaColumns = <T extends { value: number; prev?: number }>(metricLabel: string): ColDef<T>[] => [
  { headerName: `${metricLabel} (previous)`, field: "prev" as any, flex: 1, sortable: true, valueFormatter: (p) => num(p.value) },
  {
    headerName: "Δ",
    valueGetter: (p) => (p.data ? p.data.value - (p.data.prev ?? 0) : 0),
    flex: 1,
    sortable: true,
    valueFormatter: (p) => (p.value > 0 ? `+${num(p.value)}` : num(p.value)),
    cellClass: (p) => signCls(p.value ?? 0),
  },
  {
    headerName: "Δ %",
    valueGetter: (p) => (p.data && p.data.prev ? (p.data.value - p.data.prev) / p.data.prev : null),
    flex: 1,
    sortable: true,
    valueFormatter: (p) => (p.data ? fmtChange(p.data.prev ?? 0, p.data.value) : ""),
    cellClass: (p) => signCls(p.data ? p.data.value - (p.data.prev ?? 0) : 0),
  },
];

// Rows the grid's own column filter lets through; null when no filter is set.
function visibleRows<T>(grid: GridApi<T>): T[] | null {
  if (!grid.isAnyFilterPresent()) return null;
  const visible: T[] = [];
  grid.forEachNodeAfterFilter((n) => n.data && visible.push(n.data));
  return visible;
}

// Flat grid. Only ever rendered for dimensions with no parent (path,
// referrer_domain, country) -- the parented ones (browser_version, os_version,
// device_*) are reachable only through HierarchyView, which shows the whole tuple.
function DetailGrid({
  dimension,
  rows,
  source,
  onFilter,
  onVisible,
}: {
  dimension: Dimension;
  rows: AggregateRow[];
  source: DrawerSource;
  onFilter: (op: FilterOp, key: string) => void;
  onVisible: (rows: AggregateRow[] | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<GridApi<AggregateRow> | null>(null);
  const themeVal = theme.value;
  const callbacks = useRef({ onFilter, onVisible });
  callbacks.current = { onFilter, onVisible };

  useEffect(() => {
    if (!el.current) return;
    const columnDefs: ColDef<AggregateRow>[] = [
      {
        headerName: DIMENSION_LABELS[dimension],
        field: "key",
        flex: 2,
        filter: MultiFilter,
        sortable: true,
        ...(dimension === "country" && { valueFormatter: (p) => countryName(p.value) }),
      },
      {
        headerName: source.metricLabel,
        field: "value",
        flex: 1,
        sortable: true,
        sort: "desc",
        valueFormatter: (p) => num(p.value),
      },
      ...(source.comparing ? deltaColumns<AggregateRow>(source.metricLabel) : []),
      {
        headerName: "",
        width: 130,
        sortable: false,
        filter: false,
        cellRenderer: rowButtons((op, data) => callbacks.current.onFilter(op, data.key)),
      },
    ];
    const options: GridOptions<AggregateRow> = {
      theme: gridTheme(theme.value),
      columnDefs,
      defaultColDef: { resizable: true },
      rowData: rows,
      pagination: true,
      paginationPageSize: 20,
      // The chart and the map follow whatever the grid's own column filter lets through.
      onFilterChanged: (e) => callbacks.current.onVisible(visibleRows(e.api)),
    };
    api.current = createGrid(el.current, options);
    return () => {
      api.current?.destroy();
      api.current = null;
    };
  }, [dimension, source.comparing, source.metricLabel]);

  // New rows keep the grid's column filter, and setting rowData does not fire
  // onFilterChanged, so report what the filter now lets through ourselves.
  useEffect(() => {
    const grid = api.current;
    if (!grid) return;
    grid.setGridOption("rowData", rows);
    callbacks.current.onVisible(visibleRows(grid));
  }, [rows]);

  useEffect(() => {
    api.current?.setGridOption("theme", gridTheme(themeVal));
  }, [themeVal]);

  return <div class="grid-wrap" ref={el} />;
}

function FlatBody({
  dimension,
  source,
  localFilter,
  onLocal,
}: {
  dimension: Dimension;
  source: DrawerSource;
  localFilter: Filter[];
  onLocal: (f: Filter) => void;
}) {
  const { data, loading, error } = source.useFlat(dimension);
  const rows = useMemo(
    () => (data ?? []).filter((r) => passes(localFilter, [dimension], [r.key])),
    [data, localFilter, dimension]
  );
  // Rows the grid's own filter leaves visible; null = no grid filter active. The
  // grid reports it on every filter change and every new set of rows.
  const [gridVisible, setGridVisible] = useState<AggregateRow[] | null>(null);
  const shown = gridVisible ?? rows;

  const onFilter = (op: FilterOp, key: string) =>
    source.onRowFilter ? source.onRowFilter(dimension, op, key) : onLocal({ dimension, op, value: key });

  return (
    <>
      {loading && <div class="loading">Loading…</div>}
      {error && <div class="empty">Error: {error}</div>}
      <TruncatedNote count={data?.length} limit={source.rowLimits?.flat} what="values" />
      {dimension === "country" ? (
        <CountryMap rows={shown} metricLabel={source.metricLabel} onSelect={(c) => onFilter("include", c)} />
      ) : (
        <DetailChart rows={shown} comparing={source.comparing} />
      )}
      <DetailGrid dimension={dimension} rows={rows} source={source} onFilter={onFilter} onVisible={setGridVisible} />
    </>
  );
}

// --- Hierarchy (sunburst) view --------------------------------------------------

function toSunburst(nodes: HierarchyNode[]): any[] {
  return nodes.map((n) => ({
    name: n.key,
    value: n.value,
    prev: n.prev,
    ...(n.children && n.children.length ? { children: toSunburst(n.children) } : {}),
  }));
}

function HierarchySunburst({ tree, metricLabel, comparing }: { tree: HierarchyNode[]; metricLabel: string; comparing: boolean }) {
  const { el, chart, ready } = useChart();
  const themeVal = theme.value;

  useEffect(() => {
    if (!ready || !chart.current) return;
    const p = palette();
    chart.current.setOption(
      {
        color: SERIES_COLORS,
        tooltip: {
          trigger: "item",
          formatter: (params: any) => {
            const info = params.treePathInfo || [];
            const path = info.slice(1).map((t: any) => t.name).join(" › ");
            const total = info[0]?.value ?? 0;
            const value = params.value ?? 0;
            const pct = total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : "";
            const prev = params.data?.prev;
            const change = comparing && prev !== undefined ? `<br/>previous ${prev.toLocaleString()} (${fmtChange(prev, value)})` : "";
            return `${path}<br/><b>${value.toLocaleString()}</b> ${metricLabel}${pct}${change}`;
          },
        },
        series: [
          {
            type: "sunburst",
            radius: [0, "95%"],
            data: toSunburst(tree),
            emphasis: { focus: "ancestor" },
            itemStyle: { borderColor: p.bg, borderWidth: 2 },
            label: { color: "#fff", minAngle: 8 },
          },
        ],
      },
      true
    );
  }, [ready, tree, themeVal, metricLabel, comparing]);

  return <div ref={el} style="width:100%;height:360px;" />;
}

interface LeafRow {
  path: string[];
  value: number;
  prev?: number;
}

function flattenLeaves(nodes: HierarchyNode[], prefix: string[] = []): LeafRow[] {
  const out: LeafRow[] = [];
  for (const n of nodes) {
    const path = [...prefix, n.key];
    if (n.children && n.children.length) out.push(...flattenLeaves(n.children, path));
    else out.push({ path, value: n.value, prev: n.prev });
  }
  return out;
}

function HierarchyGrid({
  levels,
  tree,
  source,
  onFilter,
}: {
  levels: Dimension[];
  tree: HierarchyNode[];
  source: DrawerSource;
  onFilter: (dimension: Dimension, op: FilterOp, key: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<GridApi<LeafRow> | null>(null);
  const themeVal = theme.value;
  const levelsKey = levels.join(">");
  const rows = useMemo(() => flattenLeaves(tree), [tree]);
  const callbacks = useRef(onFilter);
  callbacks.current = onFilter;

  useEffect(() => {
    if (!el.current) return;
    const deepest = levels[levels.length - 1];
    const columnDefs: ColDef<LeafRow>[] = [
      ...levels.map((dim, i) => ({
        headerName: DIMENSION_LABELS[dim],
        valueGetter: (p: any) => (dim === "country" ? countryName(p.data?.path[i]) : p.data?.path[i]),
        flex: 1,
        filter: MultiFilter,
        sortable: true,
      })),
      {
        headerName: source.metricLabel,
        field: "value",
        flex: 1,
        sortable: true,
        sort: "desc",
        valueFormatter: (p) => num(p.value),
      },
      ...(source.comparing ? deltaColumns<LeafRow>(source.metricLabel) : []),
      {
        headerName: "",
        width: 130,
        sortable: false,
        filter: false,
        cellRenderer: rowButtons((op, data: LeafRow) => callbacks.current(deepest, op, data.path[data.path.length - 1])),
      },
    ];
    const options: GridOptions<LeafRow> = {
      theme: gridTheme(theme.value),
      columnDefs,
      defaultColDef: { resizable: true },
      rowData: rows,
      pagination: true,
      paginationPageSize: 20,
    };
    api.current = createGrid(el.current, options);
    return () => {
      api.current?.destroy();
      api.current = null;
    };
    // Rebuild when the active levels or the metric (column header/sort) change.
  }, [levelsKey, source.metricLabel, source.comparing]);

  useEffect(() => {
    api.current?.setGridOption("rowData", rows);
  }, [rows]);

  useEffect(() => {
    api.current?.setGridOption("theme", gridTheme(themeVal));
  }, [themeVal]);

  return <div class="grid-wrap" ref={el} />;
}

function HierarchyBody({
  dimension,
  source,
  localFilter,
  onLocal,
  onDropLocal,
}: {
  dimension: Dimension;
  source: DrawerSource;
  localFilter: Filter[];
  onLocal: (f: Filter) => void;
  onDropLocal: (dimensions: Dimension[]) => void;
}) {
  const allLevels = HIERARCHY[dimension]!;
  const [depth, setDepth] = useState(1);
  const levels = allLevels.slice(0, depth);
  const { data, loading, error } = source.useTuples(levels);

  const tree = useMemo(() => {
    const rows = (data ?? []).filter((r) => passes(localFilter, levels, r.keys));
    // Dropping a leaf changes its parents' totals, so a subtotal row would go stale.
    return buildTree(levels, rows, source.exact);
  }, [data, localFilter, depth, source.exact]);

  const onFilter = (d: Dimension, op: FilterOp, key: string) =>
    source.onRowFilter ? source.onRowFilter(d, op, key) : onLocal({ dimension: d, op, value: key });

  return (
    <>
      <div class="level-control">
        {allLevels.map((dim, i) => {
          const active = i < depth;
          const isRoot = i === 0;
          return (
            <button
              class={`level-chip${active ? " active" : ""}`}
              disabled={isRoot}
              title={isRoot ? "Top level" : active ? "Remove this level" : "Add this level"}
              onClick={() => {
                // A local filter on a level that is no longer shown could not
                // apply to anything, so it goes with the level.
                if (active) onDropLocal(allLevels.slice(i));
                setDepth(active ? i : i + 1);
              }}
            >
              {!active && !isRoot ? "+ " : ""}
              {DIMENSION_LABELS[dim]}
            </button>
          );
        })}
      </div>

      {loading && <div class="loading">Loading…</div>}
      {error && <div class="empty">Error: {error}</div>}
      <TruncatedNote count={data?.length} limit={source.rowLimits?.tuples} what="combinations" />

      <HierarchySunburst tree={tree} metricLabel={source.metricLabel} comparing={source.comparing} />
      <HierarchyGrid levels={levels} tree={tree} source={source} onFilter={onFilter} />
    </>
  );
}

// --- Drawer ----------------------------------------------------------------------

export function Drawer({ dimension, source }: { dimension: Dimension; source: DrawerSource }) {
  // Local filters live exactly as long as the drawer is open on this dimension:
  // the drawer unmounts on close, and the body below is keyed by dimension.
  const [localFilter, setLocalFilter] = useState<Filter[]>([]);
  useEffect(() => setLocalFilter([]), [dimension]);
  const addLocal = (f: Filter) => setLocalFilter((list) => toggleLocal(list, f));
  const dropLocal = (dims: Dimension[]) => setLocalFilter((list) => list.filter((f) => !dims.includes(f.dimension)));
  // Escape closes the drawer, like the other overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && source.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const isHierarchy = dimension in HIERARCHY;

  return (
    <>
      <div class="drawer-backdrop" onClick={source.onClose} />
      <div class="drawer" role="dialog" aria-modal="true">
        <div class="drawer-head">
          <h2>{DIMENSION_LABELS[dimension]}</h2>
          <select class="dim-select" value={dimension} onChange={(e) => source.onDimensionChange((e.target as HTMLSelectElement).value as Dimension)}>
            {DRAWER_DIMENSIONS.map((d) => (
              <option value={d}>{DIMENSION_LABELS[d]}</option>
            ))}
          </select>
          <span class="spacer" />
          {source.headerExtra?.(localFilter)}
          <button class="btn" onClick={source.onClose}>
            Close
          </button>
        </div>

        {localFilter.length > 0 && (
          <div class="chips">
            {localFilter.map((f) => (
              <span class={`chip ${f.op}`} title={`${f.op} ${f.dimension} = ${f.value}`}>
                {f.op === "exclude" ? "≠ " : ""}
                {DIMENSION_LABELS[f.dimension]}: {f.dimension === "country" ? countryName(f.value) : f.value}
                <button aria-label="Remove filter" onClick={() => addLocal(f)}>
                  ×
                </button>
              </span>
            ))}
            <button class="btn" onClick={() => setLocalFilter([])}>
              Clear all
            </button>
          </div>
        )}

        {isHierarchy ? (
          <HierarchyBody
            key={dimension}
            dimension={dimension}
            source={source}
            localFilter={localFilter}
            onLocal={addLocal}
            onDropLocal={dropLocal}
          />
        ) : (
          <FlatBody key={dimension} dimension={dimension} source={source} localFilter={localFilter} onLocal={addLocal} />
        )}
      </div>
    </>
  );
}
