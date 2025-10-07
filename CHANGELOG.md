# v1.6.0 更新說明

發布日期：2025-10-08

## ✨ 重點

- ✅ 儀表板 HTML / CSS / JavaScript 全面重寫，採用玻璃擬態卡片、深淺色主題與雙語切換按鈕，排版不再殘留壓縮版腳本。
- ✅ 新版儀表板加入 API 健康檢查、UTC 更新時間提示、搜尋錯誤提示與 Top 10 翻譯即時切換。
- ✅ README（中英）整理回乾淨結構，補上 v1.6.0 功能介紹與快速部署步驟。

## 🛠️ 修復詳情

- 儀表板腳本採用單一 IIFE 模式，所有函式拆分為 `loadSiteStats`、`loadDaily`、`performSearch` 等可讀性更高的單元。
- `renderTopPages()` 會重建清單並根據語系重算文案，避免切換語言後殘留舊字串。
- 搜尋輸入改為以 URL 物件組裝參數，並在空字串 / 錯誤時提供 i18n 錯誤提示。
- 首頁卡片註解只會套用在「總計」卡片，今日卡片仍顯示「今日」狀態文字。
- README.zh-TW 新增版本徽章與 v1.6.0 亮點；英文 README 完整重排，涵蓋架構、Quick Start 與 API 表格。

---

# v1.5.5 更新說明

發布日期：2025-10-08

## ✨ 重點

- ✅ `normalizePath()` 現在支援完整網址與協定相對路徑，無論輸入 `/zh-cn/...` 還是 `https://zakk.au/...` 都能回傳正確頁面統計。
- ✅ 儀表板腳本移除重複嵌入的壓縮版程式碼，解決頁面底部顯示原始 JavaScript 的「炸裂排版」。

## 🛠️ 修復詳情

- `normalizePath()` 會先嘗試以 `URL` 解析器處理地址，並修正舊資料裡的 `https:/` 變種，確保查詢 / 計數都指向同一個 KV / D1 key。
- 儀表板 HTML 現只保留單一 IIFE 版本，避免瀏覽器將意外殘留的程式碼視為文字節點，導致統計頁面錯亂。

---

# v1.5.4 更新說明

發布日期：2025-10-08

## ✨ 重點

- ✅ 儀表板內嵌腳本全面重寫成 IIFE 模式，移除巢狀模板字串，解決 VS Code TypeScript 解析錯誤並恢復資料載入。
- ✅ 卡片與趨勢圖保留載入 / 失敗 / 成功狀態，顯示最後成功同步的 UTC 時戳，使用者可立即判斷數據新鮮度。
- ✅ `robots.txt` 改為靜態檔案並停用 Hugo 生成邏輯，移除 Search Console 提示的 `Content-signal` 非標準指令。

## 🛠️ 修復詳情

- `loadSiteStats()` 與 `loadDailyChart()` 拆分責任，重新整理錯誤處理、快取破壞參數與 UI 更新邏輯。
- 新的 `loadTopPages()` 與 `searchPage()` 採用 `URL` 物件組裝查詢字串，避免模板字串轉義問題並增強快取控制。
- `initChart()` / `updateChartTheme()` 現採用安全的主題切換流程，確保 Chart.js 在模式切換時不會殘留舊設定。

## 📚 文件調整

- README（中英）補充「狀態提示」與 UTC 標註說明，對應新版儀表板行為。
- 靜態 `robots.txt` 加入專屬章節在部落格 README，並於 Hugo 主設定中顯式關閉 `enableRobotsTXT`。

---

# v1.5.2 更新說明

發布日期：2025-10-08

## ✨ 重點

- ✅ 儀表板與 Hugo 前端改為使用 `/api/stats` 的全站統計，移除 `url=/` 參數造成的首頁 UV 偏低問題，確保數據一致。
- ✅ `/api/stats` 現在回傳 `timestamp` 欄位，前端可以顯示最後更新的 UTC 時間。
- ✅ 儀表板加入「更新於 (UTC)」與趨勢圖刷新提示，並統一顯示全站數據的最新時間。
- ✅ Dashboard API 請求新增 `?t=<timestamp>` 參數，避免 Cloudflare 邊緣快取回傳過期的總數。

