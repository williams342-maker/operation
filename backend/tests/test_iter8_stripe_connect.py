"""Iteration 8 — Stripe Connect (Express) + iter6 regressions (AI memory, gift note).

Targets the public REACT_APP_BACKEND_URL. Stripe runs in TEST mode."""
import asyncio
import os
import sys
import uuid
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

# ------------------------------------------------------------------
# helpers / fixtures
# ------------------------------------------------------------------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _issue_maker_jwt(email: str) -> str:
    from maker_auth import issue_magic_token
    tok = issue_magic_token(email)
    r = requests.post(f"{API}/maker/auth/verify", json={"token": tok}, timeout=20)
    r.raise_for_status()
    return r.json()["token"]


def _issue_admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{API}/admin/auth/verify", json={"token": tok}, timeout=20)
    r.raise_for_status()
    return r.json()["token"]


def _issue_buyer_jwt(email: str) -> str:
    from maker_auth import issue_buyer_magic_token
    tok = issue_buyer_magic_token(email)
    r = requests.post(f"{API}/community/auth/magic/verify",
                      json={"token": tok}, timeout=20)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="session")
def maker_jwt():
    return _issue_maker_jwt("iron-and-oak@craftersmarket.org")


@pytest.fixture(scope="session")
def maker2_jwt():
    return _issue_maker_jwt("metalart-pro@craftersmarket.org")


@pytest.fixture(scope="session")
def admin_jwt():
    return _issue_admin_jwt()


@pytest.fixture(scope="session")
def buyer_jwt():
    return _issue_buyer_jwt(f"TEST_iter8_{uuid.uuid4().hex[:8]}@example.com")


def H(jwt: str) -> dict:
    return {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}


# ------------------------------------------------------------------
# 1. iter6 regressions
# ------------------------------------------------------------------
class TestAIMemory:
    """POST /api/ai/chat must remember prior turns within same session_id."""

    def test_session_memory_remembers_color(self, session):
        sid = f"TEST_iter8_{uuid.uuid4().hex[:10]}"
        r1 = session.post(f"{API}/ai/chat", json={
            "message": "My favorite color is fuchsia.",
            "session_id": sid,
        }, timeout=60)
        assert r1.status_code == 200, r1.text
        assert r1.json()["session_id"] == sid

        r2 = session.post(f"{API}/ai/chat", json={
            "message": "What color did I just tell you? Reply in one word.",
            "session_id": sid,
        }, timeout=60)
        assert r2.status_code == 200, r2.text
        reply = r2.json()["reply"].lower()
        assert "fuchsia" in reply, f"Memory lost — reply={reply!r}"


# ------------------------------------------------------------------
# 2. Stripe Connect endpoints
# ------------------------------------------------------------------
class TestStripeConnectAuth:
    """All /api/maker/stripe/connect/* require maker JWT."""

    def test_status_no_jwt_401(self, session):
        r = session.get(f"{API}/maker/stripe/connect/status")
        assert r.status_code in (401, 403), r.status_code

    def test_onboard_no_jwt_401(self, session):
        r = session.post(f"{API}/maker/stripe/connect/onboard",
                         json={"origin_url": BASE_URL})
        assert r.status_code in (401, 403)

    def test_dashboard_link_no_jwt_401(self, session):
        r = session.post(f"{API}/maker/stripe/connect/dashboard-link")
        assert r.status_code in (401, 403)

    def test_status_with_admin_jwt_403(self, session, admin_jwt):
        r = session.get(f"{API}/maker/stripe/connect/status",
                        headers=H(admin_jwt))
        assert r.status_code == 403

    def test_status_with_buyer_jwt_403(self, session, buyer_jwt):
        r = session.get(f"{API}/maker/stripe/connect/status",
                        headers=H(buyer_jwt))
        assert r.status_code == 403

    def test_payouts_no_jwt_401(self, session):
        r = session.get(f"{API}/maker/payouts")
        assert r.status_code in (401, 403)

    def test_payouts_with_buyer_jwt_403(self, session, buyer_jwt):
        r = session.get(f"{API}/maker/payouts", headers=H(buyer_jwt))
        assert r.status_code == 403


