#!/usr/bin/env bash
# update-assetlinks.sh — drops a SHA-256 fingerprint into
# /app/frontend/public/.well-known/assetlinks.json so the TWA can
# verify domain ownership and hide the URL bar in Chrome.
#
# Usage:
#   ./update-assetlinks.sh "14:6D:E9:83:C5:73:..."         # release key
#   ./update-assetlinks.sh "14:6D:..." "AA:BB:..."          # release + debug
#
# After running, redeploy craftersmarket.org and verify with:
#   curl https://craftersmarket.org/.well-known/assetlinks.json
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <release-sha256-fingerprint> [debug-sha256-fingerprint]"
  echo ""
  echo "Get your release fingerprint from Play Console:"
  echo "  Setup → App integrity → App signing → SHA-256 certificate fingerprint"
  echo ""
  echo "Or from a local keystore:"
  echo "  keytool -list -v -keystore android.keystore -alias android | grep SHA256"
  exit 1
fi

RELEASE_SHA="$1"
DEBUG_SHA="${2:-}"
TARGET="/app/frontend/public/.well-known/assetlinks.json"
PKG="org.craftersmarket.app"

FINGERPRINTS="\"${RELEASE_SHA}\""
if [ -n "${DEBUG_SHA}" ]; then
  FINGERPRINTS="${FINGERPRINTS}, \"${DEBUG_SHA}\""
fi

cat > "${TARGET}" <<JSON
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "${PKG}",
      "sha256_cert_fingerprints": [${FINGERPRINTS}]
    }
  }
]
JSON

echo "✓ Wrote ${TARGET}"
echo ""
echo "Next: redeploy craftersmarket.org and verify with:"
echo "  curl https://craftersmarket.org/.well-known/assetlinks.json"
echo ""
echo "Then validate Google's view of the file with their checker:"
echo "  https://developers.google.com/digital-asset-links/tools/generator"
