"""iter232 — /api/grow/traction endpoint regression tests.

Covers:
- Status 200 + all required keys present
- All values are non-negative integers
- 60s in-memory cache returns identical payload on second call
"""
from __future__ import annotations

import os
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to reading frontend/.env directly so tests run from CI
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except FileNotFoundError:
        pass

REQUIRED_KEYS = {
    "makers_total",
    "founding_makers",
    "products_listed",
    "community_members",
    "forum_threads",
    "clips_published",
    "showcase_posts",
    "roadmap_pct",
}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Schema / status -----------------------------------------------------

class TestGrowTractionSchema:
    def test_status_200(self, api):
        r = api.get(f"{BASE_URL}/api/grow/traction", timeout=15)
        assert r.status_code == 200, r.text

    def test_all_required_keys_present(self, api):
        r = api.get(f"{BASE_URL}/api/grow/traction", timeout=15)
        data = r.json()
        missing = REQUIRED_KEYS - set(data.keys())
        assert not missing, f"Missing keys: {missing}"

    def test_values_are_non_negative_integers(self, api):
        r = api.get(f"{BASE_URL}/api/grow/traction", timeout=15)
        data = r.json()
        for k in REQUIRED_KEYS:
            v = data[k]
            assert isinstance(v, int), f"{k} not int: {type(v).__name__}={v}"
            assert v >= 0, f"{k} negative: {v}"

    def test_roadmap_pct_in_range(self, api):
        r = api.get(f"{BASE_URL}/api/grow/traction", timeout=15)
        data = r.json()
        assert 0 <= data["roadmap_pct"] <= 100

    def test_makers_total_gte_founding(self, api):
        r = api.get(f"{BASE_URL}/api/grow/traction", timeout=15)
        d = r.json()
        assert d["makers_total"] >= d["founding_makers"], (
            f"founding ({d['founding_makers']}) > total ({d['makers_total']})"
        )


# --- Cache behavior ------------------------------------------------------

class TestGrowTractionCache:
    def test_second_call_identical_payload(self, api):
        r1 = api.get(f"{BASE_URL}/api/grow/traction", timeout=15)
        r2 = api.get(f"{BASE_URL}/api/grow/traction", timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json() == r2.json(), "Cache should return identical payload"

    def test_second_call_fast(self, api):
        # warm cache
        api.get(f"{BASE_URL}/api/grow/traction", timeout=15)
        t0 = time.time()
        r = api.get(f"{BASE_URL}/api/grow/traction", timeout=15)
        elapsed = time.time() - t0
        assert r.status_code == 200
        # Generous bound — cached response should be sub-second even over network
        assert elapsed < 2.0, f"Cached call too slow: {elapsed:.2f}s"
