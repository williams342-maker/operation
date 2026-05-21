"""Regression: Crafters Plus advanced analytics (iter170 / Phase 4 #2).

Covers:
  * Free maker → 403 with detail.code = plus_required
  * Plus maker → 200 with conversion / repeat_buyer / revenue_trend
    (series_30d len=30, series_90d len=90) / traffic_sources
"""
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

TEST_MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
TEST_MAKER_SLUG = "iron-and-oak"


async def _maker_jwt(client: httpx.AsyncClient) -> str:
    from maker_auth import issue_magic_token
    magic = issue_magic_token(TEST_MAKER_EMAIL)
    r = await client.post(f"{API}/api/maker/auth/verify", json={"token": magic})
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


async def _set_plus(active: bool):
    from core import db
    await db.makers.update_one(
        {"slug": TEST_MAKER_SLUG},
        {"$set": {"subscription_status": "active" if active else "free"}},
    )


@pytest.mark.asyncio
async def test_plus_analytics_locked_for_free_tier():
    await _set_plus(False)
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        r = await c.get(f"{API}/api/maker/analytics/plus", headers=_h(tok))
        assert r.status_code == 403, r.text
        body = r.json()
        assert body["detail"]["code"] == "plus_required"


@pytest.mark.asyncio
async def test_plus_analytics_returns_metrics_for_plus_maker():
    await _set_plus(True)
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            tok = await _maker_jwt(c)
            r = await c.get(f"{API}/api/maker/analytics/plus", headers=_h(tok))
            assert r.status_code == 200, r.text
            body = r.json()
            # Top-level keys
            for key in ("conversion", "repeat_buyer", "revenue_trend", "traffic_sources"):
                assert key in body, f"missing key {key}"
            # revenue_trend series
            rev = body["revenue_trend"]
            assert "series_30d" in rev and "series_90d" in rev
            assert len(rev["series_30d"]) == 30, f"len={len(rev['series_30d'])}"
            assert len(rev["series_90d"]) == 90, f"len={len(rev['series_90d'])}"
    finally:
        await _set_plus(False)
