"""Regression: EnrichLabs read-only API (iter258).

Covers auth, schema endpoint, and basic shape of each data endpoint.
Runs against the live backend on REACT_APP_BACKEND_URL.
"""
import os

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

KEY = os.environ.get("ENRICHLABS_API_KEY", "")
HDR = {"X-EnrichLabs-Key": KEY}


@pytest.mark.asyncio
async def test_requires_api_key():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/enrich/v1/schema")
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_wrong_key_rejected():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{API}/api/enrich/v1/schema",
            headers={"X-EnrichLabs-Key": "obviously-not-the-key"},
        )
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_schema_endpoint():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/enrich/v1/schema", headers=HDR)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == "1.0"
    assert body["auth"]["header"] == "X-EnrichLabs-Key"
    paths = {ep["path"] for ep in body["endpoints"]}
    assert {"/orders", "/sellers", "/listings", "/funnel", "/traffic", "/schema"} <= paths


@pytest.mark.asyncio
async def test_orders_shape_and_anonymized():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/enrich/v1/orders?limit=10", headers=HDR)
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"rows", "count", "next_cursor"} <= set(body)
    for row in body["rows"]:
        # No PII: never expose buyer email/name in raw form
        assert "customer_email" not in row
        assert "buyer_email" not in row
        # required surface
        assert {"id", "created_at", "amount", "currency", "buyer_hash",
                "maker_slugs", "items"} <= set(row)
        assert isinstance(row["maker_slugs"], list)
        assert isinstance(row["items"], list)


@pytest.mark.asyncio
async def test_orders_invalid_since_400():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/enrich/v1/orders?since=not-a-date", headers=HDR)
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_sellers_shape():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/enrich/v1/sellers?limit=5", headers=HDR)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "rows" in body and "count" in body
    for row in body["rows"]:
        assert "email" not in row  # PII guard
        assert {"slug", "tier", "gross_revenue", "paid_orders_count",
                "listings_count", "shop_open", "email_hash"} <= set(row)
        assert row["tier"] in ("plus", "free")


@pytest.mark.asyncio
async def test_listings_shape():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/enrich/v1/listings?limit=5", headers=HDR)
    assert r.status_code == 200, r.text
    body = r.json()
    for row in body["rows"]:
        assert {"id", "title", "price", "maker_slug", "status",
                "in_stock", "currency"} <= set(row)


@pytest.mark.asyncio
async def test_funnel_shape():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/enrich/v1/funnel?days=30", headers=HDR)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["window_days"] == 30
    keys = {s["key"] for s in body["stages"]}
    assert {"applied", "approved", "first_listing", "first_sale", "plus_upgrade"} <= keys


@pytest.mark.asyncio
async def test_traffic_shape():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/enrich/v1/traffic?days=7", headers=HDR)
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"window_days", "since", "totals", "daily", "by_source", "by_country"} <= set(body)
    assert {"pageviews", "sessions", "visitors"} <= set(body["totals"])
