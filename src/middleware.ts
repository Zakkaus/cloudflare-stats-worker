import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { corsHeadersFor, getConfig } from "./config.ts";
import { createDb, getD1 } from "./db/client.ts";
import type { AppEnv } from "./env.ts";

// Per-request config from `[vars]`, and the CORS preflight. OPTIONS is answered
// for every path -- API or asset -- with the same headers /api/send uses, which
// echo an origin only when it is the one allowed site (or a local dev host).
export const withConfig = createMiddleware<AppEnv>(async (c, next) => {
  const config = getConfig(c.env);
  c.set("config", config);
  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersFor(c.req.raw, config) });
  }
  await next();
});

// The drizzle handle over the D1 binding, for the routes that touch the database.
// An unbound database is a 503 with a clear message, not an opaque 500 from the
// first query.
export const withDb = createMiddleware<AppEnv>(async (c, next) => {
  const d1 = getD1(c.env);
  if (!d1) throw new HTTPException(503, { message: "D1 database is not bound" });
  c.set("db", createDb(d1));
  await next();
});
