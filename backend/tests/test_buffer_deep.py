"""Buffer deep tests: text-only fan-out (no image_url) + idempotency.
These actually POST to Buffer — keep small and rare."""
import os
import sys
import time
import uuid
import asyncio
import pytest
import requests

sys.path.insert(0, "/app/backend")
# Strip stray quotes from inherited env (supervisor passes literal quotes)
for _k in ("MONGO_URL", "DB_NAME", "CORS_ORIGINS"):
    if os.environ.get(_k, "").startswith('"'):
        os.environ[_k] = os.environ[_k].strip('"')
from dotenv import load_dotenv
load_dotenv("/app/backend/.env", override=True)
for _k in ("MONGO_URL", "DB_NAME"):
    if os.environ.get(_k, "").startswith('"'):
        os.environ[_k] = os.environ[_k].strip('"')
from maker_auth import issue_admin_magic_token, issue_magic_token  # noqa: E402

BASE_URL = os.environ.get("PUBLIC_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def admin_headers():
    mt = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": mt}, timeout=15)
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def channels(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/buffer/status",
                     headers=admin_headers, timeout=30)
    return r.json()["channels"]


def test_text_only_post_pinterest_errors_others_pass(admin_headers, channels):
    """No image_url → Pinterest must fail with image-required error,
    instagram+facebook should succeed (or at minimum, be attempted)."""
    payload = {
        "text": f"[regression-test {uuid.uuid4().hex[:6]}] crafters market QA",
        "channel_ids": [c["id"] for c in channels],
        "mode": "addToQueue",
        # no image_url on purpose
    }
    r = requests.post(f"{BASE_URL}/api/admin/buffer/post",
                      headers=admin_headers, json=payload, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["source"] == "admin"
    results = data["results"]
    by_svc = {x["service"]: x for x in results}
    assert "pinterest" in by_svc
    pin = by_svc["pinterest"]
    # Pinterest must surface an image-required error (Buffer's exact message)
    assert pin["success"] is False, pin
    err = (pin.get("error") or "").lower()
    assert "image" in err or "media" in err or "asset" in err, pin
    # at least one of facebook/instagram should have been attempted (success or failure surfaced explicitly)
    other = [r for r in results if r["service"] in ("facebook", "instagram")]
    assert len(other) >= 1


def test_buffer_idempotency_via_listing_publish(admin_headers):
    """Publish an already-published listing twice via listing_notify;
    only the first call should fan-out (gated by published_at)."""
    # Use existing published product owned by iron-and-oak
    # Fetch one
    sys.path.insert(0, "/app/backend")
    from core import db
    from listing_notify import notify_listing_published

    async def run():
        prod = await db.products.find_one(
            {"maker_slug": "iron-and-oak", "status": "published"}, {"_id": 0})
        if not prod:
            pytest.skip("no published product for iron-and-oak")
        slug = prod["slug"]
        # Reset published_at to None to simulate first publish
        await db.products.update_one({"slug": slug}, {"$unset": {"published_at": ""}})
        before = await db.buffer_posts.count_documents({"product_slug": slug, "source": "auto"})
        # First call → should announce (and fire buffer auto-post)
        res1 = await notify_listing_published(slug)
        assert res1.get("sent") is True, res1
        time.sleep(2)
        mid = await db.buffer_posts.count_documents({"product_slug": slug, "source": "auto"})
        # Second call → must short-circuit on already_announced
        res2 = await notify_listing_published(slug)
        assert res2.get("sent") is False
        assert res2.get("reason") == "already_announced"
        after = await db.buffer_posts.count_documents({"product_slug": slug, "source": "auto"})
        return before, mid, after

    before, mid, after = asyncio.run(run())
    print(f"buffer_posts auto count: before={before} mid={mid} after={after}")
    assert mid == before + 1, f"expected exactly +1 buffer auto row, got mid={mid} before={before}"
    assert after == mid, "second publish must NOT create another buffer row"


def test_maker_share_published_listing(admin_headers):
    """Maker share endpoint should accept a real published listing and persist a row."""
    mt = issue_magic_token("iron-and-oak@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify",
                      json={"token": mt}, timeout=15)
    maker_h = {"Authorization": f"Bearer {r.json()['token']}"}
    # Fetch maker's listings
    r = requests.get(f"{BASE_URL}/api/maker/products", headers=maker_h, timeout=15)
    items = r.json() if isinstance(r.json(), list) else r.json().get("items") or []
    pub = next((p for p in items if p.get("status") == "published"), None)
    if not pub:
        pytest.skip("no published listing")
    r = requests.post(
        f"{BASE_URL}/api/maker/buffer/share-listing/{pub['slug']}",
        headers=maker_h, timeout=60)
    assert r.status_code == 200, r.text
    row = r.json()
    assert row["source"] == "maker"
    assert row["product_slug"] == pub["slug"]
    assert isinstance(row["results"], list) and len(row["results"]) >= 1
