import { defineConfig } from "drizzle-kit";

// Migrations are plain SQL under ./drizzle, applied per deployment with
// `wrangler d1 migrations apply` (wrangler.toml sets `migrations_dir = "drizzle"`)
// -- not through drizzle-kit's own D1 driver, so there is nothing to configure
// here beyond where the schema is and where the SQL goes.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
