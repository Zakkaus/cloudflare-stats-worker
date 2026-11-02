import { useEffect, useState } from "preact/hooks";
import * as api from "./api/client";
import type {
  Dimension,
  QueryResponse,
  SummaryResponse,
  TimeseriesResponse,
  TupleRow,
} from "./api/types";
import { metric, queryKey, timeRange } from "./state/store";
import { HIERARCHY_TUPLE_LIMIT } from "./utils/tree";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useAggregate(dimension: Dimension, limit = 8): AsyncState<QueryResponse> {
  const [state, setState] = useState<AsyncState<QueryResponse>>({ data: null, loading: true, error: null });
  // queryKey.value read makes this reactive to metric/range changes.
  const key = queryKey.value;

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const r = timeRange.value;
    api
      .query(
        { metric: metric.value, from: r.from, to: r.to, groupBy: dimension, limit },
        controller.signal
      )
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setState({ data: null, loading: false, error: String(err.message || err) });
      });
    return () => controller.abort();
  }, [key, dimension, limit]);

  return state;
}

// Fetch the tuples of a dimension hierarchy in ONE request. Previously this fanned
// out a grouped /api/query per node -- up to 261 requests and 522 full range scans
// for the 3-level device hierarchy, from a single click, which on its own could
// exceed a day's D1 read budget several times over. The worker now groups by all
// levels at once and returns whole tuples; the drawer filters them locally and
// assembles the tree (utils/tree.ts).
//
// A node's value is then a SUM over its descendants. That is exact for pageviews.
// For visitors the worker takes the raw path and returns exact per-tuple counts,
// but a parent ring still shows the sum of its children rather than distinct
// visitors for the parent -- a visitor using two browser versions counts twice in
// the browser ring. Reports, which has DuckDB, shows exact figures on every ring.
export function useTuples(levels: Dimension[]): AsyncState<TupleRow[]> {
  const [state, setState] = useState<AsyncState<TupleRow[]>>({ data: null, loading: true, error: null });
  const key = queryKey.value;
  const levelsKey = levels.join(">");

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const r = timeRange.value;
    api
      .queryTuples({ metric: metric.value, from: r.from, to: r.to, groupBy: levels, limit: HIERARCHY_TUPLE_LIMIT }, controller.signal)
      .then((res) => {
        // A one-level hierarchy is a single-dimension query, answered in the
        // historical { key, value } shape.
        const rows = (res.results as unknown as { keys?: string[]; key?: string; value: number }[]).map((x) => ({
          keys: x.keys ?? [x.key ?? "(unknown)"],
          value: x.value,
        }));
        setState({ data: rows, loading: false, error: null });
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setState({ data: null, loading: false, error: String(err.message || err) });
      });
    return () => controller.abort();
  }, [key, levelsKey]);

  return state;
}

export function useTimeseries(): AsyncState<TimeseriesResponse> {
  const [state, setState] = useState<AsyncState<TimeseriesResponse>>({ data: null, loading: true, error: null });
  const key = queryKey.value;

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const r = timeRange.value;
    api
      .timeseries({ metric: metric.value, from: r.from, to: r.to }, controller.signal)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setState({ data: null, loading: false, error: String(err.message || err) });
      });
    return () => controller.abort();
  }, [key]);

  return state;
}

export function useSummary(): AsyncState<SummaryResponse> {
  const [state, setState] = useState<AsyncState<SummaryResponse>>({ data: null, loading: true, error: null });
  useEffect(() => {
    const controller = new AbortController();
    api
      .summary(controller.signal)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setState({ data: null, loading: false, error: String(err.message || err) });
      });
    return () => controller.abort();
  }, []);
  return state;
}
