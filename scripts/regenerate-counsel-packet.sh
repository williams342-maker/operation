#!/usr/bin/env bash
# Regenerate the counsel review PDF from the current /counsel-packet route.
#
# Usage:  bash /app/scripts/regenerate-counsel-packet.sh [preview_url]
#
# Two-step pipeline:
#   1. Load /counsel-packet in headless chromium (via playwright inside the
#      screenshot tool) and extract the rendered HTML + inline styles.
#   2. Feed the extracted HTML to WeasyPrint, which handles pagination,
#      @page rules, footers, and font shaping.
#
# The pipeline exists because chromium's --print-to-pdf hangs in this
# container (see iter413dp notes). WeasyPrint renders reliably without a
# browser.
#
# Output: /app/frontend/public/downloads/counsel-review-packet-<DATE>.pdf
# Public URL: <preview_url>/downloads/counsel-review-packet-<DATE>.pdf

set -euo pipefail

DATE=${DATE:-$(date +%Y-%m-%d)}
OUT="/app/frontend/public/downloads/counsel-review-packet-${DATE}.pdf"

echo "==> Regenerating counsel review PDF for ${DATE}"
echo "    Output: ${OUT}"

# The two Python steps live in /app/scripts/.  Step 1 requires a running
# preview server + working screenshot tool infrastructure (playwright).
# Step 2 is pure Python.

echo "    Step 1: extract packet HTML via playwright/screenshot tool"
echo "    (run manually via mcp_screenshot_tool on /counsel-packet; output to /tmp/packet_data.json)"

echo "    Step 2: render PDF with WeasyPrint"
python3 /app/scripts/render-counsel-packet-pdf.py

ls -la "${OUT}"
echo "==> Done."
