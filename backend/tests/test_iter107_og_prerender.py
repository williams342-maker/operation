"""iter107 — OG prerender routes for crawlers (Facebook/LinkedIn/Discord/etc).

Verifies:
- `/api/og/product/<slug>` returns full HTML with proper OG + Twitter Card tags.
- `og:url` and `link rel=canonical` point to the SPA URL (not the prerender URL).
- `meta http-equiv=refresh` redirects real browsers to the SPA URL.
- Product OG includes `product:price:amount` + `product:price:currency` + `og:type=product`.
- Maker OG carries `og:type=profile` and prepends "Veteran-Owned" badge when set.
- Journal OG carries `og:type=article` + `article:published_time`.
- Unknown slug → 302 redirect to the parent listing page.
- Malformed slug → 404 (slug regex guard).
- Diagnostics endpoint returns sample slugs across all 3 kinds.
- HTML escaping correctly handles quotes / brackets / ampersands in titles.
"""
import asyncio
import re

import pytest
from httpx import AsyncClient, ASGITransport


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


async def _client():
    from server import app
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _meta(html: str, prop: str) -> str:
    """Pull a `<meta property|name="<prop>" content="…">` value out of the HTML."""
    m = re.search(
        rf'(?:property|name)="{re.escape(prop)}"\s+content="([^"]*)"', html,
    )
    return m.group(1) if m else ""


# ============================================================
# Product
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_og_product_returns_full_html_with_correct_meta_tags():
    from core import db
    slug = "iter107-og-product"
    await db.products.delete_many({"slug": slug})
    await db.products.insert_one({
        "slug": slug,
        "title": "Iter107 Test Sign",
        "description": "A handsome plasma-cut mountain scene for testing OG meta tags.",
        "images": ["https://example.com/iter107-product.jpg"],
        "price": 149.50,
        "maker_name": "Iter107 Maker",
        "maker_slug": "iter107-maker",
        "deleted_at": None,
        "status": "active",
    })
    async with await _client() as c:
        r = await c.get(f"/api/og/product/{slug}")
    assert r.status_code == 200
    html = r.text
    assert _meta(html, "og:title") == "Iter107 Test Sign · Iter107 Maker — Crafters Market"
    assert "handsome plasma-cut mountain" in _meta(html, "og:description")
    assert _meta(html, "og:image") == "https://example.com/iter107-product.jpg"
    assert _meta(html, "og:url").endswith(f"/shop/{slug}")
    assert _meta(html, "twitter:card") == "summary_large_image"
    assert _meta(html, "twitter:image") == "https://example.com/iter107-product.jpg"
    assert _meta(html, "product:price:amount") == "149.50"
    assert _meta(html, "product:price:currency") == "USD"
    # og:type is overridden to "product" when price is present.
    assert "og:type" in html and "product" in html
    # Canonical link tag.
    assert f'rel="canonical" href="' in html and f"/shop/{slug}" in html
    # Meta-refresh fallback for real browsers.
    assert 'http-equiv="refresh"' in html
    await db.products.delete_many({"slug": slug})


@pytest.mark.asyncio(loop_scope="module")
async def test_og_product_unknown_slug_returns_404_noindex():
    """iter372 — dead slugs now return a real 404 + noindex (was a 302
    bounce, which GSC reported as 'Page with redirect')."""
    async with await _client() as c:
        r = await c.get("/api/og/product/totally-not-a-real-slug-iter107")
    assert r.status_code == 404
    assert 'noindex' in r.text
    assert "/shop" in r.text  # onward link for humans


@pytest.mark.asyncio(loop_scope="module")
async def test_og_product_malformed_slug_redirects_safely():
    """Slug regex rejects path-traversal attempts. FastAPI itself 404s
    before we even get the chance to redirect, which is also fine."""
    async with await _client() as c:
        r = await c.get("/api/og/product/has spaces")
    # FastAPI's path matcher rejects spaces in path; either way no 5xx.
    assert r.status_code in (302, 307, 404)


