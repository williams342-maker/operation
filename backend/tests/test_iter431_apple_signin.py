"""iter431 — Sign in with Apple tests.

Covers:
  * GET  /community/auth/apple/start        → 302 to appleid.apple.com with proper params
  * POST /community/auth/apple/callback     → error branches (state_expired, invalid_token, cancelled, eua_required)
  * POST /community/auth/apple/callback     → happy path (new user + linking) via monkeypatched verifier
  * POST /community/auth/apple/exchange     → returns buyer JWT, single-use codes 401 on reuse
  * Regression: magic link + /auth/password/flags apple_enabled true
"""
import os
import urllib.parse
import uuid

import pytest
import pytest_asyncio

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017/craft_test_iter431")
os.environ.setdefault("DB_NAME", "craft_test_iter431")
# Apple must be feature-flag ON for these tests. Force values so tests
# don't depend on prod-derived .env values being loaded.
os.environ["APPLE_SERVICE_ID"] = "org.craftersmarket.app.signin"
os.environ["APPLE_REDIRECT_URI"] = (
    "https://craftersmarket.org/api/community/auth/apple/callback"
)

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db  # noqa: E402
from routers import apple_auth  # noqa: E402
from routers.community_common import CURRENT_EUA_VERSION  # noqa: E402


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def _cleanup_email(email: str):
    await db.community_users.delete_many({"email": email})


# ═══════════════════════════════ START ═══════════════════════════════════
@pytest.mark.asyncio
async def test_apple_start_redirects_to_apple(client):
    r = await client.get(
        f"/api/community/auth/apple/start?eua_version={CURRENT_EUA_VERSION}",
        follow_redirects=False,
    )
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://appleid.apple.com/auth/authorize?")
    q = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)
    assert q["client_id"] == ["org.craftersmarket.app.signin"]
    assert q["redirect_uri"] == [
        "https://craftersmarket.org/api/community/auth/apple/callback"
    ]
    assert q["response_type"] == ["code id_token"]
    assert q["scope"] == ["name email"]
    assert q["response_mode"] == ["form_post"]
    assert q["state"] and q["nonce"]

    # State doc stored in Mongo with EUA + nonce.
    state_val = q["state"][0]
    doc = await db.apple_auth_states.find_one({"state": state_val})
    assert doc is not None
    assert doc["nonce"] == q["nonce"][0]
    assert doc["eua_version"] == CURRENT_EUA_VERSION
    await db.apple_auth_states.delete_one({"state": state_val})


