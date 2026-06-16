"""Iter54 — Admin brief maker-suggestions endpoint.

Coverage:
- GET /api/admin/custom-orders/{id}/maker-suggestions auth-gating (401/403/404)
- Response shape: {suggestions: [...], keywords: [...]}
- Sort by score desc, cap at 8
- Each suggestion carries slug/name/score/material_match/win_rate/won/routed/reason
- reason string is non-empty for every returned suggestion
- keyword lowercase extraction from order.material + order.project_type
"""
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_session_jwt  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "team@craftersmarket.org"
MAKER_SLUG = "iron-and-oak"
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"


@pytest.fixture(scope="session")
def admin_headers():
    tok = issue_session_jwt("admin", ADMIN_EMAIL, "admin")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def maker_headers():
    tok = issue_session_jwt(MAKER_SLUG, MAKER_EMAIL, "maker")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _create_brief(project_type="3D Printed Piece", material="PLA", suffix=""):
    payload = {
        "name": f"TEST_iter54{suffix}",
        "email": f"TEST_iter54{suffix}@example.com",
        "project_type": project_type,
        "material": material,
        "size": "10x10x5",
        "budget": "$100",
        "timeline": "2 weeks",
        "quantity": "1",
        "policy_accepted": True,
        "description": "Custom 3D printed piece for prototype.",
    }
    r = requests.post(f"{BASE_URL}/api/custom-orders", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create brief failed: {r.status_code} {r.text}"
    data = r.json()
    return data.get("id") or data.get("order_id") or data.get("custom_order_id")


@pytest.fixture(scope="session")
def brief_id():
    return _create_brief()


# ---------------- Auth gating ----------------
class TestAuthGating:
    def test_requires_auth_401(self, brief_id):
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/{brief_id}/maker-suggestions",
            timeout=10,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_rejects_maker_token_403(self, brief_id, maker_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/{brief_id}/maker-suggestions",
            headers=maker_headers, timeout=10,
        )
        assert r.status_code in (401, 403), f"expected 401/403 for maker token, got {r.status_code}"

    def test_404_for_missing_order(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/does-not-exist-xyz/maker-suggestions",
            headers=admin_headers, timeout=10,
        )
        assert r.status_code == 404


# ---------------- Response shape + ranking ----------------
class TestResponseShape:
    def test_returns_suggestions_and_keywords(self, brief_id, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/{brief_id}/maker-suggestions",
            headers=admin_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "suggestions" in data
        assert "keywords" in data
        assert isinstance(data["suggestions"], list)
        assert isinstance(data["keywords"], list)

    def test_keywords_lowercased(self, brief_id, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/{brief_id}/maker-suggestions",
            headers=admin_headers, timeout=20,
        )
        data = r.json()
        kws = data["keywords"]
        # Order is set-derived; both tokens should be lowercased
        assert all(k == k.lower() for k in kws), f"keywords must be lowercased: {kws}"
        # Should contain 'pla' and '3d printed piece'
        assert "pla" in kws
        assert "3d printed piece" in kws

    def test_capped_at_8(self, brief_id, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/{brief_id}/maker-suggestions",
            headers=admin_headers, timeout=20,
        )
        data = r.json()
        assert len(data["suggestions"]) <= 8

    def test_sorted_by_score_desc(self, brief_id, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/{brief_id}/maker-suggestions",
            headers=admin_headers, timeout=20,
        )
        data = r.json()
        scores = [s["score"] for s in data["suggestions"]]
        assert scores == sorted(scores, reverse=True), f"not sorted desc: {scores}"

    def test_each_suggestion_has_required_fields(self, brief_id, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/{brief_id}/maker-suggestions",
            headers=admin_headers, timeout=20,
        )
        data = r.json()
        required = ("slug", "name", "score", "material_match", "win_rate",
                    "won", "routed", "reason", "product_count")
        for s in data["suggestions"]:
            for k in required:
                assert k in s, f"missing {k} in suggestion {s}"
            # reason must be a non-empty string
            assert isinstance(s["reason"], str)
            assert s["reason"].strip() != ""
            # types
            assert isinstance(s["score"], (int, float))
            assert isinstance(s["material_match"], int)
            assert isinstance(s["routed"], int)
            assert isinstance(s["won"], int)
            assert 0.0 <= float(s["win_rate"]) <= 1.0
            # filter: product_count must be > 0 (else filtered out per code)
            assert s["product_count"] > 0

    def test_scoring_formula_consistency(self, brief_id, admin_headers):
        """Verify per-row score ≈ material_match*5 + win_rate*100 + min(routed,5),
        optionally halved when declined>=3 and declined>=routed (can't verify
        halving without raw declined count, so skip those rows)."""
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/{brief_id}/maker-suggestions",
            headers=admin_headers, timeout=20,
        )
        data = r.json()
        for s in data["suggestions"]:
            base = (s["material_match"] * 5) + (s["win_rate"] * 100) + min(s["routed"], 5)
            # Score either equals base (no penalty) or base/2 (halved for ≥3 declines+no wins).
            # Allow small float tolerance.
            ok = abs(s["score"] - round(base, 2)) < 0.02 or \
                 abs(s["score"] - round(base * 0.5, 2)) < 0.02
            assert ok, f"score {s['score']} does not match base {base} for {s['slug']}"


# ---------------- Cleanup ----------------
@pytest.fixture(scope="session", autouse=True)
def _cleanup_after_session():
    yield
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            return
        client = AsyncIOMotorClient(mongo_url)
        d = client[db_name]

        async def _do():
            res = await d.custom_orders.find(
                {"email": {"$regex": "^TEST_iter54"}}, {"id": 1}
            ).to_list(50)
            ids = [r["id"] for r in res if r.get("id")]
            if ids:
                await d.custom_orders.delete_many({"id": {"$in": ids}})
        try:
            asyncio.run(_do())
        except RuntimeError:
            asyncio.run(_do())
    except Exception as e:
        print(f"cleanup warning: {e}")
