"""iter122 — Secrets Rotation Tracker + final window.confirm cleanup.

Tests for the new admin/secrets/* endpoints. Frontend confirm() changes
have no isolated unit tests (they're rendered + interacted with from
the existing component tests + smoke screenshot).
"""

import os
import sys
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, "/app/backend")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("ADMIN_EMAILS", "super@example.com")

from server import app  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402


@pytest.fixture
def transport():
    return ASGITransport(app=app)


@pytest.mark.asyncio
async def test_secrets_status_requires_super_admin(transport):
    nsjwt = issue_session_jwt("mod-slug", "mod@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        for path, method in [
            ("/api/admin/secrets/status", "GET"),
            ("/api/admin/secrets/mark-rotated", "POST"),
            ("/api/admin/secrets/history/stripe_api", "GET"),
        ]:
            r = await c.request(
                method, path,
                headers={"Authorization": f"Bearer {nsjwt}"},
                json={"secret_id": "stripe_api"} if method == "POST" else None,
            )
            assert r.status_code == 403, f"{method} {path} → {r.status_code}"


@pytest.mark.asyncio
async def test_secrets_status_returns_full_catalogue(transport):
    sjwt = issue_session_jwt("super-slug", "super@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get(
            "/api/admin/secrets/status",
            headers={"Authorization": f"Bearer {sjwt}"},
        )
    assert r.status_code == 200
    body = r.json()
    assert "secrets" in body
    assert "summary" in body
    # Every catalogue entry must have the contract fields the UI expects.
    for s in body["secrets"]:
        for k in ("id", "label", "category", "env_keys", "is_set",
                  "cadence_days", "rotation_url", "rotation_notes",
                  "last_rotated_at", "next_due_at", "days_until_due",
                  "overdue", "status"):
            assert k in s, f"secret {s.get('id')!r} missing field {k!r}"
        assert s["status"] in {"ok", "due_soon", "overdue", "missing"}
        # Never leak the actual secret value — env_keys is just the var
        # NAMES, never the values.
        assert isinstance(s["env_keys"], list) and all(isinstance(k, str) for k in s["env_keys"])

    # Summary integers add up.
    summary = body["summary"]
    assert summary["total"] == len(body["secrets"])
    assert summary["configured"] + summary["missing"] == summary["total"]
    # `overdue` is a subset of configured (you can't be "overdue" if
    # the secret was never set to begin with — those are "missing").
    assert summary["overdue"] <= summary["configured"]


@pytest.mark.asyncio
async def test_mark_rotated_writes_audit_and_resets_timer(transport):
    """Marking a secret as rotated should flip its status to ok, set
    days_until_due to ~cadence_days, and write a row to
    `secret_rotations` we can read back via `/history`."""
    sjwt = issue_session_jwt("super-slug", "super@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        # Status before: capture days_until_due if set
        r0 = await c.get("/api/admin/secrets/status", headers={"Authorization": f"Bearer {sjwt}"})
        assert r0.status_code == 200
        before = next(s for s in r0.json()["secrets"] if s["id"] == "twilio")

        # Mark rotated
        rmark = await c.post(
            "/api/admin/secrets/mark-rotated",
            headers={"Authorization": f"Bearer {sjwt}"},
            json={"secret_id": "twilio", "note": "Rotated after staff turnover"},
        )
        assert rmark.status_code == 200
        body = rmark.json()
        assert body["ok"] is True
        assert body["secret_id"] == "twilio"
        assert body["rotated_at"]

        # Status after: should now be ok + days_until_due near cadence_days (365)
        r1 = await c.get("/api/admin/secrets/status", headers={"Authorization": f"Bearer {sjwt}"})
        after = next(s for s in r1.json()["secrets"] if s["id"] == "twilio")
        if after["is_set"]:
            assert after["status"] == "ok"
            assert 360 <= after["days_until_due"] <= 365
        assert after["last_rotated_by"] == "super@example.com"

        # History endpoint surfaces the rotation row.
        rh = await c.get(
            "/api/admin/secrets/history/twilio",
            headers={"Authorization": f"Bearer {sjwt}"},
        )
        assert rh.status_code == 200
        history = rh.json()["history"]
        assert len(history) >= 1
        latest = history[0]
        assert latest["admin_email"] == "super@example.com"
        assert latest["note"] == "Rotated after staff turnover"


@pytest.mark.asyncio
async def test_mark_rotated_rejects_unknown_secret(transport):
    sjwt = issue_session_jwt("super-slug", "super@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post(
            "/api/admin/secrets/mark-rotated",
            headers={"Authorization": f"Bearer {sjwt}"},
            json={"secret_id": "this-does-not-exist"},
        )
    assert r.status_code == 404
    assert "Unknown secret id" in r.text