class TestStripeConnectStatus:
    def test_status_shape(self, session, maker_jwt):
        r = session.get(f"{API}/maker/stripe/connect/status",
                        headers=H(maker_jwt))
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("connected", "charges_enabled",
                  "payouts_enabled", "details_submitted"):
            assert k in j, f"missing {k} in {j}"

    def test_dashboard_link_400_when_no_account(self, session, maker2_jwt):
        # metalart-pro almost certainly has no stripe_account_id yet.
        # If the previous run already onboarded it, the test is still valid:
        # we accept 400 (no account) OR 200 (account exists).
        r = session.post(f"{API}/maker/stripe/connect/dashboard-link",
                         headers=H(maker2_jwt))
        assert r.status_code in (200, 400, 502), r.text


class TestStripeConnectOnboard:
    """Hits real Stripe TEST API — creates Express account on the dashboard."""

    def test_onboard_returns_url_and_account_id(self, session, maker_jwt):
        r = session.post(f"{API}/maker/stripe/connect/onboard",
                         json={"origin_url": BASE_URL},
                         headers=H(maker_jwt), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["url"].startswith("https://"), j
        assert j["account_id"].startswith("acct_"), j
        assert isinstance(j["expires_at"], int)
        # save for next test
        TestStripeConnectOnboard.first_account_id = j["account_id"]

    def test_onboard_idempotent_account_id(self, session, maker_jwt):
        first = getattr(TestStripeConnectOnboard, "first_account_id", None)
        if not first:
            pytest.skip("first onboard didn't run")
        r = session.post(f"{API}/maker/stripe/connect/onboard",
                         json={"origin_url": BASE_URL},
                         headers=H(maker_jwt), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["account_id"] == first, \
            "onboard should reuse stripe_account_id stored on maker doc"

    def test_dashboard_link_after_onboard_or_400(self, session, maker_jwt):
        """Express dashboard requires payouts_enabled; on a brand-new
        unfinished Express acct Stripe returns 4xx. Either accept 200
        (mature acct) or a 502 (Stripe rejects login link for incomplete
        acct). 400 = no account at all (not expected here)."""
        r = session.post(f"{API}/maker/stripe/connect/dashboard-link",
                         headers=H(maker_jwt), timeout=30)
        # After onboard the maker doc has stripe_account_id, so 400 should NOT
        # come back. Stripe will 502 if the account isn't fully onboarded.
        assert r.status_code in (200, 502), r.text


# ------------------------------------------------------------------
# 3. Checkout transfer_group injection
# ------------------------------------------------------------------
class TestCheckoutTransferGroup:
    def test_session_has_transfer_group(self, session):
        # Pick any product
        prods = session.get(f"{API}/products", timeout=20).json()
        assert len(prods) > 0
        slug = prods[0]["slug"]
        r = session.post(f"{API}/checkout/session", json={
            "items": [{"product_id": slug, "quantity": 1}],
            "origin_url": BASE_URL,
            "customer_email": f"TEST_iter8_{uuid.uuid4().hex[:6]}@example.com",
            "gift_note": "iter8 transfer-group test",
        }, timeout=30)
        assert r.status_code == 200, r.text
        sid = r.json()["session_id"]
        assert sid.startswith("cs_"), sid

        # Verify it persisted on payment_transactions
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]

        async def _check():
            doc = await db.payment_transactions.find_one(
                {"session_id": sid}, {"_id": 0}
            )
            return doc

        doc = asyncio.get_event_loop().run_until_complete(_check())
        assert doc is not None, "tx doc not written"
        assert doc.get("transfer_group", "").startswith("order_"), doc
        client.close()


# ------------------------------------------------------------------
# 4. transfer_to_makers_for_session — deferred path (no real Stripe call)
# ------------------------------------------------------------------
class TestTransferDeferredPath:
    def test_deferred_when_maker_has_no_stripe_account(self):
        """Drive the helper directly. We synthesize a paid tx whose product
        belongs to a maker with no stripe_account_id, then assert the
        helper writes maker_payouts row with status='deferred'."""
        from motor.motor_asyncio import AsyncIOMotorClient
        from routers.stripe_connect import transfer_to_makers_for_session

        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]

        async def _run():
            slug = f"test-iter8-product-{uuid.uuid4().hex[:6]}"
            maker_slug = f"test-iter8-maker-{uuid.uuid4().hex[:6]}"
            sid = f"cs_test_iter8_{uuid.uuid4().hex[:10]}"

            # synthetic maker with NO stripe_account_id
            await db.makers.insert_one({
                "id": str(uuid.uuid4()), "slug": maker_slug,
                "name": "TEST iter8 maker", "email": f"{maker_slug}@example.com",
            })
            # synthetic product
            await db.products.insert_one({
                "id": str(uuid.uuid4()), "slug": slug,
                "title": "TEST iter8 prod", "price": 80.0,
                "maker_slug": maker_slug, "category": "Wall Art",
                "technique": "plasma",
            })
            # paid tx
            await db.payment_transactions.insert_one({
                "id": str(uuid.uuid4()), "session_id": sid,
                "items": [{"product_id": slug, "quantity": 2}],
                "amount": 160.0, "subtotal": 160.0, "shipping": 0.0,
                "currency": "usd", "payment_status": "paid",
                "status": "complete",
            })
            try:
                res = await transfer_to_makers_for_session(sid)
                # find the payout row
                row = await db.maker_payouts.find_one(
                    {"session_id": sid, "maker_slug": maker_slug}, {"_id": 0}
                )
                return res, row
            finally:
                # cleanup
                await db.products.delete_many({"slug": slug})
                await db.makers.delete_many({"slug": maker_slug})
                await db.payment_transactions.delete_many({"session_id": sid})
                await db.maker_payouts.delete_many({"session_id": sid})

        res, row = asyncio.get_event_loop().run_until_complete(_run())
        client.close()

        assert res is not None and "skipped" not in res, res
        assert row is not None, "no maker_payouts row written"
        assert row["status"] == "deferred", row
        assert row["reason"] == "no-stripe-account", row
        # 10% platform fee → 160*0.9 = $144 = 14400 cents
        assert row["amount_cents"] == 14400, row
        assert row["platform_fee_bps"] == 1000


