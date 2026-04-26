"""iter11 — Web analytics ingest + admin dashboard aggregation."""
import os
import sys
import time
import uuid

import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import (  # noqa: E402
    issue_admin_magic_token, issue_buyer_magic_token, issue_magic_token,
)

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def admin_jwt():
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{API}/admin/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200
    return r.json()["token"]


def H(jwt):
    return {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}


# ============================================================================
# 1. Ingest endpoint
# ============================================================================
class TestAnalyticsIngest:

    def test_ingest_anonymous_ok(self):
        r = requests.post(
            f"{API}/analytics/track",
            json={"path": "/shop", "visitor_id": "v_iter11_a",
                  "session_id": "s_iter11_a", "title": "Shop"},
            headers={"User-Agent": "Mozilla/5.0 Chrome/121"},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True
        assert "skipped" not in r.json()

    def test_ingest_classifies_mobile(self):
        ua = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
              "AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")
        r = requests.post(
            f"{API}/analytics/track",
            json={"path": "/", "visitor_id": "v_iter11_m",
                  "session_id": "s_iter11_m", "title": "Home"},
            headers={"User-Agent": ua},
            timeout=10,
        )
        assert r.status_code == 200
        # Verify via admin endpoint
        admin = issue_admin_magic_token("team@craftersmarket.org")
        ajwt = requests.post(f"{API}/admin/auth/verify",
                             json={"token": admin}, timeout=10).json()["token"]
        r2 = requests.get(f"{API}/admin/analytics/web", headers=H(ajwt), timeout=10)
        d = r2.json()
        device_keys = [x["key"] for x in d["devices"]]
        assert "mobile" in device_keys

    def test_ingest_skips_bots(self):
        for ua in ("Googlebot/2.1",
                   "Mozilla/5.0 (compatible; bingbot/2.0)",
                   "facebookexternalhit/1.1"):
            r = requests.post(
                f"{API}/analytics/track",
                json={"path": "/", "visitor_id": "v_bot",
                      "session_id": "s_bot", "title": "Home"},
                headers={"User-Agent": ua},
                timeout=10,
            )
            assert r.status_code == 200
            assert r.json().get("skipped") == "bot", ua

    def test_ingest_rejects_missing_ids(self):
        r = requests.post(
            f"{API}/analytics/track",
            json={"path": "/", "visitor_id": "", "session_id": "", "title": ""},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is False
        assert body.get("skipped") == "missing-ids"

    def test_ingest_required_fields_validation(self):
        r = requests.post(f"{API}/analytics/track", json={}, timeout=10)
        assert r.status_code == 422


# ============================================================================
# 2. Referer classification
# ============================================================================
class TestRefererClassification:

    def _track_and_fetch_sources(self, referer, vid, sid, ua="Mozilla/5.0 Chrome/121"):
        r = requests.post(
            f"{API}/analytics/track",
            json={"path": "/", "visitor_id": vid, "session_id": sid,
                  "referer": referer, "title": "Home"},
            headers={"User-Agent": ua, "Referer": referer},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        admin = issue_admin_magic_token("team@craftersmarket.org")
        ajwt = requests.post(f"{API}/admin/auth/verify",
                             json={"token": admin}, timeout=10).json()["token"]
        return requests.get(f"{API}/admin/analytics/web",
                            headers=H(ajwt), timeout=10).json()

    def test_organic_search(self):
        d = self._track_and_fetch_sources(
            "https://www.google.com/search?q=cnc+art",
            f"v_org_{uuid.uuid4().hex[:6]}", f"s_org_{uuid.uuid4().hex[:6]}",
        )
        assert "organic" in [x["key"] for x in d["traffic_sources"]]

    def test_social_referer(self):
        d = self._track_and_fetch_sources(
            "https://twitter.com/x/status/123",
            f"v_soc_{uuid.uuid4().hex[:6]}", f"s_soc_{uuid.uuid4().hex[:6]}",
        )
        assert "social" in [x["key"] for x in d["traffic_sources"]]

    def test_direct_traffic(self):
        d = self._track_and_fetch_sources(
            "",
            f"v_dir_{uuid.uuid4().hex[:6]}", f"s_dir_{uuid.uuid4().hex[:6]}",
        )
        assert "direct" in [x["key"] for x in d["traffic_sources"]]


# ============================================================================
# 3. Admin endpoint auth gating + shape
# ============================================================================
class TestAdminWebAnalyticsEndpoint:

    def test_unauth_rejected(self):
        r = requests.get(f"{API}/admin/analytics/web", timeout=10)
        assert r.status_code in (401, 403)

    def test_buyer_jwt_rejected(self):
        email = f"TEST_iter11_{uuid.uuid4().hex[:6]}@example.com"
        bjwt = requests.post(
            f"{API}/community/auth/magic/verify",
            json={"token": issue_buyer_magic_token(email), "accept_eua": True, "eua_version": "2026-04"},
            timeout=10,
        ).json()["token"]
        r = requests.get(f"{API}/admin/analytics/web",
                         headers=H(bjwt), timeout=10)
        assert r.status_code == 403

    def test_maker_jwt_rejected(self):
        mjwt = requests.post(
            f"{API}/maker/auth/verify",
            json={"token": issue_magic_token("iron-and-oak@craftersmarket.org")},
            timeout=10,
        ).json()["token"]
        r = requests.get(f"{API}/admin/analytics/web",
                         headers=H(mjwt), timeout=10)
        assert r.status_code == 403

    def test_admin_happy_path_shape(self, admin_jwt):
        r = requests.get(f"{API}/admin/analytics/web",
                         headers=H(admin_jwt), timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("window_days", "total_views", "unique_visitors",
                  "sessions", "views_7d", "top_pages", "devices",
                  "top_countries", "top_cities", "traffic_sources",
                  "top_referrers"):
            assert k in d, f"missing {k}"
        assert d["window_days"] == 30
        assert isinstance(d["top_pages"], list)
        assert isinstance(d["devices"], list)


# ============================================================================
# 4. Privacy: no full IP returned
# ============================================================================
class TestPrivacy:

    def test_response_never_returns_full_ip(self, admin_jwt):
        # Track an event from a known-public-looking IP via X-Forwarded-For
        requests.post(
            f"{API}/analytics/track",
            json={"path": "/", "visitor_id": f"v_priv_{uuid.uuid4().hex[:6]}",
                  "session_id": f"s_priv_{uuid.uuid4().hex[:6]}", "title": "x"},
            headers={"User-Agent": "Mozilla/5.0 Chrome/121",
                     "X-Forwarded-For": "8.8.8.8"},
            timeout=10,
        )
        time.sleep(0.5)
        r = requests.get(f"{API}/admin/analytics/web",
                         headers=H(admin_jwt), timeout=10)
        # The aggregation never surfaces raw IPs.
        assert "8.8.8.8" not in r.text
        assert "ip_anon" not in r.text

    def test_db_stores_truncated_ip(self):
        # Verify by reading the most recent row directly.
        sys.path.insert(0, "/app/backend")
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio

        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        d = client[os.environ["DB_NAME"]]
        vid = f"v_iptest_{uuid.uuid4().hex[:8]}"
        requests.post(
            f"{API}/analytics/track",
            json={"path": "/iptest", "visitor_id": vid,
                  "session_id": f"s_{vid}", "title": "x"},
            headers={"User-Agent": "Mozilla/5.0 Chrome/121",
                     "X-Forwarded-For": "203.0.113.42"},
            timeout=10,
        )
        time.sleep(0.5)

        async def _check():
            row = await d.pageview_events.find_one(
                {"visitor_id": vid}, {"_id": 0}
            )
            return row

        row = asyncio.run(_check())
        client.close()
        assert row is not None, "event not stored"
        # Last octet truncated
        assert row["ip_anon"] in ("203.0.113.0", "")
        assert "203.0.113.42" not in row["ip_anon"]
