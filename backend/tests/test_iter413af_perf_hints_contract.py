"""iter413af — LCP performance hints contract.

Pins the resource hints in public/index.html that drive first-paint
speed. If any of these regress (someone removes a preconnect, or moves
the font stylesheet back to the bottom of <head>), cold-cache mobile
LCP regresses by ~120-180ms — which Google Search Console flags as a
Core Web Vitals issue and which hurts conversion on slow networks.

Invariants pinned:
  • cdn.craftersmarket.org has a preconnect (image CDN = LCP element)
  • r2.craftersmarket.org has a preconnect (legacy R2 host kept warm)
  • fonts.googleapis.com + fonts.gstatic.com have preconnects
  • Google Fonts CSS has a rel=preload hint at the TOP of <head>, not
    waiting buried somewhere down the page
  • Hints are deduped (no double preconnect entries for the same host)
"""
import re


INDEX_HTML = "/app/frontend/public/index.html"


def _read() -> str:
    with open(INDEX_HTML, "r", encoding="utf-8") as f:
        return f.read()


def test_cdn_preconnect_present():
    """cdn.craftersmarket.org is the public R2 CDN that serves hero +
    product images — these are the LCP element on the homepage and
    product pages. Preconnect saves ~80-120ms of TLS+DNS handshake."""
    html = _read()
    assert re.search(
        r'<link[^>]*rel\s*=\s*"preconnect"[^>]*href\s*=\s*"https://cdn\.craftersmarket\.org"',
        html,
    ), "cdn.craftersmarket.org preconnect missing — LCP regression"


def test_r2_preconnect_present():
    """r2.craftersmarket.org preconnect kept warm for legacy direct
    bucket access (signed uploads + admin tooling)."""
    html = _read()
    assert re.search(
        r'<link[^>]*rel\s*=\s*"preconnect"[^>]*href\s*=\s*"https://r2\.craftersmarket\.org"',
        html,
    ), "r2.craftersmarket.org preconnect missing"


def test_fonts_googleapis_preconnect_present():
    html = _read()
    assert re.search(
        r'<link[^>]*rel\s*=\s*"preconnect"[^>]*href\s*=\s*"https://fonts\.googleapis\.com"',
        html,
    )


def test_fonts_gstatic_preconnect_present_with_crossorigin():
    """fonts.gstatic.com serves the woff2 binaries; crossorigin is
    REQUIRED on the preconnect otherwise the browser still does the
    handshake twice (anonymous + credentialed)."""
    html = _read()
    assert re.search(
        r'<link[^>]*rel\s*=\s*"preconnect"[^>]*href\s*=\s*"https://fonts\.gstatic\.com"[^>]*crossorigin',
        html,
    ) or re.search(
        r'<link[^>]*crossorigin[^>]*rel\s*=\s*"preconnect"[^>]*href\s*=\s*"https://fonts\.gstatic\.com"',
        html,
    ), "fonts.gstatic.com preconnect must include crossorigin"


def test_font_stylesheet_has_preload_hint_in_top_of_head():
    """rel=preload for the Google Fonts CSS must appear BEFORE the
    JSON-LD blocks (which are big). Otherwise the browser doesn't
    discover the font CSS until ~300 lines in, and FOUT shows."""
    html = _read()
    preload_idx = html.find(
        'rel="preload" as="style" href="https://fonts.googleapis.com/css2'
    )
    assert preload_idx != -1, "Font CSS preload hint is missing"
    # Find the first JSON-LD block — preload must come BEFORE it.
    jsonld_idx = html.find('<script type="application/ld+json">')
    assert jsonld_idx != -1
    assert preload_idx < jsonld_idx, (
        "Font CSS preload must appear before JSON-LD blocks so the browser "
        "discovers it early during HTML parsing"
    )


def test_no_duplicate_preconnects_per_host():
    """Each host should have exactly one preconnect entry. Duplicates
    waste connection budget and confuse the resource-priority lookup."""
    html = _read()
    hosts = [
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://cdn.craftersmarket.org",
        "https://r2.craftersmarket.org",
    ]
    for host in hosts:
        # Count preconnect links for this host
        matches = re.findall(
            rf'<link[^>]*rel\s*=\s*"preconnect"[^>]*href\s*=\s*"{re.escape(host)}"',
            html,
        )
        assert len(matches) == 1, (
            f"{host} has {len(matches)} preconnect entries; expected exactly 1"
        )
