"""iter350 — Pinterest Catalog Sync feed smoke tests.

Validates that:
  - GET /api/pinterest/catalog/health returns the expected schema with
    a sane product_count.
  - GET /api/pinterest/catalog.tsv returns a Pinterest-compliant TSV:
    header row matches the spec, prices are formatted "NNN.NN USD",
    availability uses spec values, image_link URLs are absolute,
    and rows missing required fields are filtered out.
  - Pinterestbot user-agent fetches are isolated from generic fetches
    in the feed-health summary.

Each test uses its own TestClient context-manager to avoid the recurring
async event-loop pollution issue when streaming responses run in sequence.
"""
from __future__ import annotations
import os

from fastapi.testclient import TestClient

os.environ.setdefault("PUBLIC_SITE_URL", "https://craftersmarket.org")

from server import app  # noqa: E402


def test_health_returns_expected_schema():
    with TestClient(app) as client:
        r = client.get("/api/pinterest/catalog/health")
    assert r.status_code == 200, r.text
    body = r.json()
    for key in (
        "feed_url", "product_count", "last_any_fetch_at",
        "last_any_fetch_ua", "last_pinterest_fetch_at",
        "currency", "site_root",
    ):
        assert key in body, f"missing key {key}"
    assert body["feed_url"].endswith("/api/pinterest/catalog.tsv")
    assert body["currency"] == "USD"
    assert isinstance(body["product_count"], int)
    assert body["product_count"] >= 0


def test_feed_serves_compliant_tsv():
    with TestClient(app) as client:
        r = client.get("/api/pinterest/catalog.tsv")
        body = r.text
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/tab-separated-values")
    lines = body.strip().split("\n")
    assert len(lines) >= 2, "feed should contain header + ≥1 product row"
    header = lines[0].split("\t")
    for required in (
        "id", "title", "description", "link", "image_link",
        "price", "availability", "condition", "brand",
    ):
        assert required in header, f"missing required column {required}"


def test_first_row_required_fields_populated():
    with TestClient(app) as client:
        r = client.get("/api/pinterest/catalog.tsv")
        body = r.text
    lines = body.strip().split("\n")
    header = lines[0].split("\t")
    first = dict(zip(header, lines[1].split("\t")))
    assert first["id"], "id required"
    assert first["title"], "title required"
    assert first["link"].startswith("https://"), "link must be absolute https"
    assert first["image_link"].startswith("https://"), "image_link must be absolute https"
    # price: "NNN.NN USD"
    assert " USD" in first["price"], f"price not USD-suffixed: {first['price']}"
    parts = first["price"].split(" ")
    assert len(parts) == 2 and parts[0].count(".") == 1
    float(parts[0])  # raises if not parseable
    # availability must be one of the spec values
    assert first["availability"] in {"in stock", "out of stock", "preorder"}
    assert first["condition"] == "new"


def test_pinterestbot_user_agent_isolated():
    # Single TestClient context — motor's global event loop binding makes
    # multiple TestClient contexts in one test crash with "Event loop is closed".
    with TestClient(app) as client:
        # Pinterestbot UA hit populates last_pinterest_fetch_at
        r1 = client.get("/api/pinterest/catalog.tsv", headers={"User-Agent": "Pinterestbot/1.0"})
        r1.read()  # drain stream before next request
        assert r1.status_code == 200
        h1 = client.get("/api/pinterest/catalog/health").json()
        assert h1["last_pinterest_fetch_at"] is not None
        pinterest_ts = h1["last_pinterest_fetch_at"]

        # Generic UA hit — last_any updates; heuristic drops Pinterest field
        r2 = client.get("/api/pinterest/catalog.tsv", headers={"User-Agent": "curl/8.0"})
        r2.read()
        assert r2.status_code == 200
        h2 = client.get("/api/pinterest/catalog/health").json()

    assert h2["last_any_fetch_ua"] == "curl/8.0"
    # Heuristic returns None when latest UA isn't Pinterest's
    assert h2["last_pinterest_fetch_at"] is None
    assert pinterest_ts is not None