## 🛠️ 修復詳情

- `loadSiteStats()` 改用全站統計並在成功載入時記錄 API 時戳，與 Hugo 頁面顯示資料完全同步。
- Daily chart 成功載入後會保存 API 回傳時間，失敗時顯示錯誤提示並保持 UTC 標籤一致。
- 新增 `formatUtcTimestamp()` 工具，統一格式化 ISO 時間為 `YYYY-MM-DD HH:mm:ss UTC`，中英文皆可讀。

## 📚 文件調整

- README 更新：補充全站統計與 UTC 刷新說明，提醒使用者 timeline 與儀表板數據現已一致。
- Timeline 頁面備註新增 UTC 時間說明，方便讀者理解儀表板的時間軸。

---

# v1.5.1 更新說明

發布日期：2025-10-07

## ✨ 重點

- ✅ `/api/daily` 現在回傳真實的 PV / UV 數據，直接來源於 D1 `site_daily_stats` 表。
- ✅ 儀表板新增「暫無趨勢數據」狀態訊息，缺資料時自動補零並提示使用者。
- ✅ 熱門頁面請求附加時間戳參數，避免 Cloudflare edge 快取造成的舊資料。
- ✅ Blog 前端腳本 `assets/js/cloudflare-stats.js` 清理多餘註解，保留主題原生外觀並確保載入後移除骨架樣式。
- ✅ Installer `scripts/install.sh` 重寫為精簡互動式版本，可自訂 Worker 名稱與自有網域。
- ✅ 自訂 `assets/css/custom.css` 已清空，改由 Blowfish 主題原生樣式控制，避免後續升級破版。
- ✅ 文檔整併：原 `DASHBOARD_DEPLOY.md`、`FIXES_SUMMARY.md`、`DEPLOYMENT_SUMMARY.md`、`HUGO_INTEGRATION.md` 內容已濃縮至本更新紀錄與 README，減少重複維護。

## 🛠️ 修復詳情

- 修正零資料時圖表仍顯示載入動畫的問題，缺資料時會顯示 0 並同步更新「今日」指標。
- `updateNodes()` 會一併移除 `animate-pulse / text-transparent / -mt-[2px]` 等骨架類別，確保數字與圖示對齊。
- 新增 `/api/daily` 失敗時的錯誤處理與本地 fallback，避免圖表崩潰。
- Cloudflare Worker 佈署腳本與 README 已更新，指向最新的 Hugo 集成步驟與儀表板操作流程。

## 📚 文件調整

- README 與安裝腳本更新，直接包含 Hugo / Blowfish 快速集成說明。
- 佈署、修復與整合說明集中到 `CHANGELOG.md`，移除重複的 Markdown 檔。
- 若需歷史註解，可在 Git 歷史檔案中查閱被移除的舊文件。

---

# v1.3.0 更新說明

發布日期：2025-01-XX

## 🎉 主要更新

### 1. 整合架構 - API + 儀表板統一部署

之前的版本需要分別部署 Worker（API）和 Cloudflare Pages（儀表板），現在全部整合在一個 Worker 中：

```
stats.zakk.au/              → 儀表板
stats.zakk.au/api/count     → API：增加瀏覽量
stats.zakk.au/api/stats     → API：查詢統計
stats.zakk.au/api/batch     → API：批量查詢
stats.zakk.au/api/top       → API：熱門頁面
stats.zakk.au/health        → 健康檢查
```

**優勢：**
- ✅ 一次部署，同時獲得 API 和儀表板
- ✅ 無 CORS 問題（同源請求）
- ✅ 簡化維護和配置
- ✅ 自訂域名一站式解決

### 2. 全新藍色主題 🎨

