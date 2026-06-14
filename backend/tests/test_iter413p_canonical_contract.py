"""iter413p regression — canonical contract for filtered shop views.

Previous bug: ShopPage emitted `<link rel="canonical">` with the active
filter's query string (`/shop?category=Pottery`, `/shop?q=mug`, etc).
Google saw these as duplicates of bare `/shop` and chose `/shop` as the
canonical, flagging every variant in Search Console as "Duplicate,
Google chose different canonical than user".

The fix (iter413p) has three load-bearing pieces — this file pins all
three so a future refactor can't silently reintroduce the bug:

  1. ShopPage canonicalizes to BARE `/shop` regardless of filters.
  2. ShopPage emits `noindex, follow` on filter variants.
  3. The XML sitemap NEVER includes query-string URLs.

We can't render the SPA from pytest (no Playwright in backend env), so
checks 1 & 2 are static-source asserts on ShopPage.jsx — if anyone
reverts those exact lines, the test fails with an explanatory message.
Check 3 is a true HTTP contract test against the running sitemap.
"""
import os
import re

import pytest
import requests

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001") + "/api"
SHOP_PAGE = "/app/frontend/src/pages/ShopPage.jsx"
SEO_LIB = "/app/frontend/src/lib/seo.js"


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_shop_page_canonicalizes_to_bare_shop_url():
    """ShopPage MUST canonicalize every filter variant to the bare
    `/shop` URL. A self-canonical that includes any query string
    (?category=…, ?q=…, ?occasion=…, ?color=…, ?technique=…) re-creates
    the GSC bug from iter413p."""
    src = _read(SHOP_PAGE)

    # The fixed constant must exist and equal the bare URL.
    m = re.search(r'_shopCanonical\s*=\s*"([^"]+)"', src)
    assert m, (
        "iter413p regression: `_shopCanonical` constant missing from "
        "ShopPage.jsx. The canonical pattern was rewritten — verify "
        "filter variants still point to bare /shop."
    )
    assert m.group(1) == "https://craftersmarket.org/shop", (
        f"iter413p regression: `_shopCanonical` is {m.group(1)!r}, "
        "expected 'https://craftersmarket.org/shop'. Filter variants "
        "must canonical-point to the bare URL, not include query strings."
    )

    # The `url:` prop passed to useStructuredData must reference the
    # constant — not build a templated URL with query strings.
    bad_canonical_patterns = [
        r'url:\s*`[^`]*\?category=',
        r'url:\s*`[^`]*\?q=',
        r'url:\s*`[^`]*\?occasion=',
        r'url:\s*`[^`]*\?color=',
        r'url:\s*`[^`]*\?technique=',
    ]
    for pat in bad_canonical_patterns:
        # We DO allow these patterns inside the JSON-LD breadcrumb item
        # (the breadcrumb URL legitimately includes ?category= for
        # crumb-link display). Strip the breadcrumb block before checking.
        breadcrumb_stripped = re.sub(
            r"breadcrumb:\s*\{[\s\S]*?\},?", "", src, count=1,
        )
        assert not re.search(pat, breadcrumb_stripped), (
            f"iter413p regression: ShopPage.jsx contains a query-string "
            f"canonical pattern ({pat}). Filter variants must canonical-"
            "point to bare /shop, not build templated URLs with filter "
            "params. See iter413p in PRD.md for context."
        )


def test_shop_page_emits_noindex_on_filtered_views():
    """ShopPage MUST pass `noindex: <filter-active-expression>` to
    useStructuredData so filter variants get `<meta name="robots"
    content="noindex, follow">`. Without this, Google keeps indexing
    every filter combination and ignoring the bare-/shop canonical."""
    src = _read(SHOP_PAGE)

    # Look for the noindex prop being passed with a non-trivial value.
    m = re.search(r"noindex:\s*([^,\n}]+)", src)
    assert m, (
        "iter413p regression: ShopPage.jsx is no longer passing the "
        "`noindex` prop to useStructuredData. Filter variants need "
        "noindex=true to avoid competing with the bare /shop canonical."
    )
    value = m.group(1).strip()
    assert value not in ("false", "undefined", "null"), (
        f"iter413p regression: ShopPage.jsx passes `noindex: {value}` — "
        "must be a filter-active expression (e.g., `_hasActiveFilter`)."
    )


def test_seo_hook_supports_noindex_param():
    """useStructuredData must continue to accept + apply a `noindex`
    prop. If this surface goes away, every page that opts-in silently
    breaks."""
    src = _read(SEO_LIB)
    assert "noindex" in src, (
        "iter413p regression: lib/seo.js no longer references `noindex`. "
        "The hook must accept this prop and emit "
        "<meta name='robots' content='noindex, follow'> when truthy."
    )
    # And the actual robots tag emission must be present.
    assert 'noindex, follow' in src, (
        "iter413p regression: lib/seo.js no longer emits "
        "'noindex, follow' — the robots tag is the entire point."
    )


def test_sitemap_never_includes_query_string_urls():
    """The XML sitemap MUST NOT list any URL with a query string.
    Including `?category=` or `?q=` URLs in the sitemap reasserts to
    Google that we WANT these indexed, undoing the canonical fix."""
    r = requests.get(f"{API}/sitemap.xml", timeout=15)
    assert r.status_code == 200, f"Sitemap returned {r.status_code}"

    # Extract every <loc>…</loc> URL and assert none contain '?'.
    locs = re.findall(r"<loc>([^<]+)</loc>", r.text)
    assert len(locs) >= 10, f"Sitemap suspiciously thin: {len(locs)} URLs"

    leaks = [u for u in locs if "?" in u]
    assert not leaks, (
        f"iter413p regression: sitemap.xml includes {len(leaks)} "
        f"query-string URLs (first 3: {leaks[:3]}). Listing filter "
        "variants in the sitemap re-creates the GSC 'Duplicate canonical' "
        "warning even after the ShopPage canonical fix."
    )


def test_sitemap_uses_https_apex_domain():
    """Sitemap URLs must use the canonical https://craftersmarket.org
    apex domain — not the preview hostname, not www, not http."""
    r = requests.get(f"{API}/sitemap.xml", timeout=15)
    assert r.status_code == 200

    locs = re.findall(r"<loc>([^<]+)</loc>", r.text)
    if not locs:
        pytest.skip("Sitemap empty")

    # Inspect the first URL — site_root is derived from the request so
    # in dev it'll be the dev origin. We only enforce the schema
    # invariant (https) and that no URL uses the preview hostname.
    for u in locs:
        assert u.startswith("https://") or u.startswith("http://localhost"), (
            f"iter413p regression: non-https sitemap URL {u}"
        )
        assert "preview.emergentagent.com" not in u, (
            f"iter413p regression: sitemap leaks preview hostname {u}. "
            "Google will index the preview as canonical and crash organic "
            "ranking. PUBLIC_SITE_URL env var must be the apex."
        )
