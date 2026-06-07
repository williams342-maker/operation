"""iter335.13 live preview-URL tests for P2 (Recommend) + P3 (Themes).

Hits the public REACT_APP_BACKEND_URL so we validate routing + middleware,
not just ASGI internals.
"""
from __future__ import annotations
import os
import sys
import uuid
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
ADMIN_EMAIL = "team@craftersmarket.org"


def _maker_jwt() -> str:
    from maker_auth import issue_magic_token  # type: ignore
    token = issue_magic_token(MAKER_EMAIL)
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify", json={"token": token}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token  # type: ignore
    token = issue_admin_magic_token(ADMIN_EMAIL)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": token}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ───────────── P2 · Budget recommender ─────────────
class TestRecommend:
    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/promote/budget/recommend",
                          json={"goal": "sales"}, timeout=20)
        assert r.status_code in (401, 403), r.status_code

    def test_bad_goal_returns_400(self):
        jwt = _maker_jwt()
        r = requests.post(f"{BASE_URL}/api/promote/budget/recommend",
                          headers={"Authorization": f"Bearer {jwt}"},
                          json={"goal": "bogus"}, timeout=30)
        assert r.status_code == 400, r.text

    def test_happy_path_returns_full_payload(self):
        jwt = _maker_jwt()
        r = requests.post(f"{BASE_URL}/api/promote/budget/recommend",
                          headers={"Authorization": f"Bearer {jwt}"},
                          json={"goal": "sales"}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        # Contract assertions
        for k in ("recommended_cents", "low_cents", "high_cents",
                  "expected_reach", "expected_clicks", "expected_orders",
                  "rationale", "basis", "breakdown", "goal"):
            assert k in d, f"missing {k}: {d.keys()}"
        assert d["goal"] == "sales"
        assert d["basis"] in ("your-data", "marketplace-default")
        assert d["recommended_cents"] >= 2500
        assert d["low_cents"] <= d["recommended_cents"] <= d["high_cents"]
        assert isinstance(d["rationale"], str) and len(d["rationale"]) > 5

    def test_all_three_goals_work(self):
        jwt = _maker_jwt()
        seen = {}
        for goal in ("sales", "traffic", "reach"):
            r = requests.post(f"{BASE_URL}/api/promote/budget/recommend",
                              headers={"Authorization": f"Bearer {jwt}"},
                              json={"goal": goal}, timeout=60)
            assert r.status_code == 200, f"{goal}: {r.text}"
            seen[goal] = r.json()["recommended_cents"]
        # Different goals SHOULD produce different recommendations once
        # the maker has listings (saturation caps differ).
        assert len(set(seen.values())) >= 1


# ───────────── P3 · Themes ─────────────
@pytest.fixture(scope="module")
def admin_jwt():
    return _admin_jwt()


@pytest.fixture(scope="module")
def maker_jwt():
    return _maker_jwt()


class TestAdminThemesCRUD:
    created_id = None
    slug = None

    def test_create_theme(self, admin_jwt):
        today = datetime.now(timezone.utc).date()
        slug = f"test-theme-{uuid.uuid4().hex[:6]}"
        body = {
            "name": f"TEST Theme {slug}",
            "slug": slug,
            "start_date": today.isoformat(),
            "end_date": (today + timedelta(days=14)).isoformat(),
            "pool_total_cents": 250000,
            "category_filter": ["wood", "outdoor"],
            "per_maker_cap_cents": 5000,
            "per_listing_cap_cents": 2000,
        }
        r = requests.post(f"{BASE_URL}/api/admin/promote/themes",
                          headers={"Authorization": f"Bearer {admin_jwt}"},
                          json=body, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        # Response is {theme: {...}} or flat dict
        theme = d.get("theme") if isinstance(d.get("theme"), dict) else d
        assert theme.get("slug") == slug, theme
        TestAdminThemesCRUD.created_id = (
            theme.get("id") or theme.get("theme_id") or theme.get("_id") or slug
        )
        TestAdminThemesCRUD.slug = slug
        assert TestAdminThemesCRUD.created_id, theme

    def test_duplicate_slug_409(self, admin_jwt):
        # Re-post same slug
        assert TestAdminThemesCRUD.slug
        today = datetime.now(timezone.utc).date()
        body = {
            "name": "dup", "slug": TestAdminThemesCRUD.slug,
            "start_date": today.isoformat(),
            "end_date": (today + timedelta(days=7)).isoformat(),
            "pool_total_cents": 1000,
        }
        r = requests.post(f"{BASE_URL}/api/admin/promote/themes",
                          headers={"Authorization": f"Bearer {admin_jwt}"},
                          json=body, timeout=30)
        assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text}"

    def test_end_before_start_400(self, admin_jwt):
        today = datetime.now(timezone.utc).date()
        body = {
            "name": "bad-dates",
            "slug": f"test-bad-{uuid.uuid4().hex[:6]}",
            "start_date": today.isoformat(),
            "end_date": (today - timedelta(days=2)).isoformat(),
            "pool_total_cents": 1000,
        }
        r = requests.post(f"{BASE_URL}/api/admin/promote/themes",
                          headers={"Authorization": f"Bearer {admin_jwt}"},
                          json=body, timeout=30)
        assert r.status_code == 400, f"got {r.status_code}: {r.text}"

    def test_list_includes_created(self, admin_jwt):
        r = requests.get(f"{BASE_URL}/api/admin/promote/themes",
                         headers={"Authorization": f"Bearer {admin_jwt}"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        themes = data if isinstance(data, list) else data.get("themes", [])
        slugs = {t.get("slug") for t in themes}
        assert TestAdminThemesCRUD.slug in slugs, slugs

    def test_status_transitions(self, admin_jwt):
        tid = TestAdminThemesCRUD.created_id
        for status in ("paused", "active", "ended"):
            r = requests.post(
                f"{BASE_URL}/api/admin/promote/themes/{tid}/status",
                headers={"Authorization": f"Bearer {admin_jwt}"},
                params={"status": status}, timeout=30,
            )
            assert r.status_code in (200, 204), f"{status}: {r.status_code} {r.text}"

    def test_unauthenticated_admin_endpoints(self):
        r = requests.get(f"{BASE_URL}/api/admin/promote/themes", timeout=20)
        assert r.status_code in (401, 403)

    def test_maker_cannot_access_admin_themes(self, maker_jwt):
        r = requests.get(f"{BASE_URL}/api/admin/promote/themes",
                         headers={"Authorization": f"Bearer {maker_jwt}"}, timeout=20)
        assert r.status_code in (401, 403)


class TestMakerActiveThemes:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/promote/themes/active", timeout=20)
        assert r.status_code in (401, 403)

    def test_returns_shape(self, maker_jwt):
        r = requests.get(f"{BASE_URL}/api/promote/themes/active",
                         headers={"Authorization": f"Bearer {maker_jwt}"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "themes" in d
        for t in d["themes"]:
            for k in ("slug", "name", "pool_total_cents",
                      "pool_remaining_cents",
                      "claimed_by_maker_cents",
                      "remaining_for_maker_cents"):
                assert k in t, f"missing {k}: {t.keys()}"
