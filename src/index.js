const CACHEABLE_PATHS = new Set(["/api/batch", "/api/stats", "/api/top"]);
const CACHE_TTL_SECONDS = 30;
const TOP_CACHE_TTL_SECONDS = 60;
const WORKER_VERSION = "1.2.0";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const shouldCache = method === "GET" && CACHEABLE_PATHS.has(pathname);
    const cache = caches.default;

    if (shouldCache) {
      const cached = await cache.match(request);
      if (cached) {
        return cached;
      }
    }

    let response;

    try {
      switch (pathname) {
        case "/api/count":
          ensureGet(method);
          response = await handleCount(request, env, corsHeaders, ctx);
          break;
        case "/api/batch":
          ensureGet(method);
          response = await handleBatch(request, env, corsHeaders);
          break;
        case "/api/stats":
          ensureGet(method);
          response = await handleStats(request, env, corsHeaders);
          break;
        case "/api/top":
          ensureGet(method);
          response = await handleTop(request, env, corsHeaders);
          break;
        case "/health":
          response = jsonResponse({ status: "ok", version: WORKER_VERSION, timestamp: new Date().toISOString() }, corsHeaders);
          break;
        default:
          response = new Response("Not Found", { status: 404, headers: corsHeaders });
      }
    } catch (error) {
      console.error("[worker] error", error);
      const status = typeof error.status === "number" ? error.status : 500;
      response = jsonResponse({ success: false, error: error.message || "Internal Error" }, corsHeaders, status);
    }

    if (shouldCache && response && response.ok) {
      ctx.waitUntil(cache.put(request, response.clone()));
    }

    return response;
  },
};

function ensureGet(method) {
  if (method !== "GET") {
    throw new Error("Only GET supported");
  }
}

async function handleCount(request, env, corsHeaders, ctx) {
  const url = new URL(request.url);
  const rawPath = url.searchParams.get("url") || "/";
  const path = normalizePath(rawPath);

  if (!path) {
    return jsonResponse({ success: false, error: "Invalid path" }, corsHeaders, 400);
  }

  const ip = (request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "0.0.0.0").split(",")[0].trim();
  const userAgent = request.headers.get("User-Agent") || "unknown";

  await enforceRateLimit(env, ip);

  const kv = env.PAGE_STATS;
  if (!kv) {
    throw new Error("KV namespace PAGE_STATS is not bound");
  }

  const visitorId = await getVisitorId(ip, userAgent);
  const today = new Date().toISOString().slice(0, 10);

  const pagePvKey = `page:${path}:pv`;
  const pageUvKey = `page:${path}:uv`;
  const sitePvKey = "site:total:pv";
  const siteUvKey = "site:total:uv";
  const pageVisitorKey = `visitor:page:${path}:${visitorId}:${today}`;
  const siteVisitorKey = `visitor:site:${visitorId}:${today}`;

  const [pagePvRaw, pageUvRaw, sitePvRaw, siteUvRaw, seenPage, seenSite] = await Promise.all([
    kv.get(pagePvKey),
    kv.get(pageUvKey),
    kv.get(sitePvKey),
    kv.get(siteUvKey),
    kv.get(pageVisitorKey),
    kv.get(siteVisitorKey),
  ]);

  let pagePv = toInt(pagePvRaw) + 1;
  let pageUv = toInt(pageUvRaw);
  let sitePv = toInt(sitePvRaw) + 1;
  let siteUv = toInt(siteUvRaw);

  const isNewPageVisitor = !seenPage;
  const isNewSiteVisitor = !seenSite;

  if (isNewPageVisitor) {
    pageUv += 1;
  }
  if (isNewSiteVisitor) {
    siteUv += 1;
  }

  await Promise.all([
    kv.put(pagePvKey, pagePv.toString()),
    kv.put(pageUvKey, pageUv.toString()),
    kv.put(sitePvKey, sitePv.toString()),
    kv.put(siteUvKey, siteUv.toString()),
    kv.put(pageVisitorKey, "1", { expirationTtl: 86400 }),
    kv.put(siteVisitorKey, "1", { expirationTtl: 86400 }),
  ]);

  try {
    await updateD1PageStats(env, path, isNewPageVisitor);
  } catch (error) {
    console.error("[worker] d1 sync error", error);
  }

  if (ctx) {
    ctx.waitUntil(invalidateCacheEntries(request, path));
  }

  return jsonResponse(
    {
      success: true,
      page: { path, pv: pagePv, uv: pageUv },
      site: { pv: sitePv, uv: siteUv },
      timestamp: new Date().toISOString(),
    },
    corsHeaders
  );
}

async function handleBatch(request, env, corsHeaders) {
  const url = new URL(request.url);
  const param = url.searchParams.get("urls") || "";
  const rawList = param.split(",").map((item) => item.trim()).filter(Boolean);

  if (!rawList.length) {
    return jsonResponse({ success: false, error: "Missing urls parameter" }, corsHeaders, 400);
  }

  const limited = rawList.slice(0, 50);
  const kv = env.PAGE_STATS;
  if (!kv) {
    throw new Error("KV namespace PAGE_STATS is not bound");
  }

  const results = {};

  await Promise.all(
    limited.map(async (raw) => {
      const path = normalizePath(raw);
      const [pvRaw, uvRaw] = await Promise.all([
        kv.get(`page:${path}:pv`),
        kv.get(`page:${path}:uv`),
      ]);

      results[raw] = {
        normalizedPath: path,
        pv: toInt(pvRaw),
        uv: toInt(uvRaw),
      };
    })
  );

  return jsonResponse(
    {
      success: true,
      count: limited.length,
      results,
      timestamp: new Date().toISOString(),
    },
    corsHeaders,
    200,
    { "Cache-Control": cacheControlHeader() }
  );
}

