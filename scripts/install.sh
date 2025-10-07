#!/usr/bin/env bash#!/bin/bash

set -Eeuo pipefail

# Cloudflare Stats Worker 一鍵安裝腳本

# Cloudflare Stats Worker · minimal guided installer# 支持完整的 KV + D1 配置和部署



BLUE="\033[1;34m"; GREEN="\033[1;32m"; YELLOW="\033[1;33m"; RED="\033[1;31m"; NC="\033[0m"set -e

info()   { printf "%b➤%b %s\n" "$BLUE" "$NC" "$1"; }

ok()     { printf "%b✓%b %s\n" "$GREEN" "$NC" "$1"; }# 顏色定義

warn()   { printf "%b!%b %s\n" "$YELLOW" "$NC" "$1"; }RED='\033[0;31m'

fail()   { printf "%b✗%b %s\n" "$RED" "$NC" "$1"; exit 1; }GREEN='\033[0;32m'

YELLOW='\033[1;33m'

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)BLUE='\033[0;34m'

cd "$PROJECT_ROOT"NC='\033[0m' # No Color



dep_check() {# 日誌函數

  if ! command -v "$1" >/dev/null 2>&1; thenlog_info() { echo -e "${BLUE}ℹ ${NC} $1"; }

    warn "$1 not found. Installing globally with npm..."log_success() { echo -e "${GREEN}✓${NC} $1"; }

    npm install -g "$1" >/dev/nulllog_warning() { echo -e "${YELLOW}⚠${NC} $1"; }

    ok "$1 installed"log_error() { echo -e "${RED}✗${NC} $1"; }

  fi

}# 橫幅

echo -e "${BLUE}"

info "Cloudflare Stats Worker installer"cat << "EOF"

dep_check wrangler╔═══════════════════════════════════════════════════════════╗

║                                                           ║

if ! wrangler whoami >/dev/null 2>&1; then║     Cloudflare Stats Worker 自動安裝腳本 v1.5.4          ║

  info "Logging in to Cloudflare via Wrangler..."║                                                           ║

  wrangler login >/dev/null║     GitHub: https://github.com/Zakkaus/cloudflare-stats-worker  ║

  ok "Login successful"║                                                           ║

else╚═══════════════════════════════════════════════════════════╝

  ACCOUNT_NAME=$(wrangler whoami 2>&1 | awk -F': ' '/Account Name/ {print $2}')EOF

  ok "Using Cloudflare account: ${ACCOUNT_NAME:-unknown}"echo -e "${NC}"

fi

# 步驟 1: 檢查 Wrangler CLI

read -rp "Worker name [cloudflare-stats-worker]: " WORKER_NAMElog_info "檢查 Wrangler CLI..."

WORKER_NAME=${WORKER_NAME:-cloudflare-stats-worker}if ! command -v wrangler &> /dev/null; then

    log_warning "Wrangler CLI 未安裝"

read -rp "Custom domain (optional, e.g. stats.example.com): " CUSTOM_DOMAIN    log_info "正在安裝 Wrangler..."

    npm install -g wrangler

read -rp "Create D1 database for /api/top? (Y/n): " USE_D1    log_success "Wrangler 安裝成功"

USE_D1=${USE_D1:-Y}else

