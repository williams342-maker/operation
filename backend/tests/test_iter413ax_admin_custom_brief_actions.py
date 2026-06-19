"""iter413ax — Admin custom-brief management contract.

Verifies the 4 new admin actions on custom briefs:
  • DELETE /admin/custom-orders/{id} — hard purge
  • POST /admin/custom-orders/{id}/archive — soft-hide
  • POST /admin/custom-orders/{id}/unarchive — restore
  • POST /admin/custom-orders/{id}/email — ad-hoc email to maker/client
And the updated list endpoint (`?include_archived=` flag).
"""
from __future__ import annotations

import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def admin_jwt():
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def H(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


@pytest.fixture
def brief_id(H):
    """Seed a synthetic custom brief via the public endpoint, then yield its id."""
    payload = {
        "name": "iter413ax test",
        "email": "iter413ax-client@example.com",
        "phone": "+15551234567",
        "project_type": "wood-sign",
        "material": "oak",
        "description": "iter413ax test brief — safe to purge",
        "budget": "$100-$200",
        "policy_accepted": True,  # iter413ax — required since iter347
    }
    r = requests.post(f"{BASE_URL}/api/custom-orders", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    oid = r.json().get("id") or r.json().get("order_id")
    if not oid:
        # Fall back to looking up by tracking number
        tn = r.json().get("tracking_number")
        if not tn:
            pytest.skip("Could not extract order_id from create response")
        lookup = requests.get(f"{BASE_URL}/api/admin/custom-orders?tracking={tn}", headers=H).json()
        oid = lookup[0]["id"] if lookup else None
        if not oid:
            pytest.skip("Brief lookup by tracking failed")
    yield oid
    # Best-effort cleanup
    requests.delete(f"{BASE_URL}/api/admin/custom-orders/{oid}", headers=H, timeout=15)


def test_archive_hides_from_default_list(H, brief_id):
    r = requests.post(f"{BASE_URL}/api/admin/custom-orders/{brief_id}/archive", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    # Default list should NOT include the archived brief
    listed = requests.get(f"{BASE_URL}/api/admin/custom-orders", headers=H, timeout=15).json()
    assert not any(o.get("id") == brief_id for o in listed), \
        "archived brief still appearing in default list"

    # `include_archived=true` SHOULD include it
    listed_all = requests.get(
        f"{BASE_URL}/api/admin/custom-orders?include_archived=true",
        headers=H, timeout=15,
    ).json()
    assert any(o.get("id") == brief_id for o in listed_all)


def test_unarchive_restores_to_default_list(H, brief_id):
    requests.post(f"{BASE_URL}/api/admin/custom-orders/{brief_id}/archive", headers=H, timeout=15)
    r = requests.post(f"{BASE_URL}/api/admin/custom-orders/{brief_id}/unarchive", headers=H, timeout=15)
    assert r.status_code == 200
    listed = requests.get(f"{BASE_URL}/api/admin/custom-orders", headers=H, timeout=15).json()
    assert any(o.get("id") == brief_id for o in listed)


def test_email_client_returns_ok(H, brief_id):
    r = requests.post(
        f"{BASE_URL}/api/admin/custom-orders/{brief_id}/email",
        headers=H, timeout=15,
        json={"target": "client", "subject": "Test", "message": "Hello from iter413ax tests"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["target"] == "client"
    assert body["sent_to"] == "iter413ax-client@example.com"


def test_email_maker_requires_assignment(H, brief_id):
    """A brief with no assigned maker can't be emailed at 'maker' target."""
    r = requests.post(
        f"{BASE_URL}/api/admin/custom-orders/{brief_id}/email",
        headers=H, timeout=15,
        json={"target": "maker", "subject": "x", "message": "y"},
    )
    assert r.status_code == 400
    assert "maker" in r.json().get("detail", "").lower()


def test_email_validates_target_value(H, brief_id):
    r = requests.post(
        f"{BASE_URL}/api/admin/custom-orders/{brief_id}/email",
        headers=H, timeout=15,
        json={"target": "spammer", "subject": "x", "message": "y"},
    )
    assert r.status_code == 400


def test_purge_hard_deletes_brief(H, brief_id):
    r = requests.delete(f"{BASE_URL}/api/admin/custom-orders/{brief_id}", headers=H, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["deleted"] == 1
    # Subsequent purge attempts 404
    r2 = requests.delete(f"{BASE_URL}/api/admin/custom-orders/{brief_id}", headers=H, timeout=15)
    assert r2.status_code == 404


def test_purge_unknown_id_returns_404(H):
    r = requests.delete(
        f"{BASE_URL}/api/admin/custom-orders/{uuid.uuid4()}", headers=H, timeout=15,
    )
    assert r.status_code == 404


def test_endpoints_require_admin_auth():
    """Anonymous requests must be rejected on all 4 actions."""
    fake_id = str(uuid.uuid4())
    for method, path in [
        ("DELETE", f"/api/admin/custom-orders/{fake_id}"),
        ("POST", f"/api/admin/custom-orders/{fake_id}/archive"),
        ("POST", f"/api/admin/custom-orders/{fake_id}/unarchive"),
        ("POST", f"/api/admin/custom-orders/{fake_id}/email"),
    ]:
        r = requests.request(method, f"{BASE_URL}{path}", timeout=15)
        assert r.status_code in (401, 403, 422), f"{method} {path} returned {r.status_code}"
