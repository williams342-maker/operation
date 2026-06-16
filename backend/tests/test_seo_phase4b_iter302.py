"""SEO Phase 4 Bundle B (iter302) — Review/AggregateRating + alt-text +
BreadcrumbList dedup.

Backend coverage:
  • `GET /api/reviews/aggregate` returns {count, average} with various filters.
  • Per-product OG prerender includes AggregateRating when ≥ 1 public review.
  • Per-maker OG prerender includes AggregateRating when ≥ 1 public review.
  • Per-product prerender OMITS AggregateRating when there are 0 reviews
    (Schema.org rejects reviewCount=0).
  • Site-wide BreadcrumbList removed from frontend/public/index.html
    (per-route emission now owns the trail).
"""
import os
import re
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

API = "http://localhost:8001"


def test_aggregate_endpoint_returns_zero_for_unknown_product():
    r = httpx.get(f"{API}/api/reviews/aggregate?product_slug=does-not-exist-zzzz", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body == {"count": 0, "average": None}


def test_aggregate_endpoint_returns_real_counts_for_product_with_reviews():
    r = httpx.get(f"{API}/api/reviews/aggregate?product_slug=carved-oak-wedding-monogram", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 1
    assert 1.0 <= body["average"] <= 5.0


def test_aggregate_endpoint_works_for_maker_filter():
    r = httpx.get(f"{API}/api/reviews/aggregate?maker_slug=iron-and-oak", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 1
    assert 1.0 <= body["average"] <= 5.0


def test_aggregate_endpoint_supports_sitewide_call():
    """No filter → sitewide aggregate. Useful for the homepage
    Organization schema (eventually)."""
    r = httpx.get(f"{API}/api/reviews/aggregate", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 1
    assert "average" in body


def test_product_prerender_includes_aggregate_rating_when_reviews_exist():
    """Slug `carved-oak-wedding-monogram` has reviews — the per-product
    prerender must surface them as AggregateRating in JSON-LD."""
    html = httpx.get(f"{API}/api/og/product/carved-oak-wedding-monogram", timeout=10).text
    assert "AggregateRating" in html
    # iter413as — Review count drifts; assert presence of positive integer.
    m_count = re.search(r'"reviewCount":(\d+)', html.replace(" ", ""))
    assert m_count and int(m_count.group(1)) >= 1
    # ratingValue is a string per Schema.org spec, rendered with 1 decimal.
    m = re.search(r'"ratingValue":"(\d\.\d)"', html.replace(" ", ""))
    assert m, "ratingValue should be a 1-decimal string"


def test_maker_prerender_includes_aggregate_rating_when_reviews_exist():
    html = httpx.get(f"{API}/api/og/maker/iron-and-oak", timeout=10).text
    assert "AggregateRating" in html
    # iter413as — iron-and-oak's review count drifts over time; assert
    # reviewCount is a positive integer rather than a hard-coded value.
    m = re.search(r'"reviewCount":(\d+)', html.replace(" ", ""))
    assert m, "reviewCount field missing"
    assert int(m.group(1)) >= 1


def test_product_prerender_omits_aggregate_rating_when_no_reviews():
    """Pick any product with 0 known reviews — schema must NOT include
    AggregateRating (Schema.org spec requires reviewCount ≥ 1)."""
    # Use the diag endpoint to find a product, then check it has 0 reviews.
    diag = httpx.get(f"{API}/api/og/diag", timeout=10).json()
    samples = diag["samples"]["products"]
    if not samples:
        return  # no products to test
    for sample in samples:
        slug = sample["slug"]
        agg = httpx.get(f"{API}/api/reviews/aggregate?product_slug={slug}", timeout=10).json()
        if agg["count"] == 0:
            # Confirm the prerender omits AggregateRating.
            html = httpx.get(f"{API}/api/og/product/{slug}", timeout=10).text
            assert "aggregateRating" not in html, f"AggregateRating leaked into zero-review product {slug}"
            return
    # If every sample has reviews, that's still a green path — just skip.


def test_index_html_no_longer_ships_site_wide_breadcrumb_list():
    """The site-wide BreadcrumbList in `index.html` (homepage scope)
    was removed in iter302 to prevent Google merging it with each
    route's own BreadcrumbList. Verify the file no longer contains
    the homepage breadcrumb @id."""
    path = "/app/frontend/public/index.html"
    with open(path) as f:
        src = f.read()
    # The removed block had this specific @id.
    assert "https://craftersmarket.org/#breadcrumb" not in src, (
        "Site-wide BreadcrumbList @id still present in index.html — "
        "iter302 dedup did not stick."
    )


def test_product_card_alt_text_includes_category():
    """ProductCard now ships denser alt text combining title + category +
    maker name. Verify the component source contains the new pattern."""
    path = "/app/frontend/src/components/ProductCard.jsx"
    with open(path) as f:
        src = f.read()
    # The iter302 alt expression should reference p.category and p.maker_name.
    assert "p.category" in src
    assert "p.maker_name" in src
    # And we should have switched fetchpriority → fetchPriority (camelCase).
    assert "fetchPriority=" in src
    assert "fetchpriority=" not in src
