// 儀表板 HTML 內容（雙語版本）
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-TW" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>統計數據 - Cloudflare Stats</title>
    <meta name="description" content="查看網站訪問統計數據">
    <link rel="icon" type="image/svg+xml" href="/logo.webp">
    <link rel="apple-touch-icon" href="/logo.webp">
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root[data-theme="light"] {
            --primary: #2563eb; --primary-light: #3b82f6; --primary-dark: #1d4ed8;
            --bg: #f8fafc; --card-bg: #ffffff; --text: #1e293b; --text-muted: #64748b;
            --border: #e2e8f0; --success: #10b981; --error: #ef4444; --shadow: rgba(0, 0, 0, 0.1);
        }
        :root[data-theme="dark"] {
            --primary: #3b82f6; --primary-light: #60a5fa; --primary-dark: #2563eb;
            --bg: #0f172a; --card-bg: #1e293b; --text: #e2e8f0; --text-muted: #94a3b8;
            --border: #334155; --success: #10b981; --error: #ef4444; --shadow: rgba(0, 0, 0, 0.3);
        }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: var(--bg); color: var(--text); line-height: 1.6; padding: 20px; transition: background-color 0.3s, color 0.3s; }
        .container { max-width: 1400px; margin: 0 auto; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px;
            padding: 30px 0; border-bottom: 2px solid var(--border); flex-wrap: wrap; gap: 20px; }
        .header-left { flex: 1; display: flex; align-items: center; gap: 20px; }
        .logo-container { width: 60px; height: 60px; }
        .logo { width: 100%; height: 100%; object-fit: contain; }
        .header-text { flex: 1; }
        h1 { font-size: 2.5rem; margin-bottom: 10px;
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .subtitle { color: var(--text-muted); font-size: 1.1rem; }
        .header-controls { display: flex; gap: 10px; align-items: center; }
        .lang-toggle, .theme-toggle { padding: 10px 16px; background: var(--card-bg); border: 1px solid var(--border);
            border-radius: 8px; color: var(--text); cursor: pointer; transition: all 0.2s;
            font-size: 0.95rem; display: flex; align-items: center; gap: 6px; }
        .lang-toggle:hover, .theme-toggle:hover { background: var(--primary); color: white; border-color: var(--primary); }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 40px; }
        .stat-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px;
            padding: 24px; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 1px 3px var(--shadow); }
        .stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 20px var(--shadow); }
        .stat-label { color: var(--text-muted); font-size: 0.9rem; text-transform: uppercase;
            letter-spacing: 0.5px; margin-bottom: 8px; }
        .stat-value { font-size: 2.5rem; font-weight: bold; color: var(--primary); }
        .stat-change { font-size: 0.85rem; margin-top: 8px; color: var(--success); }
        .chart-section { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px;
            padding: 30px; margin-bottom: 30px; box-shadow: 0 1px 3px var(--shadow); }
        .chart-section h2 { margin-bottom: 20px; font-size: 1.5rem; color: var(--text); }
        .chart-controls { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
        .chart-controls button { padding: 8px 16px; background: var(--card-bg); border: 1px solid var(--border);
            border-radius: 6px; color: var(--text); cursor: pointer; transition: all 0.2s; }
        .chart-controls button:hover, .chart-controls button.active { background: var(--primary); color: white; border-color: var(--primary); }
        .chart-container { position: relative; height: 400px; }
        .search-section { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px;
            padding: 30px; margin-bottom: 30px; box-shadow: 0 1px 3px var(--shadow); }
        .search-section h2 { margin-bottom: 20px; font-size: 1.5rem; }
        .search-box { display: flex; gap: 10px; margin-bottom: 20px; }
        input[type="text"] { flex: 1; padding: 12px 16px; background: var(--bg); border: 1px solid var(--border);
            border-radius: 8px; color: var(--text); font-size: 1rem; transition: border-color 0.2s; }
        input[type="text"]:focus { outline: none; border-color: var(--primary); }
        button { padding: 12px 24px; background: var(--primary); color: white; border: none;
            border-radius: 8px; font-size: 1rem; font-weight: 500; cursor: pointer; transition: background 0.2s; }
        button:hover { background: var(--primary-dark); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .result { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 20px; display: none; }
        .result.show { display: block; }
        .result-header { display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
        .result-path { font-size: 1.2rem; font-weight: 600; color: var(--text); }
        .result-stats { display: flex; gap: 30px; }
        .result-stat { text-align: center; }
        .result-stat-label { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px; }
        .result-stat-value { font-size: 1.8rem; font-weight: bold; color: var(--primary); }
        .top-pages { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px;
            padding: 30px; box-shadow: 0 1px 3px var(--shadow); }
        .top-pages h2 { margin-bottom: 20px; font-size: 1.5rem; }
        .page-list { list-style: none; }
        .page-item { display: flex; justify-content: space-between; align-items: center; padding: 16px;
            margin-bottom: 10px; background: var(--bg); border: 1px solid var(--border);
            border-radius: 8px; transition: border-color 0.2s; }
        .page-item:hover { border-color: var(--primary); }
        .page-rank { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
            background: var(--primary); color: white; border-radius: 50%; font-weight: bold; font-size: 0.9rem; }
        .page-info { flex: 1; margin: 0 20px; }
        .page-path { font-weight: 500; margin-bottom: 4px; }
        .page-stats { font-size: 0.85rem; color: var(--text-muted); }
        .page-views { font-size: 1.2rem; font-weight: 600; color: var(--primary); }
        .error { background: var(--error); color: white; padding: 16px; border-radius: 8px; margin-top: 20px; }
        .loading { text-align: center; padding: 40px; color: var(--text-muted); }
        .spinner { width: 40px; height: 40px; border: 4px solid var(--border); border-top-color: var(--primary);
            border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        footer { margin-top: 60px; padding-top: 30px; border-top: 1px solid var(--border);
            text-align: center; color: var(--text-muted); font-size: 0.9rem; }
        footer a { color: var(--primary); text-decoration: none; }
        footer a:hover { text-decoration: underline; }
        @media (max-width: 768px) {
            h1 { font-size: 2rem; }
            header { flex-direction: column; text-align: center; }
            .header-left { flex-direction: column; }
            .stats-grid { grid-template-columns: 1fr; }
            .result-stats { flex-direction: column; gap: 16px; }
            .chart-container { height: 300px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="header-left">
                <div class="logo-container">
                    <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='45' fill='%233b82f6'/%3E%3Ctext x='50' y='65' font-size='50' text-anchor='middle' fill='white' font-family='Arial, sans-serif' font-weight='bold'%3EZ%3C/text%3E%3C/svg%3E" alt="Logo" class="logo" id="logo-img">
                </div>
                <div class="header-text">
                    <h1><span data-i18n="title">統計數據儀表板</span></h1>
                    <p class="subtitle" data-i18n="subtitle">實時查看網站訪問統計</p>
                </div>
            </div>
            <div class="header-controls">
                <button class="lang-toggle" id="lang-toggle">
                    <span id="lang-icon">🌐</span>
                    <span id="lang-text">EN</span>
                </button>
                <button class="theme-toggle" id="theme-toggle">
                    <span id="theme-icon">🌙</span>
                    <span id="theme-text" data-i18n="darkMode">深色模式</span>
                </button>
            </div>
        </header>
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-label" data-i18n="totalPageViews">全站總瀏覽量</div><div class="stat-value" id="site-pv">-</div><div class="stat-change">載入中...</div></div>
            <div class="stat-card"><div class="stat-label" data-i18n="totalUniqueVisitors">全站訪客數</div><div class="stat-value" id="site-uv">-</div><div class="stat-change">載入中...</div></div>
            <div class="stat-card"><div class="stat-label" data-i18n="todayPageViews">今日瀏覽量</div><div class="stat-value" id="today-pv">-</div><div class="stat-change">載入中...</div></div>
            <div class="stat-card"><div class="stat-label" data-i18n="apiStatus">API 狀態</div><div class="stat-value" id="api-status">-</div><div class="stat-change" id="api-version">-</div></div>
        </div>
        <div class="chart-section">
            <h2><span data-i18n="dailyTrend">📈 每日訪問趨勢</span></h2>
            <div class="chart-controls">
                <button class="active" data-days="7" data-i18n="last7Days">過去 7 天</button>
                <button data-days="14" data-i18n="last14Days">過去 14 天</button>
                <button data-days="30" data-i18n="last30Days">過去 30 天</button>
            </div>
            <div class="chart-container"><canvas id="dailyChart"></canvas></div>
            <div id="daily-error" class="error" style="display:none"></div>
        </div>
        <div class="search-section">
            <h2><span data-i18n="searchPage">🔍 查詢頁面統計</span></h2>
            <div class="search-box">
                <input type="text" id="path-input" data-i18n-placeholder="searchPlaceholder" placeholder="輸入路徑，例如: /posts/hello-world/" value="/">
                <button id="search-btn" data-i18n="search">查詢</button>
            </div>
            <div id="search-result" class="result">
                <div class="result-header"><div class="result-path" id="result-path"></div></div>
                <div class="result-stats">
                    <div class="result-stat"><div class="result-stat-label" data-i18n="pageViews">頁面瀏覽量</div><div class="result-stat-value" id="result-pv">-</div></div>
                    <div class="result-stat"><div class="result-stat-label" data-i18n="uniqueVisitors">獨立訪客</div><div class="result-stat-value" id="result-uv">-</div></div>
                </div>
            </div>
            <div id="search-error"></div>
        </div>
        <div class="top-pages">
            <h2><span data-i18n="topPages">🔥 熱門頁面 Top 10</span></h2>
            <div id="top-loading" class="loading"><div class="spinner"></div><div data-i18n="loading">載入中...</div></div>
            <ul id="top-list" class="page-list"></ul>
            <div id="top-error"></div>
        </div>
        <footer>
            <p><span data-i18n="poweredBy">Powered by</span> <a href="https://github.com/Zakkaus/cloudflare-stats-worker" target="_blank">Cloudflare Stats Worker</a> • <a href="https://zakk.au" target="_blank">zakk.au</a></p>
        </footer>
    </div>
    <script>
        const API_BASE = window.location.origin;
        let dailyChart = null, currentDays = 7, currentLang = 'zh-TW';
        const i18n = {
            'zh-TW': {
                title: '統計數據儀表板', subtitle: '實時查看網站訪問統計', darkMode: '深色模式', lightMode: '淺色模式',
                totalPageViews: '全站總瀏覽量', totalUniqueVisitors: '全站訪客數', todayPageViews: '今日瀏覽量', apiStatus: 'API 狀態',
                dailyTrend: '📈 每日訪問趨勢', last7Days: '過去 7 天', last14Days: '過去 14 天', last30Days: '過去 30 天',
                searchPage: '🔍 查詢頁面統計', searchPlaceholder: '輸入路徑，例如: /posts/hello-world/', search: '查詢',
                pageViews: '頁面瀏覽量', uniqueVisitors: '獨立訪客', topPages: '🔥 熱門頁面 Top 10',
                loading: '載入中...', total: '總計', today: '今日', normal: '✅ 正常', error: '❌ 錯誤', version: '版本',
                cannotConnect: '無法連接', loadFailed: '載入失敗', poweredBy: 'Powered by',
                pvLabel: '瀏覽量 (PV)', uvLabel: '訪客數 (UV)', views: '次瀏覽', visitors: '位訪客',
                noData: '暫無熱門頁面數據', loadError: '載入失敗', noDailyData: '暫無趨勢數據，已顯示 0'
            },
            'en': {
                title: 'Statistics Dashboard', subtitle: 'Real-time website analytics', darkMode: 'Dark Mode', lightMode: 'Light Mode',
                totalPageViews: 'Total Page Views', totalUniqueVisitors: 'Total Unique Visitors', todayPageViews: 'Today\\'s Views', apiStatus: 'API Status',
                dailyTrend: '📈 Daily Traffic Trend', last7Days: 'Last 7 Days', last14Days: 'Last 14 Days', last30Days: 'Last 30 Days',
                searchPage: '🔍 Search Page Stats', searchPlaceholder: 'Enter path, e.g.: /posts/hello-world/', search: 'Search',
                pageViews: 'Page Views', uniqueVisitors: 'Unique Visitors', topPages: '🔥 Top 10 Pages',
                loading: 'Loading...', total: 'Total', today: 'Today', normal: '✅ Normal', error: '❌ Error', version: 'Version',
                cannotConnect: 'Cannot Connect', loadFailed: 'Load Failed', poweredBy: 'Powered by',
                pvLabel: 'Page Views (PV)', uvLabel: 'Unique Visitors (UV)', views: ' views', visitors: ' visitors',
                noData: 'No popular pages yet', loadError: 'Load failed', noDailyData: 'No trend data yet. Showing zeros.'
            }
        };
        function updateI18n() {
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                if (i18n[currentLang] && i18n[currentLang][key]) el.textContent = i18n[currentLang][key];
            });
            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.getAttribute('data-i18n-placeholder');
                if (i18n[currentLang] && i18n[currentLang][key]) el.placeholder = i18n[currentLang][key];
            });
            document.documentElement.lang = currentLang;
            if (dailyChart) { dailyChart.data.datasets[0].label = i18n[currentLang].pvLabel; dailyChart.data.datasets[1].label = i18n[currentLang].uvLabel; dailyChart.update(); }
        }
        const themeToggle = document.getElementById('theme-toggle'), themeIcon = document.getElementById('theme-icon'),
              themeText = document.getElementById('theme-text'), langToggle = document.getElementById('lang-toggle'),
              langText = document.getElementById('lang-text'), html = document.documentElement;
        const savedTheme = localStorage.getItem('theme') || 'dark', savedLang = localStorage.getItem('lang') || 'zh-TW';
        html.setAttribute('data-theme', savedTheme); currentLang = savedLang;
        updateThemeButton(savedTheme); langText.textContent = currentLang === 'zh-TW' ? 'EN' : '中文'; updateI18n();
        themeToggle.addEventListener('click', () => {
            const currentTheme = html.getAttribute('data-theme'), newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', newTheme); localStorage.setItem('theme', newTheme);
            updateThemeButton(newTheme); if (dailyChart) updateChartTheme();
        });
        langToggle.addEventListener('click', () => {
            currentLang = currentLang === 'zh-TW' ? 'en' : 'zh-TW';
            localStorage.setItem('lang', currentLang); langText.textContent = currentLang === 'zh-TW' ? 'EN' : '中文'; updateI18n();
        });
        function updateThemeButton(theme) {
            if (theme === 'dark') { themeIcon.textContent = '🌙'; themeText.textContent = i18n[currentLang].darkMode; }
            else { themeIcon.textContent = '☀️'; themeText.textContent = i18n[currentLang].lightMode; }
        }
        async function loadSiteStats() {
            try {
                const res = await fetch(\`\${API_BASE}/api/stats?url=/\`), data = await res.json();
                if (data.success) {
                    document.getElementById('site-pv').textContent = formatNumber(data.page?.pv || 0);
                    document.getElementById('site-uv').textContent = formatNumber(data.page?.uv || 0);
                    document.querySelector('#site-pv').nextElementSibling.textContent = i18n[currentLang].total;
                    document.querySelector('#site-uv').nextElementSibling.textContent = i18n[currentLang].total;
                }
            } catch (err) {
                document.querySelector('#site-pv').nextElementSibling.textContent = i18n[currentLang].loadFailed;
                document.querySelector('#site-uv').nextElementSibling.textContent = i18n[currentLang].loadFailed;
            }
        }
        async function checkHealth() {
            try {
                const res = await fetch(\`\${API_BASE}/health\`), data = await res.json();
                if (data.status === 'ok') {
                    document.getElementById('api-status').textContent = i18n[currentLang].normal;
                    document.getElementById('api-version').textContent = \`\${i18n[currentLang].version} \${data.version}\`;
                }
            } catch (err) {
                document.getElementById('api-status').textContent = i18n[currentLang].error;
                document.getElementById('api-version').textContent = i18n[currentLang].cannotConnect;
            }
        }
        function initChart() {
            const ctx = document.getElementById('dailyChart').getContext('2d');
            const theme = html.getAttribute('data-theme'), isDark = theme === 'dark';
            const textColor = isDark ? '#e2e8f0' : '#1e293b', gridColor = isDark ? '#334155' : '#e2e8f0';
            if (dailyChart) dailyChart.destroy();
            dailyChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        { label: i18n[currentLang].pvLabel, data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderWidth: 2, fill: true, tension: 0.4 },
                        { label: i18n[currentLang].uvLabel, data: [], borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 2, fill: true, tension: 0.4 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: textColor, font: { size: 12 } } }, tooltip: { mode: 'index', intersect: false } },
                    scales: {
                        y: { beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } },
                        x: { ticks: { color: textColor }, grid: { color: gridColor } }
                    }
                }
            });
        }
        function updateChartTheme() {
            if (!dailyChart) return;
            const theme = html.getAttribute('data-theme'), isDark = theme === 'dark';
            const textColor = isDark ? '#e2e8f0' : '#1e293b', gridColor = isDark ? '#334155' : '#e2e8f0';
            dailyChart.options.plugins.legend.labels.color = textColor;
            dailyChart.options.scales.y.ticks.color = textColor; dailyChart.options.scales.y.grid.color = gridColor;
            dailyChart.options.scales.x.ticks.color = textColor; dailyChart.options.scales.x.grid.color = gridColor;
            dailyChart.update();
        }
        async function loadDailyChart(days = 7) {
            const todayValueEl = document.getElementById('today-pv');
            const todayLabelEl = todayValueEl ? todayValueEl.nextElementSibling : null;
            const errorEl = document.getElementById('daily-error');
            if (todayLabelEl) todayLabelEl.textContent = i18n[currentLang].loading;
            if (errorEl) errorEl.style.display = 'none';

            try {
                const res = await fetch(\`\${API_BASE}/api/daily?days=\${days}&t=\${Date.now()}\`);
                if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
                const data = await res.json();
                const hasResults = Array.isArray(data.results) && data.results.length > 0;
                const series = hasResults
                    ? data.results
                    : Array.from({ length: days }, (_, idx) => {
                        const date = new Date();
                        date.setDate(date.getDate() - (days - 1 - idx));
                        return { date: date.toISOString().split('T')[0], pv: 0, uv: 0 };
                    });

                updateDailyChart(series);

                const todayData = series[series.length - 1] || { pv: 0 };
                if (todayValueEl) todayValueEl.textContent = formatNumber(todayData.pv || 0);
                if (todayLabelEl) todayLabelEl.textContent = i18n[currentLang].today;
                if (!hasResults && errorEl) {
                    errorEl.style.display = 'block';
                    errorEl.textContent = i18n[currentLang].noDailyData;
                }
            } catch (err) {
                console.warn('[dashboard] daily fetch error', err);
                const fallbackSeries = Array.from({ length: days }, (_, idx) => {
                    const date = new Date();
                    date.setDate(date.getDate() - (days - 1 - idx));
                    return { date: date.toISOString().split('T')[0], pv: 0, uv: 0 };
                });
                updateDailyChart(fallbackSeries);
                if (todayValueEl) todayValueEl.textContent = '0';
                if (todayLabelEl) todayLabelEl.textContent = i18n[currentLang].today;
                if (errorEl) {
                    errorEl.style.display = 'block';
                    errorEl.textContent = i18n[currentLang].loadFailed;
                }
            }
        }
        function updateDailyChart(series) {
            if (!dailyChart) return;
            const labels = series.map((item) => {
                const date = new Date(item.date);
                if (Number.isNaN(date.getTime())) return item.date;
                return \`\${date.getMonth() + 1}/\${date.getDate()}\`;
            });
            dailyChart.data.labels = labels;
            dailyChart.data.datasets[0].data = series.map((item) => item.pv || 0);
            dailyChart.data.datasets[1].data = series.map((item) => item.uv || 0);
            dailyChart.update();
        }
        document.querySelectorAll('.chart-controls button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.chart-controls button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active'); const days = parseInt(btn.getAttribute('data-days'));
                currentDays = days; loadDailyChart(days);
            });
        });
        async function searchPage() {
            const path = document.getElementById('path-input').value.trim();
            const resultDiv = document.getElementById('search-result'), errorDiv = document.getElementById('search-error');
            errorDiv.innerHTML = ''; resultDiv.classList.remove('show');
            if (!path) { errorDiv.innerHTML = \`<div class="error">\${i18n[currentLang].searchPlaceholder}</div>\`; return; }
            try {
                const res = await fetch(\`\${API_BASE}/api/stats?url=\${encodeURIComponent(path)}\`), data = await res.json();
                if (data.success) {
                    document.getElementById('result-path').textContent = data.page?.path || path;
                    document.getElementById('result-pv').textContent = formatNumber(data.page?.pv || 0);
                    document.getElementById('result-uv').textContent = formatNumber(data.page?.uv || 0);
                    resultDiv.classList.add('show');
                } else { errorDiv.innerHTML = \`<div class="error">\${data.error || i18n[currentLang].loadFailed}</div>\`; }
            } catch (err) { errorDiv.innerHTML = \`<div class="error">\${i18n[currentLang].loadFailed}</div>\`; }
        }
        async function loadTopPages() {
            const loadingDiv = document.getElementById('top-loading'), listEl = document.getElementById('top-list'), errorDiv = document.getElementById('top-error');
            try {
                const topUrl = new URL('/api/top', API_BASE);
                topUrl.searchParams.set('limit', '10');
                topUrl.searchParams.set('t', Date.now().toString());
                const res = await fetch(topUrl.toString()), data = await res.json();
                loadingDiv.style.display = 'none';
                if (data.success && data.results && data.results.length > 0) {
                    listEl.innerHTML = data.results.map((page, index) => \`
                        <li class="page-item">
                            <div class="page-rank">\${index + 1}</div>
                            <div class="page-info">
                                <div class="page-path">\${page.path}</div>
                                <div class="page-stats">\${formatNumber(page.pv)}\${i18n[currentLang].views} · \${formatNumber(page.uv)}\${i18n[currentLang].visitors}</div>
                            </div>
                            <div class="page-views">\${formatNumber(page.pv)}</div>
                        </li>
                    \`).join('');
                } else { loadingDiv.style.display = 'none'; errorDiv.innerHTML = \`<div class="error">\${i18n[currentLang].noData}</div>\`; }
            } catch (err) { loadingDiv.style.display = 'none'; errorDiv.innerHTML = \`<div class="error">\${i18n[currentLang].loadError}</div>\`; }
        }
        function formatNumber(num) { return new Intl.NumberFormat(currentLang).format(num); }
        // 嘗試載入真實 logo
        fetch(\`\${API_BASE}/logo.webp\`).then(res => { if (res.ok) return res.blob(); }).then(blob => {
            if (blob) document.getElementById('logo-img').src = URL.createObjectURL(blob);
        }).catch(() => {});
        document.addEventListener('DOMContentLoaded', () => {
            loadSiteStats(); checkHealth(); loadTopPages(); initChart(); loadDailyChart(currentDays);
            document.getElementById('search-btn').addEventListener('click', searchPage);
            document.getElementById('path-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') searchPage(); });
        });
    </script>
</body>
</html>`;
