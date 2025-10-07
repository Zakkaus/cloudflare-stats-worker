#!/bin/bash

# Cloudflare Stats Worker v1.3.0 - 功能測試腳本

BASE_URL="https://stats.zakk.au"
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 Cloudflare Stats Worker v1.3.0 測試開始${NC}\n"

# 測試 1: 健康檢查
echo -e "${BLUE}[1/6] 測試健康檢查端點...${NC}"
HEALTH=$(curl -s "${BASE_URL}/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✅ 健康檢查通過${NC}"
    echo "$HEALTH" | jq '.'
else
    echo -e "${RED}❌ 健康檢查失敗${NC}"
fi
echo ""

# 測試 2: 儀表板 HTML
echo -e "${BLUE}[2/6] 測試儀表板 HTML...${NC}"
DASHBOARD=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/")
if [ "$DASHBOARD" -eq 200 ]; then
    echo -e "${GREEN}✅ 儀表板可訪問 (HTTP 200)${NC}"
    # 檢查內容
    CONTENT=$(curl -s "${BASE_URL}/")
    if echo "$CONTENT" | grep -q "統計數據儀表板"; then
        echo -e "${GREEN}✅ 儀表板包含正確標題${NC}"
    fi
    if echo "$CONTENT" | grep -q "Chart.js"; then
        echo -e "${GREEN}✅ 儀表板包含 Chart.js${NC}"
    fi
    if echo "$CONTENT" | grep -q "data-theme"; then
        echo -e "${GREEN}✅ 儀表板支持主題切換${NC}"
    fi
else
    echo -e "${RED}❌ 儀表板無法訪問 (HTTP $DASHBOARD)${NC}"
fi
echo ""

# 測試 3: 查詢統計 API
echo -e "${BLUE}[3/6] 測試統計查詢 API...${NC}"
STATS=$(curl -s "${BASE_URL}/api/stats?url=/")
if echo "$STATS" | grep -q '"success":true'; then
    echo -e "${GREEN}✅ 統計查詢成功${NC}"
    echo "$STATS" | jq '.'
else
    echo -e "${RED}❌ 統計查詢失敗${NC}"
fi
echo ""

# 測試 4: 增加計數 API
echo -e "${BLUE}[4/6] 測試增加計數 API...${NC}"
COUNT=$(curl -s "${BASE_URL}/api/count?url=/test-page/")
if echo "$COUNT" | grep -q '"success":true'; then
    echo -e "${GREEN}✅ 計數增加成功${NC}"
    echo "$COUNT" | jq '.'
else
    echo -e "${RED}❌ 計數增加失敗${NC}"
fi
echo ""

# 測試 5: 批量查詢 API
echo -e "${BLUE}[5/6] 測試批量查詢 API...${NC}"
BATCH=$(curl -s "${BASE_URL}/api/batch?urls=/,/about/,/posts/")
if echo "$BATCH" | grep -q '"success":true'; then
    echo -e "${GREEN}✅ 批量查詢成功${NC}"
    echo "$BATCH" | jq '.'
else
    echo -e "${RED}❌ 批量查詢失敗${NC}"
fi
echo ""

# 測試 6: 熱門頁面 API（可能未配置 D1）
echo -e "${BLUE}[6/6] 測試熱門頁面 API (D1)...${NC}"
TOP=$(curl -s "${BASE_URL}/api/top?limit=5")
if echo "$TOP" | grep -q '"success":true'; then
    echo -e "${GREEN}✅ 熱門頁面查詢成功${NC}"
    echo "$TOP" | jq '.'
elif echo "$TOP" | grep -q '"success":false'; then
    echo -e "${BLUE}ℹ️  熱門頁面 API 未啟用（需要配置 D1）${NC}"
    echo "$TOP" | jq '.'
else
    echo -e "${RED}❌ 熱門頁面查詢失敗${NC}"
fi
echo ""

# 總結
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}📊 測試完成！${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""
echo "儀表板地址: ${BASE_URL}/"
echo "API 文檔: https://github.com/Zakkaus/cloudflare-stats-worker"
echo ""
echo -e "${GREEN}提示: 在瀏覽器中打開儀表板以查看完整功能：${NC}"
echo "  • 每日趨勢圖表（7/14/30 天）"
echo "  • 深淺色模式切換"
echo "  • 頁面搜尋"
echo "  • 熱門頁面排行"
