#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${1:-}
if [[ -z "$BASE_URL" ]]; then
  echo "Usage: $0 <base-worker-url>" >&2
  echo "Example: $0 https://stats.zakk.au" >&2
  exit 1
fi

fail() { echo "[FAIL] $*" >&2; exit 1; }
info() { echo "[INFO] $*"; }
ok() { echo "[ OK ] $*"; }

TMP_PATH="/verify-test-$$/"
COUNT_URL="$BASE_URL/api/count?url=$TMP_PATH"
STATS_URL="$BASE_URL/api/stats?url=$TMP_PATH"
SITE_URL="$BASE_URL/api/stats"
TOP_URL="$BASE_URL/api/top?limit=3"
HEALTH_URL="$BASE_URL/health"

jq_check() {
  if ! command -v jq >/dev/null 2>&1; then
    fail "jq is required (brew install jq)"
  fi
}

http_get() {
  local url=$1
  curl -sS --max-time 10 "$url" || return 1
}

jq_check

info "1. Health check"
HEALTH_JSON=$(http_get "$HEALTH_URL") || fail "health endpoint unreachable"
echo "$HEALTH_JSON" | jq -e '.status=="ok"' >/dev/null || fail "health status not ok"
ok "health passed"

info "2. Increment test path via /api/count"
COUNT_JSON=$(http_get "$COUNT_URL") || fail "count request failed"
PAGE_PV=$(echo "$COUNT_JSON" | jq -r '.page.pv')
PAGE_UV=$(echo "$COUNT_JSON" | jq -r '.page.uv')
[[ "$PAGE_PV" =~ ^[0-9]+$ ]] || fail "invalid pv"
[[ "$PAGE_UV" =~ ^[0-9]+$ ]] || fail "invalid uv"
ok "count increment returned pv=$PAGE_PV uv=$PAGE_UV"

info "3. Read back single page stats (no increment)"
STATS_JSON=$(http_get "$STATS_URL") || fail "stats request failed"
PV2=$(echo "$STATS_JSON" | jq -r '.page.pv')
[[ "$PV2" =~ ^[0-9]+$ ]] || fail "invalid pv from stats"
ok "stats read pv=$PV2"

info "4. Site totals"
SITE_JSON=$(http_get "$SITE_URL") || fail "site stats failed"
echo "$SITE_JSON" | jq -e '.site.pv >= 0 and .site.uv >= 0' >/dev/null || fail "invalid site totals"
ok "site totals ok"

info "5. Top endpoint (may return error if D1 not bound)"
TOP_JSON=$(http_get "$TOP_URL" || true)
if echo "$TOP_JSON" | jq -e '.success == true' >/dev/null 2>&1; then
  ok "top endpoint success"
else
  echo "$TOP_JSON" | jq '.' >/dev/null 2>&1 && echo "[WARN] top endpoint not ready or empty" || echo "[WARN] top endpoint non-JSON response"
fi

info "All checks completed."