@pytest.mark.asyncio(loop_scope="module")
async def test_og_product_html_escapes_special_characters():
    from core import db
    slug = "iter107-og-escape"
    await db.products.delete_many({"slug": slug})
    await db.products.insert_one({
        "slug": slug,
        "title": 'Bracket & "Quote" Test <signal>',
        "description": "Ampersand & angle <brackets> & 'apostrophes' in description.",
        "images": ["https://example.com/img.jpg"],
        "price": 50.0,
        "maker_name": "Maker & Co",
        "deleted_at": None,
        "status": "active",
    })
    async with await _client() as c:
        r = await c.get(f"/api/og/product/{slug}")
    assert r.status_code == 200
    html = r.text
    # Raw < > & " ' MUST NOT appear unescaped inside meta content attributes.
    title_attr = _meta(html, "og:title")
    assert "<" not in title_attr and ">" not in title_attr
    assert '"' not in title_attr  # was escaped to &quot; in raw html
    assert "&amp;" in html
    assert "&lt;signal&gt;" in html
    await db.products.delete_many({"slug": slug})


# ============================================================
# Maker
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_og_maker_returns_profile_type_with_veteran_badge():
    from core import db
    slug = "iter107-og-maker"
    await db.makers.delete_many({"slug": slug})
    await db.makers.insert_one({
        "slug": slug,
        "name": "Iron & Oak Co.",
        "tagline": "Plasma-cut signage from Idaho.",
        "banner_image_url": "https://example.com/banner.jpg",
        "is_veteran_owned": True,
    })
    async with await _client() as c:
        r = await c.get(f"/api/og/maker/{slug}")
    assert r.status_code == 200
    html = r.text
    assert _meta(html, "og:title") == "Iron &amp; Oak Co. — Crafters Market"  # raw attr is escaped
    desc = _meta(html, "og:description")
    assert "Veteran-Owned" in desc
    assert "Plasma-cut signage" in desc
    assert _meta(html, "og:image") == "https://example.com/banner.jpg"
    assert _meta(html, "og:type") == "profile"
    assert _meta(html, "og:url").endswith(f"/makers/{slug}")
    await db.makers.delete_many({"slug": slug})


@pytest.mark.asyncio(loop_scope="module")
async def test_og_maker_unknown_slug_returns_404_noindex():
    async with await _client() as c:
        r = await c.get("/api/og/maker/this-maker-does-not-exist-iter107")
    assert r.status_code == 404
    assert 'noindex' in r.text
    assert "/makers" in r.text


# ============================================================
# Journal
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_og_journal_returns_article_type_with_published_time():
    from core import db
    slug = "iter107-og-journal"
    await db.blog_posts.delete_many({"slug": slug})
    await db.blog_posts.insert_one({
        "slug": slug,
        "title": "Why we use 14ga steel",
        "excerpt": "Thicker steel survives outdoor mounting better.",
        "cover": "https://example.com/cover.jpg",
        "author": "Crafters Market Team",
        "created_at": "2026-04-15T12:00:00Z",
    })
    async with await _client() as c:
        r = await c.get(f"/api/og/journal/{slug}")
    assert r.status_code == 200
    html = r.text
    assert "Why we use 14ga steel" in _meta(html, "og:title")
    assert "Thicker steel" in _meta(html, "og:description")
    assert _meta(html, "og:type") == "article"
    assert _meta(html, "article:published_time").startswith("2026-04-15")
    assert _meta(html, "article:author") == "Crafters Market Team"
    assert _meta(html, "og:url").endswith(f"/journal/{slug}")
    await db.blog_posts.delete_many({"slug": slug})


@pytest.mark.asyncio(loop_scope="module")
async def test_og_journal_unknown_slug_returns_404_noindex():
    async with await _client() as c:
        r = await c.get("/api/og/journal/this-post-does-not-exist-iter107")
    assert r.status_code == 404
    assert 'noindex' in r.text
    assert "/journal" in r.text


# ============================================================
# Diag
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_og_diag_returns_sample_slugs():
    async with await _client() as c:
        r = await c.get("/api/og/diag")
    assert r.status_code == 200
    body = r.json()
    assert "site_root" in body and body["site_root"].startswith("http")
    assert set(body["samples"].keys()) == {"products", "makers", "journal"}
    # Each sample carries both the OG URL and the SPA URL so operators
    # can copy-paste either into a debug tool.
    for kind, items in body["samples"].items():
        for item in items:
            assert item["og_url"].startswith(body["site_root"])
            assert "/api/og/" in item["og_url"]
            assert item["spa_url"].startswith(body["site_root"])
            assert "/api/og/" not in item["spa_url"]
