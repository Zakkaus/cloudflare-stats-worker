// Overview's drawer: rows come from the D1 API, and filtering happens inside the
// drawer (see Drawer.tsx), never on the Overview itself.
import { useMemo } from "preact/hooks";
import { Drawer, type DrawerSource } from "./Drawer";
import { useAggregate, useTuples } from "../hooks";
import { closeDrawer, drawerDimension, metric, openDrawer, timeRange } from "../state/store";
import { openInReports } from "../state/reports";
import type { AggregateRow, Dimension } from "../api/types";
import { HIERARCHY_TUPLE_LIMIT } from "../utils/tree";

// The worker clamps a single-dimension breakdown at 2,000 rows. A complete list
// reads the same rows from D1 as an 8-row one (a rollup answers by scanning the
// date range, not by LIMIT), and local filtering is only right on a complete list
// -- so a list that hits the cap is flagged in the drawer (rowLimits).
const FLAT_LIMIT = 2000;

function useFlat(dimension: Dimension) {
  const { data, loading, error } = useAggregate(dimension, FLAT_LIMIT);
  const rows = useMemo<AggregateRow[] | null>(() => data?.results ?? null, [data]);
  return { data: rows, loading, error };
}

const source = (): DrawerSource => ({
  useFlat,
  useTuples,
  exact: false,
  comparing: false,
  rowLimits: { flat: FLAT_LIMIT, tuples: HIERARCHY_TUPLE_LIMIT },
  metricLabel: metric.value === "visitors" ? "Visitors" : "Page Views",
  onDimensionChange: openDrawer,
  onClose: closeDrawer,
  // The bridge for any question Overview cannot answer: same range, and whatever
  // the drawer was filtered to becomes Reports filters.
  headerExtra: (localFilters) => (
    <button
      class="btn"
      title="Open this range in Reports, which can filter and compare freely"
      onClick={() => {
        openInReports(timeRange.value, localFilters);
        closeDrawer();
      }}
    >
      Open in Reports →
    </button>
  ),
});

export default function DetailDrawer() {
  const dimension = drawerDimension.value;
  if (!dimension) return null;
  return <Drawer dimension={dimension} source={source()} />;
}
