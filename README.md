# Cloudflare Stats Worker

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Zakkaus/cloudflare-stats-worker)

🚀 **Lightweight, Privacy-First Page View Counter** - Built on Cloudflare Workers + KV

Perfect alternative to Google Analytics for static sites (Hugo, Hexo, Jekyll, VuePress, etc.)

[繁體中文文檔](README.zh-TW.md) | [English](#)

---

## ✨ Features

- **🌍 Edge Computing**: 300+ global CDN locations, sub-50ms latency
- **🔒 Privacy-Focused**: No cookies, IP hashing, 24h visitor anonymization
- **💰 Nearly Free**: 100K requests/day on free tier
- **📊 Real-time**: Live PV/UV updates, batch query support
- **🛡️ Anti-abuse**: Built-in rate limiting (120 req/60sec per IP)
- **🌐 i18n Ready**: Auto-merge paths like `/zh-tw/posts/` → `/posts/`

---

## 📦 Quick Start

### One-Click Deploy

```bash
git clone https://github.com/Zakkaus/cloudflare-stats-worker.git
cd cloudflare-stats-worker
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

Script will handle:
1. Wrangler installation check
2. Cloudflare login
3. KV namespace creation
4. `wrangler.toml` configuration
5. Worker deployment
6. Display deployment URL

### Manual Deploy

<details>
<summary>Click to expand manual steps</summary>

#### 1. Install Wrangler CLI
```bash
npm install -g wrangler
wrangler login
```

#### 2. Create KV Namespace
```bash
wrangler kv namespace create PAGE_STATS
wrangler kv namespace create PAGE_STATS --preview
```

Copy the IDs to `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "PAGE_STATS"
id = "abc123..."           # from output above
preview_id = "xyz789..."   # from output above
```

#### 3. Deploy
```bash
wrangler deploy
```

#### 4. (Optional) Enable D1 for Top Posts
```bash
wrangler d1 create cloudflare-stats-top
wrangler d1 execute cloudflare-stats-top --file=schema.sql
```

Edit `wrangler.toml` to uncomment `[[d1_databases]]` block, then `wrangler deploy`.

</details>

---

## 🔌 API Reference

### Base URL
```
https://cloudflare-stats-worker.your-subdomain.workers.dev
# or use custom domain: https://stats.yourdomain.com
```

### Endpoints

| Endpoint | Method | Description | Increments Count |
|----------|--------|-------------|------------------|
| `/api/count?url={path}` | GET | Increment & return page+site stats | ✅ |
| `/api/batch?urls={path1},{path2}...` | GET | Batch query (max 50 paths) | ❌ |
| `/api/stats?url={path}` | GET | Get single page stats (read-only) | ❌ |
| `/api/stats` | GET | Get site-wide total stats | ❌ |
| `/api/top?limit={n}` | GET | Top N pages by views (D1 required) | ❌ |
| `/health` | GET | Health check | ❌ |

### Example Responses

<details>
<summary><code>GET /api/count?url=/posts/hello-world/</code></summary>

```json
{
  "success": true,
  "page": {
    "path": "/posts/hello-world/",
    "pv": 42,
    "uv": 15
  },
  "site": {
    "pv": 12345,
    "uv": 678
  },
  "timestamp": "2025-10-07T12:34:56.789Z"
}
```
</details>

<details>
<summary><code>GET /api/batch?urls=/,/about/,/posts/example/</code></summary>

```json
{
  "success": true,
  "count": 3,
  "results": {
    "/": { "normalizedPath": "/", "pv": 1000, "uv": 500 },
    "/about/": { "normalizedPath": "/about/", "pv": 200, "uv": 150 },
    "/posts/example/": { "normalizedPath": "/posts/example/", "pv": 80, "uv": 60 }
  },
  "timestamp": "2025-10-07T12:34:56.789Z"
}
```
</details>

<details>
<summary><code>GET /api/top?limit=5</code> (D1 required)</summary>

```json
{
  "success": true,
  "top": [
    { "path": "/posts/popular-post/", "pv": 9876, "uv": 543 },
    { "path": "/posts/trending/", "pv": 5432, "uv": 321 }
  ],
  "timestamp": "2025-10-07T12:34:56.789Z"
}
```
</details>

---

## 🎨 Frontend Integration

### Hugo (Blowfish Theme)

1. **Enable view counts** in `config/_default/params.toml`:
```toml
[article]
  showViews = true
[list]
  showViews = true
```

2. **Load script** in `layouts/partials/extend-head.html`:
```html
{{- $statsJs := resources.Get "js/cloudflare-stats.js" | minify | fingerprint -}}
<script src="{{ $statsJs.RelPermalink }}" defer></script>
```

3. **Create** `assets/js/cloudflare-stats.js`:
```javascript
(function () {
  const API_BASE = "https://stats.yourdomain.com"; // Your Worker URL

  document.addEventListener("DOMContentLoaded", function() {
    const nodes = document.querySelectorAll("span[id^='views_']");
    
    nodes.forEach(async (node) => {
      const path = parsePathFromId(node.id);
      try {
        const res = await fetch(`${API_BASE}/api/count?url=${path}`);
        const data = await res.json();
        node.textContent = data.page?.pv || 0;
        node.classList.remove("animate-pulse", "text-transparent");
      } catch {
        node.textContent = "—";
      }
    });
  });

  function parsePathFromId(id) {
    return ("/" + id.replace(/^views_|\.md$/gi, "").replace(/\/index$/i, "/")).replace(/\/+/g, "/");
  }
})();
```

### Generic Static Sites

Add to your page template:
```html
<span id="page-views">Loading...</span>

<script>
  fetch('https://stats.yourdomain.com/api/count?url=' + location.pathname)
    .then(r => r.json())
    .then(d => {
      document.getElementById('page-views').textContent = d.page.pv + ' views';
    });
</script>
```

---

## 💰 Cost Breakdown

### Free Tier (Cloudflare Workers)
- **100,000 requests/day**
- **10ms CPU time per request**
- ✅ Perfect for personal blogs & small sites

### Paid Tier ($5/month base)

| Monthly Traffic | KV Reads | KV Writes | D1 Reads | **Total** |
|----------------|----------|-----------|----------|-----------|
| 3M requests | 3M | 100K | 100K | **~$5.60** |
| 10M requests | 10M | 300K | 300K | **~$7.50** |
| 30M requests | 30M | 1M | 1M | **~$12.00** |

**Calculation**:
- Workers: $5/month base + $0.50/million requests beyond 10M
- KV: $0.50/million reads, $5/million writes
- D1: $0.36/million reads (first 25M free)

**vs Google Analytics**: Free but requires cookie consent banners + GDPR compliance headaches.

---

## 🔧 Advanced Configuration

### Custom Domain

1. Cloudflare Dashboard → Workers & Pages → Your Worker → Settings → Triggers
2. **Custom Domains** → Add `stats.yourdomain.com`
3. DNS records auto-configure ✅

### Adjust Rate Limiting

Edit `src/index.js`:
```javascript
const RATE_LIMIT_WINDOW = 60;  // 60 seconds
const RATE_LIMIT_MAX = 120;    // 120 requests
```

### Enable D1 Top Posts

Uncomment in `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "cloudflare-stats-top"
database_id = "your-d1-database-id"
```

Run:
```bash
wrangler d1 execute cloudflare-stats-top --file=schema.sql
wrangler deploy
```

---

## 🛠️ Development

### Local Testing
```bash
wrangler dev
# Visit http://localhost:8787/health
```

### Health Check
```bash
chmod +x scripts/verify.sh
./scripts/verify.sh https://stats.yourdomain.com
```

Output:
```
✅ Health check passed
✅ Count API works (PV: 42)
✅ Stats API works
⚠️  Top API not available (D1 not configured)
```

### View Logs
```bash
wrangler tail
```

---

## 📊 Monitoring

Access metrics in **Cloudflare Dashboard**:
- Workers & Pages → Your Worker → **Metrics**

Track:
- Request count
- Error rate
- CPU time usage
- KV/D1 operations

Set up **Alerts**:
- Error rate > 5%
- CPU time > 10ms
- Unusual traffic spikes

---

## 🤝 Contributing

Contributions welcome!

1. Fork this repo
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Open PR

---

## 📄 License

[MIT License](LICENSE)

---

## 🙋 FAQ

<details>
<summary><strong>Why Cloudflare Workers over self-hosted solutions?</strong></summary>

- No server maintenance
- Global edge caching (< 50ms latency worldwide)
- Auto-scaling without config
- Generous free tier
- Better DDoS protection than most VPS setups
</details>

<details>
<summary><strong>Is visitor data stored permanently?</strong></summary>

No. Visitor IDs are SHA-256 hashed and expire after 24 hours. Only aggregated PV/UV counts persist.
</details>

<details>
<summary><strong>Can I import existing analytics data?</strong></summary>

Yes! Use `scripts/import.sh` (coming soon) or manually populate KV via Wrangler CLI.
</details>

<details>
<summary><strong>Does it work with CDN/proxies?</strong></summary>

Yes. Uses `CF-Connecting-IP` header (or `X-Forwarded-For` fallback) to get real visitor IP.
</details>

<details>
<summary><strong>What about GDPR/CCPA compliance?</strong></summary>

Fully compliant:
- No cookies → no cookie banners needed
- IP hashing → no PII storage
- 24h anonymization → right to be forgotten built-in
</details>

---

## 🔗 Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Guide](https://developers.cloudflare.com/workers/wrangler/)
- [KV Storage Limits](https://developers.cloudflare.com/kv/platform/limits/)
- [D1 Database Guide](https://developers.cloudflare.com/d1/)

---

## 💬 Support

- **Issues**: [GitHub Issues](https://github.com/Zakkaus/cloudflare-stats-worker/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Zakkaus/cloudflare-stats-worker/discussions)

---

**⭐ Star this repo if you find it useful!**

Made with ❤️ using Cloudflare Workers
