#!/usr/bin/env bash
# Regenerate the Legal Launch Binder v5 — both DOCX (editable master) and PDF
# (distribution copy). Runs the full pipeline end-to-end:
#
#   1. Extract HTML from /attorney-packet route into /tmp/attorney_packet.json
#      (assumes it was previously extracted; if missing, use the screenshot tool
#       or playwright script to re-extract).
#   2. Render the DOCX via python-docx (render-legal-launch-binder-v5.py).
#   3. Update TOC / PAGE / NUMPAGES fields via LibreOffice UNO and export PDF
#      (update-toc-and-export-pdf.py).
#
# Output:
#   /app/frontend/public/downloads/legal-launch-binder-v5-<DATE>.docx  (editable master)
#   /app/frontend/public/downloads/legal-launch-binder-v5-<DATE>.pdf   (distribution)

set -euo pipefail

DATE=${DATE:-$(date +%Y-%m-%d)}
DOCX="/app/frontend/public/downloads/legal-launch-binder-v5-${DATE}.docx"
PDF="/app/frontend/public/downloads/legal-launch-binder-v5-${DATE}.pdf"

if [ ! -f /tmp/attorney_packet.json ]; then
  echo "ERROR: /tmp/attorney_packet.json missing."
  echo "       Re-extract by loading /attorney-packet in the screenshot tool"
  echo "       and saving the outerHTML into /tmp/attorney_packet.json."
  exit 1
fi

echo "==> Step 1/2: Render DOCX via python-docx"
python3 /app/scripts/render-legal-launch-binder-v5.py

echo "==> Step 2/2: Populate TOC + export PDF via LibreOffice UNO"
DOCX="$DOCX" python3 /app/scripts/update-toc-and-export-pdf.py

echo ""
echo "==> Deliverables:"
ls -la "$DOCX" "$PDF"

# ------------------------------------------------------------------------
# Optional step: nudge search engines that the Trust & Policy Center
# content just changed. Idempotent — safe to skip. Requires ADMIN_TOKEN
# in the environment (mint one via issue_session_jwt or from the admin
# dashboard). Prints a hint if the token is missing.
# ------------------------------------------------------------------------
if [ -n "${ADMIN_TOKEN:-}" ]; then
  API_URL=${API_URL:-$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)}
  echo ""
  echo "==> Notifying search engines (IndexNow + GSC sitemap re-submit)…"
  curl -sf --max-time 60 -X POST "${API_URL}/api/admin/seo/policies-published" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    | python3 -c '
import json, sys
r = json.load(sys.stdin)
ix = r["indexnow"]
gsc = r["gsc"]
print("    IndexNow: ok=%s status=%s  urls=%s" % (ix["ok"], ix["status"], r["url_count"]))
print("    GSC:      ok=%s status=%s skipped=%s" % (gsc["ok"], gsc.get("status", "-"), gsc.get("skipped", False)))
' \
    || echo "    (notification failed — non-fatal; retry from admin dashboard)"
else
  echo ""
  echo "==> Skipping search-engine notification (ADMIN_TOKEN not set)."
  echo "    To notify manually:  Admin dashboard → SEO → 'Policies published'"
  echo "    Or in a shell:       curl -X POST \$API_URL/api/admin/seo/policies-published -H \"Authorization: Bearer \$ADMIN_TOKEN\""
fi

echo "==> Done."
