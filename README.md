# Cloudflare Stats Worker (V2)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> Self-hosted, cookieless website analytics on Cloudflare Workers — rich per-pageview
> dimensions (OS, browser, device, country, referrer), bot exclusion, and a preact
> dashboard with free filtering, drill-down, and a country map.

---

## Highlights

- **Edge-native** — one Worker serves the ingest + query API *and* the dashboard SPA (Workers Static Assets).
- **Rich dimensions** — OS, OS version, browser, browser version, device type/vendor/model, country, referrer (domain + path).
- **Cookieless & bot-free** — visitor id = truncated `SHA-256(ip|ua)`; bots/AI crawlers are always excluded (`ua-parser-js`).
- **D1 as source of truth** — raw event fact table gives exact PV **and** UV under arbitrary filtering.
- **Retention that fits** — day-level detail for 6 months, auto-archived to month-level by a nightly cron; designed to stay well under 500 MB at 10k pv/day.
- **Reusable** — one site per deployment via config: worker domain, allowed origin, rate limit, timezone.

---

## Architecture

```
Browser (allowed site) ──report.js──► POST /api/send ──► D1 events_tab (1 row/pageview)
Dashboard SPA at /  ◄── Static Assets ── Worker
  └─ /api/query · /api/timeseries · /api/summary · /api/config ──► D1 (SELECT/GROUP BY)
Cron (nightly) ──► refresh site_daily_tab, archive+prune >6mo ──► events_monthly_tab
```

- **PV** = `COUNT(*)`, **UV** = `COUNT(DISTINCT visitor_id)` over `events_tab`.
- Because UV isn't additive across dimensions, `total` for the visitors metric is computed over the whole filtered set (never summed from groups).

See [`CLAUDE.md`](CLAUDE.md) for the full schema, key files, and conventions.

---

## Quick start

Prerequisites: Python 3.8+, Node 18+, **pnpm**, a Cloudflare account, `wrangler`.

```bash
git clone <this-repo> && cd cloudflare-stats-worker
python scripts/manage.py init    # interactive: creates D1, applies migrations, builds dashboard, deploys
```

The script prompts for the worker name, allowed website origin, rate limit, and timezone, then writes `deployments/<name>.toml` and deploys.

### manage.py reference

```bash
python scripts/manage.py init                    # First-time setup for a new site
python scripts/manage.py deploy [name]           # Rebuild dashboard and deploy an existing site
python scripts/manage.py deploy --all            # Deploy all sites
python scripts/manage.py deploy [name] --migrate # Apply pending DB migrations, then deploy
python scripts/manage.py list                    # List configured sites
python scripts/manage.py migrate [name]          # Apply pending drizzle migrations (remote)
python scripts/manage.py migrate --local         # ... against the local D1
python scripts/manage.py migrate --all           # ... on all sites
python scripts/manage.py baseline [name|--all]   # Adopt an EXISTING database into migration tracking
python scripts/manage.py run-sql <file> [name]   # Run an ad-hoc SQL file from scripts/sql/ (one-off backfills)
```

