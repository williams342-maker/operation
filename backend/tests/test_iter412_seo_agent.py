"""iter412 — AI SEO Growth Agent backend tests.

Smoke test for the daily-cron scanner + queue + approve/reject/rollback
flow. Uses the real /api endpoints to confirm wiring, auth, scoring,
issue surfacing, and audit history all work end-to-end.

Marked `smoke` via conftest.py SMOKE_FILES so the pre-deploy CI gate
exercises this.
"""
import os
import sys
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
sys.path.insert(0, "/app/backend")

from maker_auth import issue_admin_magic_token  # noqa: E402

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def admin_jwt():
    """Mint an admin JWT for the OPS email so the /api/admin/seo-agent
    endpoints accept us. Mirrors the production magic-link → JWT swap."""
    email = os.environ.get("OPS_EMAIL") or "team@craftersmarket.org"
    magic = issue_admin_magic_token(email)
    r = requests.post(f"{API}/admin/auth/verify", json={"token": magic}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}", "Content-Type": "application/json"}


def test_overview_requires_admin():
    r = requests.get(f"{API}/admin/seo-agent/overview", timeout=10)
    # No bearer → 401/403 (current_admin returns 401/403; either is correct)
    assert r.status_code in (401, 403)


def test_overview_returns_shape(headers):
    r = requests.get(f"{API}/admin/seo-agent/overview", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "next_scheduled_scan" in d
    assert "queue_pending" in d
    # latest_run may be None if no scan has ever happened in this DB; both OK


def test_manual_scan_then_overview_reflects(headers):
    # Trigger a scan
    r = requests.post(f"{API}/admin/seo-agent/scan/run", headers=headers, timeout=180)
    assert r.status_code == 200, r.text
    run = r.json()
    assert set(run["scores"].keys()) == {"overall", "technical", "content", "authority"}
    assert run["counts"]["targets_scanned"] >= 0
    for s in run["scores"].values():
        assert 0 <= s <= 100, f"score out of range: {s}"

    # Overview now reflects the just-finished scan
    r = requests.get(f"{API}/admin/seo-agent/overview", headers=headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["latest_run"]["id"] == run["id"]


def test_issues_filter_by_pillar(headers):
    r = requests.get(f"{API}/admin/seo-agent/issues?pillar=content", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()["issues"]
    for i in items:
        assert i["pillar"] == "content"


def test_queue_empty_filter(headers):
    r = requests.get(f"{API}/admin/seo-agent/queue?status=rejected", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    assert "items" in r.json()
    assert r.json()["status"] == "rejected"


def test_generate_fix_404_when_no_issue(headers):
    """Bogus issue_id returns 404 cleanly — confirms the lookup path
    works without falling through to a 500."""
    r = requests.post(
        f"{API}/admin/seo-agent/generate-fix",
        headers=headers,
        json={"issue_id": "this-id-does-not-exist"},
        timeout=15,
    )
    assert r.status_code == 404, r.text


def test_queue_approve_404_when_missing(headers):
    r = requests.post(
        f"{API}/admin/seo-agent/queue/this-id-does-not-exist/approve",
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 404


def test_queue_reject_404_when_missing(headers):
    r = requests.post(
        f"{API}/admin/seo-agent/queue/this-id-does-not-exist/reject",
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 404


# iter413 — Recommendations engine + Reporting tab endpoints
def test_recommendations_returns_ranked_groups(headers):
    """After the scan in test_manual_scan_then_overview_reflects ran,
    we should have recommendations grouped by kind and sorted by
    impact-per-effort ratio."""
    r = requests.get(f"{API}/admin/seo-agent/recommendations", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "recommendations" in d
    recs = d["recommendations"]
    # Every recommendation has the impact/effort metadata + issue group
    for rec in recs:
        assert {"id", "kind", "title", "severity", "affected_count",
                "effort_minutes", "expected_traffic_pct", "fixable_via_ai",
                "impact_label", "effort_label", "issue_ids"}.issubset(rec.keys())
        assert rec["impact_label"] in {"high", "medium", "low"}
        assert rec["effort_label"] in {"high", "medium", "low"}
        assert rec["affected_count"] == len(rec["issue_ids"]) or rec["affected_count"] > len(rec["issue_ids"])


def test_history_returns_time_series(headers):
    r = requests.get(f"{API}/admin/seo-agent/history?days=30", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["window_days"] == 30
    assert isinstance(d["history"], list)
    assert "queue_activity" in d
    assert {"applied", "rejected", "rolled_back"}.issubset(d["queue_activity"].keys())
    # At least the run from test_manual_scan_then_overview_reflects
    # should be in the history.
    assert len(d["history"]) >= 1
    # Every history point carries scores in [0..100]
    for h in d["history"]:
        for s in h["scores"].values():
            assert 0 <= s <= 100


def test_history_window_clamps(headers):
    """days param is clamped to 1..180. Falsy values fall back to the
    30-day default."""
    r = requests.get(f"{API}/admin/seo-agent/history?days=99999", headers=headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["window_days"] == 180

    # days=0 is falsy → defaults to 30, not 1.
    r = requests.get(f"{API}/admin/seo-agent/history?days=0", headers=headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["window_days"] == 30

    r = requests.get(f"{API}/admin/seo-agent/history?days=1", headers=headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["window_days"] == 1


def test_recommendations_requires_admin():
    r = requests.get(f"{API}/admin/seo-agent/recommendations", timeout=10)
    assert r.status_code in (401, 403)


def test_history_requires_admin():
    r = requests.get(f"{API}/admin/seo-agent/history", timeout=10)
    assert r.status_code in (401, 403)


# iter413c — Pillar 3 Authority + Autopilot mode
def test_authority_pillar_surfaces_issues(headers):
    """Scan should produce authority-pillar issues for makers with
    incomplete profiles + the new authority recommendations."""
    r = requests.post(f"{API}/admin/seo-agent/scan/run", headers=headers, timeout=180)
    assert r.status_code == 200, r.text
    run = r.json()
    # Authority count is exposed in counts and used by the scoring
    assert "authority" in run["counts"]
    # Bundled issues include the new pillar
    auth_kinds = {i["kind"] for i in run["issues"] if i["pillar"] == "authority"}
    assert auth_kinds  # at least one authority kind present
    # Authority recommendations grouped + ranked
    auth_recs = [r for r in run["recommendations"]
                 if r["kind"].startswith("maker_") or r["kind"] == "landing_thin_relations"]
    for rec in auth_recs:
        assert rec["affected_count"] > 0


def test_config_endpoints_round_trip(headers):
    """GET returns current mode + valid modes + low-risk whitelist.
    POST persists. Re-read confirms."""
    r = requests.get(f"{API}/admin/seo-agent/config", headers=headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["mode"] in ("observe", "assist", "approve", "autopilot")
    assert set(d["valid_modes"]) == {"observe", "assist", "approve", "autopilot"}
    assert "missing_alt_text" in d["autopilot_low_risk_kinds"]

    # Flip to assist then back to approve — confirm persistence
    for mode in ("assist", "approve"):
        r = requests.post(f"{API}/admin/seo-agent/config", headers=headers,
                          json={"mode": mode}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["mode"] == mode
        r = requests.get(f"{API}/admin/seo-agent/config", headers=headers, timeout=15)
        assert r.json()["mode"] == mode


def test_config_rejects_invalid_mode(headers):
    r = requests.post(f"{API}/admin/seo-agent/config", headers=headers,
                      json={"mode": "self-destruct"}, timeout=15)
    assert r.status_code == 400


def test_config_requires_admin():
    r = requests.get(f"{API}/admin/seo-agent/config", timeout=10)
    assert r.status_code in (401, 403)
    r = requests.post(f"{API}/admin/seo-agent/config",
                      json={"mode": "assist"}, timeout=10)
    assert r.status_code in (401, 403)


def test_overview_exposes_mode(headers):
    """The Overview endpoint must return the current mode so the
    frontend selector can highlight the active option."""
    r = requests.get(f"{API}/admin/seo-agent/overview", headers=headers, timeout=15)
    assert r.status_code == 200
    assert "mode" in r.json()