async function handleStats(request, env, corsHeaders) {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  const kv = env.PAGE_STATS;
  if (!kv) {
    throw new Error("KV namespace PAGE_STATS is not bound");
  }

  if (!target) {
    const [pvRaw, uvRaw] = await Promise.all([
      kv.get("site:total:pv"),
      kv.get("site:total:uv"),
    ]);

    return jsonResponse(
      {
        success: true,
        site: { pv: toInt(pvRaw), uv: toInt(uvRaw) },
      },
      corsHeaders,
      200,
      { "Cache-Control": cacheControlHeader() }
    );
  }

  const path = normalizePath(target);
  const [pvRaw, uvRaw] = await Promise.all([
    kv.get(`page:${path}:pv`),
    kv.get(`page:${path}:uv`),
  ]);

  return jsonResponse(
    {
      success: true,
      page: { path, pv: toInt(pvRaw), uv: toInt(uvRaw) },
    },
    corsHeaders,
    200,
    { "Cache-Control": cacheControlHeader() }
  );
}

async function handleTop(request, env, corsHeaders) {
  const db = getD1(env);
  if (!db) {
    return jsonResponse({ success: false, error: "Top endpoint requires D1 binding" }, corsHeaders, 503);
  }

  const url = new URL(request.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") || "10", 10);
  let limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10;
  limit = Math.min(limit, 50);

  const minPvParam = Number.parseInt(url.searchParams.get("min_pv") || "0", 10);
  const minPv = Number.isFinite(minPvParam) && minPvParam > 0 ? minPvParam : 0;

  const statement = db.prepare(
    "SELECT path, pv, uv, updated_at FROM page_stats WHERE pv >= ? ORDER BY pv DESC, updated_at DESC LIMIT ?"
  );
  const { results } = await statement.bind(minPv, limit).all();

  return jsonResponse(
    {
      success: true,
      count: results.length,
      results,
      timestamp: new Date().toISOString(),
    },
    corsHeaders,
    200,
    { "Cache-Control": cacheControlHeader(TOP_CACHE_TTL_SECONDS) }
  );
}

function normalizePath(input) {
  if (!input) {
    return "/";
  }

  let path = input.split("?")[0].split("#")[0];
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }

  path = path.replace(/\/+/g, "/");
  path = path.replace(/\/index\.html$/i, "/");
  path = path.replace(/\/index$/i, "/");
  path = path.replace(/\/_index$/i, "/");

  const langPrefix = path.match(/^\/(zh-cn|zh-tw|en)(\/.*)?$/i);
  if (langPrefix) {
    path = langPrefix[2] || "/";
    if (!path.startsWith("/")) {
      path = `/${path}`;
    }
  }

  if (path !== "/" && !path.endsWith("/")) {
    path = `${path}/`;
  }

  return path;
}

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

async function getVisitorId(ip, userAgent) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${ip}|${userAgent}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0"));
  return hashArray.join("").slice(0, 16);
}

async function enforceRateLimit(env, ip) {
  const kv = env.PAGE_STATS;
  if (!kv) {
    return;
  }

  const windowSeconds = 60;
  const limit = 120;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `ratelimit:${ip}:${bucket}`;
  const current = toInt(await kv.get(key));
  if (current >= limit) {
    const error = new Error("Rate limit exceeded");
    error.status = 429;
    throw error;
  }
  await kv.put(key, (current + 1).toString(), { expirationTtl: windowSeconds });
}

function jsonResponse(payload, corsHeaders, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

function cacheControlHeader(ttl = CACHE_TTL_SECONDS) {
  return `public, max-age=${ttl}`;
}

async function updateD1PageStats(env, path, isNewPageVisitor) {
  const db = getD1(env);
  if (!db) {
    return;
  }

  const uvIncrement = isNewPageVisitor ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO page_stats (path, pv, uv, updated_at)
       VALUES (?, 1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(path) DO UPDATE SET
         pv = page_stats.pv + 1,
         uv = page_stats.uv + excluded.uv,
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(path, uvIncrement)
    .run();
}

function getD1(env) {
  return env.DB || env.cloudflare_stats_top || null;
}

async function invalidateCacheEntries(request, path) {
  const cache = caches.default;
  const base = new URL(request.url);

  const targets = [];

  const siteStatsUrl = new URL("/api/stats", base);
  targets.push(new Request(siteStatsUrl.toString(), { method: "GET" }));

  const pageStatsUrl = new URL("/api/stats", base);
  pageStatsUrl.searchParams.set("url", path);
  targets.push(new Request(pageStatsUrl.toString(), { method: "GET" }));

  const topUrl = new URL("/api/top", base);
  targets.push(new Request(topUrl.toString(), { method: "GET" }));

  await Promise.all(
    targets.map((req) =>
      cache.delete(req).catch(() => false)
    )
  );
}
