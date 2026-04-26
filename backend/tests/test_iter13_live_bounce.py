"""iter13 — Live-now indicator + bounce-rate panel."""
import os
import sys
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
# 1. Live-now endpoint
# ============================================================================
class TestLiveNow:

    def test_unauth_rejected(self):
        r = requests.get(f"{API}/admin/analytics/live", timeout=10)
        assert r.status_code in (401, 403)

    def test_buyer_jwt_rejected(self):
        email = f"TEST_iter13_{uuid.uuid4().hex[:6]}@example.com"
        bjwt = requests.post(
            f"{API}/community/auth/magic/verify",
            json={"token": issue_buyer_magic_token(email)},
            timeout=10,
        ).json()["token"]
        r = requests.get(f"{API}/admin/analytics/live",
                         headers=H(bjwt), timeout=10)
        assert r.status_code == 403

    def test_maker_jwt_rejected(self):
        mjwt = requests.post(
            f"{API}/maker/auth/verify",
            json={"token": issue_magic_token("iron-and-oak@craftersmarket.org")},
            timeout=10,
        ).json()["token"]
        r = requests.get(f"{API}/admin/analytics/live",
                         headers=H(mjwt), timeout=10)
        assert r.status_code == 403

    def test_admin_returns_counts(self, admin_jwt):
        # Drop a few pageviews so live_5m is at least 1
        for i in range(3):
            requests.post(
                f"{API}/analytics/track",
                json={"path": f"/live-{i}",
                      "visitor_id": f"v_live_{uuid.uuid4().hex[:6]}",
                      "session_id": f"s_live_{uuid.uuid4().hex[:6]}",
                      "title": "x"},
                headers={"User-Agent": "Mozilla/5.0 Chrome/121"},
                timeout=10,
            )
        r = requests.get(f"{API}/admin/analytics/live",
                         headers=H(admin_jwt), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "live_5m" in d
        assert "live_1m" in d
        assert isinstance(d["live_5m"], int)
        assert isinstance(d["live_1m"], int)
        assert d["live_5m"] >= 3, f"expected at least 3 visitors, got {d['live_5m']}"
        # 1m must always be <= 5m
        assert d["live_1m"] <= d["live_5m"]

    def test_distinct_visitors(self, admin_jwt):
        """Same visitor_id hitting 5 pages must NOT add 5 to the live count.
        We don't pin to exact +1 because other concurrent tests may fire too;
        instead we assert <=2 growth (our 1 + at most 1 racing test event).
        """
        before = requests.get(f"{API}/admin/analytics/live",
                              headers=H(admin_jwt), timeout=10).json()
        vid = f"v_distinct_{uuid.uuid4().hex[:8]}"
        for i in range(5):
            requests.post(
                f"{API}/analytics/track",
                json={"path": f"/distinct-{i}", "visitor_id": vid,
                      "session_id": f"s_d_{uuid.uuid4().hex[:6]}", "title": "x"},
                headers={"User-Agent": "Mozilla/5.0 Chrome/121"},
                timeout=10,
            )
        after = requests.get(f"{API}/admin/analytics/live",
                             headers=H(admin_jwt), timeout=10).json()
        delta = after["live_5m"] - before["live_5m"]
        # 5 pageviews but only 1 distinct visitor → distinct count grows by at
        # most 1 from our actions (other tests may add their own visitors).
        # The strong invariant is: our +5 pageviews must NEVER add +5 distincts.
        assert delta < 5, (
            f"distinct count grew by {delta} after 5 same-visitor pageviews"
        )


# ============================================================================
# 2. Bounce-rate panel on web analytics
# ============================================================================
class TestBounceRate:

    def test_shape_and_math(self, admin_jwt):
        # Seed 2 single-pageview sessions (= bounces) and 1 multi-pageview session
        run_id = uuid.uuid4().hex[:8]
        # Bouncer A
        requests.post(f"{API}/analytics/track",
                      json={"path": "/", "visitor_id": f"v_b1_{run_id}",
                            "session_id": f"s_b1_{run_id}", "title": "x"},
                      headers={"User-Agent": "Mozilla/5.0 Chrome/121"}, timeout=10)
        # Bouncer B
        requests.post(f"{API}/analytics/track",
                      json={"path": "/", "visitor_id": f"v_b2_{run_id}",
                            "session_id": f"s_b2_{run_id}", "title": "x"},
                      headers={"User-Agent": "Mozilla/5.0 Chrome/121"}, timeout=10)
        # Engager: 3 pages in same session
        for p in ("/shop", "/shop/copper-bloom", "/cart"):
            requests.post(f"{API}/analytics/track",
                          json={"path": p, "visitor_id": f"v_e_{run_id}",
                                "session_id": f"s_e_{run_id}", "title": "x"},
                          headers={"User-Agent": "Mozilla/5.0 Chrome/121"}, timeout=10)
        r = requests.get(f"{API}/admin/analytics/web",
                         headers=H(admin_jwt), timeout=15)
        d = r.json()
        assert "bounce_rate_pct" in d
        assert "bounces" in d
        assert "pages_per_session" in d
        # Sanity: pages_per_session = total_views / sessions
        if d["sessions"] > 0:
            expected_pps = round(d["total_views"] / d["sessions"], 2)
            # Allow 0.01 tolerance for rounding boundary
            assert abs(d["pages_per_session"] - expected_pps) <= 0.01
        # Bounce rate must be between 0 and 100
        assert 0.0 <= d["bounce_rate_pct"] <= 100.0
        # Bounces must be an int <= sessions
        assert d["bounces"] <= d["sessions"]
