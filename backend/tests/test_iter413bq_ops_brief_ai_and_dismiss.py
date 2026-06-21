"""iter413bq — AI Daily Brief + dismiss/snooze contracts.

Covers:
  • `daily_brief.source` ∈ {"ai", "ai-cache", "static"} — always present.
  • AI fallback to static when EMERGENT_LLM_KEY is missing or LLM fails
    (we don't simulate a network failure here; instead we validate the
    payload shape stays identical regardless of source).
  • POST /admin/ops-dashboard/dismiss      → hides item, returns expires_at.
  • POST /admin/ops-dashboard/restore      → re-surfaces item.
  • Mode "24h" expires after 24h (we just check expires_at is set ~24h ahead).
  • Mode "until_status_changes" requires `status_signature`, no expires_at.
  • Hidden items are stripped from action_queue but exposed via
    `dismissed.count` / `dismissed.ids`.
  • Auth gate on both new endpoints.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests

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
    super_email = (os.environ.get("ADMIN_EMAILS") or os.environ.get("OPS_EMAIL") or "team@craftersmarket.org").split(",")[0].strip()
    tok = issue_admin_magic_token(super_email)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def H(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


def _overview(H):
    r = requests.get(f"{BASE_URL}/api/admin/ops-dashboard/overview", headers=H, timeout=30)
    r.raise_for_status()
    return r.json()


# ─────────────────────── Daily Brief source field ──────────────────
def test_daily_brief_has_source_field(H):
    d = _overview(H)
    src = d["daily_brief"].get("source")
    assert src in ("ai", "ai-cache", "static"), f"unexpected source value: {src!r}"


def test_daily_brief_shape_consistent_across_sources(H):
    """opportunity/risk/actions exist regardless of source."""
    d = _overview(H)
    b = d["daily_brief"]
    assert isinstance(b["opportunity"], str) and b["opportunity"]
    assert isinstance(b["risk"], str) and b["risk"]
    assert isinstance(b["actions"], list)
    assert len(b["actions"]) <= 3
    for a in b["actions"]:
        assert "label" in a and "cta_tab" in a


# ─────────────────────── Dismiss/snooze ────────────────────────────
def test_dismiss_requires_auth():
    r = requests.post(
        f"{BASE_URL}/api/admin/ops-dashboard/dismiss",
        json={"item_id": "x", "mode": "24h"},
        timeout=15,
    )
    assert r.status_code in (401, 403)


def test_restore_requires_auth():
    r = requests.post(
        f"{BASE_URL}/api/admin/ops-dashboard/restore",
        json={"item_id": "x"},
        timeout=15,
    )
    assert r.status_code in (401, 403)


def test_dismiss_invalid_mode_400(H):
    r = requests.post(
        f"{BASE_URL}/api/admin/ops-dashboard/dismiss",
        json={"item_id": "x", "mode": "forever"},
        headers=H, timeout=15,
    )
    assert r.status_code == 400


def test_dismiss_until_status_changes_requires_signature(H):
    r = requests.post(
        f"{BASE_URL}/api/admin/ops-dashboard/dismiss",
        json={"item_id": "x", "mode": "until_status_changes"},
        headers=H, timeout=15,
    )
    assert r.status_code == 400


def _seed_review_item():
    """Force a `custom_orders_open` item into the action queue by
    inserting one pending custom order. Returns the inserted id so we
    can clean up."""
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        co_id = f"iter413bq-{uuid.uuid4().hex[:8]}"
        await db.custom_orders.insert_one({
            "id": co_id,
            "customer_name": "iter413bq test",
            "status": "submitted",
            "archived_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        client.close()
        return co_id

    return asyncio.run(_go())


def _cleanup_review_item(co_id: str, admin_email: str):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.custom_orders.delete_one({"id": co_id})
        await db.ops_dismissals.delete_many({"admin_email": admin_email})
        client.close()

    asyncio.run(_go())


def test_dismiss_24h_hides_item_and_restore_brings_it_back(H):
    """End-to-end: confirm item appears → dismiss → confirm hidden →
    restore → confirm visible again."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    admin_email = (os.environ.get("ADMIN_EMAILS") or "").split(",")[0].strip().lower()

    co_id = _seed_review_item()
    try:
        # Sanity: the review group should contain custom_orders_open.
        d = _overview(H)
        review_ids_before = {it["id"] for it in d["action_queue"]["review"]}
        assert "custom_orders_open" in review_ids_before

        # Dismiss for 24h.
        r = requests.post(
            f"{BASE_URL}/api/admin/ops-dashboard/dismiss",
            json={"item_id": "custom_orders_open", "mode": "24h"},
            headers=H, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["mode"] == "24h"
        # expires_at should be ~24h ahead (allow 1h skew).
        expires = datetime.fromisoformat(body["expires_at"])
        delta = expires - datetime.now(timezone.utc)
        assert timedelta(hours=23) <= delta <= timedelta(hours=25)

        # Re-fetch: item must be hidden, surfaced via dismissed.ids.
        d = _overview(H)
        review_ids_after = {it["id"] for it in d["action_queue"]["review"]}
        assert "custom_orders_open" not in review_ids_after
        assert "custom_orders_open" in d["dismissed"]["ids"]
        assert d["dismissed"]["count"] >= 1

        # Restore.
        r = requests.post(
            f"{BASE_URL}/api/admin/ops-dashboard/restore",
            json={"item_id": "custom_orders_open"},
            headers=H, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["removed"] >= 1

        # Re-fetch: item is back.
        d = _overview(H)
        review_ids_final = {it["id"] for it in d["action_queue"]["review"]}
        assert "custom_orders_open" in review_ids_final
    finally:
        _cleanup_review_item(co_id, admin_email)


def test_dismiss_until_status_changes_expires_on_signature_shift(H):
    """When mode='until_status_changes' and the item's desc changes,
    the dismissal auto-expires (item resurfaces)."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    admin_email = (os.environ.get("ADMIN_EMAILS") or "").split(",")[0].strip().lower()

    co_id = _seed_review_item()
    try:
        d = _overview(H)
        current_item = next((it for it in d["action_queue"]["review"]
                             if it["id"] == "custom_orders_open"), None)
        assert current_item is not None
        # Dismiss "until status changes" with the CURRENT desc as the signature.
        r = requests.post(
            f"{BASE_URL}/api/admin/ops-dashboard/dismiss",
            json={
                "item_id": "custom_orders_open",
                "mode": "until_status_changes",
                "status_signature": current_item["desc"],
            },
            headers=H, timeout=15,
        )
        assert r.status_code == 200, r.text

        # Hidden right away.
        d2 = _overview(H)
        assert "custom_orders_open" not in {it["id"] for it in d2["action_queue"]["review"]}

        # Now manually tamper with the stored signature to simulate a
        # status shift (e.g. count changed from "298" to "297"). The
        # item should resurface.
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _shift():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            await db.ops_dismissals.update_one(
                {"admin_email": admin_email, "item_id": "custom_orders_open"},
                {"$set": {"status_signature": "OBSOLETE - status drifted"}},
            )
            client.close()

        asyncio.run(_shift())

        d3 = _overview(H)
        assert "custom_orders_open" in {it["id"] for it in d3["action_queue"]["review"]}, (
            "expected the item to resurface once status_signature mismatched"
        )
    finally:
        _cleanup_review_item(co_id, admin_email)
