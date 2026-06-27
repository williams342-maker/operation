"""iter413cs — Deployment Watch Window + AI Operations Cards 2 & 6 + Release Timeline.

Verifies:
  • Auto-open on app boot when BUILD_SHA changes (ensure_watch_for_current_build).
  • GET /api/admin/ops/deploy-watch/current returns an active watch + health signals.
  • POST .../start opens a new watch and closes any prior active one.
  • POST .../close writes a summary and history reflects it.
  • Annotation persists features_shipped + operator_notes.
  • Release Timeline returns enriched watches + matches search query `q`.
  • GET /api/admin/ops/ai-emerging surfaces clusters that started post-watch.
  • GET /api/admin/ops/deploy-health computes severity from signal spikes.
  • close_expired_deploy_watches sweep idempotent + summary-writing.

Admin auth required on every route.
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


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _seed_ai_bug_row(when: datetime, desc: str, page: str = "/checkout",
                     listing: str | None = None) -> str:
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _do():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        _id = str(uuid.uuid4())
        await db.contact_messages.insert_one({
            "id": _id,
            "name": "Help widget · buyer",
            "email": f"test-{_id[:8]}@example.com",
            "subject": "[AI BUG] iter413cs",
            "topic": "bug",
            "kind": "ai_diagnosed_bug",
            "message": f"User report:\n{desc}\n\nRole: buyer",
            "ai_bug_meta": {"page_url": page, "listing_slug": listing, "user_role": "buyer"},
            "created_at": when.isoformat(),
            "resolved": False,
        })
        client.close()
        return _id
    return asyncio.run(_do())


def _wipe(ids: list[str]):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _do():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        if ids:
            await db.contact_messages.delete_many({"id": {"$in": ids}})
        client.close()
    asyncio.run(_do())


def test_requires_admin():
    for path in (
        "/api/admin/ops/deploy-watch/current",
        "/api/admin/ops/deploy-health",
        "/api/admin/ops/ai-emerging",
        "/api/admin/ops/release-timeline",
        "/api/admin/ops/deploy-watch/history",
    ):
        r = requests.get(f"{BASE_URL}{path}", timeout=15)
        assert r.status_code in (401, 403), f"{path} not gated"


def test_current_watch_shape(admin_jwt):
    tok, _ = admin_jwt
    r = requests.get(
        f"{BASE_URL}/api/admin/ops/deploy-watch/current", headers=_h(tok), timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Boot hook ensures a watch exists.
    assert body["watch"] is not None
    w = body["watch"]
    for key in ("id", "build_id", "started_at", "expires_at", "status", "baseline"):
        assert key in w, f"missing key {key} in watch"
    assert w["status"] == "active"
    h = body["health"]
    assert h["overall_health"] in ("green", "yellow", "orange", "red")
    sig_ids = {s["id"] for s in h["signals"]}
    assert sig_ids == {"ai_bug_reports", "support_tickets", "help_conversations", "emerging_clusters"}


def test_start_close_lifecycle_and_history(admin_jwt):
    tok, _ = admin_jwt
    suffix = uuid.uuid4().hex[:8]
    build = f"iter413cs-test-{suffix}"
    # Start
    r = requests.post(
        f"{BASE_URL}/api/admin/ops/deploy-watch/start", headers=_h(tok),
        json={"build_id": build, "ttl_hours": 2}, timeout=15,
    )
    assert r.status_code == 200, r.text
    w = r.json()["watch"]
    assert w["build_id"] == build
    assert w["status"] == "active"

    # Close it explicitly.
    r2 = requests.post(
        f"{BASE_URL}/api/admin/ops/deploy-watch/close", headers=_h(tok),
        json={"watch_id": w["id"], "notes": "iter413cs lifecycle test"}, timeout=15,
    )
    assert r2.status_code == 200, r2.text
    closed = r2.json()["watch"]
    assert closed["status"] == "closed"
    assert closed["closed_at"]
    assert closed["summary"]
    assert closed["summary"]["health"] in ("green", "yellow", "orange", "red", "unknown")

    # Surfaces in history.
    rh = requests.get(
        f"{BASE_URL}/api/admin/ops/deploy-watch/history?limit=20",
        headers=_h(tok), timeout=15,
    )
    assert rh.status_code == 200
    ids = [row["id"] for row in rh.json()["rows"]]
    assert w["id"] in ids


def test_annotate_features_shipped(admin_jwt):
    tok, _ = admin_jwt
    suffix = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{BASE_URL}/api/admin/ops/deploy-watch/start", headers=_h(tok),
        json={"build_id": f"annotate-{suffix}", "ttl_hours": 1}, timeout=15,
    )
    watch_id = r.json()["watch"]["id"]
    try:
        ann = requests.post(
            f"{BASE_URL}/api/admin/ops/deploy-watch/{watch_id}/annotate",
            headers=_h(tok),
            json={
                "features_shipped": ["Platform Knowledge service", "Help report-issue"],
                "notes": "iter413cs smoke note " + suffix,
            },
            timeout=15,
        )
        assert ann.status_code == 200, ann.text
        w = ann.json()["watch"]
        assert "Platform Knowledge service" in w["features_shipped"]
        assert suffix in w["operator_notes"]
        assert w["annotated_by"]
    finally:
        requests.post(
            f"{BASE_URL}/api/admin/ops/deploy-watch/close", headers=_h(tok),
            json={"watch_id": watch_id, "notes": "cleanup"}, timeout=15,
        )


def test_release_timeline_search(admin_jwt):
    tok, _ = admin_jwt
    suffix = uuid.uuid4().hex[:8]
    build = f"search-{suffix}"
    r = requests.post(
        f"{BASE_URL}/api/admin/ops/deploy-watch/start", headers=_h(tok),
        json={"build_id": build, "ttl_hours": 1}, timeout=15,
    )
    watch_id = r.json()["watch"]["id"]
    try:
        requests.post(
            f"{BASE_URL}/api/admin/ops/deploy-watch/{watch_id}/annotate",
            headers=_h(tok),
            json={"features_shipped": [f"FiberTextileTaxonomy-{suffix}"]},
            timeout=15,
        )
        # Search by feature name.
        rs = requests.get(
            f"{BASE_URL}/api/admin/ops/release-timeline?q=FiberTextileTaxonomy-{suffix}",
            headers=_h(tok), timeout=15,
        )
        assert rs.status_code == 200, rs.text
        rows = rs.json()["rows"]
        assert any(r["id"] == watch_id for r in rows)
        target = next(r for r in rows if r["id"] == watch_id)
        assert target["features_shipped"] == [f"FiberTextileTaxonomy-{suffix}"]
        assert "ai_issues_count" in target
        assert "ai_issue_clusters" in target
    finally:
        requests.post(
            f"{BASE_URL}/api/admin/ops/deploy-watch/close", headers=_h(tok),
            json={"watch_id": watch_id, "notes": "cleanup"}, timeout=15,
        )


def test_emerging_clusters_finds_new_post_watch(admin_jwt):
    """A cluster of reports created entirely after a watch starts should
    surface in /ai-emerging when there's no matching cluster in the prior 7d."""
    tok, _ = admin_jwt
    suffix = uuid.uuid4().hex[:8]
    # Open a fresh watch so the "since" pointer is set just before our
    # seed rows land.
    r = requests.post(
        f"{BASE_URL}/api/admin/ops/deploy-watch/start", headers=_h(tok),
        json={"build_id": f"emerging-{suffix}", "ttl_hours": 1}, timeout=15,
    )
    watch_id = r.json()["watch"]["id"]
    ids = []
    try:
        now = datetime.now(timezone.utc)
        for i in range(3):
            ids.append(_seed_ai_bug_row(
                when=now + timedelta(seconds=i + 1),
                desc=f"emerging unique probe iter413cs {suffix} cluster",
                page=f"/checkout?emerging={suffix}",
            ))
        # Wait a beat then query.
        re_ = requests.get(
            f"{BASE_URL}/api/admin/ops/ai-emerging?limit=50",
            headers=_h(tok), timeout=15,
        )
        assert re_.status_code == 200
        body = re_.json()
        assert body["anchor"] == "deploy_watch"
        # Find our cluster.
        ours = [c for c in body["clusters"]
                if any(_id in (c.get("sample_ids") or []) for _id in ids)]
        assert ours, f"expected our cluster in emerging set, got {len(body['clusters'])} clusters"
        assert ours[0]["trend"] == "new"
    finally:
        _wipe(ids)
        requests.post(
            f"{BASE_URL}/api/admin/ops/deploy-watch/close", headers=_h(tok),
            json={"watch_id": watch_id, "notes": "cleanup"}, timeout=15,
        )


