"""Assemble the extracted counsel-packet HTML into a standalone HTML doc
and render to PDF with weasyprint."""
import json
import os
from weasyprint import HTML, CSS

DATA_FILE = "/tmp/packet_data.json"
OUT = "/app/frontend/public/downloads/counsel-review-packet-2026-06-30.pdf"

os.makedirs(os.path.dirname(OUT), exist_ok=True)

with open(DATA_FILE) as f:
    data = json.load(f)

# We only want the print CSS from PrintBundlePage (embedded in the packet).
# The extracted 'styles' also includes Tailwind + app-wide styles, which
# would pollute the PDF. Since PrintBundlePage's inline <style> tag is
# scoped to the .pkt-root children with explicit classes, we can just
# use ALL the extracted styles — the .pkt-* rules will win on their
# specific elements and the site chrome is not present in the extracted
# fragment anyway.

html_doc = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Crafters Market — Counsel Review Packet</title>
<style>
{data['styles']}
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
    content: "Crafters Market — Trust & Policy Center v1 · Counsel Review Packet · Page " counter(page) " of " counter(pages);
    font-family: Georgia, serif;
    font-size: 8.5pt;
    color: #666;
  }}
}}
</style>
</head>
<body>
{data['html']}
</body>
</html>
"""

with open("/tmp/packet.html", "w") as f:
    f.write(html_doc)
print(f"HTML written: {len(html_doc)} chars")

print("Rendering PDF with weasyprint...")
HTML(string=html_doc, base_url="https://active-project-4.preview.emergentagent.com/").write_pdf(OUT)
size = os.path.getsize(OUT)
print(f"SUCCESS: {OUT} — {size} bytes ({size/1024:.1f} KB)")
