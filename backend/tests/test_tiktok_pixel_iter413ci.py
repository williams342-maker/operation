"""iter413ci — TikTok Pixel external static file verification.

Verifies the fix for: "We can't detect pixel D8UP6SJC77UCR7H8US60 base code".
Pixel snippet is now served from /tiktok-pixel.js (static, un-minified) so
TikTok's verification crawler can literal-substring-match `ttq.load('...')`.
"""
import os
import re
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL")
# Per problem statement preview URL
PREVIEW = "https://active-project-4.preview.emergentagent.com"
URL = (BASE or PREVIEW).rstrip("/")
PIXEL_ID = "D8UP6SJC77UCR7H8US60"


@pytest.fixture(scope="module")
def pixel_js():
    r = requests.get(f"{URL}/tiktok-pixel.js", timeout=15)
    return r


@pytest.fixture(scope="module")
def homepage_html():
    r = requests.get(f"{URL}/", timeout=15, headers={"User-Agent": "Mozilla/5.0"})
    return r


@pytest.fixture(scope="module")
def robots_txt():
    r = requests.get(f"{URL}/robots.txt", timeout=15)
    return r


# --- /tiktok-pixel.js static file checks ---

def test_pixel_js_status_200(pixel_js):
    assert pixel_js.status_code == 200, f"expected 200 got {pixel_js.status_code}"


def test_pixel_js_content_type_is_javascript(pixel_js):
    ctype = pixel_js.headers.get("Content-Type", "")
    assert "javascript" in ctype.lower(), f"Content-Type is {ctype!r}, expected JS MIME"


def test_pixel_js_contains_literal_ttq_load(pixel_js):
    """The CRITICAL assertion — TikTok's crawler does a literal match for this."""
    body = pixel_js.text
    assert f"ttq.load('{PIXEL_ID}')" in body, (
        f"Canonical literal `ttq.load('{PIXEL_ID}')` MISSING — TikTok crawler will fail."
    )


def test_pixel_js_not_minified_to_alias(pixel_js):
    """Ensure the local var has not been renamed to o/n/r/etc."""
    body = pixel_js.text
    # Check there is no `o.load("D8UP...` or `n.load("D8UP...` style minification
    minified = re.search(r"\b[a-eo-rt-z]\.load\(['\"]D8UP6SJC77UCR7H8US60['\"]\)", body)
    assert minified is None, f"Pixel snippet appears minified: matched {minified.group(0)!r}"


def test_pixel_js_contains_ttq_page_call(pixel_js):
    assert "ttq.page()" in pixel_js.text, "missing ttq.page() call (page-view trigger)"


# --- Homepage HTML checks ---

def test_homepage_status_200(homepage_html):
    assert homepage_html.status_code == 200


def test_homepage_references_external_pixel_script(homepage_html):
    html = homepage_html.text
    assert 'src="/tiktok-pixel.js"' in html, "external <script src='/tiktok-pixel.js'> not found"


def test_homepage_noscript_fallback_with_pixel_id(homepage_html):
    html = homepage_html.text
    # noscript img fallback should contain pixel id literal + analytics.tiktok.com
    assert PIXEL_ID in html, f"pixel ID {PIXEL_ID} not present in homepage HTML"
    # Find a noscript block containing analytics.tiktok.com and the pixel id
    noscript_blocks = re.findall(r"<noscript>.*?</noscript>", html, flags=re.DOTALL | re.IGNORECASE)
    matched = any(
        "analytics.tiktok.com" in b and PIXEL_ID in b for b in noscript_blocks
    )
    assert matched, "no <noscript> block contains analytics.tiktok.com + pixel ID"


# --- Regression: other tags still present ---

def test_ga4_gtag_still_present(homepage_html):
    assert "googletagmanager.com/gtag/js?id=G-HY3FKJS4JK" in homepage_html.text


def test_ms_uet_still_present(homepage_html):
    # Inline UET loader uses ti:"97249872"
    assert '97249872' in homepage_html.text, "Microsoft UET pixel ti=97249872 missing"


# --- robots.txt check ---

def test_robots_does_not_block_pixel_js(robots_txt):
    assert robots_txt.status_code == 200
    text = robots_txt.text
    # No Disallow line should match /tiktok-pixel.js
    for line in text.splitlines():
        line_stripped = line.strip()
        if line_stripped.lower().startswith("disallow:"):
            path = line_stripped.split(":", 1)[1].strip()
            if path and path != "/" and (
                "/tiktok-pixel.js".startswith(path) or path == "/tiktok-pixel.js"
            ):
                pytest.fail(f"robots.txt Disallow rule {path!r} blocks /tiktok-pixel.js")
