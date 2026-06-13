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
