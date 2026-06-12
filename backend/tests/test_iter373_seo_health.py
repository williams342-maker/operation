"""iter373 — Admin SEO health monitor.

Covers:
  • _analyze_page rule engine: redirect, http_error, wrong_canonical,
    noindex_leak, clean page, canonical normalization (trailing slash).
  • Endpoint auth: both admin endpoints reject anonymous callers.
  • Run + latest plumbing with the crawler mocked (no network).
"""
import os
import sys

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
from httpx import ASGITransport, AsyncClient

from routers.seo_health import _analyze_page, _norm

pytestmark = pytest.mark.asyncio


# ── Rule engine (pure, no IO) ──
def test_analyze_redirect():
    out = _analyze_page("https://x.org/shop", 301, "", "https://x.org/")
    assert out[0]["type"] == "redirect"
    assert "301" in out[0]["detail"]


def test_analyze_http_error():
    out = _analyze_page("https://x.org/shop", 404, "")
    assert out[0]["type"] == "http_error"


def test_analyze_wrong_canonical():
    html = '<head><link rel="canonical" href="https://x.org/"></head>'
    out = _analyze_page("https://x.org/shop", 200, html)
    assert [i["type"] for i in out] == ["wrong_canonical"]


def test_analyze_self_canonical_ok_with_trailing_slash():
    html = '<link rel="canonical" href="https://x.org/shop/">'
    assert _analyze_page("https://x.org/shop", 200, html) == []


def test_analyze_noindex_leak():
    html = '<meta name="robots" content="noindex, follow">'
    out = _analyze_page("https://x.org/shop", 200, html)
    assert [i["type"] for i in out] == ["noindex_leak"]


def test_analyze_clean_page_no_canonical():
    # Raw SPA shell has no canonical (iter372) — that is NOT an issue.
    assert _analyze_page("https://x.org/shop", 200, "<html><head></head></html>") == []


def test_norm():
    assert _norm("HTTPS://X.org/Shop/") == "https://x.org/Shop"


# ── Endpoints ──
async def test_endpoints_require_admin():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        r1 = await c.get("/api/admin/seo-health/latest")
        r2 = await c.post("/api/admin/seo-health/run")
    assert r1.status_code == 401
    assert r2.status_code == 401


async def test_run_and_latest_with_mocked_crawl(monkeypatch):
    from unittest.mock import AsyncMock
    import routers.seo_health as sh
    from core import db
    from maker_auth import issue_session_jwt
    from server import app

    fake_run = {
        "id": "test-run-iter373", "site": "https://craftersmarket.org",
        "trigger": "manual", "started_at": "2099-01-01T00:00:00+00:00",
        "finished_at": "2099-01-01T00:00:10+00:00", "checked": 5,
        "sitemap_urls": 174, "issue_count": 1,
        "issues": [{"type": "wrong_canonical", "url": "https://craftersmarket.org/shop",
                    "detail": "canonical → https://craftersmarket.org/"}],
    }
    monkeypatch.setattr(sh, "run_seo_health_check", AsyncMock(return_value=fake_run))
    await db.seo_health_runs.delete_many({"id": "test-run-iter373"})
    await db.seo_health_runs.insert_one({**fake_run})

    admin_jwt = issue_session_jwt("admin", "team@craftersmarket.org", role="admin")
    hdrs = {"Authorization": f"Bearer {admin_jwt}"}
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.post("/api/admin/seo-health/run", headers=hdrs)
            assert r.status_code == 200, r.text
            assert r.json()["issue_count"] == 1

            r = await c.get("/api/admin/seo-health/latest", headers=hdrs)
            assert r.status_code == 200
            data = r.json()
            assert data["latest"]["id"] == "test-run-iter373"
            assert data["latest"]["issues"][0]["type"] == "wrong_canonical"
    finally:
        await db.seo_health_runs.delete_many({"id": "test-run-iter373"})
