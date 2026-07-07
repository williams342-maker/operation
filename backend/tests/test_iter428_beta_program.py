"""iter428 — Beta App Testing endpoints."""
import os
import pytest
import pytest_asyncio

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017/craft_test_iter428")
os.environ.setdefault("DB_NAME", "craft_test_iter428")

from httpx import ASGITransport, AsyncClient
from server import app
from core import db
from maker_auth import issue_session_jwt

_ADMIN = os.environ.get("ADMIN_EMAILS", "team@craftersmarket.org").split(",")[0]


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _admin_hdr():
    return {"Authorization": f"Bearer {issue_session_jwt(_ADMIN, _ADMIN, role='admin', session_version=0)}"}


@pytest.mark.asyncio
async def test_public_config_defaults(client):
    r = await client.get("/api/beta-program/config")
    assert r.status_code == 200
    d = r.json()
    for k in ("enabled", "android_url", "ios_url", "headline"):
        assert k in d


@pytest.mark.asyncio
async def test_signup_and_dedup(client):
    await db.beta_signups.delete_many({"email": "a-dedup@example.com"})
    payload = {"name": "Test Alpha", "email": "a-dedup@example.com",
               "device": "android", "state": "Washington"}
    r1 = await client.post("/api/beta-program/signup", json=payload)
    assert r1.status_code == 200
    assert r1.json()["duplicate"] is False
    r2 = await client.post("/api/beta-program/signup", json=payload)
    assert r2.status_code == 200
    assert r2.json()["duplicate"] is True
    assert r2.json()["id"] == r1.json()["id"]


@pytest.mark.asyncio
async def test_signup_validates_device(client):
    r = await client.post("/api/beta-program/signup",
                          json={"name": "X", "email": "x@example.com",
                                "device": "windows-phone"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_stats_shape(client):
    # Seed a signup so stats aren't empty
    await client.post("/api/beta-program/signup",
                      json={"name": "Mike", "email": "mike@example.com",
                            "device": "android", "state": "Washington"})
    r = await client.get("/api/beta-program/stats")
    assert r.status_code == 200
    d = r.json()
    for k in ("android_count", "ios_count", "latest_joined",
              "bugs_fixed", "features_requested", "features_released"):
        assert k in d
    # latest_joined must NOT leak full names or emails
    for j in d["latest_joined"]:
        assert "email" not in j
        assert " " not in j["first_name"]  # first name only


@pytest.mark.asyncio
async def test_admin_config_requires_auth(client):
    r = await client.get("/api/admin/beta-program/config")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_admin_config_patch(client):
    r = await client.patch(
        "/api/admin/beta-program/config",
        json={"enabled": True, "headline": "Custom headline"},
        headers=_admin_hdr(),
    )
    assert r.status_code == 200
    assert r.json()["headline"] == "Custom headline"


@pytest.mark.asyncio
async def test_admin_signups_list(client):
    await client.post("/api/beta-program/signup",
                      json={"name": "Amber Rose", "email": "amber@example.com",
                            "device": "ios", "state": "Ohio"})
    r = await client.get("/api/admin/beta-program/signups", headers=_admin_hdr())
    assert r.status_code == 200
    d = r.json()
    assert d["total"] >= 1
    # Admin view CAN include email/full name
    assert any(s.get("email") == "amber@example.com" for s in d["signups"])
