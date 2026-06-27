"""iter413cy — Loretta production verification preflight.

Runs the *automatable* parts of the Loretta verification checklist
(/app/memory/loretta_verification.md) so we catch any environmental
regressions BEFORE booking her time. Default target is the preview
URL; pass --base-url to point at production.

Usage:
    # Preview (default)
    pytest tests/test_loretta_production_preflight.py -v

    # Production
    BASE_URL=https://craftersmarket.org pytest tests/test_loretta_production_preflight.py -v

Run BEFORE every scheduled walk-through with the founding seller.
All checks must pass.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = (
    os.environ.get("LORETTA_BASE_URL")
    or os.environ.get("REACT_APP_BACKEND_URL")
    or "https://active-project-4.preview.emergentagent.com"
).rstrip("/")


# ── Item 1 — Fiber & Textile techniques ──────────────────────────────
def test_capabilities_exposes_fiber_textile_techniques():
    """The category-aware technique map must include Sewing for Fiber
    & Textiles (the missing-technique gap Loretta flagged)."""
    r = requests.get(f"{BASE_URL}/api/platform/capabilities", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    cats = body["taxonomy"]["categories"]
    assert "Fiber & Textiles" in cats
    fiber = body["taxonomy"]["techniques_by_category"]["Fiber & Textiles"]
    assert "Sewing" in fiber, f"Sewing missing from Fiber & Textiles techniques: {fiber}"
    # "Other" must remain available as the freeform escape hatch.
    assert "Other" in cats


# ── Item 2 — Existing CNC URL regression ─────────────────────────────
def test_existing_listings_still_serve_200():
    """Smoke a few existing listings to confirm no schema regression
    left them un-renderable. We pull whatever 5 listings are available
    in the env — the goal is "did the technique rework brick anyone?"."""
    list_r = requests.get(f"{BASE_URL}/api/products?limit=5", timeout=15)
    assert list_r.status_code == 200, list_r.text
    rows = list_r.json()
    items = rows if isinstance(rows, list) else (rows.get("items") or rows.get("rows") or [])
    assert items, "no listings in this env — preflight needs at least 1 product"
    for p in items[:5]:
        slug = p.get("slug")
        if not slug:
            continue
        pdp = requests.get(f"{BASE_URL}/api/products/{slug}", timeout=15)
        assert pdp.status_code == 200, f"PDP failed for {slug}: {pdp.status_code}"
        body = pdp.json()
        # Listings created before the technique rework must still resolve.
        # Tech field may be empty/legacy but the PDP must not 500.
        assert body.get("slug") == slug


# ── Item 4 — Listing Video constraints (iter413cx) ───────────────────
def test_video_capabilities_flipped_to_live():
    r = requests.get(f"{BASE_URL}/api/platform/capabilities", timeout=15)
    body = r.json()
    lv = body["features"]["listing_videos"]
    assert lv["upload_enabled"] is True, "listing_videos.upload_enabled is still False — iter413cx not deployed"
    assert lv["max_size_mb"] == 100
    assert lv["max_duration_seconds"] == 60
    assert "mp4" in lv["supported_video_formats"]
    assert "mov" in lv["supported_video_formats"]


def test_video_endpoint_no_longer_blanket_rejects():
    """Anon hit on the video endpoint — must NOT come back with the
    legacy `video_uploads_disabled` (would mean iter413cx didn't ship)."""
    r = requests.post(
        f"{BASE_URL}/api/maker/uploads/video",
        files={"file": ("probe.mp4", b"\x00" * 32, "video/mp4")},
        timeout=15,
    )
    # 401/403 (auth gate) is the expected outcome — and crucially NOT 422.
    assert r.status_code in (401, 403), f"unexpected status {r.status_code}: {r.text}"
    try:
        body = r.json()
        detail = (body.get("detail") if isinstance(body.get("detail"), dict) else None) or {}
        assert detail.get("code") != "video_uploads_disabled", \
            "Legacy blanket reject is back — iter413cx must not be live"
    except ValueError:
        pass  # non-JSON 401 body from the auth layer is acceptable


# ── Item 7 — Compass accuracy ────────────────────────────────────────
def test_compass_self_identifies():
    r = requests.post(
        f"{BASE_URL}/api/help/chat",
        json={"message": "Who are you?"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    reply = r.json()["reply"].lower()
    assert "compass" in reply, f"Compass identity drift: {reply[:200]}"


def test_compass_says_videos_now_supported():
    """Critical Loretta-fix verification — Compass must answer YES with
    the new constraints, NOT the old "not supported yet" line."""
    r = requests.post(
        f"{BASE_URL}/api/help/chat",
        json={"message": "Can I upload a video to my listing?", "user_role": "maker"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    reply = r.json()["reply"].lower()
    assert ("mp4" in reply) or ("mov" in reply), f"video format missing: {reply[:200]}"
    assert "60" in reply, f"60-second cap missing: {reply[:200]}"
    assert "100" in reply, f"100 MB cap missing: {reply[:200]}"
    # Negative checks — old lies must be gone.
    assert "not supported yet" not in reply
    assert "planned for a future release" not in reply


def test_compass_help_chat_flags_bug_intent():
    """Sanity-check the iter413cq bug-cue path: a clear bug report
    should set report_issue_cue=true."""
    r = requests.post(
        f"{BASE_URL}/api/help/chat",
        json={"message": "The checkout button is completely broken — I click pay and nothing happens", "user_role": "buyer"},
        timeout=30,
    )
    assert r.status_code == 200
    assert r.json().get("report_issue_cue") is True


# ── Compass surface + brand assets present ───────────────────────────
def test_compass_brand_assets_served():
    for path in (
        "/brand/compass-master.svg",
        "/brand/compass-favicon.svg",
        "/brand/compass-light.svg",
        "/brand/compass-dark.svg",
        "/brand/compass-brand.svg",
        "/brand/compass-avatar.svg",
    ):
        r = requests.get(f"{BASE_URL}{path}", timeout=10)
        assert r.status_code == 200, f"{path} returned {r.status_code}"


def test_homepage_carries_compass_chrome():
    """Index.html must declare the SVG favicon link added in iter413cv —
    a missing link here means the brand sweep didn't deploy."""
    r = requests.get(f"{BASE_URL}/", timeout=15)
    assert r.status_code == 200
    assert "/brand/compass-favicon.svg" in r.text
    assert "rel=\"mask-icon\"" in r.text and "/brand/compass-master.svg" in r.text