# ═══════════════════════════════ CALLBACK ERROR BRANCHES ═════════════════
@pytest.mark.asyncio
async def test_apple_callback_unknown_state(client):
    r = await client.post(
        "/api/community/auth/apple/callback",
        data={"state": "no-such-state", "id_token": "whatever"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert "/signin?apple=error&reason=state_expired" in r.headers["location"]


@pytest.mark.asyncio
async def test_apple_callback_invalid_id_token(client):
    # Insert a valid state, then post garbage id_token.
    state = uuid.uuid4().hex
    from core import now_iso
    await db.apple_auth_states.insert_one({
        "state": state, "nonce": "n1", "eua_version": CURRENT_EUA_VERSION,
        "created_at": now_iso(),
    })
    r = await client.post(
        "/api/community/auth/apple/callback",
        data={"state": state, "id_token": "garbage.not.a.jwt"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert "/signin?apple=error&reason=invalid_token" in r.headers["location"]


@pytest.mark.asyncio
async def test_apple_callback_user_cancelled(client):
    r = await client.post(
        "/api/community/auth/apple/callback",
        data={"error": "user_cancelled_authorize"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert "/signin?apple=error&reason=cancelled" in r.headers["location"]


# ═══════════════════════════════ CALLBACK HAPPY PATH ═════════════════════
@pytest.mark.asyncio
async def test_apple_callback_new_user_and_exchange(client, monkeypatch):
    email = f"apple-test-{uuid.uuid4().hex[:8]}@example.com"
    sub = f"apple:{uuid.uuid4().hex[:16]}"
    await _cleanup_email(email)

    # Prime a state doc as if /start was hit with EUA accepted.
    state = uuid.uuid4().hex
    from core import now_iso
    await db.apple_auth_states.insert_one({
        "state": state, "nonce": "N-happy", "eua_version": CURRENT_EUA_VERSION,
        "created_at": now_iso(),
    })

    def fake_verify(id_token, expected_nonce):
        assert expected_nonce == "N-happy"
        return {"sub": sub, "email": email, "email_verified": "true"}

    monkeypatch.setattr(apple_auth, "verify_apple_id_token", fake_verify)

    r = await client.post(
        "/api/community/auth/apple/callback",
        data={"state": state, "id_token": "fake.id.token"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    loc = r.headers["location"]
    assert loc.startswith("/signin?apple=ok&code=")
    code = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)["code"][0]

    # community_users doc created with apple_sub.
    user = await db.community_users.find_one({"email": email}, {"_id": 0})
    assert user is not None
    assert user["apple_sub"] == sub

    # Exchange the one-time code for a buyer JWT.
    ex = await client.post(
        "/api/community/auth/apple/exchange", json={"code": code}
    )
    assert ex.status_code == 200
    body = ex.json()
    assert body["is_new_signup"] is True
    assert body["token"] and isinstance(body["token"], str)
    assert body["user"]["email"] == email

    # JWT is usable on GET /api/community/me.
    me = await client.get(
        "/api/community/me",
        headers={"Authorization": f"Bearer {body['token']}"},
    )
    assert me.status_code == 200
    assert me.json()["email"] == email

    # Second exchange with same code → 401 (single-use).
    reuse = await client.post(
        "/api/community/auth/apple/exchange", json={"code": code}
    )
    assert reuse.status_code == 401

    await _cleanup_email(email)


# ═══════════════════════════════ ACCOUNT LINKING ═════════════════════════
@pytest.mark.asyncio
async def test_apple_callback_links_to_existing_email(client, monkeypatch):
    email = f"apple-test-{uuid.uuid4().hex[:8]}@example.com"
    sub = f"apple:{uuid.uuid4().hex[:16]}"
    await _cleanup_email(email)

    # Pre-seed existing buyer via _upsert_buyer with current EUA.
    from routers.community_auth import _upsert_buyer
    pre_user = await _upsert_buyer(email=email, eua_version=CURRENT_EUA_VERSION)
    original_uid = pre_user["user_id"]

    state = uuid.uuid4().hex
    from core import now_iso
    await db.apple_auth_states.insert_one({
        "state": state, "nonce": "N-link", "eua_version": CURRENT_EUA_VERSION,
        "created_at": now_iso(),
    })

    def fake_verify(id_token, expected_nonce):
        return {"sub": sub, "email": email, "email_verified": "true"}

    monkeypatch.setattr(apple_auth, "verify_apple_id_token", fake_verify)

    r = await client.post(
        "/api/community/auth/apple/callback",
        data={"state": state, "id_token": "fake"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    code = urllib.parse.parse_qs(
        urllib.parse.urlparse(r.headers["location"]).query
    )["code"][0]

    # No duplicate user.
    cnt = await db.community_users.count_documents({"email": email})
    assert cnt == 1

    # Existing user now has apple_sub set.
    user = await db.community_users.find_one({"email": email}, {"_id": 0})
    assert user["user_id"] == original_uid
    assert user["apple_sub"] == sub

    ex = await client.post(
        "/api/community/auth/apple/exchange", json={"code": code}
    )
    assert ex.status_code == 200
    body = ex.json()
    assert body["is_new_signup"] is False
    assert body["user"]["user_id"] == original_uid

    await _cleanup_email(email)


# ═══════════════════════════════ EUA GATE ════════════════════════════════
@pytest.mark.asyncio
async def test_apple_callback_eua_required_for_new_email(client, monkeypatch):
    email = f"apple-test-{uuid.uuid4().hex[:8]}@example.com"
    sub = f"apple:{uuid.uuid4().hex[:16]}"
    await _cleanup_email(email)

    # State WITHOUT eua_version (as if the frontend forgot to include it).
    state = uuid.uuid4().hex
    from core import now_iso
    await db.apple_auth_states.insert_one({
        "state": state, "nonce": "N-noeua", "eua_version": "",
        "created_at": now_iso(),
    })

    def fake_verify(id_token, expected_nonce):
        return {"sub": sub, "email": email, "email_verified": "true"}

    monkeypatch.setattr(apple_auth, "verify_apple_id_token", fake_verify)

    r = await client.post(
        "/api/community/auth/apple/callback",
        data={"state": state, "id_token": "fake"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert "/signin?apple=error&reason=eua_required" in r.headers["location"]

    # Ensure no user was created.
    assert await db.community_users.count_documents({"email": email}) == 0


# ═══════════════════════════════ EXCHANGE 401 ════════════════════════════
@pytest.mark.asyncio
async def test_apple_exchange_bogus_code(client):
    r = await client.post(
        "/api/community/auth/apple/exchange",
        json={"code": "totally-bogus-code-xyz"},
    )
    assert r.status_code == 401


# ═══════════════════════════════ REGRESSION ══════════════════════════════
@pytest.mark.asyncio
async def test_password_flags_reports_apple_enabled(client):
    r = await client.get("/api/auth/password/flags")
    assert r.status_code == 200
    body = r.json()
    assert body["apple_enabled"] is True


@pytest.mark.asyncio
async def test_magic_link_request_still_works(client):
    email = f"apple-test-magic-{uuid.uuid4().hex[:6]}@example.com"
    await _cleanup_email(email)
    r = await client.post(
        "/api/community/auth/magic/request",
        json={
            "email": email,
            "origin_url": "https://craftersmarket.org",
            "accept_eua": True,
            "eua_version": CURRENT_EUA_VERSION,
        },
    )
    assert r.status_code == 200
    assert r.json()["sent"] is True
    await _cleanup_email(email)
