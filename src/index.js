import { DASHBOARD_HTML } from './dashboard.js';

const CACHEABLE_PATHS = new Set(["/api/batch", "/api/stats", "/api/daily", "/logo.webp"]);
const CACHE_TTL_SECONDS = 30;
const TOP_CACHE_TTL_SECONDS = 60;
const WORKER_VERSION = "1.6.0";
const BLOG_LOGO_WEBP_BASE64 = "UklGRuIMAABXRUJQVlA4WAoAAAAQAAAA/wAA/wAAQUxQSB8GAAABDkoAABmSpO7B9t7e2rZt27Zt27Zt2zrbtm1jsLa7fndXmVERv9vIysqqiJgAvu//+/7/f4fxJZr2m772yAmttbdmWt8mxdkp4nUTE3hHTmitPV/1a1qCHShcavj2d69a//rK21uHFg/DpvTQrW8H1r+++q4/vFTYQdK23/GrtvGnrW1TQ+W5+mfLxmCHn9YRYhoevGrZfnlf3Rh4dOBesWxXBxrEQJdh5k+WoN9PSQeLmvq9FtSdmQGyHMsvaoHPL84Kh2cCLbC7XEGVfsV1LfjVxWlgMIuVFtxbkQ6iuKGJloR/DYiRL9YNLAkThvrglHrXkvSNYrIpX0salIIlbsYNLe21SUYmM8nV0voz4gDJ+Yol9fNZ5fECLfUrOcFomGBJ/mdtWTxfS57QEIghty3pb/aVo99NLf1tBUF4RdQCUC0Ii6cWRDWAyoSli92pgdwYI5r2LCBdI5k5qMHcFSOW3mWBechIFd6hAd2g/kGa8m1GL9nxyEtvf/rl17723n7JcDBalU/zD8IbLEBdJdMyDepcZo4t2W/1C3/dtf5j/0/l9itpmHmuBeoyiQZFYVFTZj1/QQvIz83yFCzKSFPvliaiqidJ9r80GQOWIvZFi5AvGhkmWaScKEHxa7RwiwkX86ZFzDdiROtrkdMIlvpPevieWAs1QRcIlfkyRUwmkeZrks4TKM0ZmrhGnPEWUccLE/6SKl8pUappslYVZTtdfEFSnqdLYMRorAnbSIw1lFktxleUMULkj1JGGRF6atL6IqykTSDCC7RRAoSTaZOk7MsVpY0y9lXXxDX2taWOa98I6gy3bz51fPs2U2eTfVups5V8W8i3lXzKvg3U2WDfbOoE9g2mziD7WlLHs68ydQL7MkdpozLbF/6dNr+F7eMnaPM4C7iQNkqEDrQJRMh6lzJ+FhH4Xcq8x0LOp4wvRnXKVBMj9g+6eEYMXkYXlwUtFqWKKiYKv0WVN0PC9qFKH3FS/EITEy8Oj6LJKBY4VQJFElgkHkmRESGh476gh4oXi5vRoymLfpIaJ1j4rMm0SPLE42606BqScS8lOCRlqs/pwKnk4OLnqRAUY1kb36KBahSSd2CUAmoAyzyRAGoCyz1bYU/NZNnH38OdGh+Sv99NzAX9GML6Z/F2tj7DWPgjrAUeQ/nADoUxtT1lCNC2f+ErcBnWjAcUrtR+n8Gt/R6m3vcY4pg5eJodwzCvx9M6hjmSjKekCEydLUR3gulJTBmQct3BlGcgmq5RPQ2g8Le4+kbBU1MjW8GzE1suOKnOYytgaHpqdPeA5hl8PQ1MDg9fnoJlgkb4eFg+wNj7oBSNYkwFkMy1UD4HkPCXOPsSkBIWzqMeHLORpgM4PsWaB0Z+hTVloBhloX0UFM/gzQUi9XW8ealhaKER78KwCnMKho8wF4CQ6S7m/ACCNhr1CoJFuFsEwXO48wGIPYu7c7HyFdHI9+VT2FPyTcNeIN8+7LnyvYM9I18C9v6WLnIbe7cjsuWx0J9btur4M7K1xF8L2Trjz5NtAP76yzYGf6Nlm4i/QLah+BsiWzf8Kdla4s+TrQ7+fNkK4C+QLeUd7HlGNv4be4qlfwd7Rr7d2DPyjcOeK1997DWQL/M93N3NJB9/jjsOAbgJdz4EnXHXCQJ1G3O3FQT8EuZeZBBHYk7BkPsu3vxcMPDzeHuOgeyMt05QpPgba3+5UPBCrC1iMLNcwVmQBQ5ejbNVDGiOaxhzFSS8GGOGQU39B75+Tw0L98RXDwY2/AK2ng9Dw3nO4yrgELx9cNWHAVZHMHWYQX7wYzwpFyYukIwlzh+Cuu41HLl1GO5WtzCkDEPe4y5+fMOwd7uJnVvdGfpmV3ATNGP4qydgJsGwE+Z+Gy9v++yMke1RnKhtEXbMDgkYSWzPTprlFD78LOywbb/HhWnDzhuZegkPF01KduTMiy/ggI0KOXaGeQnOl+BlYEePdHsl6mSKu0dCzl987hdRZ1JfzC3OWCwx65UbTnOTZ3khXKZuvuyFs05x9kW3mRdCaUzBjjN2vfLbjShUyv+Nd03vWDAmhN3Y9EVqNm3dqdeAgWC63Dkwyk8fG7rvf5ABAFZQOCCcBgAAkEQAnQEqAAEAAT6RQpZHpaq0IS54GpqAEglpbt/6a6Os2kbbcnRKfRB9Sruz0Y+baMnny8NNU0Tu+ytdpL/HowaXC7bBpcLtsGlwu2waWux6EzwI4kMBLlvrZevy0vqgteabD+GZRaHssfbrRAr++ITuRHqac1u/T9jAn6yy4k6hTo3K/J41dv4n5eWkm2RZE2dHPSlj4FIA/Qn8CzaUXsnlD+GwTdGtG1h0qLXgy2E7s0AIJyyTwHPY0sRWXOLn0uYVf+clnwX8KCPqz6uMhWoYngFFveGQWsxHVTO5Lxb82J454meXObLHSknDHj0xUgfwB6ILrZjYOogpCKb47BPzVOR+QrFDxVq7N6/6/vCOClHu+ZdZ3MtFLguXVAZgffH8tUv9DuY6HA796tWo+g6KCLDzDxVTm2rQdCK/VgDD4oHzpBVE/Eum9LU0VI0V8ksJNtae9Scn1ez90HDqttNa+imlg1WvNpBgkZq/ly6FPA8M1rbCURaTEVD/Bsr2NkjObih3Sv0+eILZfi/16i2yTVDd2zCemzeyJvT2yC2ILiplSqYJYE8o05JR6OIiLCqvC1o96rtC5+Ndyu2Ms1jH2rxremAXb0GjVheZ0+srYXJjY0CDE7MX+JDYVMqzf0K6tAniHJoRNDwZaDT9jiZBIwL7q/fU0H1ABG8fjG9D7E+fjhhmrJ2yAFRGsjnOJh/TIjR5qwqaKn8mhdU9odKIZVkcW0nPlpvLNoAA/vnQQAAAAAAMS4mqjby7xGaGLyKbL7+Qg0t0BL6Ghpu/NP7D574f6G+aqywg4a1bphP63tRmN3IFYDvo2CLhDXTCBiTBCT896/BSY+cNkIhRTaCb+XsPWO0vleqrk9Vyd5HDCvi33tjSN89NqpzDL7loi4AL01sC+5KAG3dbNfHQyfIteXeVI3bNZym3tGA1FeE0cRVnrR7dhe4TV27r31wI9jCOWRDJEyTBsk0p7/neDgFG2ZRVRJ/DB8cJVtRC98fnYwkzjbJmQppQhKljmnqrbPYwKJF6EjDqsbWTrbZ0yhc3cS4hUW4p3C/wStFgadOEuUUWFqZdjFYBsJUSRh4XIOJf0DL64XJZn8ZeEoz709AcXhtznMRJJRpgDnUPFzHCjxHRbIBgwpJxdlWGfMYRx03Jh2E78HM3fJdMs90AixHXcSuBVfklMFiUsfJTH4cN3At/OmtLHh5AB+bOsTUmVlVtFBILdBR8uom5ZkNLA6991sEVFjKU52xFJ49Z1e16b5lX7SIx8bDpSCg9tZsmPNljdkpLrnJ8SVlfOFs2rnfwEAyRbmOIH8G/FCDA+lygqHOpajPd7apKWAKs4CZdlOGaiDgK32KIKOv36mQ6idwVy1txOBUuejU3QOMlk0PxAAZQn6I5/4z7E7SgiU9WwJ39WSQeWZPKGHXQaAVOFgVp1sOKBt87dxMUUS5BDzXtC9h+hZYo4+c3mg4Oz2YwaQsrwxiGCCvy89bODbNDLwKCbEEuBVFza9nBvaOqzwuj+8MdC0983AzLUHPzYh4X2oD0dA6/6ihnTKl0e6+V/43gaTSGQMiuh6UjzPSGv3lsaQyG7dxXNGdy9NESLWUukwGvV8LmPFxxNlJJJZCIiTqkf238pFKnE7O1GhFMqA/dma2l+buD9ASgP6NKYoRfAxClavh0jB+Qsw6gkyAHILiT7RzWEWu3M7II74mx844CTX32ujH4SACzkqD6L6l8fPSRcxV7PkewwWf3gzlVTcTfHCd2VADGIVoHjVMFe0U04FjBpi+ehhkGhFrCZvAwa4lIEBhzl2iOkZ2rm2Zc/F0e8XIP1LCOenWl0W4+EtWsRDvE+GooAslkIFiYiRL9TiOsIJqlXrG8RAfXsGrFNm1fPJRU5bOscaSv5LjByZu4FXkIaADmk8xpeFE6zbQfo8KUGPoUba4IX//fjnsDXlGEw/YGDifVzXYf/tL3HasSoZcMhDxBSh/1bD5nKUXtL6u2PqV6JwcHLoM2Pyy+WQniaMBfvqhn/X7wemDHY21sHJBsvS4/XwfVYWWRDTHFep6kmSrqOn7dA2L/Kdr0On6yQ/j/tgLQS2tZDRSVbFUQwjJGB1walrQ0uAGjdlP1cstQ6XBK4DyLNYTutwn0/H/jbRKhLAcTdpnq9arXc+3vplYlDQYp/mPsQ+Fyr+o0Jzaj61X8OsSVki4GcgpBRLc1IRsPDBVZT2on+sIhBCCto7kh+oWuWz8H/op9c0eq/+ZgAhCAAAAAAAAA";
const BLOG_LOGO_WEBP_BYTES = base64ToUint8Array(BLOG_LOGO_WEBP_BASE64);

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
        case "/":
        case "/index.html":
          // 服務儀表板 HTML
          ensureGet(method);
          response = await handleDashboard(env, corsHeaders);
          break;
        case "/logo.webp":
          // 服務 logo 圖片
          ensureGet(method);
          response = await handleLogo(env, corsHeaders);
          break;
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
        case "/api/daily":
          ensureGet(method);
          response = await handleDaily(request, env, corsHeaders);
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
    await updateD1Stats(env, path, isNewPageVisitor, isNewSiteVisitor);
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
        timestamp: new Date().toISOString(),
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
      timestamp: new Date().toISOString(),
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

  // 如果 D1 沒有數據，嘗試從 KV 同步
  if (results.length === 0 && env.PAGE_STATS) {
    try {
      await syncKVToD1(env, db);
      // 重新查詢
      const { results: newResults } = await statement.bind(minPv, limit).all();
      return jsonResponse(
        {
          success: true,
          count: newResults.length,
          results: newResults,
          timestamp: new Date().toISOString(),
        },
        corsHeaders,
        200,
      );
    } catch (error) {
      console.error("[worker] sync KV to D1 error", error);
    }
  }

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

