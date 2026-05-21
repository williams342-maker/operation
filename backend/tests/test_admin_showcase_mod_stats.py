"""Regression: admin showcase moderation stats endpoint (iter163).

Covers:
  • GET /api/admin/community/showcase/mod-stats returns expected keys
  • Unauthenticated request → 401
  • Counts respond to real data (quarantined post seeded → count >= 1)
"""
import os
from datetime import datetime, timezone

import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


async def _admin_jwt(client: httpx.AsyncClient) -> str:
    from maker_auth import issue_admin_magic_token
    email = os.environ.get("OPS_EMAIL") or "team@craftersmarket.org"
    magic = issue_admin_magic_token(email)
    r = await client.post(f"{API}/api/admin/auth/verify", json={"token": magic})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.asyncio
async def test_mod_stats_endpoint_shape():
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _admin_jwt(c)
        r = await c.get(f"{API}/api/admin/community/showcase/mod-stats", headers=_h(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        for key in [
            "pending_review", "reported", "quarantined",
            "approved_24h", "removed_24h", "auto_quarantined_24h", "now",
        ]:
            assert key in body, f"missing key: {key}"
        # All counts are non-negative ints
        for key in [
            "pending_review", "reported", "quarantined",
            "approved_24h", "removed_24h", "auto_quarantined_24h",
        ]:
            assert isinstance(body[key], int), f"{key} should be int"
            assert body[key] >= 0


@pytest.mark.asyncio
async def test_mod_stats_requires_auth():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/admin/community/showcase/mod-stats")
        assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_mod_stats_reflects_quarantined_seed():
    """Insert a quarantined post, verify it shows up in the counts."""
    from core import db
    slug_id = f"_test-modstat-{int(datetime.now().timestamp())}"
    await db.showcase_posts.insert_one({
        "id": slug_id,
        "maker_slug": "iron-and-oak",
        "user_id": "user-mod-stat-test",
        "title": "test",
        "body": "test",
        "image_url": "",
        "mod_status": "quarantined",
        "open_reports": 3,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    })
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            tok = await _admin_jwt(c)
            r = await c.get(f"{API}/api/admin/community/showcase/mod-stats", headers=_h(tok))
            assert r.status_code == 200
            assert r.json()["quarantined"] >= 1
    finally:
        await db.showcase_posts.delete_one({"id": slug_id})
