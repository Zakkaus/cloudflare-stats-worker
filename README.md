# Cloudflare Stats Worker

自架 PV/UV 統計 API，基於 Cloudflare Workers + KV (+ 可選 D1)。  
Privacy-friendly, 無 Cookie, 極低成本, 全球 Edge 加速。

---

## ✨ 核心功能

- `/api/count?url=/path/` → 遞增並回傳頁面 + 全站 PV/UV
- `/api/batch?urls=/a,/b` → 批次查詢（最多 50 個）
- `/api/stats?url=/path/` → 讀取單頁（不遞增）
- `/api/stats` → 全站總覽
- `/api/top?limit=10` → 熱門文章（需 D1）
- `/health` → 健康檢查

### 隱私與安全
- SHA-256(IP+UA) 截取 16 hex → 24h TTL
- 速率限制：每 IP 每 60s 最多 120 次
- 多語路徑合併：`/zh-tw/posts/x/` → `/posts/x/`
- CORS 開放，適合靜態網站前端呼叫

---

## 🚀 快速部署

### 1. 建立 KV 命名空間
```bash
wrangler kv:namespace create PAGE_STATS
wrangler kv:namespace create PAGE_STATS --preview
```
將輸出的 `id` 與 `preview_id` 填入 `wrangler.toml`。

### 2. （可選）建立 D1 資料庫
若需熱門排行：
```bash
wrangler d1 create cloudflare-stats-top
```
取得 `database_id`，填入 `wrangler.toml` 並取消註解 `[[d1_databases]]` 區塊。

套用 schema：
```bash
wrangler d1 execute cloudflare-stats-top --file=schema.sql
```

### 3. 部署
```bash
wrangler deploy
```

### 4. 綁定自訂網域
在 Cloudflare Dashboard: Workers → Triggers → Custom Domains → 綁定 `stats.yourdomain.com`

---

## 📂 檔案結構

```
cloudflare-stats-worker/
├─ src/
│  └─ index.js       # Worker 主程式
├─ schema.sql        # D1 schema (可選)
├─ wrangler.toml     # Wrangler 設定
├─ scripts/
│  ├─ verify.sh      # 健康檢查腳本
│  └─ warmup-top.sh  # 預熱熱門排行
└─ README.md
```

---

## 🔌 API 說明

### GET /api/count?url=/posts/example/
**遞增並回傳**
```json
{
  "success": true,
  "page": { "path": "/posts/example/", "pv": 42, "uv": 15 },
  "site": { "pv": 12345, "uv": 678 },
  "timestamp": "2025-10-07T12:34:56.789Z"
}
```

### GET /api/batch?urls=/posts/a/,/posts/b/
**批次查詢（不遞增）**
```json
{
  "success": true,
  "count": 2,
  "results": {
    "/posts/a/": { "normalizedPath": "/posts/a/", "pv": 10, "uv": 5 },
    "/posts/b/": { "normalizedPath": "/posts/b/", "pv": 8, "uv": 4 }
  }
}
```

### GET /api/stats?url=/posts/example/
**讀取單頁（不遞增）**
```json
{
  "success": true,
  "page": { "path": "/posts/example/", "pv": 42, "uv": 15 }
}
```

### GET /api/stats
**全站總覽**
```json
{
  "success": true,
  "site": { "pv": 12345, "uv": 678 }
}
```

### GET /api/top?limit=10&min_pv=5
**熱門排行（需 D1）**
```json
{
  "success": true,
  "count": 10,
  "results": [
    { "path": "/posts/popular/", "pv": 999, "uv": 88, "updated_at": "..." },
    ...
  ]
}
```

---

## 🧪 驗證

使用內建腳本：
```bash
chmod +x scripts/verify.sh
./scripts/verify.sh https://stats.yourdomain.com
```

手動測試：
```bash
curl -s https://stats.yourdomain.com/health | jq
curl -s 'https://stats.yourdomain.com/api/count?url=/test/' | jq
curl -s 'https://stats.yourdomain.com/api/top?limit=5' | jq
```

---

## 💰 成本估算

| 流量 | 建議方案 | 理由 |
|------|----------|------|
| < 3K PV/日 | 純 KV | 免費額度充足 |
| 3K–8K PV/日 | 純 KV | 超額成本低（約 $1–5/月）|
| > 8K PV/日 | 加入 D1 | 寫入成本更低 |
| 需要排行 | 必須 D1 | `/api/top` 依賴 |

詳細費率參考 [Cloudflare Pricing](https://developers.cloudflare.com/workers/platform/pricing/)。

---

## 🔧 前端整合範例

### 基本整合（單頁遞增）
```html
<span id="page-views">0</span>

<script>
(async function() {
  const API = 'https://stats.yourdomain.com';
  const path = window.location.pathname;
  
  try {
    const res = await fetch(`${API}/api/count?url=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (data.success && data.page) {
      document.getElementById('page-views').textContent = data.page.pv;
    }
  } catch (err) {
    console.warn('Stats failed:', err);
  }
})();
</script>
```

### 列表頁批次查詢
```javascript
const paths = ['/posts/a/', '/posts/b/', '/posts/c/'];
const res = await fetch(`${API}/api/batch?urls=${paths.join(',')}`);
const data = await res.json();

paths.forEach(path => {
  const pv = data.results[path]?.pv || 0;
  document.querySelector(`[data-path="${path}"]`).textContent = pv;
});
```

---

## 📜 License

MIT

---

## 🔗 相關專案

- 主站整合範例：[Zakk Blog](https://github.com/Zakkaus/blog)
- Hugo Blowfish 主題：https://blowfish.page/

---

**Maintained by** [Zakk](https://zakk.au)
