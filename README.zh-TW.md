# Cloudflare Stats Worker

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Zakkaus/cloudflare-stats-worker)

🚀 **輕量級頁面瀏覽統計 API** - 基於 Cloudflare Workers + KV，隱私友善、零成本起步、全球邊緣加速。

完美替代 Google Analytics 用於靜態網站（Hugo、Hexo、VuePress 等）。

---

## ✨ 特色

- **🌍 邊緣計算**：全球 300+ 數據中心，延遲 < 50ms
- **🔒 隱私優先**：無 Cookie、IP 雜湊化、24 小時匿名化
- **💰 幾乎免費**：每日 10 萬次請求內完全免費
- **📊 實時統計**：PV/UV 即時更新，支持批量查詢
- **🛡️ 防濫用**：內建速率限制（60 秒 / 120 次）
- **🌐 多語言支持**：自動合併 `/zh-tw/posts/` → `/posts/`
- **📈 數據儀表板**：內建網頁儀表板含每日趨勢圖表
- **🎨 雙主題**：支持淺色與深色模式手動切換
- **📉 圖表視覺化**：使用 Chart.js 展示每日 PV/UV 趨勢

---

## 🎯 線上示例

- **數據儀表板**: https://stats.zakk.au （查看統計、圖表和趨勢）
- **API 端點**: https://stats.zakk.au/api/*
- **健康檢查**: https://stats.zakk.au/health

---

## 🏗️ 架構說明

本專案將 **API 與儀表板整合在同一個 Worker** 中：

```
stats.zakk.au/              → 儀表板（HTML 介面）
stats.zakk.au/api/count     → 增加瀏覽量
stats.zakk.au/api/stats     → 獲取統計數據
stats.zakk.au/api/batch     → 批量查詢
stats.zakk.au/api/top       → 熱門頁面（需要 D1）
stats.zakk.au/health        → 健康檢查
```

**優勢：**
- ✅ API 和儀表板統一部署
- ✅ 無 CORS 問題（同源）
- ✅ 簡化維護
- ✅ 支持自定義域名（CNAME）

---

## 📦 一鍵部署

### 方法 1：自動部署腳本（推薦）

```bash
git clone https://github.com/Zakkaus/cloudflare-stats-worker.git
cd cloudflare-stats-worker
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

腳本會自動：
1. 檢查 Wrangler 安裝
2. 登入 Cloudflare
3. 創建 KV 命名空間
4. 更新 `wrangler.toml`
5. 部署 Worker
6. 顯示部署 URL

### 方法 2：手動部署

#### 1. 安裝 Wrangler
```bash
npm install -g wrangler
wrangler login
```

#### 2. 創建 KV 命名空間
```bash
wrangler kv namespace create PAGE_STATS
wrangler kv namespace create PAGE_STATS --preview
```

將輸出的 ID 填入 `wrangler.toml`：
```toml
[[kv_namespaces]]
binding = "PAGE_STATS"
id = "你的 KV ID"
preview_id = "你的 Preview ID"
```

#### 3. 部署
```bash
wrangler deploy
```

#### 4. （可選）D1 熱門文章功能
```bash
# 創建 D1 數據庫
wrangler d1 create cloudflare-stats-top

# 應用 schema
wrangler d1 execute cloudflare-stats-top --file=schema.sql

# 更新 wrangler.toml 並取消註解 d1_databases 區塊
wrangler deploy
```

---

## 🔌 API 使用

### 基礎 URL
```
https://cloudflare-stats-worker.your-subdomain.workers.dev
或
https://stats.yourdomain.com  # 自訂域名
```

### 端點

| 端點 | 方法 | 說明 | 遞增計數 |
|------|------|------|---------|
| `/api/count?url=/path/` | GET | 遞增並返回統計 | ✅ |
| `/api/batch?urls=/a/,/b/` | GET | 批量查詢（最多 50 個） | ❌ |
| `/api/stats?url=/path/` | GET | 查詢單頁統計 | ❌ |
| `/api/stats` | GET | 全站統計 | ❌ |
| `/api/top?limit=10` | GET | 熱門文章（需 D1） | ❌ |
| `/health` | GET | 健康檢查 | ❌ |

### 示例

#### 計數並獲取統計
```bash
curl "https://stats.yourdomain.com/api/count?url=/posts/hello-world/"
```

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

#### 批量查詢
```bash
curl "https://stats.yourdomain.com/api/batch?urls=/,/about/,/posts/example/"
```

#### 熱門文章（需 D1）
```bash
curl "https://stats.yourdomain.com/api/top?limit=10"
```

```json
{
  "success": true,
  "top": [
    { "path": "/posts/popular-post/", "pv": 9876, "uv": 543 },
    { "path": "/posts/another-post/", "pv": 5432, "uv": 321 }
  ],
  "timestamp": "2025-10-07T12:34:56.789Z"
}
```

---

## 🎨 前端整合

### Hugo Blowfish 主題

1. **啟用閱讀量顯示**（`config/_default/params.toml`）：
```toml
[article]
  showViews = true

