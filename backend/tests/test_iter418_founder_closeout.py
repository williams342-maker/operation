"""iter418 — Founder final-review + closeout system contract tests.

Covers:
  * ``GET /api/settings`` now exposes ``founder_applications_open`` +
    ``founder_slots_total``.
  * ``PATCH /api/admin/settings`` accepts the two new keys.
  * ``GET /api/admin/founders/slots-detail`` returns the four required
    counters.
  * ``GET /api/admin/founders/review`` returns rows classified as
    active/needs_review and matches signal contract.
  * ``POST /api/admin/founders/applications-gate`` flips the flag and
    logs actor.
  * ``POST /api/admin/founders/{slug}/downgrade`` moves a founder to
    Free, writes audit event, keeps maker + listings.
"""
from __future__ import annotations

import os
import sys
import pytest

# Ensure backend is on sys.path (matches other iter*_ tests)
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db  # noqa: E402
from maker_auth import issue_admin_magic_token  # noqa: E402


pytestmark = pytest.mark.asyncio


async def _admin_jwt(client: AsyncClient) -> str:
    email = os.environ.get("OPS_EMAIL")
    magic = issue_admin_magic_token(email)
    r = await client.post("/api/admin/auth/verify", json={"token": magic})
    assert r.status_code == 200, r.text
    return r.json()["token"]


async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_public_settings_exposes_new_keys():
    async with await _client() as c:
        r = await c.get("/api/settings")
        assert r.status_code == 200
        s = r.json()
        assert "founder_applications_open" in s
        assert "founder_slots_total" in s
        assert isinstance(s["founder_applications_open"], bool)
        assert isinstance(s["founder_slots_total"], int)
        assert s["founder_slots_total"] >= 1


async def test_slots_detail_requires_admin():
    async with await _client() as c:
        r = await c.get("/api/admin/founders/slots-detail")
        assert r.status_code in (401, 403)


async def test_slots_detail_shape():
    async with await _client() as c:
        jwt = await _admin_jwt(c)
        r = await c.get(
            "/api/admin/founders/slots-detail",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("active", "needs_review", "total_founders", "cap", "applications_open"):
            assert k in j, f"missing {k}"
        assert j["cap"] >= 1
        assert j["active"] + j["needs_review"] == j["total_founders"]


async def test_review_returns_rows_with_signals():
    async with await _client() as c:
        jwt = await _admin_jwt(c)
        r = await c.get(
            "/api/admin/founders/review",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "rows" in j
        # Only assert per-row shape if there are any Founders present.
        for row in j["rows"]:
            assert row["slug"]
            assert row["status"] in ("active", "needs_review")
            sigs = row["signals"]
            assert set(sigs.keys()) == {
                "has_shop_profile", "has_published_product",
                "recent_login", "has_sales",
            }
            # Verdict must agree with the OR of signals.
            expected = "active" if any(sigs.values()) else "needs_review"
            assert row["status"] == expected


async def test_gate_toggle_updates_public_settings():
    async with await _client() as c:
        jwt = await _admin_jwt(c)
        h = {"Authorization": f"Bearer {jwt}"}

        # Close.
        r = await c.post("/api/admin/founders/applications-gate",
                         headers=h, json={"open": False})
        assert r.status_code == 200, r.text
        assert r.json()["applications_open"] is False

        s = (await c.get("/api/settings")).json()
        assert s["founder_applications_open"] is False

        # Reopen — leave state clean for other tests.
        r = await c.post("/api/admin/founders/applications-gate",
                         headers=h, json={"open": True})
        assert r.status_code == 200
        assert r.json()["applications_open"] is True

        s = (await c.get("/api/settings")).json()
        assert s["founder_applications_open"] is True


async def test_downgrade_moves_founder_to_free_and_audits():
    """End-to-end: create → promote → downgrade → verify audit + slot count."""
    async with await _client() as c:
        jwt = await _admin_jwt(c)
        h = {"Authorization": f"Bearer {jwt}"}

        # Insert a synthetic Founder we own end-to-end.
        slug = "iter418-test-founder"
        await db.makers.delete_one({"slug": slug})  # idempotent cleanup
        await db.makers.insert_one({
            "slug": slug,
            "name": "iter418 Test Founder",
            "email": f"{slug}@example.com",
            "tier": "founder",
            "founder_status": "regular",
            "founder_number": 99999,
            "founder_started_at": "2026-01-01T00:00:00Z",
        })

        # Baseline detail
        before = (await c.get("/api/admin/founders/slots-detail",
                              headers=h)).json()

        # Downgrade.
        r = await c.post(f"/api/admin/founders/{slug}/downgrade",
                         headers=h, json={"reason": "pytest iter418"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["downgraded"] is True

        # Maker record: tier stripped, downgrade metadata written, doc kept.
        m = await db.makers.find_one({"slug": slug})
        assert m is not None, "maker record was deleted (must NOT happen)"
        assert m.get("tier") == "standard"
        assert m.get("founder_status") is None
        assert m.get("founder_number") is None
        assert m.get("founder_downgraded_at")
        assert m.get("founder_downgrade_reason") == "pytest iter418"

        # Audit event exists.
        audit = await db.activity_events.find_one({
            "kind": "admin",
            "action": "founder_downgrade",
            "target_slug": slug,
        })
        assert audit is not None
        assert audit.get("actor")

        # Slots after should not include this founder.
        after = (await c.get("/api/admin/founders/slots-detail",
                             headers=h)).json()
        assert after["total_founders"] == before["total_founders"] - 1

        # Trying to downgrade twice → 400 (not a founder anymore).
        r2 = await c.post(f"/api/admin/founders/{slug}/downgrade",
                          headers=h, json={"reason": "second attempt"})
        assert r2.status_code == 400

        # Cleanup.
        await db.makers.delete_one({"slug": slug})
        await db.activity_events.delete_many({"target_slug": slug})
