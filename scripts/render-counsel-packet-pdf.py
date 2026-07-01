"""Assemble the extracted packet HTML into a standalone HTML doc
and render to PDF with weasyprint.

Env vars:
  IN_FILE       — path to the extracted packet_data.json (default /tmp/packet_data.json)
  OUT_FILE      — output PDF path (default counsel-review-packet-<DATE>.pdf)
  PACKET_TITLE  — window title in the PDF (default "Counsel Review Packet")
  FOOTER_LABEL  — footer branding label (default "Counsel Review Packet")
"""
import json
import os
import re
from datetime import date

from weasyprint import HTML

DATA_FILE = os.environ.get("IN_FILE", "/tmp/packet_data.json")
OUT = os.environ.get(
    "OUT_FILE",
    f"/app/frontend/public/downloads/counsel-review-packet-{date.today().isoformat()}.pdf",
)
TITLE = os.environ.get("PACKET_TITLE", "Counsel Review Packet")
FOOTER_LABEL = os.environ.get("FOOTER_LABEL", TITLE)

os.makedirs(os.path.dirname(OUT), exist_ok=True)

with open(DATA_FILE) as f:
    data = json.load(f)

# Strip Emergent dev-inspector attributes injected in preview mode.
# These attributes (x-source-file-abs, x-file-name, x-line-number,
# x-source-line, x-source-path, x-source-editable, x-array-var,
# x-source-map, x-file-abs, x-column) reference internal file paths
# (manifest.js, hierarchy.js, PolicyPage.jsx, etc.) that must not
# appear in the packet sent to counsel. They are HTML attributes only
# — never text nodes — so removing them does not change the rendered
# output, only the HTML source cleanliness.
INSPECTOR_ATTR = re.compile(r'\s(?:x-source-[a-z-]+|x-file-[a-z-]+|x-line-number|x-column|x-array-var|x-array-index)="[^"]*"')
html_clean = INSPECTOR_ATTR.sub("", data["html"])
styles_clean = INSPECTOR_ATTR.sub("", data["styles"])

html_doc = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Crafters Market — {TITLE}</title>
<style>
{styles_clean}
</style>
<style>
/* Overrides for standalone print — no site chrome so remove padding etc. */
body {{ margin: 0; background: #fff; font-family: Georgia, 'Times New Roman', serif; }}
.pkt-root {{ max-width: none; margin: 0; }}
/* Ensure page breaks work in weasyprint */
.pkt-pagebreak {{ page-break-after: always; break-after: page; }}
.pkt-policy, .pkt-attorney, .pkt-body-block {{ page-break-inside: avoid; break-inside: avoid; }}
@page {{
  size: Letter;
  margin: 0.6in 0.6in 0.75in 0.6in;
  @bottom-center {{
    content: "Crafters Market — Trust & Policy Center v1 · {FOOTER_LABEL} · Page " counter(page) " of " counter(pages);
    font-family: Georgia, serif;
    font-size: 8.5pt;
    color: #666;
  }}
}}
</style>
</head>
<body>
{html_clean}
</body>
</html>
"""

tmp_html = "/tmp/packet.html"
with open(tmp_html, "w") as f:
    f.write(html_doc)
print(f"HTML written: {len(html_doc)} chars ({tmp_html})")

print(f"Rendering PDF with weasyprint → {OUT}")
HTML(string=html_doc, base_url="https://active-project-4.preview.emergentagent.com/").write_pdf(OUT)
size = os.path.getsize(OUT)
print(f"SUCCESS: {OUT} — {size} bytes ({size/1024:.1f} KB)")
