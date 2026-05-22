"""Regression: Email provider audit endpoint (iter182).

Verifies the audit correctly classifies each provider against the
active fallback chain and emits actionable DNS records for the ones
flagged safe-to-remove.
"""
import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


async def _admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{API}/api/admin/auth/verify", json={"token": tok})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.mark.asyncio
async def test_audit_requires_admin():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/admin/email-providers/audit")
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_audit_returns_expected_schema_and_logic():
    jwt = await _admin_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{API}/api/admin/email-providers/audit",
            headers={"Authorization": f"Bearer {jwt}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()

    # Top-level shape.
    assert "apex" in body
    assert "chain" in body
    assert "providers" in body
    assert "summary" in body
    assert {"configured_keys", "in_active_chain", "safe_to_remove"} <= set(body["summary"])
    assert len(body["chain"]) == 3  # primary, fallback, fallback_2

    # Per-row shape.
    for row in body["providers"]:
        assert {"provider", "key_env", "key_configured", "role", "safe_to_remove",
                "dns_records"} <= set(row)
        assert row["role"] in {"primary", "fallback", "fallback_2", "unused"}
        # safe_to_remove implies (key_configured AND role == "unused").
        if row["safe_to_remove"]:
            assert row["key_configured"] is True
            assert row["role"] == "unused"
        # Active-chain rows never have DNS records to delete.
        if row["role"] != "unused":
            assert row["dns_records"] == []

    # Sort invariant: every row with role != "unused" appears before any "unused" row.
    seen_unused = False
    for row in body["providers"]:
        if row["role"] == "unused":
            seen_unused = True
        elif seen_unused:
            pytest.fail("Active-chain providers must sort BEFORE unused ones")

    # Sanity: at least one provider should be the primary (mailgun in prod).
    assert any(r["role"] == "primary" for r in body["providers"]), \
        "Primary provider missing from audit output"


@pytest.mark.asyncio
async def test_audit_apex_falls_back_to_canonical():
    """When PUBLIC_SITE_URL points at a preview / is empty, apex should
    still resolve to a sensible apex string for DNS-record substitution."""
    jwt = await _admin_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{API}/api/admin/email-providers/audit",
            headers={"Authorization": f"Bearer {jwt}"},
        )
    body = r.json()
    assert body["apex"]
    # Should never have a scheme in the apex value.
    assert "://" not in body["apex"]