async function handleDaily(request, env, corsHeaders) {
  const db = getD1(env);
  if (!db) {
    return jsonResponse({ success: false, error: "Daily endpoint requires D1 binding" }, corsHeaders, 503);
  }

  const url = new URL(request.url);
  const daysParam = Number.parseInt(url.searchParams.get("days") || "7", 10);
  let days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 7;
  days = Math.min(days, 90);

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  const startKey = start.toISOString().slice(0, 10);

  const statement = db.prepare(
    "SELECT date, pv, uv FROM site_daily_stats WHERE date >= ? ORDER BY date ASC"
  );
  const { results } = await statement.bind(startKey).all();

  const dailyMap = new Map(results.map((row) => [row.date, row]));
  const data = [];

  for (let i = 0; i < days; i += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const key = current.toISOString().slice(0, 10);
    const value = dailyMap.get(key);
    data.push({
      date: key,
      pv: value ? toInt(value.pv) : 0,
      uv: value ? toInt(value.uv) : 0,
    });
  }

  return jsonResponse(
    {
      success: true,
      range: days,
      results: data,
      timestamp: new Date().toISOString(),
    },
    corsHeaders,
    200,
    { "Cache-Control": cacheControlHeader(30) }
  );
}

function normalizePath(input) {
  if (!input) {
    return "/";
  }

  let raw = `${input}`.trim();
  if (!raw) {
    return "/";
  }

  if (raw.startsWith("//")) {
    raw = `https:${raw}`;
  }

  let pathSource = raw;

  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      const parsed = new URL(raw);
      pathSource = parsed.pathname || "/";
    } else if (/^[a-z][a-z0-9+.-]*:\/[^/]/i.test(raw)) {
      const fixed = raw.replace(/^([a-z][a-z0-9+.-]*:\/)([^/])/i, "$1/$2");
      const parsed = new URL(fixed);
      pathSource = parsed.pathname || "/";
    }
  } catch (error) {
    console.warn("[worker] unable to parse URL, falling back to raw path", raw, error);
  }

  let path = pathSource.split("?")[0].split("#")[0];

  if (!path.startsWith("/")) {
    path = `/${path}`;
  }

  path = path.replace(/\/+/g, "/");
  path = path.replace(/\/index\.html?$/i, "/");
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

