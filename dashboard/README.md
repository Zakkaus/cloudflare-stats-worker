# Cloudflare Stats Dashboard

這是統計數據的網頁查看介面。

## 部署到 Cloudflare Pages

### 方法 1: 通過 Dashboard（推薦）

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 前往 **Workers & Pages**
3. 點擊 **Create application** → **Pages** → **Connect to Git**
4. 選擇 `cloudflare-stats-worker` 倉庫
5. 配置建置設定：
   - **Project name**: `stats-dashboard`（或其他名稱）
   - **Production branch**: `main`
   - **Build command**: （留空）
   - **Build output directory**: `dashboard`
6. 點擊 **Save and Deploy**
7. 等待部署完成
8. （可選）設定自訂域名：**Custom domains** → 添加 `stats.yourdomain.com`

### 方法 2: 使用 Wrangler CLI

```bash
# 確保已安裝 Wrangler
npm install -g wrangler

# 登入
wrangler login

# 部署
cd dashboard
wrangler pages deploy . --project-name=stats-dashboard
```

## 配置

編輯 `index.html` 第 335 行，將 API_BASE 改為你的 Worker URL：

```javascript
const API_BASE = 'https://your-worker-url.workers.dev';
// 或使用自訂域名
const API_BASE = 'https://stats.yourdomain.com';
```

## 功能

- ✅ 實時全站統計（PV/UV）
- ✅ API 健康檢查
- ✅ 單頁統計搜尋
- ✅ 熱門頁面 Top 10（需要配置 D1）
- ✅ 深色模式
- ✅ 響應式設計

## 要求

- Worker 必須已部署並可訪問
- （可選）D1 數據庫用於熱門頁面功能

## 線上示例

https://stats.zakk.au
