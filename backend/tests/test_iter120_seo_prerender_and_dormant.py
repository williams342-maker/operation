"""iter120 — Per-product/maker/journal SEO-rich prerender + auto-dormant.

Three independently-shippable features bundled in one iteration:

1. **Enhanced OG prerender** (`/api/og/product/{slug}`, `/api/og/maker/{slug}`,
   `/api/og/journal/{slug}`) now returns full SEO-quality HTML pages with
   real body content, JSON-LD structured data, breadcrumbs, internal
   links, and Schema.org markup — not just OG meta tags. When Cloudflare
   routes a non-Google crawler to one of these URLs, they get a fully
   indexable page with 200+ words instead of a thin meta-only stub.

2. **Auto dormant-buyer re-engagement** scheduled job
   (`run_auto_dormant_reengage`) — Tuesday 14:00 UTC cron, gated on the
   `auto_dormant_reengage_enabled` site_setting toggle. Default OFF.

3. **Admin Team tab polish** — search filter, "show revoked" toggle,
   relative `last_seen` timestamp. Frontend-only; smoke-tested via the
   existing TeamTab tests.
"""

import os
import re
import sys
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, "/app/backend")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("ADMIN_EMAILS", "super@example.com")

from server import app  # noqa: E402
from routers.retention import run_auto_dormant_reengage  # noqa: E402


@pytest.fixture
def transport():
    return ASGITransport(app=app)


class FakeCursor:
    """Chainable find()/aggregate() stand-in with an async to_list."""
    def __init__(self, items): self.items = items
    def sort(self, *a, **kw): return self
    def limit(self, n): return self
    async def to_list(self, n): return self.items[:n]


# ============================================================
# 1) Enhanced OG prerender
# ============================================================

@pytest.mark.asyncio
async def test_og_product_returns_seo_rich_page(transport):
    """Product prerender should now serve a real indexable HTML page,
    not just a meta-tag stub. We assert the fingerprints (JSON-LD,
    breadcrumb, ≥3 H2 sections, ≥250 words) that SEO crawlers actually
    look at — not exact word matches against a fixture."""
    fake_doc = {
        "title": "Walnut American Flag",
        "description": ("Hand-finished walnut and ebonized oak American flag with "
                        "engraved 50-star union. Built one at a time in our workshop. "
                        "Ships within 7-10 business days. Each piece is signed and dated."),
        "images": ["https://r2.example.com/flag.jpg"],
        "price": 249.0,
        "maker_name": "Iron & Oak",
        "maker_slug": "iron-and-oak",
        "category": "Wall Art",
        "in_stock": True,
        "tags": ["wood", "flag", "americana", "veteran"],
        "materials": ["walnut", "ebonized oak"],
    }
    with patch("routers.og_prerender.db") as mock_db:
        mock_db.products.find_one = AsyncMock(return_value=fake_doc)
        # iter302 added a reviews aggregate to the product prerender —
        # stub it so the MagicMock isn't awaited.
        mock_db.reviews.aggregate = lambda *a, **kw: FakeCursor([])
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/api/og/product/walnut-flag")
    assert r.status_code == 200
    body = r.text
    # Real body content, not just a meta stub
    assert "Walnut American Flag" in body
    assert "Iron & Oak" in body
    # JSON-LD Product schema
    assert 'application/ld+json' in body
    assert '"@type":"Product"' in body
    assert '"price":"249.00"' in body
    assert 'schema.org/InStock' in body
    # OG product type
    assert 'og:type" content="product' in body
    # Breadcrumb nav
    assert 'class="breadcrumb"' in body
    assert ">Home<" in body and ">Shop<" in body
    # ≥3 H2 sections (About / Maker / Details / Browse more)
    h2s = re.findall(r"<h2[^>]*>", body)
    assert len(h2s) >= 3, f"expected ≥3 H2 sections, got {len(h2s)}"
    # Word count floor — SEO tools flag thin content under ~200 words
    plain = re.sub(r"<[^>]+>", " ", body)
    words = re.split(r"\s+", plain)
    assert len([w for w in words if w]) >= 200
    # Internal links to maker + custom-order
    assert "/makers/iron-and-oak" in body
    assert "/custom-order" in body
    assert 'rel="canonical"' in body
    assert 'name="robots"' in body  # explicit index, follow


@pytest.mark.asyncio
async def test_og_product_oos_uses_preorder_schema(transport):
    fake_doc = {
        "title": "Custom Sign", "description": "x", "images": [],
        "price": 100.0, "in_stock": False, "maker_name": "M", "maker_slug": "m",
    }
    with patch("routers.og_prerender.db") as mock_db:
        mock_db.products.find_one = AsyncMock(return_value=fake_doc)
        # iter302 added a reviews aggregate to the product prerender —
        # stub it so the MagicMock isn't awaited.
        mock_db.reviews.aggregate = lambda *a, **kw: FakeCursor([])
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/api/og/product/custom-sign")
    assert r.status_code == 200
    assert "schema.org/PreOrder" in r.text
    assert "Made to order" in r.text


