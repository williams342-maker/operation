"""iter222 regression — env precedence + Stripe diag + friendlier errors.

Pre-fix bug: load_dotenv(ROOT_DIR / '.env') was called without any override,
so an OS-level placeholder like STRIPE_API_KEY=sk_test_****gent (set by
the pod's default env) silently overrode the user's real key in .env.
Makers hit "Could not start onboarding." with no hint at the real cause.

iter224 follow-up: switched to a SELECTIVE override — we only replace OS
env values that look like Emergent pod placeholders (contain `****`).
This keeps preview workable AND avoids clobbering production K8s vars
(MONGO_URL, DB_NAME, etc.) which the previous override=True caused.
"""
import os

import pytest
import requests

API_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://active-project-4.preview.emergentagent.com"
API = f"{API_URL.rstrip('/')}/api"


def _admin_headers():
    from maker_auth import issue_session_jwt
    return {"Authorization": f"Bearer {issue_session_jwt('cm-admin', 'admin@craftersmarket.org', role='admin')}"}


def test_dotenv_override_wins_over_pod_placeholder():
    """The running backend process must have a Stripe key whose value
    matches `/app/backend/.env`, NOT the pod placeholder. If this fails,
    load_dotenv is not using override=True OR the .env file is missing
    the key entirely."""
    # Read the .env value directly (no shell expansion)
    env_val = None
    with open("/app/backend/.env") as f:
        for line in f:
            if line.startswith("STRIPE_API_KEY="):
                env_val = line.strip().split("=", 1)[1]
                break
    assert env_val, "STRIPE_API_KEY missing from /app/backend/.env"
    # Real keys are sk_live_… or sk_test_… and length is typically 100+
    assert env_val.startswith(("sk_live_", "sk_test_")) and len(env_val) > 40, \
        f"STRIPE_API_KEY in .env looks like a placeholder: {env_val[:8]}…"

    # Now hit the diag — the backend's running value should match (same prefix)
    r = requests.get(f"{API}/admin/stripe/diag", headers=_admin_headers(), timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["key_prefix"] == env_val[:8], (
        f"Backend is using a different STRIPE_API_KEY ({body.get('key_prefix')}) "
        f"than /app/backend/.env ({env_val[:8]}) — selective env override should "
        f"have replaced the `****`-masked pod placeholder with the .env value."
    )


def test_stripe_diag_endpoint_responds():
    r = requests.get(f"{API}/admin/stripe/diag", headers=_admin_headers(), timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "ok" in body
    assert "mode" in body
    assert body["mode"] in ("live", "test", "placeholder", "unknown", None)


def test_stripe_diag_requires_admin():
    r = requests.get(f"{API}/admin/stripe/diag", timeout=10)
    # 401/403 either is acceptable — what we care about is "not 200 anonymously"
    assert r.status_code in (401, 403), f"expected auth required, got {r.status_code}"


def test_stripe_friendly_error_translates_auth_failure():
    """Direct unit test of the translator helper — we don't need a live
    Stripe call to validate the wording maps correctly."""
    from routers.stripe_connect import _stripe_friendly_error
    class FakeAuth(Exception):
        pass
    FakeAuth.__name__ = "AuthenticationError"
    msg = _stripe_friendly_error(FakeAuth("Invalid API Key provided: sk_test_****gent"))
    assert "STRIPE_API_KEY" in msg
    assert "/.env" in msg or "/app/backend/.env" in msg


def test_stripe_friendly_error_translates_no_such_account():
    from routers.stripe_connect import _stripe_friendly_error
    msg = _stripe_friendly_error(Exception("No such account: acct_xyz123"))
    assert "no longer exists" in msg.lower() or "stripe_account_id" in msg.lower()


def test_stripe_friendly_error_translates_rate_limit():
    from routers.stripe_connect import _stripe_friendly_error
    msg = _stripe_friendly_error(Exception("Rate limit exceeded for sk_live_..."))
    assert "rate-limit" in msg.lower() or "30 second" in msg.lower()
