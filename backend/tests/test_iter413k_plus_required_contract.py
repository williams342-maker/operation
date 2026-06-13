"""iter413k regression — Plus-required 403 contract.

This file pins the response shape of `GET /api/maker/analytics/plus`
for non-Plus makers. The frontend's PlusAnalytics gate depends on the
exact shape `{detail: {code: "plus_required", message: "..."}}` to
render the upsell card. A previous production bug (iter413k) was caused
by the frontend axios interceptor stringifying the object detail; the
fix preserves it on a sidecar field. If the backend ever changes the
shape — say to a flat string detail — the gate falls through silently
and the user sees raw JSON dumped in the page body.

This test will fail loudly the moment that shape drifts.
"""
import asyncio
import os
import sys

import pytest
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001") + "/api"


def _maker_headers_for(email: str) -> dict:
    """Mint a fresh maker JWT for the given email by hitting the
    public magic-token + verify flow against the running server.
    Matches the pattern other tests use elsewhere."""
    from maker_auth import issue_magic_token  # local import — server-side helper

    token = issue_magic_token(email)
    r = requests.post(f"{API}/maker/auth/verify", json={"token": token}, timeout=15)
    r.raise_for_status()
    return {
        "Authorization": f"Bearer {r.json()['token']}",
        "Content-Type": "application/json",
    }


def _find_non_plus_maker_email() -> str | None:
    """Locate any approved maker in the DB whose `subscription_status`
    is NOT one of the Plus-tier states. Returns the email or None when
    no such maker exists (seed data drift)."""
    from core import db

    PLUS_STATES = {"active", "trialing"}

    async def find():
        async for m in db.makers.find({}, {"_id": 0, "email": 1, "subscription_status": 1, "slug": 1}):
            if not m.get("email"):
                continue
            sub = (m.get("subscription_status") or "").lower()
            if sub not in PLUS_STATES:
                return m["email"]
        return None

    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(find())
    finally:
        loop.close()


def test_plus_analytics_403_shape_for_non_plus_maker():
    """Non-Plus makers MUST receive a 403 with detail as a dict
    containing `code: "plus_required"` and a non-empty `message`.
    String-only detail would silently break the frontend gate."""
    email = _find_non_plus_maker_email()
    if not email:
        pytest.skip("No non-Plus maker found in DB to exercise the gate.")

    headers = _maker_headers_for(email)
    r = requests.get(f"{API}/maker/analytics/plus", headers=headers, timeout=15)

    assert r.status_code == 403, (
        f"Expected 403 for non-Plus maker, got {r.status_code}: {r.text[:200]}"
    )

    body = r.json()
    assert "detail" in body, f"Response missing `detail` key: {body}"

    detail = body["detail"]
    assert isinstance(detail, dict), (
        "iter413k regression: `detail` must be a DICT — frontend gate "
        f"requires structured shape, got {type(detail).__name__}: {detail!r}. "
        "If the backend now returns a string, the maker dashboard's Stats "
        "tab will dump raw JSON in the page body for non-Plus makers."
    )
    assert detail.get("code") == "plus_required", (
        f"Expected detail.code == 'plus_required', got {detail.get('code')!r}"
    )
    assert isinstance(detail.get("message"), str) and detail["message"].strip(), (
        f"Expected non-empty detail.message string, got {detail.get('message')!r}"
    )


def test_plus_analytics_requires_maker_auth():
    """Unauthenticated requests must 401/403 — never leak data."""
    r = requests.get(f"{API}/maker/analytics/plus", timeout=10)
    assert r.status_code in (401, 403), f"Got {r.status_code}: {r.text[:200]}"
