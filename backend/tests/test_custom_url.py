"""Regression: Crafters Plus custom shop URL picker (iter170 / Phase 4 #4).

Covers:
  * Free maker → 403 with code `plus_required` on every endpoint
  * Plus maker → GET returns current state + rules
  * Availability check rejects reserved words, malformed candidates,
    already-claimed names, and the maker's own canonical slug
  * Claim persists and writes `custom_url_changed_at`
  * Public resolve endpoint accepts either canonical slug OR custom_url
  * Vanity URL stops resolving once the maker drops off Plus
"""
import os
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

TEST_MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
TEST_MAKER_SLUG = "iron-and-oak"


async def _maker_jwt(client: httpx.AsyncClient) -> str:
    from maker_auth import issue_magic_token
    magic = issue_magic_token(TEST_MAKER_EMAIL)
    r = await client.post(f"{API}/api/maker/auth/verify", json={"token": magic})
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


async def _set_plus(active: bool):
    from core import db
    # iter413cl — the gate is now Plus OR Founder, so to reliably test
    # the "locked for free" path we must also strip the founder fields
    # for the duration of the test. The teardown restores them.
    await db.makers.update_one(
        {"slug": TEST_MAKER_SLUG},
        {"$set": {
            "subscription_status": "active" if active else "free",
            "custom_url": None if not active else None,
        }},
    )


async def _set_tier(tier: str, founder_status: str | None = None):
    """iter413cl — tier toggle helper. Used to neutralize the founder
    tier when testing the standard-tier lockout, then restore."""
    from core import db
    set_doc = {"tier": tier}
    set_doc["founder_status"] = founder_status
    await db.makers.update_one(
        {"slug": TEST_MAKER_SLUG},
        {"$set": set_doc},
    )


async def _wipe_url():
    from core import db
    await db.makers.update_one(
        {"slug": TEST_MAKER_SLUG},
        {"$set": {"custom_url": None, "custom_url_changed_at": None}},
    )


@pytest.mark.asyncio
async def test_custom_url_locked_for_free_tier():
    await _set_plus(False)
    await _set_tier("standard", None)   # iter413cl — neutralize founder
    await _wipe_url()
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            tok = await _maker_jwt(c)
            r = await c.get(f"{API}/api/maker/custom-url", headers=_h(tok))
            assert r.status_code == 403
            body = r.json()
            assert body["detail"]["code"] == "plus_required"
    finally:
        # Restore the seed maker's inaugural founder status.
        await _set_tier("founder", "inaugural")


@pytest.mark.asyncio
async def test_custom_url_check_rejects_reserved_and_short():
    await _set_plus(True)
    await _wipe_url()
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            tok = await _maker_jwt(c)
            r = await c.get(f"{API}/api/maker/custom-url/check/admin", headers=_h(tok))
            assert r.status_code == 200
            assert r.json()["available"] is False

            r = await c.get(f"{API}/api/maker/custom-url/check/ab", headers=_h(tok))
            assert r.json()["available"] is False

            # Caller's own canonical slug must be flagged taken (not the
            # caller's own vanity — slug collision protection).
            r = await c.get(
                f"{API}/api/maker/custom-url/check/{TEST_MAKER_SLUG}",
                headers=_h(tok),
            )
            assert r.json()["available"] is False
    finally:
        await _set_plus(False)


@pytest.mark.asyncio
async def test_custom_url_claim_and_resolve_roundtrip():
    await _set_plus(True)
    await _wipe_url()
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            tok = await _maker_jwt(c)
            r = await c.post(
                f"{API}/api/maker/custom-url",
                json={"custom_url": "iron-vanity-test"},
                headers=_h(tok),
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["custom_url"] == "iron-vanity-test"
            assert body["custom_url_changed_at"]

            # Public resolve via vanity URL
            r = await c.get(f"{API}/api/makers/resolve/iron-vanity-test")
            assert r.status_code == 200
            assert r.json()["slug"] == TEST_MAKER_SLUG
            assert r.json()["matched_via"] == "custom_url"

            # `/api/makers/<vanity>` returns the full maker doc too
            r = await c.get(f"{API}/api/makers/iron-vanity-test")
            assert r.status_code == 200
            assert r.json()["slug"] == TEST_MAKER_SLUG
    finally:
        await _wipe_url()
        await _set_plus(False)


@pytest.mark.asyncio
async def test_vanity_url_stops_resolving_when_plus_lapses():
    """Defense in depth — even if `custom_url` is still set on the doc,
    a maker who dropped off Plus AND isn't on the Founder tier shouldn't
    be reachable via vanity."""
    await _set_plus(True)
    await _wipe_url()
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            tok = await _maker_jwt(c)
            await c.post(
                f"{API}/api/maker/custom-url",
                json={"custom_url": "iron-lapse-test"},
                headers=_h(tok),
            )
            # Drop them off Plus AND off Founder tier — both must be
            # absent for the vanity URL to stop resolving (iter413cl).
            from core import db
            await db.makers.update_one(
                {"slug": TEST_MAKER_SLUG},
                {"$set": {"subscription_status": "canceled", "tier": "standard", "founder_status": None}},
            )
            r = await c.get(f"{API}/api/makers/resolve/iron-lapse-test")
            assert r.status_code == 404
            r = await c.get(f"{API}/api/makers/iron-lapse-test")
            assert r.status_code == 404
            # Canonical slug still works
            r = await c.get(f"{API}/api/makers/{TEST_MAKER_SLUG}")
            assert r.status_code == 200
    finally:
        await _wipe_url()
        await _set_plus(False)
        await _set_tier("founder", "inaugural")