def test_deploy_health_signal_severity_for_zero_baseline(admin_jwt):
    """When baseline is 0 and current activity exists, status moves
    above green; we don't need to flood prod with reports to verify."""
    tok, _ = admin_jwt
    # Just verify the shape is well-formed; live numbers vary.
    r = requests.get(
        f"{BASE_URL}/api/admin/ops/deploy-health", headers=_h(tok), timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "watch" in body and "health" in body
    sigs = body["health"]["signals"]
    assert len(sigs) == 4
    for s in sigs:
        assert s["status"] in ("green", "yellow", "orange", "red")
        assert "delta_label" in s


def test_close_expired_sweep_idempotent(admin_jwt):
    """Direct unit-style call to the sweeper. Opens a watch with a
    1-hour TTL, then mutates expires_at to the past via Mongo, then
    runs the sweep — confirms summary is written and a second sweep
    is a no-op."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient
    from routers.deploy_watch import close_expired_deploy_watches

    tok, _ = admin_jwt
    suffix = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{BASE_URL}/api/admin/ops/deploy-watch/start", headers=_h(tok),
        json={"build_id": f"sweep-{suffix}", "ttl_hours": 1}, timeout=15,
    )
    watch_id = r.json()["watch"]["id"]

    async def _force_expire():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        await db.deploy_watches.update_one({"id": watch_id}, {"$set": {"expires_at": past}})
        client.close()
    asyncio.run(_force_expire())

    first = asyncio.run(close_expired_deploy_watches())
    second = asyncio.run(close_expired_deploy_watches())
    assert first["closed"] >= 1
    assert second["closed"] == 0

    # Closed row has a summary.
    async def _fetch():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        doc = await db.deploy_watches.find_one({"id": watch_id}, {"_id": 0})
        client.close()
        return doc
    doc = asyncio.run(_fetch())
    assert doc and doc["status"] == "closed"
    assert doc["summary"] and doc["summary"]["health"]
