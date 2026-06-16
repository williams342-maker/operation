"""iter226 regression — integration diagnostics (Shippo/Mailgun/R2) + GA4.

Locks the friendly-error pattern: each diag endpoint returns a structured
response with `ok: bool` and (when broken) a `reason: str` that the admin
UI can render inline. No raw exceptions leak.
"""
import os

import pytest
import requests


API_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://active-project-4.preview.emergentagent.com"
API = f"{API_URL.rstrip('/')}/api"


def _admin_headers():
    from maker_auth import issue_session_jwt
    return {"Authorization": f"Bearer {issue_session_jwt('cm-admin', 'admin@craftersmarket.org', role='admin')}"}


# ─────────────────────────────────────────────────────────────────────
# Shippo
# ─────────────────────────────────────────────────────────────────────
def test_shippo_diag_response_shape():
    r = requests.get(f"{API}/admin/shippo/diag", headers=_admin_headers(), timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "ok" in body
    assert isinstance(body["ok"], bool)
    if body["ok"]:
        assert body.get("mode") in ("live", "test", "unknown")
        assert body.get("key_prefix")
    else:
        assert body.get("reason"), "broken diag must surface a friendly reason"


def test_shippo_diag_requires_admin():
    r = requests.get(f"{API}/admin/shippo/diag", timeout=10)
    assert r.status_code in (401, 403)


# ─────────────────────────────────────────────────────────────────────
# Mailgun
# ─────────────────────────────────────────────────────────────────────
def test_mailgun_diag_response_shape():
    r = requests.get(f"{API}/admin/mailgun/diag", headers=_admin_headers(), timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "ok" in body
    # Region always surfaced regardless of ok/not — operator may need it.
    assert body.get("region") in ("us", "eu")
    if not body["ok"]:
        assert body.get("reason")


def test_mailgun_diag_requires_admin():
    r = requests.get(f"{API}/admin/mailgun/diag", timeout=10)
    assert r.status_code in (401, 403)


# ─────────────────────────────────────────────────────────────────────
# R2
# ─────────────────────────────────────────────────────────────────────
def test_r2_diag_response_shape():
    r = requests.get(f"{API}/admin/r2/diag", headers=_admin_headers(), timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "ok" in body
    if body["ok"]:
        assert body.get("bucket")
        assert body.get("public_url")
        assert body["public_url"].startswith("http"), "public_url must be a full URL"
    else:
        assert body.get("reason")


def test_r2_diag_requires_admin():
    r = requests.get(f"{API}/admin/r2/diag", timeout=10)
    assert r.status_code in (401, 403)


# ─────────────────────────────────────────────────────────────────────
# GA4 friendly-error translator (pure unit — no GA4 network call)
# ─────────────────────────────────────────────────────────────────────
def test_ga4_friendly_error_translates_api_not_enabled():
    from routers.ga4_analytics import _friendly_ga4_error
    msg = _friendly_ga4_error(Exception(
        "Google Analytics Data API has not been used in project 239405833611 before "
        "or it is disabled. Enable it by visiting "
        "https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=239405833611 "
        "then retry."
    ))
    assert "isn't enabled" in msg
    # The clickable enable URL must be embedded so the frontend can link it.
    assert "console.developers.google.com" in msg
    assert "239405833611" in msg


def test_ga4_friendly_error_translates_permission_denied():
    from routers.ga4_analytics import _friendly_ga4_error
    msg = _friendly_ga4_error(Exception("PERMISSION_DENIED: caller lacks viewer role"))
    assert "PERMISSION_DENIED" in msg or "rejected" in msg.lower()
    # Operator-actionable hint must mention the GA4 admin path.
    assert "Viewer" in msg or "Property Access Management" in msg


def test_ga4_friendly_error_translates_quota():
    from routers.ga4_analytics import _friendly_ga4_error
    msg = _friendly_ga4_error(Exception("RESOURCE_EXHAUSTED: token bucket empty"))
    assert "quota" in msg.lower()


# ─────────────────────────────────────────────────────────────────────
# GA4 diag endpoint (hits a real GA4 probe — may surface "API not enabled"
# until the user clicks the enable link, but the response shape is locked
# regardless of the upstream outcome).
# ─────────────────────────────────────────────────────────────────────
def test_ga4_diag_response_shape():
    r = requests.get(f"{API}/admin/ga4/diag", headers=_admin_headers(), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "ok" in body
    assert body.get("property_id") == "535632204"
    if body["ok"]:
        # iter413as — Admin can be in either service-account or oauth mode.
        client_email = body.get("client_email", "")
        connected_email = body.get("connected_email", "")
        active_mode = body.get("active_mode", "")
        # Either we have a SA email or we're in oauth mode with a connected email.
        if active_mode != "oauth":
            assert client_email.endswith(".iam.gserviceaccount.com"), body
        assert "sample_active_users_24h" in body
    else:
        assert body.get("reason")
        # Common preview state: API not yet enabled. The reason must
        # carry the actionable enable link so the admin UI can render
        # it as a clickable button.
        if "isn't enabled" in body["reason"]:
            assert "console.developers.google.com" in body["reason"]


def test_ga4_diag_requires_admin():
    r = requests.get(f"{API}/admin/ga4/diag", timeout=10)
    assert r.status_code in (401, 403)