The schema lives in `src/db/schema.ts`; `pnpm db:generate` writes SQL migrations to `drizzle/`, and `migrate` applies them per site (tracked in each database's `d1_migrations` table). Databases created before migrations existed need `baseline` once — see `CLAUDE.md` › "Database schema & migrations".

Each site's config lives in `deployments/<name>.toml` (managed by the script; do not edit manually).

### Manual setup

```bash
pnpm install                              # root deps (hono, drizzle-orm, ua-parser-js, wrangler)
wrangler d1 create cloudflare_stats_db    # -> put database_id in wrangler.toml
pnpm db:migrate                           # apply drizzle/*.sql to the remote D1

pnpm --dir dashboard-v2 install
pnpm --dir dashboard-v2 build             # -> dashboard-v2/dist
wrangler deploy
```

Edit `wrangler.toml` `[vars]` to set `WORKER_DOMAIN`, `ALLOWED_ORIGIN`, `RATE_LIMIT_PER_MINUTE`, `TIMEZONE`.

---

## Add the beacon to your site

```html
<script defer src="https://stats.example.com/report.js"></script>
```

It POSTs `{ path, referrer }` to `/api/send` via `XMLHttpRequest`. Only requests whose `Origin` matches `ALLOWED_ORIGIN` (or `127.0.0.1`/`localhost` in dev) are accepted.

---

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/send` | Ingest one pageview. Origin-restricted; bots dropped. → `204` |
| `GET` | `/api/query` | Grouped breakdown: `metric`, `from`, `to`, `group_by`, `filter`, `exclude`, `limit` |
| `GET` | `/api/timeseries` | Daily trend: `metric`, `from`, `to`, `filter`, `exclude` |
| `GET` | `/api/summary` | Headline cards (today / 7d / 30d / all-time) |
| `GET` | `/api/config` | `{ timezone }` |
| `GET` | `/health` | `{ status, version, timestamp }` |
| `*` | | Dashboard SPA (static assets) |

**Dimensions:** `path, referrer_domain, country, browser, browser_version, os, os_version, device_type, device_vendor, device_model`.

Example:

```
/api/query?metric=visitors&from=2026-01-01&to=2026-06-30&group_by=country&filter=browser:Chrome&exclude=country:XX&limit=20
```

---

## Dashboard

English-only preact SPA (AG Grid + Apache ECharts). Metric switcher (Visitors / Page Views), time-range shortcuts (Today / Yesterday / Last 7 / Last 28 days), dark-light toggle, a trend chart, and six panels (Referrer, Path, Country, Browser, OS, Device type). Hover a panel row to **filter** or **exclude** that value; every panel updates. Each panel expands into a drill-down drawer with an AG Grid table and — for Country — an ECharts world map keyed by ISO-2.

---

## Local development

```bash
pnpm db:migrate:local
pnpm --dir dashboard-v2 build     # or: pnpm --dir dashboard-v2 dev  (proxies /api to :8787)
wrangler dev                      # http://127.0.0.1:8787
node check.js                     # quick-check (STATS_HOST=... to target remote)
bash scripts/verify.sh http://127.0.0.1:8787
```

---

## Retention

Raw events are kept day-level for ~6 months. A nightly cron (`30 15 * * *`, i.e. 00:30 Asia/Tokyo) refreshes the `site_daily_tab` rollup and archives older months into `events_monthly_tab` (per-dimension PV/UV — exact per single value, but not cross-filterable once the raw rows are pruned), then deletes the raw rows.

## Cloudflare Zero Trust Access Authentication

It is recommended to configure [Cloudflare Zero Trust](https://www.cloudflare.com/products/access/) to limit dashboard access to trusted admins only. Cloudflare Zero Trust has a free tier that allows 50 users for free (though a credit card is needed just to enable it).

Only the dashboard SPA itself should require a login — `/api/send` (the ingest beacon) and `/report.js` (the client script) are called directly by anonymous visitor browsers on your site, so they must stay public or every pageview beacon fails. This means **one worker domain needs three separate Access applications**: one covering the whole domain (protected), and two narrower ones that override it for the two public paths.

### Setup

1. Open **Zero Trust dashboard → Access controls → Applications → Create new application → Self-hosted**.
2. **Protect the dashboard** — create the first application:
   - **Application domain**: your worker's domain, e.g. `stats.example.com` (no path — this covers everything).
   - Add a policy restricting access to trusted admins, e.g. **Action: Allow**, **Include: GitHub → your org**, or **Include: Emails → your address(es)**.
   - Save. At this point the *entire* domain, including `/api/send` and `/report.js`, requires login.
3. **Open up `/api/send`** — create a second application on the same domain:
   - **Application domain**: same domain, but with path `stats.example.com/api/send`.
   - Policy: **Action: Bypass** (or **Allow** with **Include: Everyone**, labelled "Public" in the dashboard) — no login required.
   - Save.
4. **Open up `/report.js`** — create a third application the same way:
   - **Application domain**: `stats.example.com/report.js`.
   - Policy: same **Public**/**Bypass** policy as above.
   - Save.

Cloudflare Access matches the **most specific path** first, so the two public path-scoped applications take precedence over the domain-wide one and exempt just those two routes. Everything else — the dashboard HTML, `/api/query`, `/api/timeseries`, `/api/summary` — still requires the login from step 2. You should end up with three applications listed for the one worker (**Applications** list, one row each), with destinations `<domain>`, `<domain>/api/send`, and `<domain>/report.js`, where only the first has a real (non-Public) policy attached.

Verify by opening the dashboard domain in a private/incognito window — it should prompt for login — then confirming `curl -I https://stats.example.com/report.js` and a beacon POST to `/api/send` both return successfully without any Access redirect.

### Allow local testing to Access-protected deployments

Some deployments sit behind Cloudflare Zero Trust Access — fine for real admins, but it blocks scripted checks since `check.js`/`verify.sh` can't complete an OAuth flow. The fix is a Cloudflare Access **Service Token**, which is a bypass credential scoped to one Access application, not an account-wide key:

1. In the Zero Trust dashboard: **Access controls → Service credentials → Service Tokens → Create Service Token**. Copy the Client ID/Secret immediately — the secret is shown once.
2. On the target Access application, add a second policy: **Action: Service Auth**, **Include: Service Token** → the token from step 1. Leave the existing policies in place; Service Auth policies are evaluated before Allow/Block, so this doesn't loosen human access.
3. Put the credentials in a repo-root `.env` (gitignored) as `CF_Access_Client_Id` / `CF_Access_Client_Secret`.

`check.js` (via `node --env-file=.env check.js`) and `scripts/verify.sh` (which sources `.env` itself) both send `CF-Access-Client-Id`/`CF-Access-Client-Secret` automatically when those two vars are set, and are silent no-ops against anything not behind Access.

---

## License

MIT.
