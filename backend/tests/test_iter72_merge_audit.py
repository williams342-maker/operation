"""iter72 regression: email-provider audit + merge-williams admin endpoints.

Validates:
1. /api/admin/email-providers/audit returns {configured:2, active:2, safe:0}
   after removing 6 unused provider keys (mailgun primary, mailtrap fallback).
2. /api/admin/merge-williams/preview returns {already_merged: true}.
3. /api/admin/merge-williams/commit is idempotent.
4. All endpoints reject anonymous requests with 401/403.
"""
import os
import sys

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


async def _admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token(os.environ.get("OPS_EMAIL", "team@craftersmarket.org"))
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{API}/api/admin/auth/verify", json={"token": tok})
    assert r.status_code == 200, r.text
    return r.json()["token"]


# --- Email provider audit ---
@pytest.mark.asyncio
async def test_audit_anonymous_rejected():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/admin/email-providers/audit")
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_audit_summary_post_cleanup():
    """Post-cleanup expectation: only mailgun + mailtrap keys remain."""
    jwt = await _admin_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{API}/api/admin/email-providers/audit",
            headers={"Authorization": f"Bearer {jwt}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    s = body["summary"]
    assert s["configured_keys"] == 2, f"expected 2 configured keys, got {s}"
    assert s["in_active_chain"] == 2, f"expected 2 in active chain, got {s}"
    assert s["safe_to_remove"] == 0, f"expected 0 safe_to_remove, got {s}"

    # All non-active providers should report key_configured=false
    roles_by_provider = {p["provider"]: p for p in body["providers"]}
    # Verify mailgun + mailtrap are configured
    assert roles_by_provider["mailgun"]["key_configured"] is True
    assert roles_by_provider["mailgun"]["role"] == "primary"
    assert roles_by_provider["mailtrap"]["key_configured"] is True
    assert roles_by_provider["mailtrap"]["role"] in ("fallback", "fallback_2")

    # Removed providers should now read key_configured=false
    for prov in ("resend", "brevo", "postmark", "sender", "mailersend"):
        if prov in roles_by_provider:
            assert roles_by_provider[prov]["key_configured"] is False, (
                f"{prov} key should be removed, got {roles_by_provider[prov]}"
            )


# --- Merge williams preview ---
@pytest.mark.asyncio
async def test_merge_preview_anonymous_rejected():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/admin/merge-williams/preview")
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_merge_preview_already_merged():
    jwt = await _admin_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{API}/api/admin/merge-williams/preview",
            headers={"Authorization": f"Bearer {jwt}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("already_merged") is True, body
    assert body.get("mode") == "preview"


# --- Merge williams commit ---
@pytest.mark.asyncio
async def test_merge_commit_anonymous_rejected():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{API}/api/admin/merge-williams/commit")
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_merge_commit_idempotent():
    jwt = await _admin_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/admin/merge-williams/commit",
            headers={"Authorization": f"Bearer {jwt}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("already_merged") is True, body
