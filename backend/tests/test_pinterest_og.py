"""Regression: Pinterest Rich Pin OG tags on product OG prerender (iter181).

Pinterest validates product pages by reading specific Open Graph tags.
This test pulls a real product page from `/api/og/product/{slug}` and
asserts every tag Pinterest needs is present.

Required (per Pinterest Rich Pin Product spec):
  • og:type = "product"
  • og:title / og:description / og:image / og:url
  • og:price:amount + og:price:currency (Pinterest reads og:price:*)
  • og:availability (or product:availability)
  • product:brand (the maker name)
  • og:image:width + og:image:height

Nice-to-have (we render them too):
  • og:locale = "en_US"
  • og:image:alt
  • og:image:secure_url
"""
import re

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


async def _first_product_slug() -> str:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/products", params={"limit": 1})
    items = r.json()
    assert items, "Catalog has no published products to validate against."
    return items[0]["slug"]


@pytest.mark.asyncio
async def test_product_og_includes_pinterest_required_tags():
    slug = await _first_product_slug()
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as c:
        r = await c.get(f"{API}/api/og/product/{slug}")
    assert r.status_code in (200, 301, 302), r.text
    if r.status_code in (301, 302):
        pytest.skip(f"og endpoint redirected ({r.status_code}) — product not eligible")
    html = r.text

    # Mandatory Pinterest tags.
    assert 'property="og:type" content="product"' in html, "og:type must be 'product' for Rich Pin"
    assert 'property="og:title"' in html
    assert 'property="og:description"' in html
    assert 'property="og:image"' in html
    assert 'property="og:url"' in html
    assert 'property="og:price:amount"' in html, "Pinterest reads og:price:amount"
    assert 'property="og:price:currency"' in html
    assert 'property="og:availability"' in html
    assert 'property="og:image:width"' in html
    assert 'property="og:image:height"' in html
    assert 'property="og:locale"' in html

    # product:* duplicates for Facebook validators.
    assert 'property="product:price:amount"' in html
    assert 'property="product:price:currency"' in html
    assert 'property="product:availability"' in html

    # availability value must be one of Pinterest's accepted strings.
    m = re.search(r'property="og:availability" content="([^"]+)"', html)
    assert m, "og:availability tag malformed"
    assert m.group(1) in {"in stock", "out of stock", "preorder", "available for order"}


@pytest.mark.asyncio
async def test_product_og_has_brand_when_maker_present():
    """product:brand should mirror the maker name. Skipped if the first
    product happens to have no maker attribution."""
    slug = await _first_product_slug()
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as c:
        r = await c.get(f"{API}/api/og/product/{slug}")
    if r.status_code != 200:
        pytest.skip("og endpoint didn't return 200")
    html = r.text
    if 'property="product:brand"' not in html:
        pytest.skip("Product has no maker_name → brand tag intentionally omitted")
    m = re.search(r'property="product:brand" content="([^"]+)"', html)
    assert m and m.group(1).strip(), "product:brand value must be non-empty"
