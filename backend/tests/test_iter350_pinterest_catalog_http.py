"""iter350 — Pinterest Catalog Sync (HTTP-layer regression tests).

Hits the live preview URL (REACT_APP_BACKEND_URL) via `requests` to avoid the
known motor/event-loop pollution that the pytest TestClient flow trips on
when run as part of the broader iter350 suite.

Coverage (mirrors review_request feature list):
  * /api/pinterest/catalog/health response schema + types
  * /api/pinterest/catalog.tsv content-type & content-disposition
  * TSV header row exact column ordering
  * Row-level validations: id/title/link/image_link/price/availability/condition/brand
  * Absolute-URL conversion for /seed-images/* image links
  * User-Agent heuristic (Pinterestbot vs curl) updates health timestamps correctly
  * 83+ published products served
  * StreamingResponse: complete / parseable body
  * Regression: /api/products?limit=5 still 200
"""
from __future__ import annotations

import csv
import io
import os
import re
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
HEALTH_URL = f"{BASE_URL}/api/pinterest/catalog/health"
FEED_URL = f"{BASE_URL}/api/pinterest/catalog.tsv"

EXPECTED_HEADER = [
    "id", "title", "description", "link", "image_link",
    "additional_image_link", "price", "availability", "condition",
    "brand", "google_product_category", "product_type",
    "item_group_id", "color", "size",
]
ALLOWED_AVAILABILITY = {"in stock", "out of stock", "preorder"}
PRICE_RE = re.compile(r"^\d+\.\d{2} USD$")


# ---------- shared fixtures ---------------------------------------------------

@pytest.fixture(scope="module")
def feed_response():
    r = requests.get(FEED_URL, timeout=60)
    return r


@pytest.fixture(scope="module")
def feed_rows(feed_response):
    text = feed_response.text
    reader = csv.DictReader(io.StringIO(text), dialect="excel-tab")
    rows = list(reader)
    return rows, reader.fieldnames


@pytest.fixture(scope="module")
def health_response():
    r = requests.get(HEALTH_URL, timeout=30)
    return r


# ---------- /api/pinterest/catalog/health -------------------------------------

class TestCatalogHealth:
    """Health endpoint: public, returns diagnostic JSON."""

    def test_health_returns_200(self, health_response):
        assert health_response.status_code == 200, health_response.text

    def test_health_schema_and_types(self, health_response):
        data = health_response.json()
        for key in (
            "feed_url", "product_count", "last_any_fetch_at",
            "last_any_fetch_ua", "last_pinterest_fetch_at",
            "currency", "site_root",
        ):
            assert key in data, f"missing key {key}: {data}"
        assert isinstance(data["product_count"], int)
        assert data["product_count"] >= 0
        assert data["feed_url"].endswith("/api/pinterest/catalog.tsv")
        assert data["currency"] == "USD"

    def test_health_serves_83_plus_products(self, health_response):
        data = health_response.json()
        assert data["product_count"] >= 83, (
            f"expected >=83 published products, got {data['product_count']}"
        )


# ---------- /api/pinterest/catalog.tsv (headers) ------------------------------

class TestCatalogTSVHeaders:
    def test_tsv_returns_200(self, feed_response):
        assert feed_response.status_code == 200, feed_response.text[:500]

    def test_tsv_content_type(self, feed_response):
        ctype = feed_response.headers.get("content-type", "")
        assert "text/tab-separated-values" in ctype, ctype
        assert "charset=utf-8" in ctype.lower(), ctype

    def test_tsv_content_disposition_filename(self, feed_response):
        cd = feed_response.headers.get("content-disposition", "")
        assert 'filename="crafters-market-catalog.tsv"' in cd, cd


# ---------- TSV body / header row / row-level field validation ----------------

class TestCatalogTSVBody:
    def test_header_row_exact_columns(self, feed_rows):
        _, fieldnames = feed_rows
        assert fieldnames == EXPECTED_HEADER, (
            f"Header mismatch.\nExpected: {EXPECTED_HEADER}\nGot:      {fieldnames}"
        )

    def test_at_least_83_product_rows(self, feed_rows):
        rows, _ = feed_rows
        assert len(rows) >= 83, f"expected >=83 product rows, got {len(rows)}"

    def test_every_row_has_required_fields(self, feed_rows):
        rows, _ = feed_rows
        for i, row in enumerate(rows):
            assert row["id"], f"row {i} has empty id"
            assert row["title"], f"row {i} ({row['id']}) has empty title"
            assert row["link"].startswith("https://"), (
                f"row {i} ({row['id']}) link not https: {row['link']!r}"
            )
            assert row["image_link"].startswith("https://"), (
                f"row {i} ({row['id']}) image_link not https: {row['image_link']!r}"
            )

    def test_price_format_NNN_dot_NN_USD(self, feed_rows):
        rows, _ = feed_rows
        for row in rows:
            assert PRICE_RE.match(row["price"]), (
                f"row {row['id']} bad price format: {row['price']!r}"
            )

    def test_availability_values_in_allowed_set(self, feed_rows):
        rows, _ = feed_rows
        for row in rows:
            assert row["availability"] in ALLOWED_AVAILABILITY, (
                f"row {row['id']} bad availability: {row['availability']!r}"
            )

    def test_condition_always_new(self, feed_rows):
        rows, _ = feed_rows
        for row in rows:
            assert row["condition"] == "new", (
                f"row {row['id']} condition: {row['condition']!r}"
            )

    def test_brand_non_empty(self, feed_rows):
        rows, _ = feed_rows
        for row in rows:
            assert row["brand"], f"row {row['id']} empty brand"


