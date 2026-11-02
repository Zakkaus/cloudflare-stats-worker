// Sunburst trees from flat tuples, shared by Overview (D1 tuples) and Reports
// (DuckDB). Pure: rows in, tree out.
import type { Dimension, HierarchyNode } from "../api/types";

// Top-N children kept per ring, by 0-based depth. Keeps the sunburst readable.
const HIERARCHY_LIMITS = [20, 12, 8];

// Tuples pulled before truncation. Generous because it is one statement either
// way, and the worker caps `limit` well above this.
export const HIERARCHY_TUPLE_LIMIT = 2000;

interface TreeBucket {
  key: string;
  value: number;
  prev: number | undefined;
  children: Map<string, TreeBucket>;
}

// `rows` may arrive in either response shape: a one-level hierarchy is a
// single-dimension query, which the API answers with the historical
// { key, value } rows rather than tuples.
export interface TreeRow {
  keys?: string[];
  key?: string;
  value: number;
  prev?: number;
}

const addPrev = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));

// The truncation is per-parent (each node keeps its own top-N children), which
// is what the old per-node fan-out produced -- a single global LIMIT would
// instead keep the top-N tuples overall and visibly change the chart.
//
// By default a parent's value is the SUM of its descendants. That is exact for
// pageviews but for visitors it counts someone using two browser versions twice.
// With `exact`, rows may be shorter than `levels` -- a ROLLUP subtotal for a
// prefix -- and set that prefix's value directly, so every ring is exact.
export function buildTree(levels: Dimension[], rows: TreeRow[], exact = false): HierarchyNode[] {
  const roots = new Map<string, TreeBucket>();

  for (const row of rows) {
    const keys = row.keys ?? [row.key ?? "(unknown)"];
    let level = roots;
    for (let depth = 0; depth < Math.min(keys.length, levels.length); depth += 1) {
      const key = keys[depth] ?? "(unknown)";
      let bucket = level.get(key);
      if (!bucket) {
        bucket = { key, value: 0, prev: undefined, children: new Map() };
        level.set(key, bucket);
      }
      const last = depth === Math.min(keys.length, levels.length) - 1;
      if (exact) {
        if (last) {
          bucket.value = row.value;
          bucket.prev = row.prev;
        }
      } else {
        bucket.value += row.value;
        bucket.prev = addPrev(bucket.prev, row.prev);
      }
      level = bucket.children;
    }
  }

  const collect = (level: Map<string, TreeBucket>, depth: number): HierarchyNode[] =>
    [...level.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, HIERARCHY_LIMITS[depth] ?? 8)
      .map((bucket) => {
        const node: HierarchyNode = { key: bucket.key, value: bucket.value, dim: levels[depth] };
        if (bucket.prev !== undefined) node.prev = bucket.prev;
        if (bucket.children.size) node.children = collect(bucket.children, depth + 1);
        return node;
      });

  return collect(roots, 0);
}
