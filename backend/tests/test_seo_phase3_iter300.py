"""SEO Phase 3 (iter300) — content-rich landing pages + custom-order hub.

Verifies:
  • `/api/sitemap.xml` includes the new `/how-custom-orders-work` URL
    with the bumped priority.
  • The frontend route file `seoLandingConfig.js` declares the bodyExtras
    + faqs + relatedLinks on the top-3 enhanced configs (custom-metal-
    signs, personalized-gifts, wedding-gifts).

Frontend-rendered FAQPage / HowTo JSON-LD on the actual pages is
verified by the testing agent (browser context required to read
useStructuredData output).
"""
import os
import re
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

API = "http://localhost:8001"


def test_sitemap_includes_how_custom_orders_work():
    r = httpx.get(f"{API}/api/sitemap.xml", timeout=15)
    assert r.status_code == 200
    body = r.text
    assert "https://craftersmarket.org/how-custom-orders-work" in body
    # changefreq=monthly, priority=0.85 — high priority, low recrawl
    m = re.search(
        r"<loc>https://craftersmarket\.org/how-custom-orders-work</loc>"
        r"[^<]*<lastmod>[^<]+</lastmod>"
        r"[^<]*<changefreq>monthly</changefreq>"
        r"[^<]*<priority>0\.85</priority>",
        body,
    )
    assert m, "Expected /how-custom-orders-work entry with monthly changefreq + 0.85 priority"


def test_sitemap_still_includes_phase3_landing_pages():
    """Regression — adding the new slug must not displace any of the
    iter177 buyer-intent landing pages."""
    r = httpx.get(f"{API}/api/sitemap.xml", timeout=15)
    body = r.text
    for slug in (
        "custom-metal-signs", "personalized-gifts", "wedding-gifts",
        "custom-ranch-signs", "business-signs", "outdoor-metal-decor",
    ):
        assert f"https://craftersmarket.org/{slug}" in body


def test_seo_landing_config_has_phase3_enrichments():
    """Top-3 enhanced configs must declare bodyExtras, faqs, and
    relatedLinks. Read the JS source directly (no JS parser needed —
    a substring check on the key names is enough)."""
    path = "/app/frontend/src/pages/seoLandingConfig.js"
    with open(path) as f:
        src = f.read()
    for slug in ("custom-metal-signs", "personalized-gifts", "wedding-gifts"):
        block_idx = src.find(f'"{slug}":')
        assert block_idx > 0, f"Missing config for {slug}"
        # Look at the next ~12000 chars (the FAQ + body extras can be 8-10 kB).
        block = src[block_idx:block_idx + 12000]
        assert "bodyExtras:" in block, f"{slug} missing bodyExtras"
        assert "faqs:" in block, f"{slug} missing faqs"
        assert "relatedLinks:" in block, f"{slug} missing relatedLinks"
        # Each enhanced config should have ≥ 5 FAQ entries (we shipped exactly 5).
        # Use a coarse count of `q:` keys inside the FAQ array.
        faqs_idx = block.find("faqs:")
        related_idx = block.find("relatedLinks:")
        faqs_slice = block[faqs_idx:related_idx if related_idx > faqs_idx else faqs_idx + 4000]
        assert faqs_slice.count("q:") >= 5, f"{slug} should have ≥ 5 FAQs, found {faqs_slice.count('q:')}"


def test_how_custom_orders_work_jsx_has_required_schema_types():
    """The hub page must emit HowTo + FAQPage + BreadcrumbList JSON-LD."""
    path = "/app/frontend/src/pages/HowCustomOrdersWorkPage.jsx"
    with open(path) as f:
        src = f.read()
    for t in ("HowTo", "FAQPage", "BreadcrumbList", "WebPage"):
        assert f'"@type": "{t}"' in src, f"HowCustomOrdersWorkPage missing @type {t}"
    # Must have exactly 5 process steps + ≥ 5 FAQs.
    # Steps live in the STEPS constant (5 entries); FAQ in FAQS (≥5).
    steps_match = re.search(r"const STEPS = \[(.*?)\];", src, re.DOTALL)
    assert steps_match
    assert steps_match.group(1).count("title:") == 5
    faqs_match = re.search(r"const FAQS = \[(.*?)\];", src, re.DOTALL)
    assert faqs_match
    assert faqs_match.group(1).count("q:") >= 5
