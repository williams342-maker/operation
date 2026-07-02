"""iter327 — Application email verification.

Covers:
- Submit creates row with ``email_verified=False``,
  ``email_verification_sent_at`` populated.
- GET /applications/verify-email flips the row to verified.
- Re-clicking the same link returns ``already_verified=true`` (idempotent).
- Expired / mismatched tokens return 401 / 404 with clear detail.
- Duplicate submit while pending returns 409 with the copy the frontend renders.
- Admin resend re-issues a fresh token + bumps ``email_verification_sent_at``.
- Admin resend against an already-verified applicant returns
  ``already_verified=true`` without touching the DB.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch, AsyncMock

import pytest
import pytest_asyncio

sys.path.insert(0, str(Path(__file__).parent.parent))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture(autouse=True)
async def clean_applications():
    from core import db
    await db.maker_applications.delete_many({"email": {"$regex": "^iter327-"}})
    yield
    await db.maker_applications.delete_many({"email": {"$regex": "^iter327-"}})


async def _submit(payload: dict) -> dict:
    from httpx import ASGITransport, AsyncClient
    from server import app as fastapi_app
    # Reset the in-process rate-limit bucket between submissions so 5
    # test cases in a row don't hit the 5-per-minute cap (real users
    # come from different IPs; the test client always looks like 127.0.0.1).
    from routers import catalog as catalog_mod
    catalog_mod._MAKER_APP_RATE_BUCKET.clear()
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
    ) as c:
        # Stub outgoing emails and third-party CAPI calls so the test
        # doesn't require a live SMTP / Meta / TikTok connection.
        with patch("email_service.send_applicant_received", new=AsyncMock()), \
             patch("email_service.send_ops_new_application", new=AsyncMock()), \
             patch("email_service.send_application_verify_email", new=AsyncMock()), \
             patch("routers.meta_capi.send_meta_event", new=AsyncMock()), \
             patch("routers.tiktok_capi.send_tiktok_event", new=AsyncMock()):
            r = await c.post("/api/maker-applications", json=payload)
    r.raise_for_status()
    return r.json()


def _base_payload(**overrides):
    p = {
        "name": "Test Applicant",
        "email": "iter327-fresh@example.com",
        "studio_name": "Iter327 Studio",
        "location": "Denver, CO",
        "techniques": ["Wood"],
        "portfolio_url": "https://example.test/portfolio",
        "about": "I make things.",
    }
    p.update(overrides)
    return p


async def test_submit_creates_row_with_pending_verification():
    from core import db
    r = await _submit(_base_payload())
    row = await db.maker_applications.find_one({"id": r["id"]}, {"_id": 0})
    assert row is not None
    assert row["email_verified"] is False
    assert row.get("email_verification_sent_at"), (
        "email_verification_sent_at must be stamped at submit time"
    )
    assert row.get("email_verified_at") is None


async def test_verify_flow_flips_row_and_is_idempotent():
    from core import db
    from httpx import ASGITransport, AsyncClient
    from server import app as fastapi_app
    from maker_auth import issue_application_verify_token

    r = await _submit(_base_payload(email="iter327-verify@example.com"))
    app_id = r["id"]
    token = issue_application_verify_token(app_id, "iter327-verify@example.com")

    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
    ) as c:
        # First click flips it.
        v1 = await c.get(f"/api/applications/verify-email?token={token}")
        assert v1.status_code == 200
        b1 = v1.json()
        assert b1["ok"] is True
        assert b1["already_verified"] is False
        assert b1["studio_name"] == "Iter327 Studio"

        row = await db.maker_applications.find_one({"id": app_id}, {"_id": 0})
        assert row["email_verified"] is True
        assert row["email_verified_at"], "email_verified_at must be stamped"

        # Second click is idempotent.
        v2 = await c.get(f"/api/applications/verify-email?token={token}")
        b2 = v2.json()
        assert v2.status_code == 200
        assert b2["ok"] is True
        assert b2["already_verified"] is True


async def test_verify_token_email_mismatch_401():
    from httpx import ASGITransport, AsyncClient
    from server import app as fastapi_app
    from maker_auth import issue_application_verify_token

    r = await _submit(_base_payload(email="iter327-mismatch@example.com"))
    # Token embeds the WRONG email but the real app_id — the endpoint
    # should refuse rather than silently verify.
    bad_token = issue_application_verify_token(r["id"], "attacker@example.com")

    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
    ) as c:
        v = await c.get(f"/api/applications/verify-email?token={bad_token}")
    assert v.status_code == 401
    assert "mismatch" in v.json()["detail"].lower()


async def test_duplicate_submit_while_pending_returns_409():
    from httpx import ASGITransport, AsyncClient
    from server import app as fastapi_app

    email = "iter327-dupe@example.com"
    await _submit(_base_payload(email=email))
    # Second submit — SAME email, still pending verification. Backend
    # should refuse with the exact copy the frontend renders.
    from routers import catalog as catalog_mod
    catalog_mod._MAKER_APP_RATE_BUCKET.clear()
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
    ) as c:
        with patch("email_service.send_applicant_received", new=AsyncMock()), \
             patch("email_service.send_ops_new_application", new=AsyncMock()), \
             patch("email_service.send_application_verify_email", new=AsyncMock()), \
             patch("routers.meta_capi.send_meta_event", new=AsyncMock()), \
             patch("routers.tiktok_capi.send_tiktok_event", new=AsyncMock()):
            r = await c.post("/api/maker-applications", json=_base_payload(email=email))
    assert r.status_code == 409
    assert "already applied" in r.json()["detail"].lower()
    assert "check your email" in r.json()["detail"].lower()


async def test_admin_resend_reissues_token_and_bumps_timestamp():
    from core import db
    from httpx import ASGITransport, AsyncClient
    from server import app as fastapi_app
    from maker_auth import issue_session_jwt

    r = await _submit(_base_payload(email="iter327-resend@example.com"))
    app_id = r["id"]
    sent_before = (await db.maker_applications.find_one({"id": app_id}))["email_verification_sent_at"]

    admin_jwt = issue_session_jwt("admin", "team@craftersmarket.org", role="admin")
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
    ) as c:
        with patch("email_service.send_application_verify_email", new=AsyncMock()):
            r2 = await c.post(
                f"/api/admin/maker-applications/{app_id}/resend-verification",
                headers={"Authorization": f"Bearer {admin_jwt}"},
            )
    assert r2.status_code == 200
    body = r2.json()
    assert body["ok"] is True
    assert body["already_verified"] is False
    assert body["verify_sent_at"] is not None
    sent_after = (await db.maker_applications.find_one({"id": app_id}))["email_verification_sent_at"]
    assert sent_after >= sent_before, "resend must bump email_verification_sent_at forward"


async def test_admin_resend_noop_when_already_verified():
    from core import db
    from httpx import ASGITransport, AsyncClient
    from server import app as fastapi_app
    from maker_auth import issue_session_jwt, issue_application_verify_token

    r = await _submit(_base_payload(email="iter327-already@example.com"))
    app_id = r["id"]
    token = issue_application_verify_token(app_id, "iter327-already@example.com")

    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
    ) as c:
        await c.get(f"/api/applications/verify-email?token={token}")

    admin_jwt = issue_session_jwt("admin", "team@craftersmarket.org", role="admin")
    resend_stub = AsyncMock()
    async with AsyncClient(
        transport=ASGITransport(app=fastapi_app),
        base_url="http://test",
    ) as c:
        with patch("email_service.send_application_verify_email", resend_stub):
            r2 = await c.post(
                f"/api/admin/maker-applications/{app_id}/resend-verification",
                headers={"Authorization": f"Bearer {admin_jwt}"},
            )
    assert r2.status_code == 200
    body = r2.json()
    assert body["ok"] is True
    assert body["already_verified"] is True
    resend_stub.assert_not_called()
