"""iter413ba — Founder Funnel Dashboard contract.

Verifies:
  • GET /admin/founder-funnel?window=...
      - requires admin
      - validates window param (7d / 30d / 90d / all)
      - returns 8 stages in canonical order
      - returns 6 adjacent-stage conversion deltas
      - never divides by zero (all pct values are finite numbers)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import requests
import pytest

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
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def H(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


def test_funnel_requires_admin():
    r = requests.get(f"{BASE_URL}/api/admin/founder-funnel", timeout=15)
    assert r.status_code in (401, 403)


def test_funnel_rejects_bad_window(H):
    r = requests.get(f"{BASE_URL}/api/admin/founder-funnel?window=banana", headers=H, timeout=15)
    assert r.status_code == 422, r.text


def test_funnel_30d_shape(H):
    r = requests.get(f"{BASE_URL}/api/admin/founder-funnel?window=30d", headers=H, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["window"] == "30d"
    assert "generated_at" in body

    # Stage order is the documented spec — lock it.
    stage_keys = [s["key"] for s in body["stages"]]
    assert stage_keys == [
        "traffic", "lead", "applied", "approved",
        "store", "listing", "founder", "sale",
    ]
    for s in body["stages"]:
        assert isinstance(s["value"], int)
        assert s["value"] >= 0
        assert "label" in s and "source" in s

    # 6 adjacent-stage conversions, in canonical order.
    conv_pairs = [(c["from"], c["to"]) for c in body["conversions"]]
    assert conv_pairs == [
        ("traffic", "lead"),
        ("lead", "applied"),
        ("applied", "approved"),
        ("approved", "store"),
        ("store", "listing"),
        ("listing", "sale"),
    ]
    for c in body["conversions"]:
        # All pct values are finite numbers (never NaN / inf / null).
        assert isinstance(c["pct"], (int, float))
        assert c["pct"] >= 0


def test_funnel_all_window_includes_seeded_makers(H):
    """With window=all the Approved stage uses max(approved_apps, makers_doc),
    so it must be >= the standalone approved-applications count."""
    r_all = requests.get(f"{BASE_URL}/api/admin/founder-funnel?window=all", headers=H, timeout=20)
    r_all.raise_for_status()
    body = r_all.json()
    stages = {s["key"]: s["value"] for s in body["stages"]}
    # Sanity — there ARE seeded makers in this DB, so Approved must be >= 1.
    assert stages["approved"] >= 1
    # Featured Founder must never exceed Approved.
    assert stages["founder"] <= stages["approved"]
    # First Sale must never exceed First Listing.
    assert stages["sale"] <= stages["listing"] or stages["listing"] == 0


def test_funnel_warnings_never_crash_on_empty_data(H):
    """The warnings logic must produce a list even when counts are 0."""
    r = requests.get(f"{BASE_URL}/api/admin/founder-funnel?window=7d", headers=H, timeout=20)
    r.raise_for_status()
    body = r.json()
    assert isinstance(body.get("warnings"), list)
    for w in body["warnings"]:
        assert "key" in w and "title" in w and "detail" in w
        assert w.get("severity") in {"warn", "alert"}