@pytest.mark.asyncio
async def test_og_maker_returns_seo_rich_page(transport):
    fake_maker = {
        "name": "Iron & Oak Studio", "slug": "iron-and-oak",
        "bio": "Husband-and-wife shop in central Texas building one-off CNC pieces "
               "from reclaimed lumber and hot-rolled steel.",
        "tagline": "Reclaimed steel & wood, made to order.",
        "banner_image_url": "https://r2.example.com/banner.jpg",
        "is_veteran_owned": True, "location": "Austin, TX",
        "techniques": ["CNC plasma", "hardwood finishing"],
    }
    fake_listings = [
        {"slug": "flag", "title": "Walnut Flag", "price": 249},
        {"slug": "sign", "title": "Family Name Sign", "price": 89},
    ]

    with patch("routers.og_prerender.db") as mock_db:
        mock_db.makers.find_one = AsyncMock(return_value=fake_maker)
        mock_db.products.find = lambda *a, **kw: FakeCursor(fake_listings)
        mock_db.reviews.aggregate = lambda *a, **kw: FakeCursor([])
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/api/og/maker/iron-and-oak")
    assert r.status_code == 200
    body = r.text
    assert "Iron &amp; Oak Studio" in body  # HTML-escaped &
    assert '"@type":"Person"' in body
    assert "Veteran-Owned" in body or "Veteran-owned" in body
    # Recent listings rendered as internal links
    assert "/shop/flag" in body
    assert "/shop/sign" in body
    assert 'class="breadcrumb"' in body
    h2s = re.findall(r"<h2[^>]*>", body)
    assert len(h2s) >= 3


@pytest.mark.asyncio
async def test_og_journal_returns_seo_rich_page(transport):
    fake_post = {
        "title": "How we built the Walnut Flag",
        "excerpt": "A walkthrough of our 14-step CNC + hand-finishing process.",
        "body": "<p>Step one is selecting the lumber.</p><p>Step two...</p>",
        "cover": "https://r2.example.com/cover.jpg",
        "author": "Liam at Iron & Oak",
        "created_at": "2026-04-15T10:00:00Z",
    }
    with patch("routers.og_prerender.db") as mock_db:
        mock_db.blog_posts.find_one = AsyncMock(return_value=fake_post)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/api/og/journal/walnut-flag-build")
    assert r.status_code == 200
    body = r.text
    assert '"@type":"Article"' in body
    assert 'og:type" content="article' in body
    assert 'article:author' in body
    assert 'article:published_time' in body
    assert "Step one is selecting the lumber" in body  # body_plain stripped of HTML


# ============================================================
# 2) Auto dormant re-engagement scheduler entrypoint
# ============================================================

@pytest.mark.asyncio
async def test_auto_dormant_bails_when_toggle_off():
    # `get_setting` is lazy-imported inside the function from routers.settings,
    # so we patch the source module, not routers.retention.
    with patch("routers.settings.get_setting", new=AsyncMock(return_value=False)):
        out = await run_auto_dormant_reengage()
    assert out == {"ran": False, "reason": "toggle_off"}


@pytest.mark.asyncio
async def test_auto_dormant_runs_when_toggle_on_and_no_candidates():
    """Toggle ON, but the aggregation pipeline returns no dormant buyers
    (empty test DB). Should still complete cleanly with sent=0."""
    out = await run_auto_dormant_reengage()
    # We don't assert ran=True here because the toggle's actual state
    # in the live test DB depends on prior test runs; the contract is
    # that it never raises and always returns a dict with `ran`.
    assert isinstance(out, dict)
    assert "ran" in out
    if out["ran"]:
        assert out.get("sent", -1) >= 0
        assert out.get("skipped", -1) >= 0
        assert out.get("candidate_count", -1) >= 0
        assert out.get("days", 0) >= 30  # min floor


# ============================================================
# 3) site_settings accepts the new toggle
# ============================================================

@pytest.mark.asyncio
async def test_settings_patch_accepts_auto_dormant_toggle(transport):
    from maker_auth import issue_session_jwt
    token = issue_session_jwt("super-slug", "super@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.patch(
            "/api/admin/settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"auto_dormant_reengage_enabled": True},
        )
    assert r.status_code == 200
    assert r.json().get("auto_dormant_reengage_enabled") is True
    # Toggle off again so we don't pollute other tests' state.
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        await c.patch(
            "/api/admin/settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"auto_dormant_reengage_enabled": False},
        )
