"""
Iteration 45 tests:
- GET /api/admin/makers/approved
- GET /api/admin/makers/rejected
- GET /api/admin/makers/plus
- POST /api/admin/maker-applications/{id}/email
- POST /api/admin/broadcast/preview
- POST /api/admin/broadcast/send
"""
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_session_jwt  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def admin_headers():
    token = issue_session_jwt("admin", "team@craftersmarket.org", role="admin")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Approved Makers ----------
class TestApprovedMakers:
    def test_returns_list(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/makers/approved", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # Could be list or {items:[...]}
        items = data if isinstance(data, list) else data.get("items") or data.get("makers") or []
        assert isinstance(items, list)
        if items:
            sample = items[0]
            # Spot check enrichment fields
            keys = set(sample.keys())
            # at least one of these enrichment fields is expected
            expected_any = {"listings_count", "lifetime_gmv", "is_beta", "subscription_status", "approved_at"}
            assert expected_any & keys, f"none of expected enrichment keys present: {keys}"

    def test_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/makers/approved", timeout=15)
        assert r.status_code in (401, 403)


# ---------- Rejected Apps ----------
class TestRejectedApps:
    def test_returns_list(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/makers/rejected", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        items = data if isinstance(data, list) else data.get("items") or data.get("applications") or []
        assert isinstance(items, list)

    def test_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/makers/rejected", timeout=15)
        assert r.status_code in (401, 403)


# ---------- Plus Members ----------
class TestPlusMembers:
    def test_returns_list(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/makers/plus", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        items = data if isinstance(data, list) else data.get("items") or data.get("members") or []
        assert isinstance(items, list)

    def test_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/makers/plus", timeout=15)
        assert r.status_code in (401, 403)


# ---------- Applicant Email ----------
class TestApplicantEmail:
    def test_unknown_app_returns_404(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/maker-applications/nonexistent_id_xyz/email",
            json={"subject": "Hi", "message": "hello"},
            headers=admin_headers,
            timeout=20,
        )
        assert r.status_code == 404, r.text

    def test_missing_subject_400(self, admin_headers):
        # Fetch any application id (rejected list)
        r = requests.get(f"{BASE_URL}/api/admin/makers/rejected", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        items = data if isinstance(data, list) else data.get("items") or data.get("applications") or []
        if not items:
            pytest.skip("No applications to test against")
        app_id = items[0].get("id") or items[0].get("_id")
        if not app_id:
            pytest.skip("No id field in application")
        r = requests.post(
            f"{BASE_URL}/api/admin/maker-applications/{app_id}/email",
            json={"subject": "", "message": ""},
            headers=admin_headers,
            timeout=20,
        )
        assert r.status_code in (400, 422), r.text

    def test_subject_too_long_400(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/makers/rejected", headers=admin_headers, timeout=30)
        items = r.json() if isinstance(r.json(), list) else r.json().get("items") or r.json().get("applications") or []
        if not items:
            pytest.skip("No applications")
        app_id = items[0].get("id") or items[0].get("_id")
        long_subject = "x" * 200
        r = requests.post(
            f"{BASE_URL}/api/admin/maker-applications/{app_id}/email",
            json={"subject": long_subject, "message": "Hello body"},
            headers=admin_headers,
            timeout=20,
        )
        assert r.status_code in (400, 422), r.text


# ---------- Broadcast preview ----------
class TestBroadcastPreview:
    @pytest.mark.parametrize("audience", ["all_makers", "plus_makers", "beta_makers", "buyers", "applicants_pending", "everyone"])
    def test_known_audiences_200(self, admin_headers, audience):
        r = requests.post(
            f"{BASE_URL}/api/admin/broadcast/preview",
            json={"audience": audience, "subject": "Preview test", "message": "body"},
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200, f"{audience}: {r.text}"
        data = r.json()
        # Should contain a count and a sample list
        assert "count" in data or "total" in data or "audience_count" in data, data
        # sample emails key
        assert any(k in data for k in ("sample", "samples", "sample_emails", "emails"))

    def test_unknown_audience_400(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/broadcast/preview",
            json={"audience": "martians", "subject": "x", "message": "y"},
            headers=admin_headers,
            timeout=20,
        )
        assert r.status_code == 400, r.text


# ---------- Broadcast send ----------
class TestBroadcastSend:
    def test_test_mode_send(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/broadcast/send",
            json={
                "audience": "all_makers",
                "subject": "TEST_iter45 broadcast",
                "message": "This is an automated test broadcast.",
                "test_email": "qa-test@craftersmarket.org",
            },
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text

    def test_missing_subject_400(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/broadcast/send",
            json={"audience": "all_makers", "subject": "", "message": ""},
            headers=admin_headers,
            timeout=20,
        )
        assert r.status_code in (400, 422), r.text

    def test_unknown_audience_400(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/broadcast/send",
            json={"audience": "martians", "subject": "hi", "message": "msg"},
            headers=admin_headers,
            timeout=20,
        )
        assert r.status_code in (400, 422), r.text
