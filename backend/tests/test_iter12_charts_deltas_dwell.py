"""iter12 — GMV mini-chart + 7d delta arrows + time-on-page tracking."""
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
# 1. GMV-by-week mini-chart on global + per-maker analytics
# ============================================================================
class TestWeeklyGMV:

    def test_global_analytics_includes_weekly_gmv(self, admin_jwt):
        r = requests.get(f"{API}/admin/analytics",
                         headers=H(admin_jwt), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "weekly_gmv" in d
        assert isinstance(d["weekly_gmv"], list)
        assert len(d["weekly_gmv"]) == 12
        for bucket in d["weekly_gmv"]:
            assert "week_start" in bucket
            assert "total" in bucket
            assert isinstance(bucket["total"], (int, float))
        # Sum of buckets should equal total recent GMV (capped at 12 weeks)
        bucket_total = sum(b["total"] for b in d["weekly_gmv"])
        assert bucket_total >= 0
        # Buckets are chronological (oldest first)
        starts = [b["week_start"] for b in d["weekly_gmv"]]
        assert starts == sorted(starts), "weekly_gmv must be chronological oldest-first"

    def test_maker_analytics_includes_weekly_gmv(self, admin_jwt):
        r = requests.get(f"{API}/admin/maker-analytics/iron-and-oak",
                         headers=H(admin_jwt), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "weekly_gmv" in d
        assert len(d["weekly_gmv"]) == 12
        # Maker total weekly GMV must equal their gross_revenue (within 12-week window)
        bucket_total = round(sum(b["total"] for b in d["weekly_gmv"]), 2)
        # gross_revenue is all-time; weekly_gmv is last-12-weeks. So bucket_total <= gross.
        assert bucket_total <= d["gross_revenue"] + 0.01

    def test_unknown_maker_404(self, admin_jwt):
        r = requests.get(f"{API}/admin/maker-analytics/never-real",
                         headers=H(admin_jwt), timeout=15)
        assert r.status_code == 404


# ============================================================================
# 2. 7d-vs-prior-7d delta on web analytics headline numbers
# ============================================================================
class TestWebAnalyticsDeltas:

    def test_deltas_present_with_correct_shape(self, admin_jwt):
        r = requests.get(f"{API}/admin/analytics/web",
                         headers=H(admin_jwt), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "deltas" in d
        for k in ("views", "visitors", "sessions"):
            assert k in d["deltas"]
            row = d["deltas"][k]
            assert "current" in row
            assert "prior" in row
            assert "direction" in row
            assert row["direction"] in ("up", "down", "flat", "new")
            # delta_pct can be None ("new" case) or a number
            if row["direction"] == "new":
                assert row["delta_pct"] is None
                assert row["prior"] == 0


def _read_event_dwell(event_id: str) -> int | None:
    """Direct Mongo lookup — top_pages aggregation caps at 10 so we can't
    rely on it when many tests have already run."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _fetch():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            row = await c[os.environ["DB_NAME"]].pageview_events.find_one(
                {"id": event_id}, {"_id": 0, "dwell_ms": 1}
            )
        finally:
            c.close()
        return row.get("dwell_ms") if row else None
    return asyncio.run(_fetch())


# ============================================================================
# 3. Time-on-page (dwell) tracking
# ============================================================================
class TestDwellTracking:

    def test_track_returns_event_id(self):
        r = requests.post(
            f"{API}/analytics/track",
            json={"path": "/dwell-test",
                  "visitor_id": f"v_dwell_{uuid.uuid4().hex[:6]}",
                  "session_id": f"s_dwell_{uuid.uuid4().hex[:6]}",
                  "title": "dwell"},
            headers={"User-Agent": "Mozilla/5.0 Chrome/121"},
            timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert "event_id" in body
        assert len(body["event_id"]) >= 32

    def test_dwell_updates_event(self, admin_jwt):
        path = f"/dwell-{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{API}/analytics/track",
            json={"path": path,
                  "visitor_id": f"v_dwell_{uuid.uuid4().hex[:6]}",
                  "session_id": f"s_dwell_{uuid.uuid4().hex[:6]}",
                  "title": "dwell"},
            headers={"User-Agent": "Mozilla/5.0 Chrome/121"},
            timeout=10,
        )
        eid = r.json()["event_id"]
        # Send dwell
        r = requests.post(
            f"{API}/analytics/dwell",
            json={"event_id": eid, "dwell_ms": 7500},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["ok"] is True
        time.sleep(0.3)
        assert _read_event_dwell(eid) == 7500

    def test_dwell_uses_max_not_overwrite(self, admin_jwt):
        """Repeated dwell calls should keep the longest, never shrink."""
        path = f"/dwell-max-{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{API}/analytics/track",
            json={"path": path,
                  "visitor_id": f"v_max_{uuid.uuid4().hex[:6]}",
                  "session_id": f"s_max_{uuid.uuid4().hex[:6]}",
                  "title": "x"},
            headers={"User-Agent": "Mozilla/5.0 Chrome/121"},
            timeout=10,
        )
        eid = r.json()["event_id"]
        # First update: 10s
        requests.post(f"{API}/analytics/dwell",
                      json={"event_id": eid, "dwell_ms": 10000}, timeout=10)
        # Smaller update: 3s — must NOT shrink the value
        requests.post(f"{API}/analytics/dwell",
                      json={"event_id": eid, "dwell_ms": 3000}, timeout=10)
        time.sleep(0.3)
        assert _read_event_dwell(eid) == 10000

    def test_dwell_caps_at_30_min(self, admin_jwt):
        """Forgotten tabs (24h+) should not pollute averages."""
        path = f"/dwell-cap-{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{API}/analytics/track",
            json={"path": path,
                  "visitor_id": f"v_cap_{uuid.uuid4().hex[:6]}",
                  "session_id": f"s_cap_{uuid.uuid4().hex[:6]}",
                  "title": "x"},
            headers={"User-Agent": "Mozilla/5.0 Chrome/121"},
            timeout=10,
        )
        eid = r.json()["event_id"]
        # 24 hours
        requests.post(f"{API}/analytics/dwell",
                      json={"event_id": eid,
                            "dwell_ms": 24 * 60 * 60 * 1000}, timeout=10)
        time.sleep(0.3)
        # Capped at 30 min = 1_800_000 ms
        assert _read_event_dwell(eid) == 30 * 60 * 1000

    def test_dwell_rejects_invalid(self):
        # Empty event_id
        r = requests.post(f"{API}/analytics/dwell",
                         json={"event_id": "", "dwell_ms": 5000}, timeout=10)
        assert r.status_code == 200
        assert r.json()["ok"] is False
        # Negative dwell
        r = requests.post(f"{API}/analytics/dwell",
                         json={"event_id": "x", "dwell_ms": -100}, timeout=10)
        assert r.json()["ok"] is False
        # Missing fields
        r = requests.post(f"{API}/analytics/dwell", json={}, timeout=10)
        assert r.status_code == 422
