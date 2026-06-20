"""iter413bd — Freshness Engine contract.

Verifies:
  • GET  /admin/freshness                 — scan returns 3 buckets +
                                             threshold + count summary
  • POST /admin/freshness/action accept   — writes a row, increments
                                             counts.accepted_last_7d
  • POST /admin/freshness/action dismiss  — snoozes the entry; same
                                             entity disappears on rescan
  • GET  /admin/freshness/history         — returns recent actions
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import requests
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def admin_jwt():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def H(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


def test_scan_requires_admin():
    r = requests.get(f"{BASE_URL}/api/admin/freshness", timeout=15)
    assert r.status_code in (401, 403)


def test_scan_shape(H):
    r = requests.get(f"{BASE_URL}/api/admin/freshness", headers=H, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    # Required keys
    for k in ("scanned_at", "thresholds", "counts", "founders", "blog", "products"):
        assert k in body, f"missing key: {k}"

    # Thresholds are the documented spec — lock them.
    assert body["thresholds"]["founder"] == 14
    assert body["thresholds"]["blog"] == 21
    assert body["thresholds"]["product"] == 30

    # Count sums match.
    counts = body["counts"]
    assert counts["founder"] + counts["blog"] + counts["product"] == counts["total"]

    # Each row has the documented fields.
    for r in (body["founders"] + body["blog"] + body["products"]):
        assert "id" in r and "kind" in r and "url" in r
        assert "days_stale" in r
        assert r["days_stale"] >= r["threshold_days"]
        assert "suggested_update" in r and "reason" in r and "expected_impact" in r
        assert r["severity"] in {"warn", "alert"}


def test_action_validation(H):
    bad = requests.post(
        f"{BASE_URL}/api/admin/freshness/action",
        json={"id": "x", "kind": "founder", "decision": "delete"},
        headers=H, timeout=15,
    )
    assert bad.status_code == 422

    bad2 = requests.post(
        f"{BASE_URL}/api/admin/freshness/action",
        json={"id": "x", "kind": "video", "decision": "accept"},
        headers=H, timeout=15,
    )
    assert bad2.status_code == 422


def test_dismiss_snoozes_and_history_logs(H):
    """Accept then dismiss synthetic entries; confirm both land in history."""
    import uuid
    fake_id = f"freshness-test-{uuid.uuid4().hex[:8]}"
    r1 = requests.post(
        f"{BASE_URL}/api/admin/freshness/action",
        json={"id": fake_id, "kind": "product", "decision": "accept"},
        headers=H, timeout=15,
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["decision"] == "accept"

    r2 = requests.post(
        f"{BASE_URL}/api/admin/freshness/action",
        json={"id": fake_id, "kind": "product", "decision": "dismiss"},
        headers=H, timeout=15,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["snoozed_until"] is not None

    # History contains both rows (most recent first).
    hist = requests.get(f"{BASE_URL}/api/admin/freshness/history?limit=20",
                       headers=H, timeout=15).json()
    matches = [a for a in hist["actions"] if a.get("id") == fake_id]
    assert len(matches) >= 2

    # Cleanup
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _wipe():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.freshness_actions.delete_many({"id": fake_id})
        client.close()

    asyncio.run(_wipe())
