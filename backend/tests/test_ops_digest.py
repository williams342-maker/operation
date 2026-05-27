"""Regression: daily ops digest (iter263)."""
import os
import pytest

import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


@pytest.mark.asyncio
async def test_build_digest_data_shape():
    """build_digest_data() returns all six sections with the right keys."""
    from ops_digest import build_digest_data
    data = await build_digest_data()
    assert {"window", "revenue", "makers", "catalog", "traffic", "reliability", "community"} <= set(data)
    assert {"since", "until"} <= set(data["window"])
    assert {"orders", "gmv", "aov", "top_makers"} <= set(data["revenue"])
    assert {"new_applications", "new_approvals", "new_makers", "new_plus"} <= set(data["makers"])
    assert {"new_listings", "new_design_files", "new_clips"} <= set(data["catalog"])
    assert {"pageviews", "sessions", "visitors", "top_sources", "top_pages"} <= set(data["traffic"])
    assert {"outages", "budget_alerts"} <= set(data["reliability"])
    assert {"new_showcase_posts", "new_forum_threads", "new_organic_uploads"} <= set(data["community"])


@pytest.mark.asyncio
async def test_send_daily_digest_dry_run():
    """dry_run=True returns rendered HTML without dispatching email."""
    from ops_digest import send_daily_digest
    result = await send_daily_digest(dry_run=True)
    assert result["sent"] is False
    assert result["dry_run"] is True
    assert result["html_bytes"] > 1000
    assert "data" in result


@pytest.mark.asyncio
async def test_send_daily_digest_disabled_via_env(monkeypatch):
    """OPS_DIGEST_ENABLED=false short-circuits the send."""
    monkeypatch.setenv("OPS_DIGEST_ENABLED", "false")
    from ops_digest import send_daily_digest
    result = await send_daily_digest()
    assert result["sent"] is False
    assert result["reason"] == "disabled_via_env"


@pytest.mark.asyncio
async def test_admin_endpoints_require_auth():
    async with httpx.AsyncClient(timeout=10) as c:
        r1 = await c.get(f"{API}/api/admin/ops-digest/preview")
        r2 = await c.post(f"{API}/api/admin/ops-digest/send-now", json={})
    assert r1.status_code == 401
    assert r2.status_code == 401


@pytest.mark.asyncio
async def test_yesterday_window_is_24h_utc():
    from ops_digest import _yesterday_window
    from datetime import datetime
    since, until = _yesterday_window()
    s = datetime.fromisoformat(since.replace("Z", "+00:00"))
    u = datetime.fromisoformat(until.replace("Z", "+00:00"))
    delta = u - s
    assert delta.total_seconds() == 24 * 3600
    assert s.hour == 0 and s.minute == 0
    assert u.hour == 0 and u.minute == 0


def test_render_html_handles_empty_data():
    """The renderer should never crash on a zero-traffic / zero-sales day."""
    from ops_digest import _render_html
    empty = {
        "window": {"since": "2026-05-26T00:00:00Z", "until": "2026-05-27T00:00:00Z"},
        "revenue": {"orders": 0, "gmv": 0.0, "aov": 0.0, "top_makers": []},
        "makers": {"new_applications": 0, "new_approvals": 0, "new_makers": 0, "new_plus": 0},
        "catalog": {"new_listings": 0, "new_design_files": 0, "new_clips": 0},
        "traffic": {"pageviews": 0, "sessions": 0, "visitors": 0, "top_sources": [], "top_pages": []},
        "reliability": {"outages": [], "budget_alerts": []},
        "community": {"new_showcase_posts": 0, "new_forum_threads": 0, "new_organic_uploads": 0},
    }
    html = _render_html("Test · May 26", empty)
    assert "Daily ops digest" in html
    assert "All clear" in html  # reliability shows ✓ when nothing to report
    assert "$0.00" in html