[list]
  showViews = true
```

2. **添加統計腳本**（`layouts/partials/extend-head.html`）：
```html
{{- $statsJs := resources.Get "js/cloudflare-stats.js" | minify | fingerprint -}}
<script src="{{ $statsJs.RelPermalink }}" defer></script>
```

3. **創建 JS 文件**（`assets/js/cloudflare-stats.js`）：
```javascript
(function () {
  const API_BASE = "https://stats.yourdomain.com"; // 改成你的 Worker URL

  document.addEventListener("DOMContentLoaded", function() {
    // 掃描所有 views_ 開頭的元素
    const viewNodes = document.querySelectorAll("span[id^='views_']");
    
    viewNodes.forEach(async (node) => {
      const path = parsePathFromId(node.id);
      if (!path) return;
      
      try {
        const res = await fetch(`${API_BASE}/api/count?url=${path}`);
        const data = await res.json();
        if (data.success) {
          node.textContent = data.page.pv || 0;
          node.classList.remove("animate-pulse", "text-transparent");
        }
      } catch (err) {
        console.warn("Stats error:", err);
        node.textContent = "—";
      }
    });
  });

  function parsePathFromId(id) {
    // views_posts/example/index.md → /posts/example/
    let path = id.replace(/^views_/, "");
    path = path.replace(/\.md$/i, "");
    path = path.replace(/\/index$/i, "/");
    if (!path.startsWith("/")) path = "/" + path;
    return path;
  }
})();
```

### 其他靜態網站生成器

只需在頁面中插入：
```html
<span id="views_current_page">0</span>
```

然後用 JavaScript 調用 `/api/count` 更新數字。

---

## 💰 成本估算

### Cloudflare Workers 免費方案
- ✅ 每天 100,000 次請求
- ✅ 10ms CPU 時間/請求
- ✅ 適合個人博客和中小型網站

### 超出免費額度（Workers Paid: $5/月）
| 每月請求量 | KV 讀取 | KV 寫入 | D1 讀取 | 總成本 |
|-----------|---------|---------|---------|--------|
| 300 萬 | 300 萬 | 10 萬 | 10 萬 | ~$5.60 |
| 1000 萬 | 1000 萬 | 30 萬 | 30 萬 | ~$7.50 |

**計算說明**：
- Workers: $5/月基礎 + 超過 1000 萬請求每百萬 $0.50
- **KV 存儲（Paid 方案包含）**:
  - ✅ 1000 萬次讀取操作/月
  - ✅ 100 萬次寫入操作/月
  - ✅ 100 萬次刪除操作/月
  - ✅ 100 萬次列表操作/月
  - ✅ 1 GB 儲存資料
  - 超出限制: 讀取 $0.50/百萬次，寫入 $5/百萬次
- D1: 每百萬次讀取 $0.36（前 2500 萬免費）

**對比 Google Analytics**: 完全免費 vs. GA 收集大量隱私數據

---

## 🔧 進階配置

### 自訂域名綁定

1. 進入 Cloudflare Dashboard
2. Workers & Pages → 你的 Worker → Settings → Triggers
3. Custom Domains → Add Custom Domain
4. 輸入 `stats.yourdomain.com`
5. DNS 會自動配置

### 啟用 D1 熱門排行

編輯 `wrangler.toml` 取消註解：
```toml
[[d1_databases]]
binding = "DB"
database_name = "cloudflare-stats-top"
database_id = "你的 D1 ID"
```

執行：
```bash
wrangler d1 execute cloudflare-stats-top --file=schema.sql
wrangler deploy
```

---

## 📊 使用數據儀表板

Worker 包含一個 **內建的網頁儀表板**，位於根路徑（`/`）。部署後，直接訪問 Worker URL：

```
https://cloudflare-stats-worker.your-subdomain.workers.dev/
# 或使用自訂域名：
https://stats.yourdomain.com/
```

### 儀表板功能

**📈 每日趨勢圖表**
- 視覺化 PV/UV 趨勢（7/14/30 天）
- 互動式 Chart.js 圖表
- 響應式設計，支持所有設備

**🎨 主題自訂**
- 🌙 **深色模式**（預設）：舒適的藍色配色
- ☀️ **淺色模式**：清爽的白色介面
- 頂部手動切換按鈕
- 使用 localStorage 保存偏好

**📊 統計卡片**
- 全站總 PV/UV
- 今日 PV 統計
- API 健康狀態

**🔍 頁面搜尋**
- 查詢任意頁面路徑
- 實時顯示 PV/UV
- 支持標準化路徑

**🔥 熱門頁面**
- Top 10 最多瀏覽頁面
- 需要 D1 數據庫（可選）

### 自訂域名設定

要使用像 `stats.zakk.au` 這樣的自訂域名：

1. **Cloudflare Dashboard** → Workers & Pages → 你的 Worker
2. **Settings** → **Triggers** → **Custom Domains**
3. 點擊 **Add Custom Domain**
4. 輸入你的域名（例如：`stats.zakk.au`）
5. DNS 記錄將自動配置 ✅

**注意**：儀表板和 API 共用同一域名：
- `https://stats.zakk.au/` → 儀表板
- `https://stats.zakk.au/api/*` → API 端點

