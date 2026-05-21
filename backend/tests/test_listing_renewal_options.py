"""Regression: Etsy-style Listing Renewal Options (Feb 2026).

Covers:
  • Maker creates a listing with renewal_option set; field persists.
  • Default is "automatic" when caller omits the field.
  • PATCH rejects invalid values (HTTP 400).
  • Manual-renewal listing flips to draft on `expire_due_listings()`.
  • Automatic-renewal listing extends `expires_at` and stays "published"
    via the same sweep.
  • `send_listing_expiry_reminders` only fires for **manual** listings
    inside the 7-day window AND stamps `renewal_reminder_sent_at`.
"""
import os
from datetime import datetime, timedelta, timezone

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


async def _maker_jwt(client: httpx.AsyncClient) -> str:
    from maker_auth import issue_magic_token  # noqa: WPS433
    magic = issue_magic_token(TEST_MAKER_EMAIL)
    r = await client.post(f"{API}/api/maker/auth/verify", json={"token": magic})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.asyncio
async def test_create_listing_with_renewal_option_persists():
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        payload = {
            "title": "Renewal Test Listing — Manual",
            "category": "Wall Art",
            "technique": "PLASMA",
            "price": 25,
            "description": "Test description for renewal options.",
            "images": ["https://example.com/img.jpg"],
            "in_stock": 1,
            "status": "draft",
            "renewal_option": "manual",
        }
        r = await c.post(f"{API}/api/maker/products", json=payload, headers=_h(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["renewal_option"] == "manual"
        slug = body["slug"]
        # Cleanup
        await c.delete(f"{API}/api/maker/products/{slug}", headers=_h(tok))


@pytest.mark.asyncio
async def test_create_listing_default_is_automatic():
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        payload = {
            "title": "Renewal Test Listing — Default",
            "category": "Wall Art",
            "technique": "PLASMA",
            "price": 25,
            "description": "No renewal_option sent — must default to automatic.",
            "images": ["https://example.com/img.jpg"],
            "in_stock": 1,
            "status": "draft",
        }
        r = await c.post(f"{API}/api/maker/products", json=payload, headers=_h(tok))
        assert r.status_code == 200, r.text
        slug = r.json()["slug"]
        assert r.json()["renewal_option"] == "automatic"
        await c.delete(f"{API}/api/maker/products/{slug}", headers=_h(tok))


@pytest.mark.asyncio
async def test_patch_rejects_invalid_renewal_option():
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        # Create draft
        payload = {
            "title": "Renewal Patch Test",
            "category": "Wall Art",
            "technique": "PLASMA",
            "price": 25,
            "description": "Patch reject test.",
            "images": ["https://example.com/img.jpg"],
            "in_stock": 1,
            "status": "draft",
        }
        r = await c.post(f"{API}/api/maker/products", json=payload, headers=_h(tok))
        slug = r.json()["slug"]
        # Try invalid value
        r = await c.patch(
            f"{API}/api/maker/products/{slug}",
            json={"renewal_option": "weekly"},
            headers=_h(tok),
        )
        assert r.status_code == 400, r.text
        assert "renewal_option" in (r.json().get("detail") or "").lower()
        # Valid value works
        r = await c.patch(
            f"{API}/api/maker/products/{slug}",
            json={"renewal_option": "manual"},
            headers=_h(tok),
        )
        assert r.status_code == 200, r.text
        assert r.json()["renewal_option"] == "manual"
        await c.delete(f"{API}/api/maker/products/{slug}", headers=_h(tok))


@pytest.mark.asyncio
async def test_expire_sweep_handles_manual_and_automatic_differently():
    """Direct-DB test of the renewal-aware sweep."""
    from core import db
    from revenue import expire_due_listings, expiry_iso_from_now

    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    manual_slug = f"_test-renewal-manual-{int(datetime.now().timestamp())}"
    auto_slug = f"_test-renewal-auto-{int(datetime.now().timestamp())}"

    docs = [
        {
            "id": f"id-{manual_slug}",
            "slug": manual_slug,
            "title": "Manual sweep test",
            "category": "Wall Art",
            "technique": "PLASMA",
            "price": 1,
            "description": "x",
            "images": [],
            "maker_slug": "iron-and-oak",
            "in_stock": 1,
            "status": "published",
            "deleted_at": None,
            "expires_at": past,
            "renewal_option": "manual",
        },
        {
            "id": f"id-{auto_slug}",
            "slug": auto_slug,
            "title": "Auto sweep test",
            "category": "Wall Art",
            "technique": "PLASMA",
            "price": 1,
            "description": "x",
            "images": [],
            "maker_slug": "iron-and-oak",
            "in_stock": 1,
            "status": "published",
            "deleted_at": None,
            "expires_at": past,
            "renewal_option": "automatic",
        },
    ]
    await db.products.insert_many([dict(d) for d in docs])
    try:
        r = await expire_due_listings()
        assert r["expired_to_draft"] >= 1
        assert r["auto_renewed"] >= 1
        manual = await db.products.find_one({"slug": manual_slug}, {"_id": 0})
        assert manual["status"] == "draft"
        auto = await db.products.find_one({"slug": auto_slug}, {"_id": 0})
        assert auto["status"] == "published"
        assert auto["expires_at"] > past
    finally:
        await db.products.delete_many({"slug": {"$in": [manual_slug, auto_slug]}})


@pytest.mark.asyncio
async def test_reminder_sweep_targets_manual_only_within_7d_window():
    from core import db
    from revenue import send_listing_expiry_reminders

    in_5d = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    in_30d = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    m_slug = f"_test-reminder-manual-{int(datetime.now().timestamp())}"
    a_slug = f"_test-reminder-auto-{int(datetime.now().timestamp())}"
    far_slug = f"_test-reminder-far-{int(datetime.now().timestamp())}"
    docs = [
        {  # in window, manual → reminded
            "id": f"id-{m_slug}", "slug": m_slug,
            "title": "Reminder due", "category": "Wall Art", "technique": "PLASMA",
            "price": 1, "description": "x", "images": [],
            "maker_slug": "iron-and-oak", "in_stock": 1, "status": "published",
            "deleted_at": None, "expires_at": in_5d, "renewal_option": "manual",
        },
        {  # in window, automatic → skipped (auto-renew handles it)
            "id": f"id-{a_slug}", "slug": a_slug,
            "title": "Auto in window", "category": "Wall Art", "technique": "PLASMA",
            "price": 1, "description": "x", "images": [],
            "maker_slug": "iron-and-oak", "in_stock": 1, "status": "published",
            "deleted_at": None, "expires_at": in_5d, "renewal_option": "automatic",
        },
        {  # far away, manual → skipped (outside window)
            "id": f"id-{far_slug}", "slug": far_slug,
            "title": "Far away", "category": "Wall Art", "technique": "PLASMA",
            "price": 1, "description": "x", "images": [],
            "maker_slug": "iron-and-oak", "in_stock": 1, "status": "published",
            "deleted_at": None, "expires_at": in_30d, "renewal_option": "manual",
        },
    ]
    await db.products.insert_many([dict(d) for d in docs])
    try:
        r = await send_listing_expiry_reminders(days_before=7)
        # Result includes at least our manual-in-window product
        assert r["emails_sent"] >= 1
        m = await db.products.find_one({"slug": m_slug}, {"_id": 0})
        assert m.get("renewal_reminder_sent_at"), "stamp should be set on manual-in-window"
        a = await db.products.find_one({"slug": a_slug}, {"_id": 0})
        assert not a.get("renewal_reminder_sent_at"), "automatic listings shouldn't be stamped"
        far = await db.products.find_one({"slug": far_slug}, {"_id": 0})
        assert not far.get("renewal_reminder_sent_at"), "far-away listings shouldn't be stamped"

        # Second run is idempotent — already-stamped listing skipped
        r2 = await send_listing_expiry_reminders(days_before=7)
        # No new emails for our test row
        m_after = await db.products.find_one({"slug": m_slug}, {"_id": 0})
        assert m_after["renewal_reminder_sent_at"] == m["renewal_reminder_sent_at"]
        # r2 may have >= 0 emails (other live test data), just sanity-check structure
        assert "emails_sent" in r2
    finally:
        await db.products.delete_many({"slug": {"$in": [m_slug, a_slug, far_slug]}})