- **主色調**：從橙色 (#f38020) 改為藍色 (#3b82f6)
- **視覺風格**：更現代、更專業
- **配色方案**：藍色漸變 + 綠色輔助色（成功狀態）

### 3. 深淺色模式切換 🌙☀️

- **深色模式**（預設）：適合夜間瀏覽，護眼舒適
- **淺色模式**：清爽明亮，適合白天使用
- **手動切換**：頂部按鈕一鍵切換
- **記憶功能**：使用 localStorage 保存偏好設定
- **圖表適配**：切換主題時圖表配色自動調整

### 4. 每日訪問趨勢圖表 📈

使用 Chart.js 實現的互動式圖表：

- **數據展示**：PV（瀏覽量）和 UV（訪客數）雙線圖
- **時間範圍**：支持 7/14/30 天三種視圖
- **互動功能**：懸停顯示詳細數據
- **響應式**：自動適配移動設備

**注意**：目前圖表使用模擬數據。如需真實歷史數據，可擴展 KV 存儲每日統計。

## 🛠️ 技術變更

### 新增文件

- `src/dashboard.js`：儀表板 HTML 內容（作為 ES 模組導入）

### 修改文件

- `src/index.js`：
  - 新增 `handleDashboard()` 函數處理根路徑請求
  - 導入 `dashboard.js` 模組
  - 版本號更新為 `1.3.0`
  - 新增 `/` 和 `/index.html` 路由

- `dashboard/index.html`：
  - 完全重寫 CSS 變量系統（雙主題支持）
  - 新增主題切換邏輯（JavaScript）
  - 整合 Chart.js CDN
  - 新增每日趨勢圖表區塊
  - API_BASE 改為 `window.location.origin`（自動適配）

- `README.md` & `README.zh-TW.md`：
  - 更新架構說明
  - 新增儀表板使用指南
  - 移除獨立 Pages 部署章節
  - 新增自訂域名設定說明

## 📦 部署方式

### 從舊版本升級

如果你之前部署了 v1.2.0 或更早版本：

```bash
cd cloudflare-stats-worker
git pull origin main
wrangler deploy
```

**遷移說明：**
1. 如果之前有獨立部署儀表板到 Cloudflare Pages，可以刪除該 Pages 項目
2. 使用 Worker 的自訂域名功能綁定域名（例如：`stats.yourdomain.com`）
3. 更新 Hugo 網站的 `cloudflare-stats.js` 中的 `API_BASE`（如果有變更域名）

### 全新部署

```bash
git clone https://github.com/Zakkaus/cloudflare-stats-worker.git
cd cloudflare-stats-worker
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

## 🎯 功能對比

| 功能 | v1.2.0 | v1.3.0 |
|------|--------|--------|
| API 端點 | ✅ | ✅ |
| 儀表板 | 獨立 Pages 部署 | 整合在 Worker |
| 主題色 | 橙色 | 藍色 |
| 深淺模式 | 僅深色 | 可切換 |
| 趨勢圖表 | ❌ | ✅ |
| 部署複雜度 | 需兩次部署 | 一次部署 |
| CORS 配置 | 需要設定 | 無需設定 |

## 🔮 未來計劃

- [ ] KV 存儲每日統計數據（替代模擬數據）
- [ ] 新增 `/api/trends` 端點返回歷史數據
- [ ] 儀表板支持日期範圍自訂
- [ ] 匯出數據功能（CSV/JSON）
- [ ] 頁面訪問路徑分析（referrer）
- [ ] 地理位置統計（CF-IPCountry header）

## 📝 Breaking Changes

**無重大破壞性變更**。所有 API 端點保持向後兼容。

**建議操作：**
- 如果使用自訂域名，確認 DNS CNAME 記錄正確指向 Worker URL
- 如果之前有獨立的 Pages 儀表板，可以安全刪除

## 🙏 致謝

感謝所有使用和反饋的用戶！如有問題請在 [GitHub Issues](https://github.com/Zakkaus/cloudflare-stats-worker/issues) 提出。

---

**完整更新日誌**: https://github.com/Zakkaus/cloudflare-stats-worker/compare/v1.2.0...v1.3.0
