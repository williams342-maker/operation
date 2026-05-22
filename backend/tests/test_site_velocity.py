"""Regression: public marketplace velocity endpoint (iter177)."""
import os
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


@pytest.mark.asyncio
async def test_site_velocity_returns_expected_shape():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/site/velocity")
        assert r.status_code == 200, r.text
        body = r.json()
        # Required keys
        for k in (
            "orders_this_week",
            "makers_active_this_week",
            "avg_ship_days",
            "custom_orders_this_month",
            "total_makers",
            "as_of",
        ):
            assert k in body, f"Missing {k}"
        # Type contracts
        assert isinstance(body["orders_this_week"], int)
        assert isinstance(body["makers_active_this_week"], int)
        assert isinstance(body["custom_orders_this_month"], int)
        assert isinstance(body["total_makers"], int)
        # avg_ship_days is float or None
        assert body["avg_ship_days"] is None or isinstance(body["avg_ship_days"], (int, float))
        # No negative counters — that would mean a broken aggregation
        assert body["orders_this_week"] >= 0
        assert body["makers_active_this_week"] >= 0
        assert body["custom_orders_this_month"] >= 0
        assert body["total_makers"] >= 0


@pytest.mark.asyncio
async def test_site_velocity_does_not_require_auth():
    """Public endpoint — must work without any auth headers."""
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/site/velocity")
        assert r.status_code == 200
        # Should NOT 401/403 anonymously
        assert r.status_code not in (401, 403)
