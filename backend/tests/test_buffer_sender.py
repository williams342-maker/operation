"""Tests for Buffer (social) integration + Sender.net email switch."""
import os
import sys
import time
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_admin_magic_token, issue_magic_token  # noqa: E402

BASE_URL = os.environ.get("PUBLIC_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "team@craftersmarket.org"
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
MAKER_SLUG = "iron-and-oak"


@pytest.fixture(scope="session")
def admin_token():
    mt = issue_admin_magic_token(ADMIN_EMAIL)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": mt}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def maker_token():
    mt = issue_magic_token(MAKER_EMAIL)
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify", json={"token": mt}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def maker_headers(maker_token):
    return {"Authorization": f"Bearer {maker_token}"}


# ============================================================
#   Buffer admin status / list
# ============================================================
class TestBufferAdmin:
    def test_status_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/buffer/status", timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_status_ok(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/buffer/status",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["enabled"] is True, data
        assert data["auto_publish"] is True
        services = sorted([(c.get("service") or "").lower() for c in data["channels"]])
        assert services == ["facebook", "instagram", "pinterest"], services

    def test_posts_list(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/buffer/posts?limit=10",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and isinstance(data["items"], list)
        assert data["limit"] == 10

    def test_posts_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/buffer/posts", timeout=15)
        assert r.status_code in (401, 403)


# ============================================================
#   Buffer admin compose – validation only (no spam)
# ============================================================
class TestBufferComposeValidation:
    def test_empty_text_400(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/admin/buffer/post",
                          headers=admin_headers,
                          json={"text": "", "channel_ids": ["x"]}, timeout=15)
        assert r.status_code in (400, 422)

    def test_empty_channels_400(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/admin/buffer/post",
                          headers=admin_headers,
                          json={"text": "hi", "channel_ids": []}, timeout=15)
        assert r.status_code in (400, 422)

    def test_unknown_channel_400(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/admin/buffer/post",
                          headers=admin_headers,
                          json={"text": "hi", "channel_ids": ["nonexistent_id"]},
                          timeout=30)
        assert r.status_code == 400


# ============================================================
#   Maker share-listing endpoint
# ============================================================
class TestMakerShare:
    def test_share_unauthenticated(self):
        r = requests.post(
            f"{BASE_URL}/api/maker/buffer/share-listing/some-slug", timeout=15)
        assert r.status_code in (401, 403)

    def test_share_404_when_not_owned(self, maker_headers):
        r = requests.post(
            f"{BASE_URL}/api/maker/buffer/share-listing/__does_not_exist__",
            headers=maker_headers, timeout=30)
        assert r.status_code == 404


# ============================================================
#   Email status / Sender.net integration
# ============================================================
class TestEmailSender:
    def test_status_provider_sender(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/email-status",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("provider") == "sender", data
        assert "today" in data
        assert "recent" in data and isinstance(data["recent"], list)

    def test_email_test_captures_dns_error(self, admin_headers):
        """Sender.net should reject with 400 SPF/DKIM until DNS configured.
        The integration must capture that error into email_events."""
        r = requests.post(f"{BASE_URL}/api/admin/email-test",
                          headers=admin_headers,
                          json={"to": "team@craftersmarket.org"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # Expected: sent=false with SPF/DKIM message captured
        assert data.get("sent") is False, data
        last_err = data.get("last_error") or {}
        assert last_err.get("error_code") == 400, last_err
        body = (last_err.get("error_body") or "").lower()
        assert "spf" in body and "dkim" in body, last_err

    def test_email_event_persisted(self, admin_headers):
        """Verify the failed send row landed in email_events."""
        # Trigger a fresh failure
        requests.post(f"{BASE_URL}/api/admin/email-test",
                      headers=admin_headers,
                      json={"to": "team@craftersmarket.org"}, timeout=30)
        time.sleep(1)
        r = requests.get(f"{BASE_URL}/api/admin/email-status",
                         headers=admin_headers, timeout=30)
        recent = r.json().get("recent") or []
        assert recent, "no recent email_events"
        # Find a failed sender row with SPF/DKIM body
        match = next(
            (e for e in recent
             if e.get("provider") == "sender"
             and e.get("status") == "failed"
             and e.get("error_code") == 400
             and "spf" in (e.get("error_body") or "").lower()),
            None)
        assert match is not None, f"no failed sender row found, recent={recent[:3]}"
