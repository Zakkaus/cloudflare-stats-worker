# Cloudflare Stats Worker

[![Version](https://img.shields.io/badge/version-1.6.0-brightgreen.svg)](https://github.com/Zakkaus/cloudflare-stats-worker/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Zakkaus/cloudflare-stats-worker)

> Serverless analytics powered by Cloudflare Workers + KV + D1 with a beautiful, bilingual dashboard.  
> 想看繁體中文介紹？請參考 [`README.zh-TW.md`](README.zh-TW.md)。

---

## Highlights

- **Edge-native analytics** – one Worker serves the REST APIs _and_ the dashboard from 300+ Cloudflare PoPs.
- **Privacy first** – no cookies, IPs are SHA-256 hashed and truncated after 24h.
- **Realtime dashboards** – brand-new v1.6.0 UI with dark/light mode, i18n toggle, health indicator, and Chart.js trends.
- **KV + D1 hybrid storage** – KV keeps blazing-fast counters while D1 stores historical daily and “top pages” aggregates.
- **Self-healing storage** – `/api/top` automatically backfills D1 from KV, plus documented playbook for zeroing counters safely.
- **Hugo friendly** – drop-in helper script keeps Blowfish placeholders in sync; zero custom CSS required.
- **Works offline** – every API call adds a timestamp so the dashboard can show last-updated status even on stale networks.

---

## Architecture

```
stats.example.com/              → Dashboard UI (this file)
stats.example.com/api/count     → Increment PV/UV counters (KV)
stats.example.com/api/stats     → Page or global stats (KV)
stats.example.com/api/batch     → Batch lookups for multiple paths
stats.example.com/api/top       → Top pages (D1, optional)
stats.example.com/api/daily     → Daily PV/UV trend (D1)
stats.example.com/health        → Health check + Worker version
```

All endpoints return JSON and include permissive CORS headers (`Access-Control-Allow-Origin: *`).

---

## Quick start

> Requirements: Node.js ≥ 18, `wrangler` CLI ≥ 3.0.

1. Clone and enter the repository.
   ```bash
   git clone https://github.com/Zakkaus/cloudflare-stats-worker.git
   cd cloudflare-stats-worker
   ```
2. Install (or upgrade) Wrangler and log in once.
   ```bash
   npm install -g wrangler
   wrangler login
   ```
3. Create the KV namespace and paste the IDs into `wrangler.toml`.
   ```bash
   wrangler kv namespace create PAGE_STATS
   wrangler kv namespace create PAGE_STATS --preview
   ```
4. (Optional) Enable the D1-backed features.
   ```bash
   wrangler d1 create cloudflare-stats-top
   wrangler d1 execute cloudflare-stats-top --file=schema.sql --remote
   ```
   Uncomment the `d1_databases` section in `wrangler.toml` and set the generated IDs.
5. Deploy 🎉
   ```bash
   wrangler deploy
   ```

The Worker URL (e.g. `https://cloudflare-stats-worker.your-subdomain.workers.dev`) will now serve the dashboard at `/` and every API route under `/api/*`.

---

## Dashboard features (v1.6.0)

- Responsive glassmorphism UI with live PV/UV cards, API health, and UTC timestamps.
- 7/14/30 day trend selector powered by Chart.js, with graceful zero-state fallbacks.
- Instant search for any page path – enter `/zh-cn/posts/gentoo-optimization/` and get normalized stats.
- Top 10 list with PV/UV badges, ranking, and automatic language switching.
- Dark/light mode toggle + language toggle (Traditional Chinese ⇄ English) with localStorage persistence.

Try it live: **https://stats.zakk.au/**

---

## API reference

| Method | Path | Description | Writes |
|--------|------|-------------|--------|
| `GET` | `/api/count?url=/path/` | Increment counters for `/path/` and return page + site totals | ✅ |
| `GET` | `/api/stats?url=/path/` | Fetch stats for a specific path | ❌ |
| `GET` | `/api/stats` | Fetch site-wide totals | ❌ |
| `GET` | `/api/batch?urls=/, /about/` | Batch lookup (max 50 paths) | ❌ |
| `GET` | `/api/top?limit=10` | Top pages ordered by PV (requires D1) | ❌ |
| `GET` | `/api/daily?days=7` | Daily PV/UV trend (requires D1) | ❌ |
| `GET` | `/health` | Worker status + semantic version | ❌ |

Every response contains a UTC `timestamp` so clients can display “last updated” information.

---

## Operations & maintenance

### Reset all analytics

> Because the Worker will repopulate D1 from KV when `/api/top` sees an empty table, **always clear KV first, then D1**.

1. Remove every key from the production KV namespace:
   ```bash
   # list first (optional)
   wrangler kv key list --binding=PAGE_STATS --preview false --remote

   # delete individual keys
   wrangler kv key delete "page:/posts/example/:pv" --binding=PAGE_STATS --preview false --remote

   # or iterate in a shell session
   # Cloudflare Stats Worker

   [![Version](https://img.shields.io/badge/version-1.6.0-brightgreen.svg)](https://github.com/Zakkaus/cloudflare-stats-worker/releases)
   [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
   [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Zakkaus/cloudflare-stats-worker)

   > Serverless analytics powered by Cloudflare Workers + KV + D1 with a polished, bilingual dashboard.  
   > Looking for the Traditional Chinese guide? See [`README.zh-TW.md`](README.zh-TW.md).

   ---

   ## Table of contents

   - [Why choose Cloudflare Stats Worker](#why-choose-cloudflare-stats-worker)
   - [Free tier and upgrade options](#free-tier-and-upgrade-options)
   - [Architecture & data flow](#architecture--data-flow)
   - [Dashboard highlights](#dashboard-highlights)
   - [Prerequisites](#prerequisites)
   - [Step 1: Clone the repository](#step-1-clone-the-repository)
   - [Step 2: Run the install script](#step-2-run-the-install-script)
   - [Step 3: Verify the APIs](#step-3-verify-the-apis)
   - [Step 4: Import the Hugo client script](#step-4-import-the-hugo-client-script)
   - [Step 5: Override Blowfish templates](#step-5-override-blowfish-templates)
   - [Step 6: Test locally](#step-6-test-locally)
   - [Step 7: Embed the dashboard page](#step-7-embed-the-dashboard-page)
   - [API quick reference](#api-quick-reference)
   - [Operations cheat sheet](#operations-cheat-sheet)
   - [FAQ](#faq)

   ---

   ## Why choose Cloudflare Stats Worker

   - **One Worker = APIs + dashboard + data sync** – deploy once and ship `/api/*` plus a hosted dashboard.
   - **Privacy first** – zero cookies, IP addresses are SHA-256 hashed and truncated; data retention is entirely under your control.
   - **Internationalization aware** – `normalizePath()` merges `/zh-tw/posts/foo/`, `/posts/foo/`, and `/posts/foo/index.html` into the same key.
   - **Starts free** – the Cloudflare free tier easily covers personal blogs and most small sites.
   - **Blowfish ready** – shipping client script + partial overrides tailored for the Hugo Blowfish theme.

   ## Free tier and upgrade options

   | Service | Free allowance | When to upgrade |
   |---------|----------------|-----------------|
   | **Workers** | 100k requests/day, 10ms CPU | Upgrade to Workers Paid ($5/mo) when daily traffic exceeds 100k or you need larger CPU headroom. |
   | **KV** | 1 GB storage, 100k reads / 1k writes per day | Move to the paid bundle when you store large JSON payloads or retain long-tail history. |
   | **D1** | 5 M queries/month, 1 GB storage | Switch to D1 Paid for heavier Top 10 usage or long-running trend queries. |

   > D1 is optional. If you only need real-time PV/UV counting, KV is sufficient and the dashboard still works (minus Top 10 and trends).

   ## Architecture & data flow

   ```mermaid
   graph LR
      Browser[Visitor] -->|/api/count| Worker
      Browser -->|/api/batch| Worker
      Dashboard[stats subdomain] -->|/api/stats /api/daily /api/top| Worker
      Worker -->|read/write| KV[(Cloudflare KV)]
      Worker -->|optional| D1[(Cloudflare D1)]
   ```

   - Every endpoint returns JSON and ships with permissive CORS headers (`Access-Control-Allow-Origin: *`).
   - When `/api/top` finds an empty D1 table it automatically backfills from KV to keep the dashboard stable.
   - Built-in caching keeps `/api/stats`, `/api/daily`, and `/api/top` cost-efficient without sacrificing freshness.

## Dashboard highlights

See it live: **[stats.zakk.au](https://stats.zakk.au/)**

- Glassmorphism cards, light/dark theme toggle, instant zh‑TW ⇄ EN locale switch.
- Today/sitewide PV/UV, API health badge, last-updated timestamp (UTC).
- 7/14/30-day trend charts (Chart.js) with clean zero-state fallbacks.
- Top 10 list with badge counts, quick path search, deep links to posts.
- Deploys as a standalone website—optionally embed via iframe/shortcode in any site.   ## Prerequisites

   - Cloudflare account (free plan is fine).
   - Node.js ≥ 18 and `wrangler` CLI ≥ 3.0 installed.
   - Git and a POSIX shell (macOS, Linux, or WSL).
   - To bind a custom subdomain like `stats.example.com`, ensure the apex domain is proxied by Cloudflare.

   ---

   ## Step 1: Clone the repository

   ```bash
   git clone https://github.com/Zakkaus/cloudflare-stats-worker.git
   cd cloudflare-stats-worker
   ```

   Project layout essentials:

   - `src/index.js` – Worker entrypoint with routing, cache invalidation, and D1 sync logic.
   - `dashboard/` – static assets for the built-in dashboard.
   - `scripts/` – automation helpers for deploy, verification, and cleanup.
   - `schema.sql` – D1 schema creating `page_stats` and `site_daily_stats`.

   ## Step 2: Run the install script

   ```bash
   chmod +x scripts/deploy.sh
   ./scripts/deploy.sh --domain stats.example.com
   ```

   The script will:

   1. Check that Wrangler is authenticated (prompting for `wrangler login` if needed).
   2. Create the KV namespace and persist IDs back into `wrangler.toml`.
   3. Apply `schema.sql` when a D1 binding is present (optional but recommended).
   4. Deploy the Worker and print out the dashboard / API URLs.

   Prefer manual setup? Execute the steps individually:

   ```bash
   wrangler kv namespace create PAGE_STATS
   wrangler kv namespace create PAGE_STATS --preview
   wrangler d1 create cloudflare-stats-top             # optional
   wrangler d1 execute cloudflare-stats-top --file=schema.sql --remote
   wrangler deploy
   ```

   ## Step 3: Verify the APIs

   ```bash
   curl https://stats.example.com/health
   curl "https://stats.example.com/api/count?url=/" | jq
   curl "https://stats.example.com/api/stats" | jq
   curl "https://stats.example.com/api/top?limit=5" | jq
   ```

   Or run the bundled smoke test:

   ```bash
   ./scripts/verify.sh https://stats.example.com
   ```

   The script checks every endpoint, validates cache headers, and surfaces common misconfigurations.

   ## Step 4: Import the Hugo client script

   1. Copy `client/cloudflare-stats.js` into your Hugo project (e.g. `assets/js/cloudflare-stats.js`).
   2. Add the script to `layouts/partials/extend-head.html`:
       ```go-html-template
       {{ $stats := resources.Get "js/cloudflare-stats.js" | resources.Minify | resources.Fingerprint }}
       <script defer src="{{ $stats.RelPermalink }}"
                   data-api="https://stats.example.com"
                   data-site="https://zakk.au"></script>
       ```
   3. Rebuild Hugo and confirm the PV placeholders on article pages animate in.

   The client scans `span[id^="views_"]`/`likes_`, normalizes paths, and uses `/api/count` or `/api/batch` to hydrate values with graceful fallbacks.

   ## Step 5: Override Blowfish templates

   To keep multilingual pages consolidated under the same key, override these files:

   - `layouts/_default/list.html`
   - `layouts/_default/single.html`
   - `layouts/partials/meta/views.html`
   - `layouts/partials/meta/likes.html`

   Core snippet:

   ```go-html-template
   {{- $path := partial "stats/normalize-path" . -}}
   <span id="views_{{ $path }}" class="views-counter animate-pulse">—</span>
   ```

   The `stats/normalize-path` partial strips language prefixes and `/index` endings so `/zh-tw/posts/foo/` and `/posts/foo/` share the same KV entry.

   ## Step 6: Test locally

   ```bash
   wrangler dev
   # in a separate terminal
   hugo server -D
   ```

   - Browse locally and confirm `/api/count` and `/api/batch` respond with HTTP 200.
   - Use `npx autocannon https://stats.example.com/api/count?url=/` to probe rate limiting if needed.
   - Stream logs with `wrangler tail` to watch KV/D1 interactions in real time.

## Step 7: Access your dashboard

Once deployed, visit your dashboard domain directly:

```
https://stats.example.com/
```

You'll see the same interface as [stats.zakk.au](https://stats.zakk.au/):

- Real-time today/site PV・UV cards
- API health status indicator  
- 7/14/30-day trend charts
- Top 10 pages ranking
- Dark/light theme and locale switcher

**Optional: Embed in Hugo**

Want to embed the dashboard in a blog page? Use the provided shortcode:

```markdown
{{< statsDashboard url="https://stats.example.com" heightClass="md:h-[1200px]" >}}
```

- The shortcode lives in `layouts/shortcodes/statsDashboard.html` with responsive, dark-mode aware styling.
- Use it inside `content/stats/index.*.md` to create a `/stats/` page on your site.
- Want full control? Port the `dashboard/` assets into Hugo partials or a standalone SPA.   ---

   ## API quick reference

   | Method | Path | Description | Writes | Default cache |
   |--------|------|-------------|--------|----------------|
   | `GET` | `/api/count?url=/path/` | Increment PV/UV and return page + site totals | ✅ | ❌ |
   | `GET` | `/api/stats?url=/path/` | Fetch stats for a specific path | ❌ | ✅ (30 s) |
   | `GET` | `/api/stats` | Fetch site-wide totals | ❌ | ✅ (30 s) |
   | `GET` | `/api/batch?urls=/,/about/` | Batch lookup (≤ 50 paths) | ❌ | ✅ (30 s) |
   | `GET` | `/api/top?limit=10` | Top pages ordered by PV (needs D1) | ❌ | ✅ (60 s) |
   | `GET` | `/api/daily?days=7` | Daily PV/UV trend (needs D1) | ❌ | ✅ (30 s) |
   | `GET` | `/health` | Health check + semantic version | ❌ | ❌ |

   All responses include a UTC `timestamp`, making “last updated” displays trivial.

   ## Operations cheat sheet

   ### Resetting all analytics

   > Because `/api/top` backfills D1 from KV, **always wipe KV first, then clear D1**.

   ```bash
   # 1. Delete every key in the production KV namespace
   wrangler kv key list --binding=PAGE_STATS --preview false --remote \
      | jq -r '.[].name' \
      | xargs -I{} wrangler kv key delete "{}" --binding=PAGE_STATS --preview false --remote

   # 2. Truncate D1 tables
   wrangler d1 execute cloudflare-stats-top --command "DELETE FROM page_stats;" --remote
   wrangler d1 execute cloudflare-stats-top --command "DELETE FROM site_daily_stats;" --remote

   # 3. Double-check
   wrangler kv key list --binding=PAGE_STATS --preview false --remote
   wrangler d1 execute cloudflare-stats-top --command "SELECT COUNT(*) AS count FROM page_stats;" --remote
   curl -s https://stats.example.com/api/top?limit=5
   ```

   ### Still seeing data on `/api/top`?

   - Inspect KV for leftover `page:*` keys – clearing D1 alone will rehydrate from KV.
   - Cache TTL is 60 s; either wait it out or hit `/health` to trigger invalidation.
   - Ensure no other environments (e.g. `wrangler dev`) are writing stats back in.

   ## FAQ

   **Why not Google Analytics?**  
   Cloudflare Stats Worker is cookie-free, works in China, and keeps raw numbers under your control—all while running on the free tier.

   **Will the dashboard slow my site?**  
   The article script loads with `defer` and batches requests, so above-the-fold performance is unaffected. The dashboard itself can be embedded via iframe to isolate resources.

   **Can I extend the data model?**  
   Absolutely. Add new D1 tables, store richer JSON blobs in KV, or hook into Cloudflare Queues/Scheduled Jobs for offline processing.

   **How do I exclude internal traffic?**  
   Add allow/deny logic inside `enforceRateLimit` or `handleCount`—for example, skip counting specific IP ranges or User-Agents.

   ---

   - Changelog: see [`CHANGELOG.md`](CHANGELOG.md).  
   - License: MIT (see [`LICENSE`](LICENSE)).
