"""iter413bp — Admin Operations Dashboard aggregator contract.

Locks the shape of `/admin/ops-dashboard/overview` so future refactors
don't silently break the new admin landing layer.
"""
from __future__ import annotations

import os
import sys
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


def test_requires_auth():
    r = requests.get(f"{BASE_URL}/api/admin/ops-dashboard/overview", timeout=15)
    assert r.status_code in (401, 403)


def test_overview_returns_all_six_sections(H):
    r = requests.get(f"{BASE_URL}/api/admin/ops-dashboard/overview", headers=H, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    expected = {
        "generated_at", "summary", "action_queue", "marketplace_health",
        "founder_funnel", "daily_brief", "recent_activity",
    }
    assert expected.issubset(set(data.keys())), f"missing sections: {expected - set(data.keys())}"


def test_summary_card_shape(H):
    data = requests.get(f"{BASE_URL}/api/admin/ops-dashboard/overview", headers=H, timeout=30).json()
    s = data["summary"]
    for k in ("critical", "needs_review", "healthy", "activity"):
        assert k in s, f"summary missing key {k}"
        assert isinstance(s[k], int), f"summary[{k}] must be int"


def test_action_queue_groups(H):
    data = requests.get(f"{BASE_URL}/api/admin/ops-dashboard/overview", headers=H, timeout=30).json()
    aq = data["action_queue"]
    assert set(aq.keys()) == {"critical", "review", "growth"}
    for group_id, items in aq.items():
        for it in items:
            assert "id" in it and "title" in it and "desc" in it
            assert "cta_label" in it and "cta_tab" in it
            assert it["severity"] in ("critical", "review", "growth")


def test_marketplace_health_metrics(H):
    data = requests.get(f"{BASE_URL}/api/admin/ops-dashboard/overview", headers=H, timeout=30).json()
    metrics = data["marketplace_health"]["metrics"]
    assert len(metrics) == 7, f"expected 7 KPI cards, got {len(metrics)}"
    expected_ids = {
        "applications_7d", "approved_7d", "active_sellers",
        "listings_pending", "orders_open", "custom_orders_open", "revenue_today",
    }
    assert {m["id"] for m in metrics} == expected_ids
    for m in metrics:
        assert m["status"] in ("green", "yellow", "red")
        assert "cta_tab" in m


def test_founder_funnel_has_six_stages(H):
    data = requests.get(f"{BASE_URL}/api/admin/ops-dashboard/overview", headers=H, timeout=30).json()
    stages = data["founder_funnel"]["stages"]
    assert len(stages) == 6
    stage_ids = [s["id"] for s in stages]
    assert stage_ids == ["visitor", "application", "approved", "activated", "first_listing", "first_sale"]
    # First stage has no conversion %; the rest must.
    assert stages[0]["conversion_pct"] is None
    for s in stages[1:]:
        assert isinstance(s["conversion_pct"], (int, float))


def test_daily_brief_has_opportunity_risk_actions(H):
    data = requests.get(f"{BASE_URL}/api/admin/ops-dashboard/overview", headers=H, timeout=30).json()
    brief = data["daily_brief"]
    assert isinstance(brief["opportunity"], str) and brief["opportunity"]
    assert isinstance(brief["risk"], str) and brief["risk"]
    assert isinstance(brief["actions"], list)
    for a in brief["actions"]:
        assert "label" in a and "cta_tab" in a
    # Cap at 3 actions (rule engine contract).
    assert len(brief["actions"]) <= 3


def test_recent_activity_capped_and_sorted(H):
    data = requests.get(f"{BASE_URL}/api/admin/ops-dashboard/overview", headers=H, timeout=30).json()
    items = data["recent_activity"]["items"]
    assert len(items) <= 20, "activity rail must be capped at 20"
    # Sorted newest-first.
    tss = [it.get("ts") for it in items if it.get("ts")]
    assert tss == sorted(tss, reverse=True), "items must be newest-first"
    # Only the big 5 kinds are allowed.
    allowed = {
        "application_submitted", "order_placed", "custom_request",
        "seller_approved", "automation_failed",
    }
    for it in items:
        assert it["kind"] in allowed, f"unexpected kind {it['kind']!r} — should be one of {allowed}"
        assert "cta_tab" in it
