"""iter335.5 — Admin Ads backfill parity test.

All three platforms (Google · Microsoft · Meta) now expose the same
30-day backfill endpoint pattern:
    POST /api/admin/integrations/{platform}/backfill?days={1..90}

This test pins the response contract so a refactor in any one
platform's router can't silently break the others.
"""
from __future__ import annotations
import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


def _admin_jwt() -> str:
    """Mint an admin session JWT directly so we don't need to walk the
    magic-token email exchange."""
    from maker_auth import issue_session_jwt
    return issue_session_jwt(
        "team", "team@craftersmarket.org",
        role="admin", session_version=0,
    )


@pytest.mark.parametrize("platform", ["google-ads", "microsoft-ads", "meta-ads"])
async def test_backfill_endpoint_exists_and_validates_range(platform):
    """Each backfill endpoint must:
      • Exist and be admin-gated (200 with bearer, 401 without)
      • Reject days < 1 with 422
      • Reject days > 90 with 422
      • Accept days=1 and return the standard summary shape
    """
    from server import app

    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 0 days → 422
        r_low = await ac.post(
            f"/api/admin/integrations/{platform}/backfill?days=0",
            headers=h,
        )
        # 100 days → 422
        r_high = await ac.post(
            f"/api/admin/integrations/{platform}/backfill?days=100",
            headers=h,
        )
        # 1 day → 200 (will internally skip since no creds in test DB)
        r_ok = await ac.post(
            f"/api/admin/integrations/{platform}/backfill?days=1",
            headers=h,
        )

    assert r_low.status_code == 422, f"{platform} should reject days=0"
    assert r_high.status_code == 422, f"{platform} should reject days=100"
    assert r_ok.status_code == 200, f"{platform} days=1 failed: {r_ok.text}"

    body = r_ok.json()
    # Required keys — keep the API contract identical across all 3 platforms.
    for k in ("status", "days_requested", "days_ok", "days_skipped",
              "days_error", "total_rows", "results"):
        assert k in body, f"{platform} missing key '{k}' in response"
    assert body["days_requested"] == 1
    assert isinstance(body["results"], list) and len(body["results"]) == 1


@pytest.mark.parametrize("platform", ["google-ads", "microsoft-ads", "meta-ads"])
async def test_backfill_requires_auth(platform):
    """No bearer → 401 (consistent with other admin endpoints)."""
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            f"/api/admin/integrations/{platform}/backfill?days=7",
        )
    assert r.status_code in (401, 403)
