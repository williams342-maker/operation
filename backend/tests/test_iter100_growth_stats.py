"""iter100 — Admin growth heartbeat.

Verifies the /api/admin/growth-stats endpoint returns the expected
shape with totals + 24h/7d deltas, and that auth gating works.
"""
import pytest
from fastapi.testclient import TestClient

from server import app
from maker_auth import issue_session_jwt


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_growth_stats_returns_expected_shape(client):
    token = issue_session_jwt("admin", "team@craftersmarket.org", role="admin")
    r = client.get("/api/admin/growth-stats", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()
    assert "as_of" in data
    assert "stats" in data
    keys = [s["key"] for s in data["stats"]]
    expected = {
        "update_subscribers", "coming_soon_neon", "coming_soon_furniture",
        "restock_waitlist", "beta_feedback",
    }
    assert expected.issubset(set(keys))
    for s in data["stats"]:
        for k in ("key", "label", "total", "d1", "d7"):
            assert k in s
        assert isinstance(s["total"], int)
        assert isinstance(s["d1"], int)
        assert isinstance(s["d7"], int)
        # d1 must never exceed d7 (24h is a subset of 7d)
        assert s["d1"] <= s["d7"]
        # Both must be non-negative; totals can never be smaller than 7d delta
        assert s["d1"] >= 0 and s["d7"] >= 0
        assert s["total"] >= s["d7"]


def test_growth_stats_requires_admin_auth(client):
    r = client.get("/api/admin/growth-stats")
    assert r.status_code in (401, 403)
