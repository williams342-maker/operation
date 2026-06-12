"""iter377 — SEO health: resilient crawler + ✦ AI auto-fix endpoint.

Covers:
  • /admin/seo-health/autofix requires admin (401 anonymous).
  • Auto-fix pass 1 (deterministic re-check) clears transient issues and
    updates the stored run in place — no LLM call needed when everything
    resolves (verified via monkeypatched _check_url).
  • Persistent issues survive the re-check and keep their type.
"""
import os
import sys
import uuid

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


async def test_autofix_requires_admin():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        r = await c.post("/api/admin/seo-health/autofix")
    assert r.status_code == 401


async def _seed_run(db, issues):
    run = {
        "id": f"iter377-{uuid.uuid4().hex[:8]}",
        "site": "https://craftersmarket.org", "trigger": "manual",
        "started_at": "2099-01-01T00:00:00+00:00",  # sorts newest
        "finished_at": "2099-01-01T00:00:10+00:00",
        "checked": 10, "sitemap_urls": 174,
        "issue_count": len(issues), "issues": issues,
    }
    await db.seo_health_runs.insert_one({**run})
    return run


async def test_autofix_clears_transient_issues(monkeypatch):
    from unittest.mock import AsyncMock
    import routers.seo_health as sh
    from core import db
    from maker_auth import issue_session_jwt
    from server import app

    run = await _seed_run(db, [
        {"type": "fetch_error", "url": "https://craftersmarket.org/community",
         "detail": "timeout"},
        {"type": "fetch_error", "url": "https://craftersmarket.org/makers/x",
         "detail": "connection reset"},
    ])
    # Re-check finds the pages healthy now (transient blip cleared).
    monkeypatch.setattr(sh, "_check_url", AsyncMock(return_value=[]))

    admin_jwt = issue_session_jwt("admin", "team@craftersmarket.org", role="admin")
    hdrs = {"Authorization": f"Bearer {admin_jwt}"}
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.post("/api/admin/seo-health/autofix", headers=hdrs)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["resolved"] == 2
        assert body["remaining"] == 0
        stored = await db.seo_health_runs.find_one({"id": run["id"]}, {"_id": 0})
        assert stored["issue_count"] == 0
        assert stored["autofix"]["resolved"] == 2
    finally:
        await db.seo_health_runs.delete_one({"id": run["id"]})


async def test_autofix_keeps_persistent_issues(monkeypatch):
    from unittest.mock import AsyncMock
    import routers.seo_health as sh
    from core import db
    from maker_auth import issue_session_jwt
    from server import app

    bad = {"type": "wrong_canonical", "url": "https://craftersmarket.org/shop",
           "detail": "canonical → https://craftersmarket.org/"}
    run = await _seed_run(db, [dict(bad)])
    monkeypatch.setattr(sh, "_check_url", AsyncMock(return_value=[dict(bad)]))
    # Skip the real LLM call — diagnosis passthrough.
    monkeypatch.setattr(sh, "_ai_diagnose_issues", AsyncMock(side_effect=lambda i: i))

    admin_jwt = issue_session_jwt("admin", "team@craftersmarket.org", role="admin")
    hdrs = {"Authorization": f"Bearer {admin_jwt}"}
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.post("/api/admin/seo-health/autofix", headers=hdrs)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["resolved"] == 0
        assert body["remaining"] == 1
        assert body["run"]["issues"][0]["type"] == "wrong_canonical"
    finally:
        await db.seo_health_runs.delete_one({"id": run["id"]})
