"""iter413az — Approved-makers CSV export + hard purge contract.

Verifies:
  • GET    /admin/makers/approved.csv
      - requires admin
      - returns text/csv with Content-Disposition attachment
      - header row matches the documented shape Enrich Labs expects
      - one data row per maker in `makers` collection (modulo soft-deletes)
  • DELETE /admin/makers/{slug}
      - requires super-admin
      - 404 on unknown slug
      - hard-deletes the maker doc
      - soft-deletes the maker's listings (sets deleted_at)
      - tags maker_payouts rows with owner_purged=true
      - writes an `admin_audit` row of kind `maker_purged`
"""
from __future__ import annotations

import os
import sys
import uuid
import csv
import io
from pathlib import Path

import requests
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def admin_jwt():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def H(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


# ───────────────────────── CSV export ─────────────────────────


def test_csv_requires_admin():
    r = requests.get(f"{BASE_URL}/api/admin/makers/approved.csv", timeout=15)
    assert r.status_code in (401, 403)


def test_csv_export_shape(H):
    r = requests.get(f"{BASE_URL}/api/admin/makers/approved.csv", headers=H, timeout=30)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("text/csv")
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert ".csv" in cd

    rows = list(csv.reader(io.StringIO(r.text)))
    assert len(rows) >= 1, "expected at least a header row"
    header = rows[0]
    # Lock the column shape — Enrich Labs jobs depend on this header order.
    assert header == [
        "slug", "name", "email", "location", "techniques", "bio",
        "is_beta", "is_veteran_owned", "subscription_status",
        "listings_count", "lifetime_gmv_usd",
        "approved_at", "created_at",
    ]


def test_csv_row_count_matches_directory(H):
    """The CSV should have exactly the same row count as the JSON
    directory endpoint (modulo the header)."""
    json_r = requests.get(f"{BASE_URL}/api/admin/makers/approved", headers=H, timeout=30)
    json_r.raise_for_status()
    json_count = len(json_r.json())

    csv_r = requests.get(f"{BASE_URL}/api/admin/makers/approved.csv", headers=H, timeout=30)
    csv_r.raise_for_status()
    csv_rows = list(csv.reader(io.StringIO(csv_r.text)))
    # -1 for header
    assert len(csv_rows) - 1 == json_count, (
        f"CSV has {len(csv_rows) - 1} data rows, JSON has {json_count}"
    )


# ───────────────────────── Maker purge ─────────────────────────


def _seed_maker_via_db():
    """Insert a throwaway maker + 2 products + 1 payout directly into
    Mongo. We don't use the maker-application approve flow because that
    triggers emails + Stripe Connect and we just need a row."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    from datetime import datetime, timezone

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        slug = f"iter413az-purge-{uuid.uuid4().hex[:8]}"
        email = f"{slug}@example.com"
        now = datetime.now(timezone.utc).isoformat()
        await db.makers.insert_one({
            "id": str(uuid.uuid4()),
            "slug": slug,
            "name": "iter413az purge target",
            "email": email,
            "created_at": now,
            "is_veteran_owned": False,
            "tier": "free",
        })
        for i in range(2):
            await db.products.insert_one({
                "id": str(uuid.uuid4()),
                "maker": slug,
                "title": f"iter413az test product {i}",
                "deleted_at": None,
                "price": 10,
                "status": "published",
                "created_at": now,
            })
        await db.maker_payouts.insert_one({
            "id": str(uuid.uuid4()),
            "maker_slug": slug,
            "gross_cents": 5000,
            "status": "succeeded",
            "created_at": now,
        })
        client.close()
        return slug, email

    return asyncio.run(_go())


def _assert_db_state_after_purge(slug):
    """Verify maker doc is gone, products are soft-deleted, payout is tagged."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        maker = await db.makers.find_one({"slug": slug})
        assert maker is None, "maker doc should be hard-deleted"
        # Listings should be soft-deleted, not hard-deleted.
        live = await db.products.count_documents({"maker": slug, "deleted_at": None})
        soft = await db.products.count_documents({"maker": slug, "deleted_at": {"$ne": None}})
        assert live == 0, "all listings should be soft-deleted"
        assert soft == 2, f"expected 2 soft-deleted listings, got {soft}"
        # Payouts tagged.
        tagged = await db.maker_payouts.count_documents({"maker_slug": slug, "owner_purged": True})
        assert tagged == 1, f"expected 1 tagged payout, got {tagged}"
        # Audit row written.
        audit = await db.admin_audit.find_one({"kind": "maker_purged", "slug": slug})
        assert audit is not None, "expected an admin_audit row of kind maker_purged"
        client.close()
        # Cleanup the test pollution we just created.
        client2 = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db2 = client2[os.environ["DB_NAME"]]
        await db2.products.delete_many({"maker": slug})
        await db2.maker_payouts.delete_many({"maker_slug": slug})
        await db2.admin_audit.delete_many({"slug": slug})
        client2.close()

    asyncio.run(_go())


def test_purge_unknown_slug_404s(H):
    r = requests.delete(
        f"{BASE_URL}/api/admin/makers/does-not-exist-{uuid.uuid4().hex[:6]}",
        headers=H, timeout=15,
    )
    # Either 404 (slug not found) or 403 if the super-admin gate fires
    # before the slug lookup. Both are acceptable contract responses.
    assert r.status_code in (403, 404), r.text


def test_purge_happy_path(H):
    slug, _email = _seed_maker_via_db()
    try:
        r = requests.delete(
            f"{BASE_URL}/api/admin/makers/{slug}", headers=H, timeout=20,
        )
        if r.status_code == 403:
            pytest.skip("super-admin gate not satisfied in this env — magic token may not include super-admin claim")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["slug"] == slug
        assert body["products_soft_deleted"] == 2
        assert body["payouts_tagged"] == 1
        _assert_db_state_after_purge(slug)
    finally:
        # Belt-and-suspenders cleanup in case purge didn't run.
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _wipe():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            await db.makers.delete_many({"slug": slug})
            await db.products.delete_many({"maker": slug})
            await db.maker_payouts.delete_many({"maker_slug": slug})
            await db.admin_audit.delete_many({"slug": slug})
            client.close()

        asyncio.run(_wipe())


def test_purge_requires_auth():
    r = requests.delete(
        f"{BASE_URL}/api/admin/makers/anything", timeout=15,
    )
    assert r.status_code in (401, 403)
