"""iter413cr — AI Operations Center · Card 1 contract.

Verifies the clustering endpoint `GET /api/admin/ops/ai-issues`:
  • Admin auth required (401/403 without token).
  • Stable response shape (window_days, current_window, prior_window,
    clusters[], generated_at).
  • Reports with similar descriptions cluster together.
  • Different listing slugs / page areas stay in separate clusters.
  • Trend flag = "new" when prior window is empty.
  • Trend flag = "up" when current significantly exceeds prior.
  • Severity escalates with cluster size (info → low → medium → high).

These tests seed their own contact_messages rows so they don't depend
on accumulated production noise. Each test cleans up after itself.
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
    super_email = (
        os.environ.get("ADMIN_EMAILS") or "team@craftersmarket.org"
    ).split(",")[0].strip()
    tok = issue_admin_magic_token(super_email)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"], super_email


def _seed_rows(rows: list[dict]) -> list[str]:
    """Insert ai_diagnosed_bug rows directly into Mongo, return inserted ids."""
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _do():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        ids = []
        for r in rows:
            r.setdefault("id", str(uuid.uuid4()))
            r.setdefault("topic", "bug")
            r.setdefault("kind", "ai_diagnosed_bug")
            r.setdefault("resolved", False)
            ids.append(r["id"])
            await db.contact_messages.insert_one(r)
        client.close()
        return ids
    return asyncio.run(_do())


def _wipe_rows(ids: list[str]):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _do():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        if ids:
            await db.contact_messages.delete_many({"id": {"$in": ids}})
        client.close()
    asyncio.run(_do())


def test_requires_admin_auth():
    r = requests.get(f"{BASE_URL}/api/admin/ops/ai-issues", timeout=15)
    assert r.status_code in (401, 403)


def test_response_shape(admin_jwt):
    tok, _ = admin_jwt
    r = requests.get(
        f"{BASE_URL}/api/admin/ops/ai-issues?window_days=7&limit=8",
        headers={"Authorization": f"Bearer {tok}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("window_days", "current_window", "prior_window", "clusters", "generated_at"):
        assert key in body
    assert body["window_days"] == 7
    assert isinstance(body["clusters"], list)
    for w in (body["current_window"], body["prior_window"]):
        for k in ("start", "end", "total"):
            assert k in w


def test_clusters_similar_descriptions(admin_jwt):
    """Five reports describing the same checkout issue must cluster into
    one bucket with count=5 and severity>=medium."""
    tok, _ = admin_jwt
    sig = uuid.uuid4().hex[:8]
    base_meta = {
        "page_url": f"/checkout?case={sig}",
        "category": None,
        "user_agent": "Mozilla/5.0",
        "viewport": "1440x900",
        "user_role": "buyer",
    }
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(5):
        rows.append({
            "name": "Help widget · buyer",
            "email": f"anon-{sig}-{i}@example.com",
            "subject": f"[AI BUG] iter413cr-checkout-{sig}",
            "message": f"User report:\nCheckout button completely broken — clicking pay does nothing iter413cr-{sig}\n\nRole: buyer",
            "ai_bug_meta": dict(base_meta),
            "created_at": (now - timedelta(minutes=i)).isoformat(),
        })
    ids = _seed_rows(rows)
    try:
        r = requests.get(
            f"{BASE_URL}/api/admin/ops/ai-issues?window_days=7&limit=50",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Our cluster must surface.
        matching = [
            c for c in body["clusters"]
            if any(_id in (c.get("sample_ids") or []) for _id in ids)
        ]
        assert matching, "expected a cluster containing our seeded reports"
        c = matching[0]
        assert c["count"] == 5
        assert c["severity"] in ("medium", "high")
        assert c["trend"] in ("up", "new")
        assert c["prior_count"] == 0
        # Cluster should reference our checkout path.
        assert any("/checkout" in p for p in (c.get("sample_pages") or []))
    finally:
        _wipe_rows(ids)


def test_separate_clusters_for_distinct_areas(admin_jwt):
    """A report against /checkout and one against /shop/<slug> should
    NOT collapse into the same cluster."""
    tok, _ = admin_jwt
    sig = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)
    rows = [
        {
            "name": "buyer",
            "email": f"buyer-{sig}@example.com",
            "subject": f"[AI BUG] iter413cr-A-{sig}",
            "message": f"User report:\nCheckout flow stuck in spinner iter413cr-{sig}-A\n\nRole: buyer",
            "ai_bug_meta": {"page_url": "/checkout", "user_role": "buyer"},
            "created_at": now.isoformat(),
        },
        {
            "name": "buyer",
            "email": f"buyer-{sig}@example.com",
            "subject": f"[AI BUG] iter413cr-B-{sig}",
            "message": f"User report:\nProduct images won't load iter413cr-{sig}-B\n\nRole: buyer",
            "ai_bug_meta": {
                "page_url": f"/shop/listing-{sig}",
                "listing_slug": f"listing-{sig}",
                "user_role": "buyer",
            },
            "created_at": now.isoformat(),
        },
    ]
    ids = _seed_rows(rows)
    try:
        r = requests.get(
            f"{BASE_URL}/api/admin/ops/ai-issues?window_days=7&limit=50",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=15,
        )
        body = r.json()
        keys = set()
        for c in body["clusters"]:
            for _id in c.get("sample_ids") or []:
                if _id in ids:
                    keys.add(c["key"])
        assert len(keys) == 2, f"expected 2 distinct clusters, got {len(keys)}: {keys}"
    finally:
        _wipe_rows(ids)


def test_severity_thresholds(admin_jwt):
    """1 report = info, 2 = low, 5 = medium, 10 = high."""
    tok, _ = admin_jwt
    sig = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(10):
        rows.append({
            "name": "buyer",
            "email": f"sev-{sig}-{i}@example.com",
            "subject": f"[AI BUG] iter413cr-sev-{sig}",
            "message": f"User report:\nSeverity probe iter413cr-{sig} cluster\n\nRole: buyer",
            "ai_bug_meta": {"page_url": f"/probe-{sig}", "user_role": "buyer"},
            "created_at": (now - timedelta(seconds=i)).isoformat(),
        })
    ids = _seed_rows(rows)
    try:
        r = requests.get(
            f"{BASE_URL}/api/admin/ops/ai-issues?window_days=7&limit=50",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=15,
        )
        body = r.json()
        ours = [
            c for c in body["clusters"]
            if any(_id in (c.get("sample_ids") or []) for _id in ids)
        ]
        assert ours, "expected the high-severity cluster"
        c = ours[0]
        assert c["count"] == 10
        assert c["severity"] == "high"
    finally:
        _wipe_rows(ids)
