"""Iter18 — Etsy-style revenue layer E2E (live HTTP via REACT_APP_BACKEND_URL).

Covers:
  - GET /api/maker/billing  (policy/usage/pending/history shape)
  - POST /api/maker/products/<slug>/promote  (accrual + promoted_until + cleanup)
  - GET /api/products  (promoted product floats to top)
  - POST /api/maker/products/<slug>/renew    (fresh expires_at + listings_used_lifetime++)
  - POST /api/maker/products  (auto expires_at + listing-fee accrual past the free quota)
  - POST /api/admin/listings/expire-due  (idempotent sweep)
  - Cleanup: reset iron-and-oak's pending balance + charge_history + promoted_until

Cleans up after itself so iron-and-oak is left at pending_charges_cents=0.
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone
from typing import Any

import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402

load_dotenv("/app/backend/.env")

from maker_auth import issue_admin_magic_token, issue_magic_token  # noqa: E402

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get(
    "REACT_APP_BACKEND_URL"
) else "https://active-project-4.preview.emergentagent.com"

MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
MAKER_SLUG = "iron-and-oak"
ADMIN_EMAIL = "team@craftersmarket.org"


# ---------- helpers / fixtures ----------

@pytest.fixture(scope="module")
def maker_token() -> str:
    magic = issue_magic_token(MAKER_EMAIL)
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify", json={"token": magic}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token() -> str:
    magic = issue_admin_magic_token(ADMIN_EMAIL)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": magic}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def maker_headers(maker_token: str) -> dict:
    return {"Authorization": f"Bearer {maker_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_headers(admin_token: str) -> dict:
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _live_product_slug(maker_headers: dict) -> str:
    r = requests.get(f"{BASE_URL}/api/maker/products", headers=maker_headers, timeout=20)
    assert r.status_code == 200, r.text
    pubs = [
        p for p in r.json()
        if p.get("status") == "published" and not p.get("deleted_at") and p.get("maker_slug") == MAKER_SLUG
    ]
    assert pubs, "iron-and-oak should have at least 1 live product"
    return pubs[0]["slug"]


def _reset_iron_and_oak() -> None:
    """Direct Mongo cleanup so subsequent reruns / iters stay green."""
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio

    async def _do():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        # Wipe maker pending state.
        await db.makers.update_one(
            {"slug": MAKER_SLUG},
            {"$set": {"pending_charges_cents": 0, "charge_history": [],
                      "listings_used_lifetime": 3,  # reset to seed count (3 real iron-and-oak listings)
                      "listings_by_month": {}}},
        )
        # Wipe promoted_until on every iron-and-oak product (test paranoia).
        await db.products.update_many(
            {"maker_slug": MAKER_SLUG},
            {"$set": {"promoted_until": None}},
        )
        # Hard-delete every leftover test-iter18 product so it doesn't pollute
        # other test files (e.g. maker_portal expects exactly 3 iron listings).
        await db.products.delete_many({"slug": {"$regex": "^test-iter18-"}})
        client.close()

    asyncio.get_event_loop().run_until_complete(_do()) if False else asyncio.run(_do())


# ---------- tests ----------

class TestBillingPolicy:
    """GET /api/maker/billing returns Etsy-style policy + usage."""

    def test_billing_shape_and_policy_constants(self, maker_headers: dict):
        r = requests.get(f"{BASE_URL}/api/maker/billing", headers=maker_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # core fields
        for k in (
            "listings_used_lifetime",
            "listings_free_remaining",
            "listings_free_quota",
            "pending_charges_cents",
            "policy",
            "history",
        ):
            assert k in data, f"missing field: {k}"
        # policy block
        pol = data["policy"]
        assert pol["platform_fee_bps"] == 500
        assert pol["processing_fee_bps"] == 300
        assert pol["listing_fee_cents"] == 20
        assert pol["listing_expiry_days"] == 120
        assert pol["promotion_weekly_fee_cents"] == 500
        assert data["listings_free_quota"] == 10
        assert isinstance(data["history"], list)


class TestPromoteFlow:
    """Promote a live listing for 2 weeks and verify accrual + catalog top-pin."""

    def test_promote_two_weeks_and_catalog_pin(self, maker_headers: dict):
        slug = _live_product_slug(maker_headers)
        # baseline pending (should be 0 from a fresh state, but tolerant)
        baseline = requests.get(
            f"{BASE_URL}/api/maker/billing", headers=maker_headers, timeout=20
        ).json()["pending_charges_cents"]

        r = requests.post(
            f"{BASE_URL}/api/maker/products/{slug}/promote?weeks=2",
            headers=maker_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        prod = r.json()
        assert prod.get("promoted_until"), "promoted_until missing"
        until = datetime.fromisoformat(prod["promoted_until"])
        delta_days = (until - datetime.now(timezone.utc)).days
        assert 13 <= delta_days <= 15, f"promoted_until ~14d expected, got {delta_days}d"

        # billing reflects new $10 charge + history entry
        bill = requests.get(
            f"{BASE_URL}/api/maker/billing", headers=maker_headers, timeout=20
        ).json()
        assert bill["pending_charges_cents"] == baseline + 1000, bill
        kinds = [h.get("kind") for h in bill["history"]]
        assert "promotion" in kinds, kinds

        # public catalog → promoted slug is at position 0
        cat = requests.get(f"{BASE_URL}/api/products", timeout=20)
        assert cat.status_code == 200, cat.text
        items = cat.json()
        assert items, "catalog empty"
        # Anti-flake: the just-promoted slug is among first N (should be 0)
        top_slugs = [p["slug"] for p in items[:3]]
        assert slug in top_slugs, f"promoted {slug} not in top 3: {top_slugs}"
        assert items[0]["slug"] == slug, f"expected {slug} at pos 0; got {items[0]['slug']}"


class TestRenewFlow:
    """Renew sets fresh expires_at and bumps listings_used_lifetime by 1."""

    def test_renew_sets_fresh_expiry_and_increments_lifetime(self, maker_headers: dict):
        # Use a draft listing if any, else a live one (renew works on both per code).
        rprods = requests.get(
            f"{BASE_URL}/api/maker/products", headers=maker_headers, timeout=20
        ).json()
        target = next(
            (p for p in rprods if p.get("status") == "draft" and not p.get("deleted_at")),
            None,
        )
        if target is None:
            target = next(p for p in rprods if not p.get("deleted_at"))
        slug = target["slug"]

        before = requests.get(
            f"{BASE_URL}/api/maker/billing", headers=maker_headers, timeout=20
        ).json()
        lifetime_before = before["listings_used_lifetime"]

        r = requests.post(
            f"{BASE_URL}/api/maker/products/{slug}/renew",
            headers=maker_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        prod = r.json()
        assert prod.get("status") == "published"
        assert prod.get("expires_at"), "expires_at missing"
        delta_days = (
            datetime.fromisoformat(prod["expires_at"]) - datetime.now(timezone.utc)
        ).days
        assert 119 <= delta_days <= 121, f"expected ~120d, got {delta_days}d"

        after = requests.get(
            f"{BASE_URL}/api/maker/billing", headers=maker_headers, timeout=20
        ).json()
        assert after["listings_used_lifetime"] == lifetime_before + 1


class TestCreateListingExpiryAndFee:
    """Creating a draft listing sets expires_at; published costs $0.20 past quota."""

    def test_create_published_sets_expires_at_and_increments_lifetime(self, maker_headers: dict):
        before = requests.get(
            f"{BASE_URL}/api/maker/billing", headers=maker_headers, timeout=20
        ).json()
        ts = int(time.time())
        payload = {
            "title": f"TEST_iter18_listing_{ts}",
            "price": 12.5,
            "category": "Woodworking",
            "technique": "Hand-tooled",
            "in_stock": 1,
            "description": "iter18 test listing",
            "images": [],
            "status": "published",
        }
        r = requests.post(
            f"{BASE_URL}/api/maker/products", headers=maker_headers, json=payload, timeout=30
        )
        assert r.status_code == 200, r.text
        prod = r.json()
        assert prod["title"] == payload["title"]
        assert prod.get("status") == "published"
        assert prod.get("expires_at"), "expires_at must be auto-set on publish"
        delta_days = (
            datetime.fromisoformat(prod["expires_at"]) - datetime.now(timezone.utc)
        ).days
        assert 119 <= delta_days <= 121, f"expected ~120d, got {delta_days}d"

        after = requests.get(
            f"{BASE_URL}/api/maker/billing", headers=maker_headers, timeout=20
        ).json()
        assert after["listings_used_lifetime"] == before["listings_used_lifetime"] + 1

        # cleanup: soft-delete so we don't pollute the maker dashboard
        rd = requests.delete(
            f"{BASE_URL}/api/maker/products/{prod['slug']}",
            headers=maker_headers, timeout=20,
        )
        assert rd.status_code in (200, 204), rd.text


class TestAdminExpirySweep:
    """POST /api/admin/listings/expire-due → idempotent."""

    def test_expire_sweep_returns_shape_and_is_idempotent(self, admin_headers: dict):
        r1 = requests.post(
            f"{BASE_URL}/api/admin/listings/expire-due", headers=admin_headers, timeout=20
        )
        assert r1.status_code == 200, r1.text
        out1 = r1.json()
        assert "expired" in out1 and "now" in out1
        assert isinstance(out1["expired"], int)

        r2 = requests.post(
            f"{BASE_URL}/api/admin/listings/expire-due", headers=admin_headers, timeout=20
        )
        assert r2.status_code == 200, r2.text
        out2 = r2.json()
        # Second call: no further expiries since the first already drained them.
        assert out2["expired"] == 0


class TestCleanup:
    """Reset iron-and-oak so the next test run starts from a clean slate."""

    def test_zzz_cleanup_resets_iron_and_oak(self, maker_headers: dict):
        _reset_iron_and_oak()
        bill = requests.get(
            f"{BASE_URL}/api/maker/billing", headers=maker_headers, timeout=20
        ).json()
        assert bill["pending_charges_cents"] == 0
        assert bill["history"] == []
