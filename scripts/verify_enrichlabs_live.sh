#!/usr/bin/env bash
# Verify the EnrichLabs Data API is live and healthy on production.
#
# Usage:
#   ./scripts/verify_enrichlabs_live.sh
#   ./scripts/verify_enrichlabs_live.sh https://craftersmarket.org dzsxEmaHVDHTbAA8vju6RgRc77Rxw5ts
#
# Exits 0 on full pass, non-zero on any failure.

set -u

BASE="${1:-https://craftersmarket.org}"
KEY="${2:-${ENRICHLABS_API_KEY:-}}"

if [ -z "$KEY" ]; then
    # fall back to backend/.env
    KEY=$(grep '^ENRICHLABS_API_KEY=' "$(dirname "$0")/../backend/.env" 2>/dev/null | cut -d= -f2-)
fi

if [ -z "$KEY" ]; then
    echo "FAIL: no API key provided (set ENRICHLABS_API_KEY, pass as arg 2, or put it in backend/.env)"
    exit 2
fi

API="$BASE/api/enrich/v1"
PASS=0
FAIL=0

# colors when stdout is a tty
if [ -t 1 ]; then GREEN="\033[32m"; RED="\033[31m"; DIM="\033[2m"; RESET="\033[0m"
else GREEN=""; RED=""; DIM=""; RESET=""; fi

check() {
    local label="$1" expected_code="$2" url="$3"; shift 3
    local code body
    body=$(curl -s -o /tmp/enrich_body -w "%{http_code}" --max-time 20 "$@" "$url")
    code="$body"
    if [ "$code" = "$expected_code" ]; then
        printf "%b ✓ %-40s %s%b\n" "$GREEN" "$label" "(HTTP $code)" "$RESET"
        PASS=$((PASS + 1))
    else
        printf "%b ✗ %-40s expected HTTP %s, got %s%b\n" "$RED" "$label" "$expected_code" "$code" "$RESET"
        printf "%b   body: %s%b\n" "$DIM" "$(head -c 200 /tmp/enrich_body)" "$RESET"
        FAIL=$((FAIL + 1))
    fi
}

shape_check() {
    local label="$1" url="$2" required_keys="$3"; shift 3
    local code body
    code=$(curl -s -o /tmp/enrich_body -w "%{http_code}" --max-time 20 -H "X-EnrichLabs-Key: $KEY" "$@" "$url")
    if [ "$code" != "200" ]; then
        printf "%b ✗ %-40s HTTP %s (expected 200)%b\n" "$RED" "$label" "$code" "$RESET"
        FAIL=$((FAIL + 1))
        return
    fi
    local missing
    missing=$(python3 -c "
import json, sys
try: body = json.load(open('/tmp/enrich_body'))
except Exception as e: print('JSON parse:', e); sys.exit()
required = '$required_keys'.split(',')
missing = [k for k in required if k not in body]
print(','.join(missing))
")
    if [ -z "$missing" ]; then
        printf "%b ✓ %-40s (HTTP 200, keys ok)%b\n" "$GREEN" "$label" "$RESET"
        PASS=$((PASS + 1))
    else
        printf "%b ✗ %-40s missing keys: %s%b\n" "$RED" "$label" "$missing" "$RESET"
        FAIL=$((FAIL + 1))
    fi
}

echo ""
echo "════════════════════════════════════════════════════════════════"
echo " EnrichLabs API · Live verification"
echo " Target: $API"
echo " Key:    ${KEY:0:8}…${KEY: -4}  (${#KEY} chars)"
echo "════════════════════════════════════════════════════════════════"
echo ""

echo "── Auth gate ──"
check "/schema  WITHOUT key      → 401" 401  "$API/schema"
check "/schema  WITH wrong key   → 401" 401  "$API/schema" -H "X-EnrichLabs-Key: nope-not-the-key"
check "/orders  WITHOUT key      → 401" 401  "$API/orders"

echo ""
echo "── Endpoint shape (with valid key) ──"
shape_check "/schema    manifest"         "$API/schema"        "version,endpoints,auth"
shape_check "/orders?limit=5"             "$API/orders?limit=5"  "rows,count,next_cursor"
shape_check "/sellers?limit=5"            "$API/sellers?limit=5" "rows,count"
shape_check "/listings?limit=5"           "$API/listings?limit=5" "rows,count"
shape_check "/funnel?days=30"             "$API/funnel?days=30"   "window_days,since,stages"
shape_check "/traffic?days=7"             "$API/traffic?days=7"   "window_days,totals,daily,by_source,by_country"

echo ""
echo "── Input validation ──"
check "/orders bad date → 400"             400 "$API/orders?since=NOT-A-DATE" \
    -H "X-EnrichLabs-Key: $KEY"

echo ""
echo "── PII guard ──"
PII_CHECK=$(curl -s -H "X-EnrichLabs-Key: $KEY" --max-time 20 "$API/orders?limit=10" | \
    python3 -c "
import json, sys
try:
    body = json.load(sys.stdin)
    leaks = []
    for row in body.get('rows', []):
        for k in ('customer_email', 'buyer_email', 'email', 'name', 'address'):
            if k in row:
                leaks.append(k)
    print(','.join(sorted(set(leaks))) or 'CLEAN')
except Exception as e:
    print('ERR:', e)
")
if [ "$PII_CHECK" = "CLEAN" ]; then
    printf "%b ✓ %-40s (no PII fields exposed)%b\n" "$GREEN" "/orders PII guard" "$RESET"
    PASS=$((PASS + 1))
else
    printf "%b ✗ %-40s LEAKED: %s%b\n" "$RED" "/orders PII guard" "$PII_CHECK" "$RESET"
    FAIL=$((FAIL + 1))
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
if [ $FAIL -eq 0 ]; then
    printf "%b ✓ All %d checks passed — EnrichLabs API is healthy on %s%b\n" "$GREEN" "$TOTAL" "$BASE" "$RESET"
    echo "════════════════════════════════════════════════════════════════"
    exit 0
else
    printf "%b ✗ %d / %d checks failed%b\n" "$RED" "$FAIL" "$TOTAL" "$RESET"
    echo "════════════════════════════════════════════════════════════════"
    exit 1
fi
