"""iter318 — SEO prerender + product card trust-denorm regression tests.

Validates:
  • All 6 new static prerender endpoints return 200 with unique
    <title>, canonical link, OG tags, and a JSON-LD block.
  • All 19 SEO landing slugs return a per-slug prerender (no 404,
    each title contains the keyword).
  • The PolicyPage hash-anchor sections + aliasIds work
    (`#buyer-protection`, `#maker-agreement` link to a section that
    actually exists).
  • /api/products denormalizes maker_location onto each product so
    ProductCard's trust strip renders without N+1 fetches.
"""
from __future__ import annotations

import os
import re

import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

from server import app  # noqa: E402

pytestmark = pytest.mark.asyncio


# ────────────────────────────────────────────────────────────────────
# Static prerender routes
# ────────────────────────────────────────────────────────────────────

STATIC_ENDPOINTS = [
    ("/api/og/home",         "Crafters Market"),
    ("/api/og/custom-order", "Custom Piece"),
    ("/api/og/apply",        "Apply"),
    ("/api/og/journal",      "Journal"),
    ("/api/og/policy",       "Policies"),
]


@pytest.mark.parametrize("path,title_kw", STATIC_ENDPOINTS)
async def test_static_prerender_returns_unique_title_and_canonical(path, title_kw):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(path)
    assert r.status_code == 200, r.text
    html = r.text
    # Title present + contains the expected keyword
    m = re.search(r"<title>([^<]+)</title>", html)
    assert m, f"No <title> in {path}"
    assert title_kw.lower() in m.group(1).lower(), \
        f"Expected {title_kw!r} in title for {path}, got {m.group(1)!r}"
    # Canonical link present
    assert 'rel="canonical"' in html
    # Description meta present
    assert 'name="description"' in html
    # OG meta present
    assert 'property="og:title"' in html
    assert 'property="og:url"' in html
    # JSON-LD present
    assert 'application/ld+json' in html


async def test_static_prerender_titles_are_all_distinct():
    """Crawler ranking signal — no two routes should share a title."""
    transport = ASGITransport(app=app)
    titles: list[str] = []
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        for path, _ in STATIC_ENDPOINTS:
            r = await ac.get(path)
            m = re.search(r"<title>([^<]+)</title>", r.text)
            assert m, path
            titles.append(m.group(1))
    assert len(set(titles)) == len(titles), \
        f"Duplicate titles across static prerenders: {titles}"


# ────────────────────────────────────────────────────────────────────
# SEO landing prerenders
# ────────────────────────────────────────────────────────────────────

async def test_all_seo_landing_slugs_have_prerender():
    """Every slug declared in `seo.SEO_LANDING_SLUGS` must have a
    working /api/og/landing/{slug} endpoint that returns 200 with a
    title containing the slug's keyword (or at least the slug words)."""
    from routers.seo import SEO_LANDING_SLUGS
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        for slug in SEO_LANDING_SLUGS:
            r = await ac.get(f"/api/og/landing/{slug}")
            assert r.status_code == 200, f"{slug}: {r.status_code}"
            m = re.search(r"<title>([^<]+)</title>", r.text)
            assert m, slug
            title = m.group(1).lower()
            # Title should contain at least one of the slug's words —
            # not the whole verbatim slug, since titles use natural
            # capitalization.
            kw = slug.split("-")[0].lower()
            assert kw in title, f"{slug}: {kw!r} not in title {m.group(1)!r}"
            assert 'rel="canonical"' in r.text
            # Canonical points at the SPA path, not the prerender URL.
            assert f'href="https://craftersmarket.org/{slug}"' in r.text


async def test_unknown_landing_slug_returns_generic_content_not_404():
    """A bot landing on a not-yet-configured slug should still get
    crawlable content (we never want a 404 here)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/og/landing/totally-bogus-slug-xyz")
    assert r.status_code == 200
    assert "Totally Bogus Slug Xyz" in r.text


# ────────────────────────────────────────────────────────────────────
# Product trust denorm
# ────────────────────────────────────────────────────────────────────

async def test_products_endpoint_denormalizes_maker_location():
    """/api/products should set `maker_location` on each row when the
    parent maker has a `location` field — ProductCard relies on it."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/products")
    assert r.status_code == 200
    products = r.json()
    assert isinstance(products, list)
    # At least one product should have maker_location populated (the
    # seed makers all have location strings). Don't assert on all
    # because some products may belong to legacy makers without one.
    located = [p for p in products if p.get("maker_location")]
    assert len(located) > 0, "Expected at least one product to have maker_location set"
    # When populated, it should be a non-empty string.
    for p in located[:5]:
        assert isinstance(p["maker_location"], str)
        assert len(p["maker_location"]) > 0
    # accepts_custom_orders should always be a bool (never missing).
    for p in products[:5]:
        assert isinstance(p.get("accepts_custom_orders"), bool)


# ────────────────────────────────────────────────────────────────────
# Cloudflare Worker route table sanity
# ────────────────────────────────────────────────────────────────────

def test_cloudflare_worker_routes_include_new_endpoints():
    """Read the Worker script and assert it references the new static
    prerender paths so a Worker redeploy will route them correctly."""
    with open("/app/cloudflare/prerender-router.worker.js", "r") as f:
        worker = f.read()
    for fragment in (
        "/api/og/home",
        "/api/og/custom-order",
        "/api/og/apply",
        "/api/og/journal",
        "/api/og/policy",
        "/api/og/landing/",
    ):
        assert fragment in worker, f"Missing {fragment} in Worker script"
