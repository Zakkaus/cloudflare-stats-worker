// Parquet archive, read side (the dashboard's Month-over-Month view).
//
// The dashboard downloads whole day files and queries them in DuckDB-Wasm, so
// arbitrary cross-filters cost 0 D1 rows. Only the live tail -- days after
// archive_max_day, normally just today -- is read from D1.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ARCHIVE_PREFIX, archiveKey, dayFromKey } from "../archive.ts";
import type { AppEnv } from "../env.ts";
import { CACHE_TTL_CLOSED, CACHE_TTL_LIVE, NO_STORE, jsonResponse } from "../http.ts";
import { dayIntToISO, parseDayParam } from "../lib/days.ts";
import { withDb } from "../middleware.ts";
import { archiveMeta, archiveWriter, liveRange } from "../services/archive-export.ts";
import { readMeta } from "../services/meta.ts";

export const archive = new Hono<AppEnv>();

function requireArchive(env: Env): R2Bucket {
  if (!env.ARCHIVE || !env.ARCHIVER) {
    throw new HTTPException(503, { message: "Parquet archive is not configured (no R2 bucket bound)" });
  }
  return env.ARCHIVE;
}

archive.all("/api/archive/manifest", withDb, async (c) => {
  const bucket = requireArchive(c.env);
  const days: { day: string; size: number; etag: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: ARCHIVE_PREFIX, cursor });
    for (const obj of page.objects) {
      const day = dayFromKey(obj.key);
      if (day) days.push({ day: dayIntToISO(day), size: obj.size, etag: obj.etag });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  days.sort((a, b) => (a.day < b.day ? -1 : 1));

  const meta = await readMeta(c.var.db);
  const live = liveRange(meta, c.var.config);
  return jsonResponse(
    {
      timezone: c.var.config.timezone,
      days,
      live: { from: dayIntToISO(live.from), to: dayIntToISO(live.to) },
    },
    200,
    { "Cache-Control": `public, max-age=${CACHE_TTL_LIVE}` }
  );
});

// The dashboard appends the manifest's etag (`&v=`) so a re-exported day gets
// a new URL, which is what makes the long cache lifetime safe.
archive.all("/api/archive/file", async (c) => {
  const bucket = requireArchive(c.env);
  const day = parseDayParam(c.req.query("day"));
  if (!day) return jsonResponse({ error: "day must be YYYY-MM-DD" }, 400, NO_STORE);
  const obj = await bucket.get(archiveKey(day));
  if (!obj) return jsonResponse({ error: "Not archived" }, 404, NO_STORE);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Content-Length", String(obj.size));
  headers.set("Content-Disposition", `attachment; filename="stats-${dayIntToISO(day)}.parquet"`);
  headers.set("Cache-Control", `public, max-age=${CACHE_TTL_CLOSED}, immutable`);
  return new Response(obj.body, { headers });
});

archive.all("/api/archive/live", withDb, async (c) => {
  requireArchive(c.env);
  const { from, to } = liveRange(await readMeta(c.var.db), c.var.config);
  const bytes = await archiveWriter(c.env).encodeLive(from, to, archiveMeta(c.var.config));
  const headers = {
    "Cache-Control": `public, max-age=${CACHE_TTL_LIVE}`,
    "X-Archive-From": dayIntToISO(from),
    "X-Archive-To": dayIntToISO(to),
  };
  if (!bytes) return new Response(null, { status: 204, headers });
  return new Response(bytes, {
    headers: { ...headers, "Content-Type": "application/vnd.apache.parquet" },
  });
});
