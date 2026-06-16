"""iter56 — Tracking number on every custom-order brief.

Tests:
- POST /api/custom-orders → returns 10-digit numeric tracking_number
- GET /api/custom-orders/track/{n} → public, sanitised payload (no PII)
- GET /api/custom-orders/track/{n} → 400 invalid format, 404 unknown
- GET /api/admin/custom-orders?tracking=N → admin-only, 400 bad format
- Mongo unique index on tracking_number
- All existing rows backfilled with tracking_number
"""
import os
import re
import sys
import asyncio
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback for in-container test runs
    sys.path.insert(0, "/app/backend")
    from dotenv import load_dotenv
    load_dotenv("/app/frontend/.env")
    BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

API = f"{BASE_URL}/api"


# ── Fixtures ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def admin_jwt():
    sys.path.insert(0, "/app/backend")
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    token = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{API}/admin/auth/verify", json={"token": token}, timeout=15)
    assert r.status_code == 200, f"admin verify failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def created_brief():
    """Create one brief and return the JSON response (incl. tracking_number)."""
    payload = {
        "name": "TEST_iter56",
        "email": "TEST_iter56@example.com",
        "project_type": "Tracking smoke test iter56",
        "material": "Steel",
        "description": "Auto test — please ignore.",
        "budget": "100",
        "policy_accepted": True,
    }
    r = requests.post(f"{API}/custom-orders", json=payload, timeout=20)
    assert r.status_code == 200, f"create brief failed: {r.status_code} {r.text}"
    return r.json()


# ── Tests: POST creates with tracking_number ────────────────────────────────
class TestCreateBriefTracking:
    def test_response_includes_tracking(self, created_brief):
        assert "tracking_number" in created_brief
        tn = created_brief["tracking_number"]
        assert isinstance(tn, str)
        assert len(tn) == 10
        assert tn.isdigit(), f"tracking_number not all-digit: {tn!r}"

    def test_two_briefs_different_tracking(self):
        payload = {
            "name": "TEST_iter56_b",
            "email": "TEST_iter56b@example.com",
            "project_type": "Tracking smoke test iter56-b",
            "material": "Wood",
            "description": "Auto test 2.",
            "budget": "200",
            "policy_accepted": True,
        }
        r1 = requests.post(f"{API}/custom-orders", json=payload, timeout=20)
        r2 = requests.post(f"{API}/custom-orders", json=payload, timeout=20)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["tracking_number"] != r2.json()["tracking_number"]


# ── Tests: Public GET /custom-orders/track/{n} ──────────────────────────────
class TestPublicTrackEndpoint:
    def test_invalid_short_returns_400(self):
        r = requests.get(f"{API}/custom-orders/track/123456789", timeout=10)
        assert r.status_code == 400
        body = r.json()
        # FastAPI renders detail
        assert "Invalid tracking number" in str(body), body

    def test_invalid_long_returns_400(self):
        r = requests.get(f"{API}/custom-orders/track/12345678901", timeout=10)
        assert r.status_code == 400

    def test_invalid_alpha_returns_400(self):
        r = requests.get(f"{API}/custom-orders/track/abcd123456", timeout=10)
        assert r.status_code == 400

    def test_unknown_returns_404(self):
        # Use 10 zeros — vanishingly unlikely to exist
        r = requests.get(f"{API}/custom-orders/track/0000000001", timeout=10)
        assert r.status_code in (404, 400)
        if r.status_code == 404:
            assert "not found" in r.text.lower()

    def test_valid_returns_sanitised_payload(self, created_brief):
        tn = created_brief["tracking_number"]
        r = requests.get(f"{API}/custom-orders/track/{tn}", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        # Required public fields
        for f in ["tracking_number", "status", "project_type", "material",
                  "submitted_at"]:
            assert f in data, f"missing field {f}: {data}"
        assert data["tracking_number"] == tn
        assert data["status"] == "submitted"
        assert data["project_type"] == "Tracking smoke test iter56"
        # PII MUST NOT leak
        forbidden = ["email", "phone", "description", "admin_note", "name", "buyer_name", "budget"]
        for k in forbidden:
            assert k not in data, f"PII field {k!r} leaked in public payload: {data}"
        # Optional fields are present (may be None)
        for f in ["quoted_at", "assigned_at", "assigned_maker_name",
                  "won_bid_at", "reddit_post_url", "reddit_subreddit"]:
            assert f in data


# ── Tests: Admin search by tracking ─────────────────────────────────────────
class TestAdminTrackingSearch:
    def test_admin_requires_auth(self):
        r = requests.get(f"{API}/admin/custom-orders?tracking=1234567890", timeout=10)
        assert r.status_code in (401, 403)

    def test_admin_bad_format_400(self, admin_jwt):
        r = requests.get(
            f"{API}/admin/custom-orders?tracking=abc",
            headers={"Authorization": f"Bearer {admin_jwt}"}, timeout=10,
        )
        assert r.status_code == 400

    def test_admin_finds_by_tracking(self, admin_jwt, created_brief):
        tn = created_brief["tracking_number"]
        r = requests.get(
            f"{API}/admin/custom-orders?tracking={tn}",
            headers={"Authorization": f"Bearer {admin_jwt}"}, timeout=10,
        )
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) >= 1
        assert any(row.get("tracking_number") == tn for row in rows)

    def test_admin_unknown_tracking_empty(self, admin_jwt):
        r = requests.get(
            f"{API}/admin/custom-orders?tracking=0000000099",
            headers={"Authorization": f"Bearer {admin_jwt}"}, timeout=10,
        )
        assert r.status_code == 200
        assert r.json() == []


# ── Tests: Mongo backfill + index ───────────────────────────────────────────
class TestMongoBackfillAndIndex:
    def test_all_rows_have_tracking_and_index_unique(self):
        sys.path.insert(0, "/app/backend")
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _run():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            # Backfill check — every row has tracking_number
            missing = await db.custom_orders.count_documents({
                "$or": [
                    {"tracking_number": {"$exists": False}},
                    {"tracking_number": None},
                    {"tracking_number": ""},
                ]
            })
            total = await db.custom_orders.count_documents({})
            # Index check — must have unique index on tracking_number
            indexes = await db.custom_orders.index_information()
            client.close()
            return missing, total, indexes

        missing, total, indexes = asyncio.run(_run())
        assert total > 0, "no custom_orders rows present"
        assert missing == 0, f"{missing}/{total} rows missing tracking_number"
        # Look for unique index covering tracking_number
        has_unique_idx = False
        for name, info in indexes.items():
            keys = info.get("key", [])
            if any(k[0] == "tracking_number" for k in keys) and info.get("unique"):
                has_unique_idx = True
                break
        assert has_unique_idx, f"no unique index on tracking_number; indexes={indexes}"

    def test_all_tracking_numbers_unique_and_10digit(self):
        sys.path.insert(0, "/app/backend")
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _run():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            cursor = db.custom_orders.find({}, {"tracking_number": 1, "_id": 0})
            tns = [d["tracking_number"] async for d in cursor if "tracking_number" in d]
            client.close()
            return tns

        tns = asyncio.run(_run())
        assert len(tns) == len(set(tns)), "duplicate tracking_numbers found"
        bad = [t for t in tns if not (isinstance(t, str) and len(t) == 10 and t.isdigit())]
        assert not bad, f"non-10-digit tracking numbers: {bad[:5]}"