async function updateD1Stats(env, path, isNewPageVisitor, isNewSiteVisitor) {
  const db = getD1(env);
  if (!db) {
    return;
  }

  const uvIncrement = isNewPageVisitor ? 1 : 0;
  const siteUvIncrement = isNewSiteVisitor ? 1 : 0;
  const today = new Date().toISOString().slice(0, 10);

  const statements = [
    db
      .prepare(
        `INSERT INTO page_stats (path, pv, uv, updated_at)
         VALUES (?, 1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(path) DO UPDATE SET
           pv = page_stats.pv + 1,
           uv = page_stats.uv + excluded.uv,
           updated_at = CURRENT_TIMESTAMP`
      )
      .bind(path, uvIncrement),
    db
      .prepare(
        `INSERT INTO site_daily_stats (date, pv, uv, updated_at)
         VALUES (?, 1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(date) DO UPDATE SET
           pv = site_daily_stats.pv + 1,
           uv = site_daily_stats.uv + excluded.uv,
           updated_at = CURRENT_TIMESTAMP`
      )
      .bind(today, siteUvIncrement),
  ];

  await db.batch(statements);
}

function getD1(env) {
  return env.DB || env.cloudflare_stats_top || null;
}

// 同步 KV 數據到 D1（僅在 D1 為空時調用）
async function syncKVToD1(env, db) {
  const kv = env.PAGE_STATS;
  if (!kv) return;

  const statements = [];

  try {
    const { keys } = await kv.list({ prefix: "page:", limit: 1000 });
    const pageMap = new Map();

    for (const key of keys) {
      const name = key?.name;
      if (!name) {
        continue;
      }

      const metricMatch = name.match(/^page:(.+):(pv|uv)$/);
      if (metricMatch) {
        const [, rawPath, metric] = metricMatch;
        const entry = pageMap.get(rawPath) || { pv: 0, uv: 0 };
        entry[metric] = toInt(await kv.get(name));
        pageMap.set(rawPath, entry);
        continue;
      }

      // Backward compatibility: legacy JSON structure stored at key "page:<path>"
      if (name.startsWith("page:")) {
        try {
          const legacy = await kv.get(name, "json");
          if (legacy && (legacy.pv || legacy.uv)) {
            const rawPath = name.replace(/^page:/, "");
            const entry = pageMap.get(rawPath) || { pv: 0, uv: 0 };
            if (legacy.pv) entry.pv = toInt(legacy.pv);
            if (legacy.uv) entry.uv = toInt(legacy.uv);
            pageMap.set(rawPath, entry);
          }
        } catch (legacyError) {
          console.warn("[worker] legacy KV parse error", legacyError);
        }
      }
    }

    for (const [rawPath, metrics] of pageMap.entries()) {
      if (!metrics || (!metrics.pv && !metrics.uv)) {
        continue;
      }

      const path = normalizePath(rawPath);

      statements.push(
        db
          .prepare(
            `INSERT INTO page_stats (path, pv, uv, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(path) DO UPDATE SET
               pv = excluded.pv,
               uv = excluded.uv,
               updated_at = CURRENT_TIMESTAMP`
          )
          .bind(path, metrics.pv || 0, metrics.uv || 0)
      );
    }
  } catch (error) {
    console.error("[worker] KV sync error", error);
  }

  if (statements.length > 0) {
    await db.batch(statements);
    console.log(`[worker] synced ${statements.length} pages from KV to D1`);
  }
}

async function handleDashboard(env, corsHeaders) {
  return new Response(DASHBOARD_HTML, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

async function handleLogo(env, corsHeaders) {
  const body = BLOG_LOGO_WEBP_BYTES.slice();

  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=86400, immutable',
      'Content-Length': body.length.toString(),
    },
  });
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

  const dailyUrl = new URL("/api/daily", base);
  targets.push(new Request(dailyUrl.toString(), { method: "GET" }));

  await Promise.all(
    targets.map((req) =>
      cache.delete(req).catch(() => false)
    )
  );
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