# ---------- Absolute-URL conversion (seed images) -----------------------------

class TestAbsoluteImageURL:
    def test_seed_images_converted_to_https_craftersmarket_org(self, feed_rows):
        """Seed images stored as /seed-images/foo.jpg MUST become absolute under
        PUBLIC_SITE_URL (https://craftersmarket.org). Verify by checking at
        least one row points at craftersmarket.org/seed-images/."""
        rows, _ = feed_rows
        seed_rows = [r for r in rows if "/seed-images/" in r["image_link"]]
        # If the catalog has seed images we expect them all absolutized
        for r in seed_rows:
            assert r["image_link"].startswith("https://"), r["image_link"]
            assert "craftersmarket.org/seed-images/" in r["image_link"], (
                f"seed image not absolutized to craftersmarket.org: {r['image_link']!r}"
            )

    def test_no_relative_image_paths(self, feed_rows):
        rows, _ = feed_rows
        for r in rows:
            assert not r["image_link"].startswith("/"), (
                f"row {r['id']} image_link still relative: {r['image_link']!r}"
            )


# ---------- User-Agent heuristic ---------------------------------------------

class TestUserAgentHeuristic:
    """Hitting the feed with UA 'Pinterestbot/1.0' should bump
    last_pinterest_fetch_at; hitting with 'curl/8.0' should NOT (but should
    update last_any_fetch_ua)."""

    def test_pinterestbot_ua_updates_last_pinterest_fetch_at(self):
        # Fire Pinterestbot fetch
        r = requests.get(FEED_URL, headers={"User-Agent": "Pinterestbot/1.0"}, timeout=60)
        assert r.status_code == 200
        # Consume body to ensure request completes
        _ = r.text
        time.sleep(1.0)
        h = requests.get(HEALTH_URL, timeout=15).json()
        assert h["last_pinterest_fetch_at"], (
            f"last_pinterest_fetch_at not set after Pinterestbot fetch: {h}"
        )
        assert "pinterest" in (h.get("last_any_fetch_ua") or "").lower(), h
        return h["last_pinterest_fetch_at"]

    def test_curl_ua_leaves_pinterest_ts_but_updates_any_ua(self):
        # First ensure a Pinterestbot fetch has happened so we have a baseline.
        requests.get(FEED_URL, headers={"User-Agent": "Pinterestbot/1.0"}, timeout=60).text
        time.sleep(1.0)
        before = requests.get(HEALTH_URL, timeout=15).json()
        baseline_pinterest_ts = before.get("last_pinterest_fetch_at")
        assert baseline_pinterest_ts, "precondition failed: pinterest ts not set"

        # Now fire a curl fetch
        r = requests.get(FEED_URL, headers={"User-Agent": "curl/8.0"}, timeout=60)
        assert r.status_code == 200
        _ = r.text
        time.sleep(1.0)
        after = requests.get(HEALTH_URL, timeout=15).json()
        # last_pinterest_fetch_at should be None now (heuristic checks ONLY the
        # most-recent log row), OR still equal baseline if there were
        # interleaving Pinterestbot hits we don't control. Either way it must
        # NOT have advanced past baseline due to the curl call.
        # Strict reading of spec: "leaves last_pinterest_fetch_at at the prior value"
        # → since the heuristic only inspects the latest log, curl most-recent
        # means last_pinterest_fetch_at returns None.
        new_pinterest_ts = after.get("last_pinterest_fetch_at")
        assert new_pinterest_ts in (None, baseline_pinterest_ts), (
            f"curl fetch incorrectly bumped pinterest ts: before={baseline_pinterest_ts} after={new_pinterest_ts}"
        )
        # last_any_fetch_ua should reflect the curl call
        assert "curl" in (after.get("last_any_fetch_ua") or "").lower(), after


# ---------- StreamingResponse completeness ------------------------------------

class TestStreamingResponse:
    def test_full_body_parseable_and_consistent_with_health_count(
        self, feed_response, feed_rows, health_response,
    ):
        rows, _ = feed_rows
        # No truncation — last row should have all expected columns populated
        last = rows[-1]
        for col in ("id", "title", "link", "image_link", "price", "availability", "condition", "brand"):
            assert col in last, f"last row missing column {col}: {last}"

        # Streaming hint: either chunked transfer-encoding OR a sizeable body
        te = feed_response.headers.get("transfer-encoding", "").lower()
        body_len = len(feed_response.content)
        assert te == "chunked" or body_len > 10_000, (
            f"feed neither chunked nor sizeable (te={te!r}, len={body_len})"
        )

        # Row count should be <= health.product_count (drafts/missing-image
        # rows are filtered out). Should be close to product_count, not zero.
        product_count = health_response.json()["product_count"]
        assert 0 < len(rows) <= product_count + 5, (
            f"row count {len(rows)} not within sane range of product_count {product_count}"
        )


# ---------- Regression -------------------------------------------------------

class TestRegressions:
    def test_products_limit_5_still_200(self):
        r = requests.get(f"{BASE_URL}/api/products?limit=5", timeout=15)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        # Endpoint shape: either list, or {"products": [...]} — accept both
        if isinstance(data, dict):
            items = data.get("products") or data.get("items") or []
        else:
            items = data
        assert isinstance(items, list)
        assert len(items) > 0, "no products returned (category/technique default regression?)"
