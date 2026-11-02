import type {
  Filter,
  QueryParams,
  QueryResponse,
  SummaryResponse,
  TimeseriesResponse,
  TupleQueryResponse,
} from "./types";

// Mirrors the worker's Cache-Control policy (src/http.ts cacheHeaders): a date
// range that has already closed can never change, so it is held far longer than
// one that includes today.
const CACHE_TTL_LIVE_MS = 60_000;
const CACHE_TTL_CLOSED_MS = 15 * 60_000;

interface CacheEntry {
  at: number;
  ttl: number;
  promise: Promise<any>;
}
const cache = new Map<string, CacheEntry>();

function ttlFor(to?: string): number {
  if (!to) return CACHE_TTL_LIVE_MS;
  // Compare as plain YYYY-MM-DD strings against the browser's local date. Worst
  // case a timezone skew picks the shorter TTL, which is always safe.
  const today = new Date().toISOString().slice(0, 10);
  return to < today ? CACHE_TTL_CLOSED_MS : CACHE_TTL_LIVE_MS;
}

function encodeFilters(filters: Filter[]): { include: string[]; exclude: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const f of filters) {
    const token = `${f.dimension}:${f.value}`;
    (f.op === "exclude" ? exclude : include).push(token);
  }
  return { include, exclude };
}

function buildUrl(path: string, params: Record<string, string | number | undefined>, filters?: Filter[]): string {
  const u = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  }
  if (filters && filters.length) {
    const { include, exclude } = encodeFilters(filters);
    if (include.length) u.searchParams.set("filter", include.join(","));
    if (exclude.length) u.searchParams.set("exclude", exclude.join(","));
  }
  return u.pathname + u.search;
}

// `signal` aborts the caller's interest, not the shared request: a response
// already in flight stays cached so a second component asking for the same URL
// still gets it. Aborting the fetch itself would not save the server any work
// (the query has already been issued) but would throw away a paid-for result.
async function getJSON<T>(url: string, ttl: number, signal?: AbortSignal): Promise<T> {
  const now = Date.now();
  const hit = cache.get(url);
  const promise =
    hit && now - hit.at < hit.ttl
      ? (hit.promise as Promise<T>)
      : (() => {
          const p = fetch(url)
            .then((r) => {
              if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
              return r.json();
            })
            .catch((err) => {
              cache.delete(url); // don't cache failures
              throw err;
            });
          cache.set(url, { at: now, ttl, promise: p });
          return p as Promise<T>;
        })();

  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

// `groupBy` may name several dimensions, in which case the worker returns whole
// tuples in one statement instead of the caller fanning out a query per node.
export function query(p: QueryParams, signal?: AbortSignal): Promise<QueryResponse> {
  const groupBy = Array.isArray(p.groupBy) ? p.groupBy.join(",") : p.groupBy;
  const url = buildUrl(
    "/api/query",
    { metric: p.metric, from: p.from, to: p.to, group_by: groupBy, limit: p.limit },
    p.filters
  );
  return getJSON<QueryResponse>(url, ttlFor(p.to), signal);
}

export function queryTuples(p: QueryParams, signal?: AbortSignal): Promise<TupleQueryResponse> {
  return query(p, signal) as unknown as Promise<TupleQueryResponse>;
}

export function timeseries(
  p: { metric: QueryParams["metric"]; from: string; to: string; filters?: Filter[] },
  signal?: AbortSignal
): Promise<TimeseriesResponse> {
  const url = buildUrl("/api/timeseries", { metric: p.metric, from: p.from, to: p.to }, p.filters);
  return getJSON<TimeseriesResponse>(url, ttlFor(p.to), signal);
}

export function summary(signal?: AbortSignal): Promise<SummaryResponse> {
  return getJSON<SummaryResponse>("/api/summary", CACHE_TTL_LIVE_MS, signal);
}

export function fetchConfig(): Promise<{ timezone: string }> {
  return getJSON<{ timezone: string }>("/api/config", CACHE_TTL_CLOSED_MS);
}
