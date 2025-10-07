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

## Hugo integration (Blowfish)

1. Copy `assets/js/cloudflare-stats.js` into your Hugo project (e.g. `assets/js/`).
2. Include it from `layouts/partials/extend-head.html` or equivalent:
   ```go-html-template
   {{ $stats := resources.Get "js/cloudflare-stats.js" | resources.Minify }}
   <script defer src="{{ $stats.RelPermalink }}" data-api="https://stats.example.com"></script>
   ```
3. Rebuild your site – Blowfish placeholders such as `{{ .Site.Data.views_total }}` will hydrate automatically.

Need multi-language normalization? The worker’s `normalizePath()` already collapses `/zh-cn/posts/foo/` → `/posts/foo/` for consistent keys.

---

## Local development

```bash
wrangler dev
```

Wrangler spins up a local Worker with KV + D1 bindings (using `.data/` + `D1` SQLite). Use the dashboard at `http://127.0.0.1:8787/` while hitting APIs under `http://127.0.0.1:8787/api/*`.

Deploy when you are happy:

```bash
wrangler deploy
```

---

## Changelog & license

- See [`CHANGELOG.md`](CHANGELOG.md) for release notes (v1.6.0 introduces the redesigned dashboard and resiliency improvements).
- Distributed under the [MIT License](LICENSE).
