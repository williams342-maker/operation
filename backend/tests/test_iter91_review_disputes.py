"""
Iter91 — Maker review dispute lifecycle.

Covers:
  • GET /maker/reviews
  • POST /maker/reviews/{id}/response (public reply)
  • POST /maker/reviews/{id}/dispute
  • Block double-disputes (409)
  • Block disputing another maker's review (403)
  • Admin GET /admin/review-disputes
  • Admin POST resolve upheld → review deleted
  • Admin POST resolve denied → review.dispute_status = "denied"
"""
import os
import sys
import asyncio
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_magic_token, issue_admin_magic_token  # noqa: E402

API = os.environ.get(
    "PUBLIC_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
MAKER_SLUG = "iron-and-oak"
ADMIN_EMAIL = "team@craftersmarket.org"


def _maker_jwt():
    tok = issue_magic_token(MAKER_EMAIL)
    return requests.post(f"{API}/api/maker/auth/verify", json={"token": tok}, timeout=15).json()["token"]


def _admin_jwt():
    tok = issue_admin_magic_token(ADMIN_EMAIL)
    return requests.post(f"{API}/api/admin/auth/verify", json={"token": tok}, timeout=15).json()["token"]


def _seed_review(maker_slug=MAKER_SLUG, rating=1, text="bad"):
    """Insert a synthetic review row directly so the test is hermetic."""
    from motor.motor_asyncio import AsyncIOMotorClient
    import uuid as _u
    rid = f"iter91-{_u.uuid4().hex[:8]}"
    async def go():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        await c[os.environ["DB_NAME"]].reviews.insert_one({
            "id": rid, "name": "iter91 buyer", "location": "Test", "rating": rating,
            "text": text, "maker_slug": maker_slug, "product_slug": "iter91-probe",
            "created_at": "2026-04-30T00:00:00+00:00",
        })
    asyncio.run(go())
    return rid


def _cleanup(rid: str):
    from motor.motor_asyncio import AsyncIOMotorClient
    async def go():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        d = c[os.environ["DB_NAME"]]
        await d.reviews.delete_many({"id": rid})
        await d.review_disputes.delete_many({"review_id": rid})
    asyncio.run(go())


def test_maker_lists_own_reviews():
    rid = _seed_review()
    try:
        h = {"Authorization": f"Bearer {_maker_jwt()}"}
        r = requests.get(f"{API}/api/maker/reviews", headers=h, timeout=15).json()
        assert any(it["id"] == rid for it in r["items"])
    finally:
        _cleanup(rid)


def test_response_publishes():
    rid = _seed_review()
    try:
        h = {"Authorization": f"Bearer {_maker_jwt()}"}
        r = requests.post(
            f"{API}/api/maker/reviews/{rid}/response",
            headers=h, json={"response": "Sorry to hear — refunded."}, timeout=15,
        )
        assert r.status_code == 200
        # Verify it's persisted on the review row
        rows = requests.get(f"{API}/api/maker/reviews", headers=h, timeout=15).json()["items"]
        rev = next(x for x in rows if x["id"] == rid)
        assert rev["maker_response"] == "Sorry to hear — refunded."
        assert rev["maker_response_at"]
    finally:
        _cleanup(rid)


def test_dispute_create_and_resolve_denied():
    rid = _seed_review()
    try:
        mh = {"Authorization": f"Bearer {_maker_jwt()}"}
        ah = {"Authorization": f"Bearer {_admin_jwt()}"}

        r = requests.post(
            f"{API}/api/maker/reviews/{rid}/dispute", headers=mh,
            json={"reason": "not_a_buyer", "explanation": "We confirmed no order matches this name."},
            timeout=15,
        )
        assert r.status_code == 200
        did = r.json()["id"]

        # Maker dashboard should reflect dispute_status=open
        rows = requests.get(f"{API}/api/maker/reviews", headers=mh, timeout=15).json()["items"]
        rev = next(x for x in rows if x["id"] == rid)
        assert rev["dispute_status"] == "open"

        # Repeat dispute → 409
        r2 = requests.post(
            f"{API}/api/maker/reviews/{rid}/dispute", headers=mh,
            json={"reason": "not_a_buyer", "explanation": "stacking duplicate dispute"}, timeout=15,
        )
        assert r2.status_code == 409

        # Admin lists open disputes
        disputes = requests.get(
            f"{API}/api/admin/review-disputes", headers=ah,
            params={"status": "open"}, timeout=15,
        ).json()["items"]
        assert any(d["id"] == did for d in disputes)
        assert any("maker_name" in d for d in disputes)  # hydrated

        # Admin denies → review stays, dispute_status=denied
        r3 = requests.post(
            f"{API}/api/admin/review-disputes/{did}/resolve", headers=ah,
            json={"status": "denied", "admin_note": "Order records confirm purchase."},
            timeout=15,
        )
        assert r3.status_code == 200, r3.text

        rows = requests.get(f"{API}/api/maker/reviews", headers=mh, timeout=15).json()["items"]
        rev = next(x for x in rows if x["id"] == rid)
        assert rev["dispute_status"] == "denied"

        # Resolving an already-resolved dispute → 400
        r4 = requests.post(
            f"{API}/api/admin/review-disputes/{did}/resolve", headers=ah,
            json={"status": "upheld"}, timeout=15,
        )
        assert r4.status_code == 400
    finally:
        _cleanup(rid)


def test_dispute_upheld_deletes_review():
    rid = _seed_review(rating=2, text="terrible product")
    try:
        mh = {"Authorization": f"Bearer {_maker_jwt()}"}
        ah = {"Authorization": f"Bearer {_admin_jwt()}"}
        did = requests.post(
            f"{API}/api/maker/reviews/{rid}/dispute", headers=mh,
            json={"reason": "harassment", "explanation": "Reviewer used slurs in a follow-up DM."},
            timeout=15,
        ).json()["id"]

        requests.post(
            f"{API}/api/admin/review-disputes/{did}/resolve", headers=ah,
            json={"status": "upheld", "admin_note": "Confirmed via DM screenshots."},
            timeout=15,
        )

        # Review should now be gone
        rows = requests.get(f"{API}/api/maker/reviews", headers=mh, timeout=15).json()["items"]
        assert all(it["id"] != rid for it in rows)
    finally:
        _cleanup(rid)


def test_cannot_dispute_other_makers_review():
    """Make sure makers can't dispute reviews on listings they don't own."""
    other = "another-shop-slug"  # presumed not iron-and-oak
    rid = _seed_review(maker_slug=other)
    try:
        mh = {"Authorization": f"Bearer {_maker_jwt()}"}
        r = requests.post(
            f"{API}/api/maker/reviews/{rid}/dispute", headers=mh,
            json={"reason": "other", "explanation": "trying to game the system"}, timeout=15,
        )
        assert r.status_code == 403, r.text
    finally:
        _cleanup(rid)


if __name__ == "__main__":
    test_maker_lists_own_reviews(); print("✓ maker lists own reviews")
    test_response_publishes(); print("✓ public response publishes")
    test_dispute_create_and_resolve_denied(); print("✓ dispute create + 409 + denied resolve")
    test_dispute_upheld_deletes_review(); print("✓ upheld dispute deletes review")
    test_cannot_dispute_other_makers_review(); print("✓ 403 on cross-maker dispute")
    print("\niter91 checks passed.")
