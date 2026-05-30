"""SEO Phase-1 (iter298) — index-page prerender + BreadcrumbList tests.

Verifies:
  • `/api/og/shop` returns CollectionPage + ItemList + BreadcrumbList JSON-LD,
    plus an indexable HTML grid of latest listings.
  • `/api/og/makers` returns CollectionPage + ItemList + BreadcrumbList JSON-LD,
    plus an indexable HTML list of all vetted makers.
  • Per-product prerender now ships BreadcrumbList alongside Product+Offer.
  • Per-maker prerender now ships BreadcrumbList alongside Person.
  • `/api/og/diag` lists the new index URLs.

Live HTTP tests against the running backend on :8001. Each test is
independent, no DB seeding, no shared event loop — runs cleanly even
when the global pytest suite has loop pollution.
"""
import os
import re
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

API = "http://localhost:8001"


def _types(html: str) -> set[str]:
    """Pull every `"@type":"X"` from the JSON-LD blocks."""
    return set(re.findall(r'"@type":"([^"]+)"', html))


def test_og_shop_index_returns_full_schema_graph():
    r = httpx.get(f"{API}/api/og/shop", timeout=10)
    assert r.status_code == 200, r.text
    body = r.text
    # Title + description include exact-match keywords for SEO scan.
    assert "Metal Signs" in body
    assert "CNC Wood Signs" in body
    # Canonical points to the SPA `/shop`, NOT `/api/og/shop`.
    assert 'rel="canonical" href="https://craftersmarket.org/shop"' in body
    # Schema graph
    ts = _types(body)
    assert "CollectionPage" in ts
    assert "ItemList" in ts
    assert "BreadcrumbList" in ts
    # Real-browser fallback present so humans hitting the prerender bounce.
    assert 'http-equiv="refresh"' in body


def test_og_makers_index_returns_full_schema_graph():
    r = httpx.get(f"{API}/api/og/makers", timeout=10)
    assert r.status_code == 200, r.text
    body = r.text
    assert "Meet the Makers" in body
    assert 'rel="canonical" href="https://craftersmarket.org/makers"' in body
    ts = _types(body)
    assert "CollectionPage" in ts
    assert "ItemList" in ts
    assert "BreadcrumbList" in ts


def test_og_product_has_breadcrumb_added():
    """The per-product prerender used to ship only Product+Offer. iter298
    adds BreadcrumbList so SERPs show the trail under each result."""
    diag = httpx.get(f"{API}/api/og/diag", timeout=10).json()
    samples = diag["samples"]["products"]
    if not samples:
        # No published products in the DB — skip rather than fail.
        return
    slug = samples[0]["slug"]
    r = httpx.get(f"{API}/api/og/product/{slug}", timeout=10)
    assert r.status_code == 200
    ts = _types(r.text)
    assert "Product" in ts
    assert "Offer" in ts
    assert "BreadcrumbList" in ts  # NEW in iter298


def test_og_maker_has_breadcrumb_added():
    diag = httpx.get(f"{API}/api/og/diag", timeout=10).json()
    samples = diag["samples"]["makers"]
    if not samples:
        return
    slug = samples[0]["slug"]
    r = httpx.get(f"{API}/api/og/maker/{slug}", timeout=10)
    assert r.status_code == 200
    ts = _types(r.text)
    assert "Person" in ts
    assert "BreadcrumbList" in ts  # NEW in iter298


def test_og_diag_lists_new_index_urls():
    """The diagnostics endpoint surfaces the new `/api/og/shop` and
    `/api/og/makers` prerenders so an operator can verify post-deploy
    without leaving the admin dashboard."""
    r = httpx.get(f"{API}/api/og/diag", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "indexes" in body
    assert body["indexes"]["shop"]["og_url"].endswith("/api/og/shop")
    assert body["indexes"]["shop"]["spa_url"].endswith("/shop")
    assert body["indexes"]["makers"]["og_url"].endswith("/api/og/makers")
    assert body["indexes"]["makers"]["spa_url"].endswith("/makers")