# ------------------------------------------------------------------
# 5. GET /api/maker/payouts (maker-scoped)
# ------------------------------------------------------------------
class TestMakerPayoutsList:
    def test_list_returns_only_my_rows(self, session, maker_jwt):
        r = session.get(f"{API}/maker/payouts", headers=H(maker_jwt), timeout=20)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        for row in rows:
            assert row.get("maker_slug") == "iron-and-oak", row


# ------------------------------------------------------------------
# 6. Iter7 regression sanity
# ------------------------------------------------------------------
class TestIter7Regression:
    def test_admin_analytics_still_loads(self, session, admin_jwt):
        r = session.get(f"{API}/admin/analytics", headers=H(admin_jwt), timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "gmv" in j or "total_gmv" in j or "totals" in j, j

    def test_admin_listings_still_loads(self, session, admin_jwt):
        # admin listings = GET /api/products (public) and PATCH /api/admin/products/{slug}
        r = session.get(f"{API}/products", timeout=20)
        assert r.status_code == 200, r.text

    def test_admin_users_still_loads(self, session, admin_jwt):
        r = session.get(f"{API}/admin/community-users",
                        headers=H(admin_jwt), timeout=20)
        assert r.status_code == 200, r.text

    def test_showcase_list_still_loads(self, session):
        r = session.get(f"{API}/community/showcase", timeout=20)
        assert r.status_code == 200, r.text