---

### 調整速率限制

編輯 `src/index.js`：
```javascript
const RATE_LIMIT_WINDOW = 60; // 60 秒
const RATE_LIMIT_MAX = 120;   // 120 次請求
```

---

## 🛠️ 開發與測試

### 本地測試
```bash
wrangler dev
```

訪問 `http://localhost:8787/health`

### 健康檢查
```bash
chmod +x scripts/verify.sh
./scripts/verify.sh https://stats.yourdomain.com
```

### 查看日誌
```bash
wrangler tail
```

---

## 📊 監控

### Cloudflare Dashboard
Workers & Pages → 你的 Worker → Metrics

可查看：
- 請求數
- 錯誤率
- CPU 使用時間
- KV/D1 操作數

### 自定義告警
設置 Cloudflare Alerts：
- 錯誤率 > 5%
- CPU 使用 > 10ms
- 請求數異常

---

## 🤝 貢獻

歡迎提交 Issue 和 PR！

### 開發指南
1. Fork 本倉庫
2. 創建特性分支：`git checkout -b feature/amazing-feature`
3. 提交修改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 PR

---

## 📄 授權

MIT License

---

## 🙋 FAQ

### Q: 為什麼選擇 Cloudflare Workers？
A: 全球邊緣加速、免費額度高、隱私友善、無需維護服務器。

### Q: 與 Google Analytics 相比有什麼優勢？
A: 無隱私侵犯、無 Cookie、數據完全自主、更快的載入速度。

### Q: 是否支持實時統計？
A: 是！每次訪問都會實時更新，延遲通常 < 100ms。

### Q: 如何遷移現有數據？
A: 可以通過 KV API 批量導入歷史數據，參考 `scripts/import.sh`（即將推出）。

### Q: 能否統計特定時間範圍？
A: 當前版本統計累計值。時間範圍查詢需要 D1 + 自定義查詢（計劃中）。

---

## 🔗 相關資源

- [Cloudflare Workers 文檔](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文檔](https://developers.cloudflare.com/workers/wrangler/)
- [KV 存儲文檔](https://developers.cloudflare.com/kv/)
- [D1 數據庫文檔](https://developers.cloudflare.com/d1/)

---

## 💬 支持

- GitHub Issues: [提交問題](https://github.com/Zakkaus/cloudflare-stats-worker/issues)
- Discussions: [討論區](https://github.com/Zakkaus/cloudflare-stats-worker/discussions)

---

**⭐ 如果覺得有用，請給個星星！**
