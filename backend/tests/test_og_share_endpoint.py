"""Smoke test for the OG prerender endpoints that the maker
"⎘ Share link" button (in `ProductEditCard.jsx`) hands out.

These endpoints have to:
  • return 200 with a real `og:title` (so social crawlers unfurl correctly)
  • include a `<meta http-equiv="refresh">` pointing at the canonical
    `/shop/<slug>` page (so humans who click the share-link don't get
    stuck on the OG endpoint — they bounce to the real product)
  • include `og:image` (so the unfurl shows a thumbnail)

Hits the live local backend at http://localhost:8001 — same pattern
the other tests in this folder use.
"""
import re

import httpx
import pytest


BASE = "http://localhost:8001"


@pytest.mark.asyncio
async def test_og_product_returns_unfurl_and_redirects_humans():
    """Find a published product, hit the OG endpoint, assert prerender
    HTML has real metadata + a meta-refresh to /shop/<slug>."""
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
        listing_res = await client.get("/api/products?limit=1")
        if listing_res.status_code != 200:
            pytest.skip(f"can't list products: {listing_res.status_code}")
        body = listing_res.json()
        items = body if isinstance(body, list) else (body.get("items") or [])
        if not items:
            pytest.skip("no published products in test DB")
        slug = items[0].get("slug")
        assert slug, "first product has no slug"

        og_res = await client.get(f"/api/og/product/{slug}")
        assert og_res.status_code == 200, og_res.text[:300]
        html = og_res.text

    title_match = re.search(r'<meta property="og:title" content="([^"]+)"', html)
    assert title_match, "og:title meta tag missing"
    title_val = title_match.group(1)
    assert "Crafters Market" in title_val, f"og:title looks wrong: {title_val!r}"

    img_match = re.search(r'<meta property="og:image" content="([^"]+)"', html)
    assert img_match, "og:image meta tag missing"
    assert img_match.group(1).startswith("http"), \
        f"og:image should be absolute, got: {img_match.group(1)}"

    refresh = re.search(
        r'<meta http-equiv="refresh" content="0;\s*url=([^"]+)"', html,
    )
    assert refresh, "meta-refresh missing — humans would get stuck on the raw OG page"
    refresh_target = refresh.group(1)
    assert refresh_target.endswith(f"/shop/{slug}"), \
        f"refresh should target /shop/{slug}, got {refresh_target}"
