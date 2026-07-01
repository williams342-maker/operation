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
echo "==> Done."
