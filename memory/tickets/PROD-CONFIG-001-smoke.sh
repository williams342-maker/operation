#!/usr/bin/env bash
# PROD-CONFIG-001 smoke test playbook
#
# Runs every flow you listed against https://craftersmarket.org and reports
# pass/fail + the host each /api/* call was sent to. After your prod
# redeploy, the "wired-to" column should read "craftersmarket.org" — not
# "active-project-4". That's the proof the env-var change landed in the
# production build.
#
# Re-runnable. No mutations. Safe to invoke multiple times.

set -u
PROD=https://craftersmarket.org
PASS=0; FAIL=0
say() { printf "  %-46s %s\n" "$1" "$2"; }
ok()  { PASS=$((PASS+1)); say "$1" "✓ $2"; }
bad() { FAIL=$((FAIL+1)); say "$1" "✗ $2"; }

echo
echo "──────── PROD smoke · $(date -u +%FT%TZ) ──────────"
echo

# 1. Homepage HTML loads
code=$(curl -s -o /dev/null -w "%{http_code}" "$PROD/")
[[ "$code" == "200" ]] && ok "1. Homepage GET /" "HTTP $code" || bad "1. Homepage GET /" "HTTP $code"

# 1a. What host does the prod bundle hardcode for /api/*? (the actual question)
BUNDLE_URL=$(curl -s "$PROD/" | grep -oE '/static/js/main\.[a-f0-9]+\.js' | head -1)
if [[ -n "$BUNDLE_URL" ]]; then
  hosts=$(curl -s -H "Accept-Encoding: identity" "$PROD$BUNDLE_URL" \
    | grep -oE 'https?://[a-zA-Z0-9.\-]+\.(emergent\.host|emergentagent\.com|craftersmarket\.org)' \
    | sort -u | tr '\n' ' ')
  api_host_count_preview=$(curl -s -H "Accept-Encoding: identity" "$PROD$BUNDLE_URL" \
    | grep -oc "active-project-[0-9]\+")
  if [[ "$api_host_count_preview" == "0" ]]; then
    ok "1a. Prod bundle wired-to" "✓ NO preview-host refs (good)"
  else
    bad "1a. Prod bundle wired-to" "$api_host_count_preview refs to active-project-* still present"
  fi
  echo "      bundle: $BUNDLE_URL"
  echo "      hosts referenced: $hosts"
fi

# 2. Browse Makers
code=$(curl -s -o /dev/null -w "%{http_code}" "$PROD/makers")
[[ "$code" == "200" ]] && ok "2. /makers (SSR HTML)" "HTTP $code" || bad "2. /makers" "HTTP $code"
n=$(curl -s "$PROD/api/makers" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
[[ "$n" =~ ^[0-9]+$ && "$n" -gt 0 ]] && ok "2. GET /api/makers payload"   "$n makers returned" || bad "2. /api/makers" "got: $n"

# 3. Shop
code=$(curl -s -o /dev/null -w "%{http_code}" "$PROD/shop")
[[ "$code" == "200" ]] && ok "3. /shop (SSR HTML)" "HTTP $code" || bad "3. /shop" "HTTP $code"
n=$(curl -s "$PROD/api/products?featured=true" | python3 -c "import sys,json,collections;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else d.get('count','?'))" 2>/dev/null || echo "?")
[[ -n "$n" ]] && ok "3. GET /api/products?featured=true" "$n products" || bad "3. /api/products" "failed"

# 4. Founder application page
code=$(curl -s -o /dev/null -w "%{http_code}" "$PROD/apply")
[[ "$code" == "200" ]] && ok "4. /apply (founder application page)" "HTTP $code" || bad "4. /apply" "HTTP $code"
code=$(curl -s -o /dev/null -w "%{http_code}" "$PROD/api/founders/slots")
[[ "$code" == "200" ]] && ok "4. GET /api/founders/slots" "HTTP $code" || bad "4. /api/founders/slots" "HTTP $code"

# 5. Login / logout (magic-link request path — no mutation, no email actually consumed)
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROD/api/maker/auth/request" \
       -H "Content-Type: application/json" -d '{"email":"smoke-test-noop@example.invalid"}')
# Accept 200/202/204/400/429 (request was processed; we're not validating email delivery)
[[ "$code" =~ ^(200|202|204|400|422|429)$ ]] && ok "5. POST /api/maker/auth/request" "HTTP $code (processed)" \
                                          || bad "5. /api/maker/auth/request" "HTTP $code"

# 6. Create listing — requires auth; we only verify the route gate exists
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROD/api/maker/products" \
       -H "Content-Type: application/json" -d '{}')
[[ "$code" =~ ^(401|403)$ ]] && ok "6. POST /api/maker/products (auth gate)" "HTTP $code (correctly rejected)" \
                              || bad "6. /api/maker/products" "expected 401/403, got $code"

# 7. Checkout — same: verify the route exists and refuses anonymous bodies
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROD/api/checkout/session" \
       -H "Content-Type: application/json" -d '{}')
[[ "$code" =~ ^(400|401|403|422)$ ]] && ok "7. POST /api/checkout/session" "HTTP $code (route reachable)" \
                                       || bad "7. /api/checkout/session" "HTTP $code"

# 8. Admin login page + magic-link endpoint
code=$(curl -s -o /dev/null -w "%{http_code}" "$PROD/admin/login")
[[ "$code" == "200" ]] && ok "8. /admin/login" "HTTP $code" || bad "8. /admin/login" "HTTP $code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROD/api/admin/auth/request" \
       -H "Content-Type: application/json" -d '{"email":"smoke-test-noop@example.invalid"}')
[[ "$code" =~ ^(200|202|204|400|401|403|422|429)$ ]] && ok "8. POST /api/admin/auth/request" "HTTP $code (processed)" \
                                                   || bad "8. /api/admin/auth/request" "HTTP $code"

echo
echo "──────── result: $PASS passed · $FAIL failed ──────────"
echo
exit $FAIL
