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
