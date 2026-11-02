// Static assets: the dashboard SPA, served from Workers Static Assets (env.ASSETS).
//
// Real asset hits (including `/`) are answered by the platform before the worker
// runs (`run_worker_first` is unset), so in practice this only sees misses --
// the SPA fallback -- and the security headers below only reach those responses.
import type { Context } from "hono";
import type { AppEnv } from "../env.ts";

export async function serveAsset(c: Context<AppEnv>): Promise<Response> {
  const request = c.req.raw;
  if (!c.env.ASSETS) {
    return new Response("Dashboard not built. Run: pnpm --dir dashboard-v2 build", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  let res = await c.env.ASSETS.fetch(request);
  if (res.status === 404) {
    // SPA fallback for client-side routes.
    res = await c.env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  }
  const headers = new Headers(res.headers);
  headers.set(
    "Content-Security-Policy",
    // The Month-over-Month view runs DuckDB-Wasm, loaded from jsDelivr (its
    // 36 MB .wasm is over the 25 MiB static-asset limit). It needs to compile
    // wasm ('wasm-unsafe-eval'), fetch the bundle and its parquet extension
    // (connect-src), and start its worker from a blob: URL that
    // importScripts() the CDN script.
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; " +
      "worker-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net https://extensions.duckdb.org; " +
      "font-src 'self'; base-uri 'self'; frame-ancestors 'none'"
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return new Response(res.body, { status: res.status, headers });
}
