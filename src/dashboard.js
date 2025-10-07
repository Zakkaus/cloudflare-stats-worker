// 儀表板 HTML 內容（雙語版本）
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-TW" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare Stats Dashboard</title>
    <meta name="description" content="Realtime analytics powered by Cloudflare Workers, KV, and D1">
    <link rel="icon" type="image/svg+xml" href="/logo.webp">
    <link rel="apple-touch-icon" href="/logo.webp">
    <style>
        *, *::before, *::after { box-sizing: border-box; }
        :root {
            --font-family: 'Inter', 'Noto Sans TC', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
            --radius: 18px;
            --shadow: 0 20px 40px -24px rgba(15, 23, 42, 0.55);
            --headline: #0f172a;
            --muted: #475569;
            --border: rgba(148, 163, 184, 0.35);
            --bg: #f1f5f9;
            --card-bg: rgba(255, 255, 255, 0.88);
            --card-border: rgba(148, 163, 184, 0.32);
            --accent: #3b82f6;
            --accent-soft: rgba(59, 130, 246, 0.12);
            --success: #10b981;
            --success-soft: rgba(16, 185, 129, 0.16);
            --error: #ef4444;
            --error-soft: rgba(239, 68, 68, 0.16);
            --gradient: linear-gradient(135deg, rgba(59, 130, 246, 0.16), rgba(14, 165, 233, 0.1));
        }
        html[data-theme="dark"] {
            --headline: #e2e8f0;
            --muted: #94a3b8;
            --border: rgba(148, 163, 184, 0.18);
            --bg: #0f172a;
            --card-bg: rgba(15, 23, 42, 0.82);
            --card-border: rgba(30, 41, 59, 0.65);
            --accent: #60a5fa;
            --accent-soft: rgba(96, 165, 250, 0.24);
            --success: #34d399;
            --success-soft: rgba(52, 211, 153, 0.18);
            --error: #f87171;
            --error-soft: rgba(248, 113, 113, 0.18);
            --gradient: linear-gradient(135deg, rgba(59, 130, 246, 0.28), rgba(14, 165, 233, 0.18));
            color-scheme: dark;
        }
        body {
            margin: 0;
            font-family: var(--font-family);
            background: var(--bg);
            color: var(--headline);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            padding: 32px 18px 48px;
        }
        .page {
            width: min(1120px, 100%);
            display: flex;
            flex-direction: column;
            gap: 28px;
        }
        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: var(--radius);
            backdrop-filter: blur(18px);
            box-shadow: var(--shadow);
        }
        header.page__header {
            display: flex;
            flex-direction: column;
            gap: 24px;
        }
        .hero {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 24px;
        }
        .hero__title {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .hero__title img {
            width: 64px;
            height: 64px;
            border-radius: 18px;
            border: 1px solid var(--card-border);
            background: rgba(255, 255, 255, 0.2);
            object-fit: cover;
        }
        .hero__title h1 {
            margin: 0;
            font-size: clamp(1.8rem, 4vw, 2.35rem);
            letter-spacing: -0.02em;
        }
        .hero__title p {
            margin: 4px 0 0;
            color: var(--muted);
            font-size: 1rem;
        }
        .hero__actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        .pill-button {
            border: 1px solid var(--card-border);
            background: var(--card-bg);
            color: var(--headline);
            border-radius: 999px;
            padding: 8px 16px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
        }
        .pill-button:link,
        .pill-button:visited {
            color: var(--headline);
        }
        .pill-button span.icon {
            font-size: 1.1rem;
            line-height: 1;
        }
        .pill-button:hover {
            background: var(--accent-soft);
            border-color: var(--accent);
            transform: translateY(-1px);
        }
        main.page__main {
            display: flex;
            flex-direction: column;
            gap: 28px;
        }
        .grid {
            display: grid;
            gap: 20px;
        }
        .stats-grid {
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        }
        .stat-card {
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .stat-card h2 {
            margin: 0;
            color: var(--muted);
            font-size: 0.9rem;
            letter-spacing: 0.02em;
            text-transform: uppercase;
        }
        .stat-card .value {
            font-size: clamp(1.8rem, 4vw, 2.35rem);
            font-weight: 700;
        }
        .stat-card .note {
            color: var(--muted);
            font-size: 0.9rem;
        }
        .stat-card.today {
            border: 1px solid var(--accent);
            background: var(--accent-soft);
        }
        .status-card {
            padding: 24px;
            display: grid;
            gap: 16px;
            background: var(--gradient);
        }
        .status-card h3 {
            margin: 0;
            font-size: 1.1rem;
        }
        .status-row {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 12px;
            font-size: 0.98rem;
        }
        .status-row span.label {
            color: var(--muted);
        }
        .status-value {
            font-weight: 600;
        }
        .chart-card {
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 18px;
        }
        .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            flex-wrap: wrap;
        }
        .chart-controls {
            display: inline-flex;
            gap: 6px;
            background: rgba(59, 130, 246, 0.08);
            padding: 6px;
            border-radius: 999px;
        }
        .chart-controls button {
            border: none;
            background: transparent;
            border-radius: 999px;
            padding: 6px 14px;
            cursor: pointer;
            font-size: 0.92rem;
            color: var(--muted);
            transition: background 0.18s ease, color 0.18s ease;
        }
        .chart-controls button.active {
            background: white;
            color: var(--accent);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.24);
        }
        html[data-theme="dark"] .chart-controls button.active {
            background: rgba(15, 23, 42, 0.7);
            color: var(--accent);
        }
        .chart-meta {
            font-size: 0.85rem;
            color: var(--muted);
        }
        .chart-wrapper {
            position: relative;
            width: 100%;
            height: 320px;
        }
        .chart-error {
            color: var(--error);
            background: var(--error-soft);
            border-radius: 12px;
            padding: 12px 16px;
            display: none;
        }
        .search-card {
            padding: 24px;
            display: grid;
            gap: 18px;
        }
        .search-card form {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        .search-card input {
            flex: 1 1 260px;
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 12px 16px;
            font-size: 1rem;
            background: rgba(255, 255, 255, 0.85);
            color: var(--headline);
        }
        html[data-theme="dark"] .search-card input {
            background: rgba(15, 23, 42, 0.85);
            color: var(--headline);
        }
        .search-card button.primary {
            border: none;
            border-radius: 12px;
            background: var(--accent);
            color: white;
            padding: 12px 22px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .search-card button.primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 10px 24px rgba(59, 130, 246, 0.28);
        }
        .search-error {
            display: none;
            color: var(--error);
            background: var(--error-soft);
            border-radius: 12px;
            padding: 12px 16px;
        }
        .search-result {
            display: none;
            padding: 16px 20px;
            border-radius: 14px;
            background: rgba(59, 130, 246, 0.08);
            border: 1px solid rgba(59, 130, 246, 0.16);
        }
        .search-result.show {
            display: block;
        }
        .search-result strong {
            display: block;
            font-size: 1.05rem;
            margin-bottom: 6px;
        }
        .search-result span.muted {
            color: var(--muted);
            font-size: 0.9rem;
        }
        .top-card {
            padding: 24px;
            display: grid;
            gap: 18px;
        }
        .top-list {
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            gap: 12px;
        }
        .page-item {
            display: grid;
            grid-template-columns: auto 1fr auto;
            gap: 16px;
            align-items: center;
            padding: 14px 16px;
            border-radius: 14px;
            border: 1px solid var(--card-border);
            background: rgba(255, 255, 255, 0.6);
        }
        html[data-theme="dark"] .page-item {
            background: rgba(15, 23, 42, 0.65);
        }
        .page-rank {
            font-weight: 700;
            font-size: 1.1rem;
            color: var(--accent);
            min-width: 28px;
        }
        .page-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .page-path {
            font-weight: 600;
        }
        .page-stats {
            font-size: 0.9rem;
            color: var(--muted);
        }
        .page-views {
            font-weight: 600;
            font-variant-numeric: tabular-nums;
        }
        .top-loading,
        .top-error {
            font-size: 0.92rem;
            color: var(--muted);
        }
        .top-error {
            color: var(--error);
        }
        footer.page__footer {
            text-align: center;
            font-size: 0.85rem;
            color: var(--muted);
            padding: 12px 0 24px;
        }
        footer.page__footer a {
            color: var(--accent);
            text-decoration: none;
            font-weight: 600;
        }
        footer.page__footer a:hover {
            text-decoration: underline;
        }
        @media (max-width: 720px) {
            body { padding: 24px 14px 32px; }
            .hero { flex-direction: column; align-items: flex-start; }
            .hero__actions { width: 100%; justify-content: stretch; }
            .hero__actions button { flex: 1 1 auto; justify-content: center; }
            .page-item { grid-template-columns: 1fr; }
            .page-views { justify-self: flex-start; }
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" integrity="sha384-e6nUZLBkQ86NJ6TVVKAeSaK8jWa3NhkYWZFomE39AvDbQWeie9PlQqM3pmYW5d1g" crossorigin="anonymous"></script>
</head>
<body>
    <div class="page">
        <header class="page__header">
            <div class="card hero">
                <div class="hero__title">
                    <img id="logo-img" src="/logo.webp" alt="Cloudflare Stats logo" width="64" height="64" loading="lazy">
                    <div>
                        <h1 data-i18n="title">統計數據儀表板</h1>
                        <p data-i18n="subtitle">實時查看網站訪問統計</p>
                    </div>
                </div>
                <div class="hero__actions">
                    <button id="theme-toggle" class="pill-button" type="button">
                        <span id="theme-icon" class="icon">🌙</span>
                        <span id="theme-text" data-i18n="darkMode">深色模式</span>
                    </button>
                    <button id="lang-toggle" class="pill-button" type="button">
                        <span class="icon">🌐</span>
                        <span id="lang-text">EN</span>
                    </button>
                    <a id="repo-link" class="pill-button" href="https://github.com/Zakkaus/cloudflare-stats-worker" target="_blank" rel="noopener">
                        <span class="icon">💻</span>
                        <span data-i18n="githubRepo">GitHub</span>
                    </a>
                </div>
            </div>
            <div class="grid stats-grid">
                <article class="card stat-card">
                    <h2 data-i18n="totalPageViews">全站總瀏覽量</h2>
                    <div id="site-pv" class="value">—</div>
                    <div class="note">—</div>
                </article>
                <article class="card stat-card">
                    <h2 data-i18n="totalUniqueVisitors">全站訪客數</h2>
                    <div id="site-uv" class="value">—</div>
                    <div class="note">—</div>
                </article>
                <article class="card stat-card today">
                    <h2 data-i18n="todayPageViews">今日瀏覽量</h2>
                    <div id="today-pv" class="value">—</div>
                    <div class="note" data-i18n="loading">載入中...</div>
                </article>
            </div>
        </header>

        <main class="page__main">
            <section class="card status-card">
                <h3 data-i18n="apiStatus">API 狀態</h3>
                <div class="status-row">
                    <span class="label" data-i18n="poweredBy">Powered by</span>
                    <span class="status-value">Cloudflare Workers · KV · D1</span>
                </div>
                <div class="status-row">
                    <span class="label" data-i18n="apiStatus">API 狀態</span>
                    <span id="api-status" class="status-value">—</span>
                </div>
                <div class="status-row">
                    <span class="label" data-i18n="version">版本</span>
                    <span id="api-version" class="status-value">—</span>
                </div>
                <div class="status-row">
                    <span class="label" data-i18n="chartUpdatedPrefix">趨勢圖資料更新 (UTC)</span>
                    <span id="daily-updated" class="status-value">—</span>
                </div>
            </section>

            <section class="card chart-card">
                <div class="chart-header">
                    <div>
                        <h3 data-i18n="dailyTrend">📈 每日訪問趨勢</h3>
                        <p id="daily-error" class="chart-error" role="alert"></p>
                    </div>
                    <div class="chart-controls">
                        <button type="button" data-days="7" class="active" data-i18n="last7Days">過去 7 天</button>
                        <button type="button" data-days="14" data-i18n="last14Days">過去 14 天</button>
                        <button type="button" data-days="30" data-i18n="last30Days">過去 30 天</button>
                    </div>
                </div>
                <div class="chart-wrapper">
                    <canvas id="dailyChart" role="img" aria-label="Daily PV/UV chart"></canvas>
                </div>
            </section>

            <section class="card search-card">
                <h3 data-i18n="searchPage">🔍 查詢頁面統計</h3>
                <form id="search-form" autocomplete="off">
                    <input id="path-input" type="text" name="path" placeholder="/posts/hello-world/" data-i18n-placeholder="searchPlaceholder">
                    <button id="search-btn" class="primary" type="submit" data-i18n="search">查詢</button>
                </form>
                <div id="search-error" class="search-error" role="alert"></div>
                <div id="search-result" class="search-result" aria-live="polite">
                    <strong id="result-path">—</strong>
                    <span class="muted">
                        <span id="result-pv">0</span> <span data-i18n="views">次瀏覽</span> ·
                        <span id="result-uv">0</span> <span data-i18n="visitors">位訪客</span>
                    </span>
                </div>
            </section>

            <section class="card top-card">
                <div class="header">
                    <h3 data-i18n="topPages">🔥 熱門頁面 Top 10</h3>
                </div>
                <div id="top-loading" class="top-loading" data-i18n="loading">載入中...</div>
                <div id="top-error" class="top-error" role="alert"></div>
                <ol id="top-list" class="top-list"></ol>
            </section>
        </main>

        <footer class="page__footer">
            <span data-i18n="poweredBy">Powered by</span>
            <a href="https://github.com/Zakkaus/cloudflare-stats-worker" rel="noopener" target="_blank">Cloudflare Stats Worker</a>
        </footer>
    </div>

    <script>
        (function () {
            "use strict";

            const API_BASE = window.location.origin;
            const html = document.documentElement;
            const i18n = {
                "zh-TW": {
                    title: "統計數據儀表板",
                    subtitle: "實時查看網站訪問統計",
                    darkMode: "深色模式",
                    lightMode: "淺色模式",
                    totalPageViews: "全站總瀏覽量",
                    totalUniqueVisitors: "全站訪客數",
                    todayPageViews: "今日瀏覽量",
                    apiStatus: "API 當前狀態",
                    dailyTrend: "📈 每日訪問趨勢",
                    last7Days: "過去 7 天",
                    last14Days: "過去 14 天",
                    last30Days: "過去 30 天",
                    searchPage: "🔍 查詢頁面統計",
                    searchPlaceholder: "輸入路徑，例如: /posts/hello-world/",
                    search: "查詢",
                    pageViews: "頁面瀏覽量",
                    uniqueVisitors: "獨立訪客",
                    topPages: "🔥 熱門頁面 Top 10",
                    loading: "載入中...",
                    total: "總計",
                    today: "今日",
                    normal: "✅ 正常",
                    error: "❌ 錯誤",
                    version: "版本",
                    cannotConnect: "無法連接",
                    loadFailed: "載入失敗",
                    poweredBy: "Powered by",
                    pvLabel: "瀏覽量 (PV)",
                    uvLabel: "訪客數 (UV)",
                    views: "次瀏覽",
                    visitors: "位訪客",
                    noData: "暫無熱門頁面數據",
                    loadError: "載入失敗",
                    noDailyData: "暫無趨勢數據，已顯示 0",
                    updatedAtPrefix: "更新於 (UTC)",
                    chartUpdatedPrefix: "趨勢圖資料更新 (UTC)",
                    searchPlaceholderError: "請至少輸入一個路徑，例如 /posts/hello-world/",
                    searchNoResult: "找不到這個路徑的數據",
                    githubRepo: "GitHub 倉庫"
                },
                "en": {
                    title: "Statistics Dashboard",
                    subtitle: "Real-time website analytics",
                    darkMode: "Dark Mode",
                    lightMode: "Light Mode",
                    totalPageViews: "Total Page Views",
                    totalUniqueVisitors: "Total Unique Visitors",
                    todayPageViews: "Today's Views",
                    apiStatus: "API Status",
                    dailyTrend: "📈 Daily Traffic Trend",
                    last7Days: "Last 7 Days",
                    last14Days: "Last 14 Days",
                    last30Days: "Last 30 Days",
                    searchPage: "🔍 Search Page Stats",
                    searchPlaceholder: "Enter path, e.g. /posts/hello-world/",
                    search: "Search",
                    pageViews: "Page Views",
                    uniqueVisitors: "Unique Visitors",
                    topPages: "🔥 Top 10 Pages",
                    loading: "Loading...",
                    total: "Total",
                    today: "Today",
                    normal: "✅ Normal",
                    error: "❌ Error",
                    version: "Version",
                    cannotConnect: "Cannot Connect",
                    loadFailed: "Load Failed",
                    poweredBy: "Powered by",
                    pvLabel: "Page Views (PV)",
                    uvLabel: "Unique Visitors (UV)",
                    views: " views",
                    visitors: " visitors",
                    noData: "No popular pages yet",
                    loadError: "Load failed",
                    noDailyData: "No trend data yet. Showing zeros.",
                    updatedAtPrefix: "Updated (UTC)",
                    chartUpdatedPrefix: "Trend refreshed (UTC)",
                    searchPlaceholderError: "Please enter a path such as /posts/hello-world/",
                    searchNoResult: "No stats found for this path",
                    githubRepo: "GitHub Repo"
                }
            };

            const elements = {
                sitePv: document.getElementById("site-pv"),
                siteUv: document.getElementById("site-uv"),
                siteNotes: Array.from(document.querySelectorAll(".stat-card:not(.today) .note")),
                todayPv: document.getElementById("today-pv"),
                todayNote: document.querySelector(".stat-card.today .note"),
                apiStatus: document.getElementById("api-status"),
                apiVersion: document.getElementById("api-version"),
                chartUpdated: document.getElementById("daily-updated"),
                chartError: document.getElementById("daily-error"),
                chartCanvas: document.getElementById("dailyChart"),
                chartButtons: document.querySelectorAll(".chart-controls button"),
                themeToggle: document.getElementById("theme-toggle"),
                themeIcon: document.getElementById("theme-icon"),
                themeText: document.getElementById("theme-text"),
                langToggle: document.getElementById("lang-toggle"),
                langText: document.getElementById("lang-text"),
                searchForm: document.getElementById("search-form"),
                pathInput: document.getElementById("path-input"),
                searchResult: document.getElementById("search-result"),
                resultPath: document.getElementById("result-path"),
                resultPv: document.getElementById("result-pv"),
                resultUv: document.getElementById("result-uv"),
                searchError: document.getElementById("search-error"),
                topLoading: document.getElementById("top-loading"),
                topList: document.getElementById("top-list"),
                topError: document.getElementById("top-error"),
                logo: document.getElementById("logo-img")
            };

            const storage = (function createStorage() {
                try {
                    if (typeof window !== "undefined" && window.localStorage) {
                        const testKey = "__stats_dashboard_test__";
                        window.localStorage.setItem(testKey, "1");
                        window.localStorage.removeItem(testKey);
                        return window.localStorage;
                    }
                } catch (error) {
                    console.warn("[dashboard] localStorage unavailable, using in-memory fallback", error);
                }
                const memory = new Map();
                return {
                    getItem(key) {
                        return memory.has(key) ? memory.get(key) : null;
                    },
                    setItem(key, value) {
                        memory.set(key, String(value));
                    },
                    removeItem(key) {
                        memory.delete(key);
                    }
                };
            })();

            const state = {
                theme: storage.getItem("theme") || "dark",
                lang: storage.getItem("lang") || "zh-TW",
                currentDays: 7,
                siteStatus: "loading",
                dailyStatus: "loading",
                lastSiteTimestamp: null,
                lastDailyTimestamp: null,
                chart: null,
                topPages: [],
                lastSeries: []
            };

            function t(key) {
                return (i18n[state.lang] && i18n[state.lang][key]) || key;
            }

            function setTheme(theme) {
                state.theme = theme;
                html.setAttribute("data-theme", theme);
                storage.setItem("theme", theme);
                updateThemeButton();
                updateChartTheme();
            }

            function toggleTheme() {
                const next = state.theme === "dark" ? "light" : "dark";
                setTheme(next);
            }

            function updateThemeButton() {
                if (!elements.themeIcon || !elements.themeText) {
                    return;
                }
                if (state.theme === "dark") {
                    elements.themeIcon.textContent = "🌙";
                    elements.themeText.textContent = t("darkMode");
                } else {
                    elements.themeIcon.textContent = "☀️";
                    elements.themeText.textContent = t("lightMode");
                }
            }

            function setLang(lang) {
                state.lang = lang;
                document.documentElement.lang = lang;
                storage.setItem("lang", lang);
                updateLangButton();
                applyTranslations();
                updateChartLabels();
                renderSiteStatus();
                renderDailyStatus();
                renderTopPages(state.topPages);
            }

            function toggleLang() {
                const next = state.lang === "zh-TW" ? "en" : "zh-TW";
                setLang(next);
            }

            function updateLangButton() {
                if (elements.langText) {
                    elements.langText.textContent = state.lang === "zh-TW" ? "EN" : "中文";
                }
            }

            function applyTranslations() {
                document.querySelectorAll("[data-i18n]").forEach(function (node) {
                    const key = node.getAttribute("data-i18n");
                    if (key) {
                        node.textContent = t(key);
                    }
                });
                document.querySelectorAll("[data-i18n-placeholder]").forEach(function (node) {
                    const key = node.getAttribute("data-i18n-placeholder");
                    if (key) {
                        node.setAttribute("placeholder", t(key));
                    }
                });
            }

            function updateChartTheme() {
                if (!state.chart) {
                    return;
                }
                const isDark = state.theme === "dark";
                const textColor = isDark ? "#e2e8f0" : "#1e293b";
                const gridColor = isDark ? "#334155" : "#e2e8f0";
                state.chart.options.plugins.legend.labels.color = textColor;
                state.chart.options.scales.x.ticks.color = textColor;
                state.chart.options.scales.x.grid.color = gridColor;
                state.chart.options.scales.y.ticks.color = textColor;
                state.chart.options.scales.y.grid.color = gridColor;
                state.chart.update();
            }

            function updateChartLabels() {
                if (!state.chart) {
                    return;
                }
                state.chart.data.datasets[0].label = t("pvLabel");
                state.chart.data.datasets[1].label = t("uvLabel");
                state.chart.update();
            }

            function setupChart() {
                if (typeof window.Chart === "function") {
                    initChart();
                    return;
                }
                const chartScript = document.querySelector('script[src*="chart.js"]');
                const handler = function () {
                    initChart();
                };
                if (chartScript && typeof chartScript.addEventListener === "function") {
                    chartScript.addEventListener("load", handler, { once: true });
                } else {
                    window.addEventListener("load", handler, { once: true });
                }
            }

            function initChart() {
                if (!elements.chartCanvas) {
                    return;
                }
                if (typeof window.Chart !== "function") {
                    state.chart = null;
                    return;
                }
                const ctx = elements.chartCanvas.getContext("2d");
                if (!ctx) {
                    state.chart = null;
                    return;
                }
                if (state.chart) {
                    state.chart.destroy();
                }
                state.chart = new Chart(ctx, {
                    type: "line",
                    data: {
                        labels: [],
                        datasets: [
                            {
                                label: t("pvLabel"),
                                borderColor: "#3b82f6",
                                backgroundColor: "rgba(59, 130, 246, 0.12)",
                                borderWidth: 2,
                                tension: 0.35,
                                fill: true,
                                data: []
                            },
                            {
                                label: t("uvLabel"),
                                borderColor: "#10b981",
                                backgroundColor: "rgba(16, 185, 129, 0.12)",
                                borderWidth: 2,
                                tension: 0.35,
                                fill: true,
                                data: []
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                display: true,
                                labels: {
                                    color: state.theme === "dark" ? "#e2e8f0" : "#1e293b",
                                    font: { size: 12 }
                                }
                            },
                            tooltip: {
                                mode: "index",
                                intersect: false
                            }
                        },
                        scales: {
                            x: {
                                ticks: {
                                    color: state.theme === "dark" ? "#e2e8f0" : "#1e293b"
                                },
                                grid: {
                                    color: state.theme === "dark" ? "#334155" : "#e2e8f0"
                                }
                            },
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    color: state.theme === "dark" ? "#e2e8f0" : "#1e293b"
                                },
                                grid: {
                                    color: state.theme === "dark" ? "#334155" : "#e2e8f0"
                                }
                            }
                        }
                    }
                });
                updateChartTheme();
                if (state.lastSeries && state.lastSeries.length) {
                    updateDailyChart(state.lastSeries);
                }
            }

            function updateDailyChart(series) {
                state.lastSeries = Array.isArray(series)
                    ? series.map(function (item) {
                        return { date: item.date, pv: item.pv || 0, uv: item.uv || 0 };
                    })
                    : [];
                if (!state.chart) {
                    return;
                }
                const labels = series.map(function (item) {
                    const parsed = new Date(item.date);
                    if (Number.isNaN(parsed.getTime())) {
                        return item.date;
                    }
                    const month = parsed.getMonth() + 1;
                    const day = parsed.getDate();
                    return month + "/" + day;
                });
                state.chart.data.labels = labels;
                state.chart.data.datasets[0].data = series.map(function (item) { return item.pv || 0; });
                state.chart.data.datasets[1].data = series.map(function (item) { return item.uv || 0; });
                state.chart.update();
            }

            function renderSiteStatus() {
                const message = (function () {
                    if (state.siteStatus === "loading") {
                        return t("loading");
                    }
                    if (state.siteStatus === "error") {
                        return t("loadFailed");
                    }
                    if (state.lastSiteTimestamp) {
                        return t("total") + " · " + t("updatedAtPrefix") + ": " + formatUtc(state.lastSiteTimestamp);
                    }
                    return t("loadFailed");
                })();
                elements.siteNotes.forEach(function (node) {
                    node.textContent = message;
                });
            }

            function renderDailyStatus() {
                if (!elements.chartUpdated) {
                    return;
                }
                let detail;
                if (state.dailyStatus === "loading") {
                    detail = t("loading");
                } else if (state.dailyStatus === "error") {
                    detail = t("loadFailed");
                } else if (state.lastDailyTimestamp) {
                    detail = formatUtc(state.lastDailyTimestamp);
                } else {
                    detail = "—";
                }
                elements.chartUpdated.textContent = t("chartUpdatedPrefix") + ": " + detail;
            }

            function renderTopPages(pages) {
                if (!elements.topList) {
                    return;
                }
                state.topPages = Array.isArray(pages) ? pages : [];
                if (state.topPages.length === 0) {
                    elements.topList.innerHTML = "";
                    if (elements.topError) {
                        elements.topError.textContent = t("noData");
                        elements.topError.style.display = "block";
                    }
                    return;
                }
                if (elements.topError) {
                    elements.topError.textContent = "";
                    elements.topError.style.display = "none";
                }
                const markup = state.topPages.map(function (page, index) {
                    const rank = index + 1;
                    const pv = formatNumber(page.pv);
                    const uv = formatNumber(page.uv);
                    const path = typeof page.path === "string" ? page.path : "—";
                    return '<li class="page-item">' +
                        '<div class="page-rank">' + rank + '</div>' +
                        '<div class="page-info">' +
                            '<div class="page-path">' + sanitize(path) + '</div>' +
                            '<div class="page-stats">' + pv + t("views") + ' · ' + uv + t("visitors") + '</div>' +
                        '</div>' +
                        '<div class="page-views">' + pv + '</div>' +
                    '</li>';
                }).join("");
                elements.topList.innerHTML = markup;
            }

            function sanitize(value) {
                return String(value)
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#39;");
            }

            function formatNumber(value) {
                const num = typeof value === "number" ? value : 0;
                try {
                    return new Intl.NumberFormat(state.lang).format(num);
                } catch (_error) {
                    return String(num);
                }
            }

            function formatUtc(value) {
                try {
                    const date = typeof value === "string" ? new Date(value) : value;
                    if (!date || Number.isNaN(date.getTime())) {
                        return "—";
                    }
                    return date.toISOString().replace("T", " ").replace("Z", " UTC");
                } catch (_error) {
                    return "—";
                }
            }

            function showSearchError(message) {
                if (!elements.searchError) {
                    return;
                }
                if (message) {
                    elements.searchError.textContent = message;
                    elements.searchError.style.display = "block";
                } else {
                    elements.searchError.textContent = "";
                    elements.searchError.style.display = "none";
                }
            }

            async function loadSiteStats() {
                state.siteStatus = "loading";
                renderSiteStatus();
                try {
                    const url = new URL("/api/stats", API_BASE);
                    url.searchParams.set("t", Date.now().toString());
                    const response = await fetch(url.toString());
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status);
                    }
                    const data = await response.json();
                    if (data && data.success) {
                        const pv = data.site && typeof data.site.pv === "number" ? data.site.pv : data.page && typeof data.page.pv === "number" ? data.page.pv : 0;
                        const uv = data.site && typeof data.site.uv === "number" ? data.site.uv : data.page && typeof data.page.uv === "number" ? data.page.uv : 0;
                        if (elements.sitePv) {
                            elements.sitePv.textContent = formatNumber(pv);
                        }
                        if (elements.siteUv) {
                            elements.siteUv.textContent = formatNumber(uv);
                        }
                        state.lastSiteTimestamp = data.timestamp || new Date().toISOString();
                        state.siteStatus = "ok";
                    } else {
                        state.siteStatus = "error";
                        state.lastSiteTimestamp = null;
                    }
                } catch (error) {
                    console.warn("[dashboard] stats fetch error", error);
                    state.siteStatus = "error";
                    state.lastSiteTimestamp = null;
                }
                renderSiteStatus();
            }

            async function checkHealth() {
                if (!elements.apiStatus || !elements.apiVersion) {
                    return;
                }
                try {
                    const response = await fetch(API_BASE + "/health");
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status);
                    }
                    const data = await response.json();
                    elements.apiStatus.textContent = data.status === "ok" ? t("normal") : t("error");
                    elements.apiVersion.textContent = data.status === "ok" && data.version
                        ? t("version") + " " + data.version
                        : t("cannotConnect");
                } catch (error) {
                    console.warn("[dashboard] health check error", error);
                    elements.apiStatus.textContent = t("error");
                    elements.apiVersion.textContent = t("cannotConnect");
                }
            }

            async function loadDaily(days) {
                const targetDays = typeof days === "number" && !Number.isNaN(days) ? days : state.currentDays;
                state.currentDays = targetDays;
                state.dailyStatus = "loading";
                renderDailyStatus();
                if (elements.todayNote) {
                    elements.todayNote.textContent = t("loading");
                }
                if (elements.chartError) {
                    elements.chartError.style.display = "none";
                    elements.chartError.textContent = "";
                }
                try {
                    const url = new URL("/api/daily", API_BASE);
                    url.searchParams.set("days", String(targetDays));
                    url.searchParams.set("t", Date.now().toString());
                    const response = await fetch(url.toString());
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status);
                    }
                    const data = await response.json();
                    const hasResults = Array.isArray(data.results) && data.results.length > 0;
                    const series = hasResults ? data.results : buildFallbackSeries(targetDays);
                    updateDailyChart(series);
                    const todayData = series.length > 0 ? series[series.length - 1] : { pv: 0 };
                    if (elements.todayPv) {
                        elements.todayPv.textContent = formatNumber(todayData.pv);
                    }
                    if (elements.todayNote) {
                        elements.todayNote.textContent = t("today");
                    }
                    state.lastDailyTimestamp = data.timestamp || new Date().toISOString();
                    state.dailyStatus = "ok";
                    if (!hasResults && elements.chartError) {
                        elements.chartError.textContent = t("noDailyData");
                        elements.chartError.style.display = "block";
                    }
                } catch (error) {
                    console.warn("[dashboard] daily fetch error", error);
                    const fallback = buildFallbackSeries(targetDays);
                    updateDailyChart(fallback);
                    if (elements.todayPv) {
                        elements.todayPv.textContent = formatNumber(0);
                    }
                    if (elements.todayNote) {
                        elements.todayNote.textContent = t("today");
                    }
                    if (elements.chartError) {
                        elements.chartError.textContent = t("loadFailed");
                        elements.chartError.style.display = "block";
                    }
                    state.lastDailyTimestamp = null;
                    state.dailyStatus = "error";
                }
                renderDailyStatus();
            }

            function buildFallbackSeries(days) {
                return Array.from({ length: days }, function (_value, index) {
                    const date = new Date();
                    date.setDate(date.getDate() - (days - 1 - index));
                    return { date: date.toISOString().split("T")[0], pv: 0, uv: 0 };
                });
            }

            async function loadTopPages() {
                if (elements.topLoading) {
                    elements.topLoading.style.display = "block";
                }
                if (elements.topError) {
                    elements.topError.textContent = "";
                    elements.topError.style.display = "none";
                }
                try {
                    const url = new URL("/api/top", API_BASE);
                    url.searchParams.set("limit", "10");
                    url.searchParams.set("t", Date.now().toString());
                    const response = await fetch(url.toString());
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status);
                    }
                    const data = await response.json();
                    if (elements.topLoading) {
                        elements.topLoading.style.display = "none";
                    }
                    if (data && data.success && Array.isArray(data.results) && data.results.length > 0) {
                        renderTopPages(data.results);
                    } else {
                        renderTopPages([]);
                    }
                } catch (error) {
                    console.warn("[dashboard] top pages error", error);
                    if (elements.topLoading) {
                        elements.topLoading.style.display = "none";
                    }
                    if (elements.topError) {
                        elements.topError.textContent = t("loadError");
                        elements.topError.style.display = "block";
                    }
                    renderTopPages([]);
                }
            }

            function wireEvents() {
                if (elements.themeToggle) {
                    elements.themeToggle.addEventListener("click", toggleTheme);
                }
                if (elements.langToggle) {
                    elements.langToggle.addEventListener("click", toggleLang);
                }
                if (elements.chartButtons) {
                    elements.chartButtons.forEach(function (button) {
                        button.addEventListener("click", function () {
                            elements.chartButtons.forEach(function (item) {
                                item.classList.remove("active");
                            });
                            button.classList.add("active");
                            const days = parseInt(button.getAttribute("data-days"), 10);
                            loadDaily(days);
                        });
                    });
                }
                if (elements.searchForm) {
                    elements.searchForm.addEventListener("submit", function (event) {
                        event.preventDefault();
                        performSearch();
                    });
                }
            }

            async function performSearch() {
                if (!elements.pathInput) {
                    return;
                }
                const raw = elements.pathInput.value.trim();
                showSearchError("");
                if (elements.searchResult) {
                    elements.searchResult.classList.remove("show");
                }
                if (!raw) {
                    showSearchError(t("searchPlaceholderError"));
                    return;
                }
                try {
                    const url = new URL("/api/stats", API_BASE);
                    url.searchParams.set("url", raw);
                    url.searchParams.set("t", Date.now().toString());
                    const response = await fetch(url.toString());
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status);
                    }
                    const data = await response.json();
                    if (!data.success) {
                        showSearchError(data.error || t("searchNoResult"));
                        return;
                    }
                    if (elements.resultPath) {
                        elements.resultPath.textContent = data.page && data.page.path ? data.page.path : raw;
                    }
                    if (elements.resultPv) {
                        elements.resultPv.textContent = formatNumber(data.page && typeof data.page.pv === "number" ? data.page.pv : 0);
                    }
                    if (elements.resultUv) {
                        elements.resultUv.textContent = formatNumber(data.page && typeof data.page.uv === "number" ? data.page.uv : 0);
                    }
                    if (elements.searchResult) {
                        elements.searchResult.classList.add("show");
                    }
                } catch (error) {
                    console.warn("[dashboard] search error", error);
                    showSearchError(t("loadFailed"));
                }
            }

            async function loadLogo() {
                if (!elements.logo) {
                    return;
                }
                try {
                    const response = await fetch(API_BASE + "/logo.webp");
                    if (!response.ok) {
                        return;
                    }
                    const blob = await response.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    elements.logo.src = objectUrl;
                } catch (_error) {
                    // ignore logo load failures
                }
            }

            document.addEventListener("DOMContentLoaded", function () {
                setTheme(state.theme);
                setLang(state.lang);
                applyTranslations();
                updateThemeButton();
                updateLangButton();
                setupChart();
                wireEvents();
                loadLogo();
                loadSiteStats();
                checkHealth();
                loadDaily(state.currentDays);
                loadTopPages();
            });
        })();
    </script>
</body>
</html>`;