USE_D1=$(echo "$USE_D1" | tr '[:upper:]' '[:lower:]')    WRANGLER_VERSION=$(wrangler --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

    log_success "Wrangler 已安裝 (版本 $WRANGLER_VERSION)"

COMPAT_DATE=$(grep '^compatibility_date' wrangler.toml 2>/dev/null | awk -F'"' '{print $2}')fi

COMPAT_DATE=${COMPAT_DATE:-$(date +%Y-%m-%d)}

# 步驟 2: 登錄 Cloudflare

# --- KV namespace -----------------------------------------------------------------log_info "檢查 Cloudflare 登錄狀態..."

KV_TITLE="${WORKER_NAME//[^A-Za-z0-9_-]/}_PAGE_STATS"if ! wrangler whoami &> /dev/null; then

info "Creating KV namespace (${KV_TITLE})..."    log_warning "未登錄 Cloudflare"

KV_OUTPUT=$(wrangler kv namespace create "$KV_TITLE" 2>&1 || true)    log_info "請在瀏覽器中完成登錄..."

if echo "$KV_OUTPUT" | grep -qi "already exists"; then    wrangler login

  warn "Namespace already exists. Reusing existing ID."    log_success "Cloudflare 登錄成功"

  KV_ID=$(wrangler kv namespace list 2>/dev/null | awk -v title="$KV_TITLE" '$0 ~ title {print $2}' | head -1)else

  if [[ -z "$KV_ID" ]]; then    ACCOUNT=$(wrangler whoami 2>&1 | grep "Account Name:" | cut -d':' -f2 | xargs)

    read -rp "Enter existing KV namespace id: " KV_ID    log_success "已登錄 Cloudflare (帳戶: $ACCOUNT)"

  fifi

else

  KV_ID=$(echo "$KV_OUTPUT" | awk -F'"' '/id =/ {print $2}' | head -1)# 步驟 3: 創建 KV 命名空間

filog_info "創建 KV 命名空間..."



KV_PREVIEW_OUTPUT=$(wrangler kv namespace create "$KV_TITLE" --preview 2>&1 || true)# 檢查是否已經有 KV 配置

if echo "$KV_PREVIEW_OUTPUT" | grep -qi "already exists"; thenif grep -q "kv_namespaces" wrangler.toml && grep -q "PAGE_STATS" wrangler.toml; then

  warn "Preview namespace already exists. Reusing existing ID."    log_warning "wrangler.toml 中已存在 KV 配置"

  KV_PREVIEW_ID=$KV_ID    read -p "是否覆蓋現有配置？(y/N): " OVERWRITE_KV

else    if [[ "$OVERWRITE_KV" != "y" && "$OVERWRITE_KV" != "Y" ]]; then

  KV_PREVIEW_ID=$(echo "$KV_PREVIEW_OUTPUT" | awk -F'"' '/preview_id =/ {print $2}' | head -1)        log_info "跳過 KV 創建"

fi        KV_SKIP=true

    fi

[[ -n "$KV_ID" ]] || fail "KV namespace id missing"fi

[[ -n "$KV_PREVIEW_ID" ]] || fail "KV preview id missing"

if [[ "$KV_SKIP" != true ]]; then

ok "KV bound: $KV_ID"    # 創建生產 KV

    KV_OUTPUT=$(wrangler kv namespace create PAGE_STATS 2>&1)

# --- D1 database -------------------------------------------------------------------    KV_ID=$(echo "$KV_OUTPUT" | grep -oE 'id = "[a-f0-9]+"' | cut -d'"' -f2)

D1_BLOCK=""    

if [[ "$USE_D1" == "y" || "$USE_D1" == "yes" ]]; then    # 創建預覽 KV

  D1_NAME="${WORKER_NAME//[^A-Za-z0-9_-]/}-stats"    KV_PREVIEW_OUTPUT=$(wrangler kv namespace create PAGE_STATS --preview 2>&1)

  info "Creating D1 database (${D1_NAME})..."    KV_PREVIEW_ID=$(echo "$KV_PREVIEW_OUTPUT" | grep -oE 'preview_id = "[a-f0-9]+"' | cut -d'"' -f2)

  D1_OUTPUT=$(wrangler d1 create "$D1_NAME" 2>&1 || true)    

  if echo "$D1_OUTPUT" | grep -qi "already exists"; then    log_success "KV 命名空間創建成功"

    warn "D1 database already exists. Reusing existing ID."    log_info "  - 生產環境 ID: $KV_ID"

    D1_ID=$(wrangler d1 list 2>/dev/null | awk -v name="$D1_NAME" '$0 ~ name {print $1}' | head -1)    log_info "  - 預覽環境 ID: $KV_PREVIEW_ID"

    if [[ -z "$D1_ID" ]]; then    

      read -rp "Enter existing D1 database id: " D1_ID    # 更新 wrangler.toml

    fi    log_info "更新 wrangler.toml 配置..."

  else    

    D1_ID=$(echo "$D1_OUTPUT" | awk -F'"' '/database_id =/ {print $2}' | head -1)    # 備份原配置

  fi    cp wrangler.toml wrangler.toml.backup

  [[ -n "$D1_ID" ]] || fail "D1 database id missing"    

  ok "D1 bound: $D1_ID"    # 移除舊的 KV 配置

    sed -i.bak '/\[\[kv_namespaces\]\]/,/preview_id.*PAGE_STATS/d' wrangler.toml

  if [[ -f schema.sql ]]; then    

    info "Applying schema.sql to ${D1_NAME}..."    # 添加新的 KV 配置

    wrangler d1 execute "$D1_NAME" --remote --file=schema.sql >/dev/null    cat >> wrangler.toml << EOF

    ok "Schema applied"

  else[[kv_namespaces]]

    warn "schema.sql not found; skipping table creation"binding = "PAGE_STATS"

  fiid = "$KV_ID"

preview_id = "$KV_PREVIEW_ID"

  D1_BLOCK=$'\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "'$D1_NAME$'"\ndatabase_id = "'$D1_ID$'"\n'EOF

fi    

    log_success "KV 配置已更新"

# --- Rewrite wrangler.toml ---------------------------------------------------------fi

info "Writing wrangler.toml..."

cat > wrangler.toml <<EOF# 步驟 4: 創建 D1 數據庫

name = "$WORKER_NAME"log_info "創建 D1 數據庫..."

main = "src/index.js"

compatibility_date = "$COMPAT_DATE"# 檢查是否已經有 D1 配置

if grep -q "d1_databases" wrangler.toml && grep -q "cloudflare-stats-top" wrangler.toml; then

[[kv_namespaces]]    log_warning "wrangler.toml 中已存在 D1 配置"

binding = "PAGE_STATS"    read -p "是否重新創建 D1 數據庫？(y/N): " RECREATE_D1

id = "$KV_ID"    if [[ "$RECREATE_D1" != "y" && "$RECREATE_D1" != "Y" ]]; then

preview_id = "$KV_PREVIEW_ID"        log_info "跳過 D1 創建"

$D1_BLOCK        D1_SKIP=true

EOF    fi

ok "wrangler.toml updated"fi



# --- Deploy ------------------------------------------------------------------------if [[ "$D1_SKIP" != true ]]; then

info "Deploying Worker..."    # 嘗試創建 D1 數據庫

wrangler deploy >/tmp/stats-worker-deploy.log && ok "Deployment successful" || fail "Deployment failed"    D1_OUTPUT=$(wrangler d1 create cloudflare-stats-top 2>&1 || true)

    

WORKER_SUBDOMAIN=$(wrangler whoami 2>&1 | awk -F': ' '/Account ID/ {print $2}' | tr -d '-' | cut -c1-8)    if echo "$D1_OUTPUT" | grep -q "already exists"; then

WORKERS_URL="https://${WORKER_NAME}.${WORKER_SUBDOMAIN}.workers.dev"        log_warning "D1 數據庫已存在，使用現有數據庫"

        # 獲取現有數據庫 ID

if [[ -n "$CUSTOM_DOMAIN" ]]; then        D1_ID=$(wrangler d1 list | grep cloudflare-stats-top | awk '{print $1}')

  info "Binding custom domain ${CUSTOM_DOMAIN}..."    else

  wrangler custom-domains add "$CUSTOM_DOMAIN" >/dev/null && ok "Custom domain added" || warn "Unable to bind custom domain automatically"        D1_ID=$(echo "$D1_OUTPUT" | grep -oE 'database_id = "[a-f0-9-]+"' | cut -d'"' -f2)

fi        log_success "D1 數據庫創建成功"

    fi

cat <<SUMMARY    

    log_info "  - 數據庫 ID: $D1_ID"

${GREEN}Done!${NC}    

Primary URL : ${WORKERS_URL}    # 更新 wrangler.toml

Dashboard   : ${WORKERS_URL}/    log_info "更新 D1 配置..."

Health      : ${WORKERS_URL}/health    

API sample  : ${WORKERS_URL}/api/stats?url=/    # 移除舊的 D1 配置註釋

SUMMARY    sed -i.bak '/# \[\[d1_databases\]\]/,/# database_id.*cloudflare-stats-top/d' wrangler.toml

    sed -i.bak '/\[\[d1_databases\]\]/,/database_id.*cloudflare-stats-top/d' wrangler.toml

if [[ -n "$CUSTOM_DOMAIN" ]]; then    

  echo "Custom domain : https://${CUSTOM_DOMAIN}"; fi    # 添加新的 D1 配置

    cat >> wrangler.toml << EOF

echo "Next steps:"

echo "  1. Update assets/js/cloudflare-stats.js -> API_BASE to match your domain."[[d1_databases]]

echo "  2. Visit the dashboard and confirm PV/UV counters." binding = "DB"

if [[ -n "$CUSTOM_DOMAIN" ]]; thendatabase_name = "cloudflare-stats-top"

  echo "  3. Ensure DNS & SSL for ${CUSTOM_DOMAIN} are active in Cloudflare."; fidatabase_id = "$D1_ID"

EOF
    
    log_success "D1 配置已更新"
    
    # 初始化 D1 數據表
    log_info "初始化 D1 數據表..."
    if [ -f "schema.sql" ]; then
        wrangler d1 execute cloudflare-stats-top --file=schema.sql --remote
        log_success "D1 數據表初始化成功"
    else
        log_warning "未找到 schema.sql，跳過數據表初始化"
        log_info "請手動執行: wrangler d1 execute cloudflare-stats-top --file=schema.sql --remote"
    fi
fi

# 步驟 5: 部署 Worker
log_info "部署 Cloudflare Worker..."
wrangler deploy

log_success "Worker 部署成功！"

# 步驟 6: 獲取部署信息
log_info "獲取部署信息..."

WORKER_NAME=$(grep '^name' wrangler.toml | cut -d'"' -f2 | cut -d"'" -f2)
WORKER_URL=$(wrangler deployments list 2>&1 | grep -oE 'https://[a-z0-9\-]+\.workers\.dev' | head -1)

if [ -z "$WORKER_URL" ]; then
    # 如果沒有獲取到，使用預設格式
    ACCOUNT_SUBDOMAIN=$(wrangler whoami 2>&1 | grep "Account ID:" | cut -d':' -f2 | xargs | cut -c1-8)
    WORKER_URL="https://${WORKER_NAME}.${ACCOUNT_SUBDOMAIN}.workers.dev"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                           ║${NC}"
echo -e "${GREEN}║                🎉 部署成功！                              ║${NC}"
echo -e "${GREEN}║                                                           ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
log_success "Worker 名稱: $WORKER_NAME"
log_success "Worker URL: $WORKER_URL"
echo ""
log_info "可用端點："
echo -e "  ${BLUE}•${NC} 儀表板:     ${WORKER_URL}/"
echo -e "  ${BLUE}•${NC} 健康檢查:   ${WORKER_URL}/health"
echo -e "  ${BLUE}•${NC} 統計查詢:   ${WORKER_URL}/api/stats?url=/"
echo -e "  ${BLUE}•${NC} 計數增加:   ${WORKER_URL}/api/count?url=/&action=pv"
echo -e "  ${BLUE}•${NC} 批量查詢:   ${WORKER_URL}/api/batch"
echo -e "  ${BLUE}•${NC} 熱門頁面:   ${WORKER_URL}/api/top?limit=10"
echo ""
log_info "下一步："
echo -e "  ${BLUE}1.${NC} 設置自定義域名（可選）"
echo -e "     ${YELLOW}wrangler custom-domains add stats.yourdomain.com${NC}"
echo ""
echo -e "  ${BLUE}2.${NC} 在博客中集成統計代碼"
echo -e "     詳見: ${BLUE}README.md → 🌐 博客集成${NC}"
echo ""
echo -e "  ${BLUE}3.${NC} 訪問儀表板查看統計數據"
echo -e "     ${BLUE}$WORKER_URL${NC}"
echo ""
log_success "安裝完成！"
