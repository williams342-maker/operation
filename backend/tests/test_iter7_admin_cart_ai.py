"""Iteration 7 — Admin dashboard backend, Cart gift_note, AI session_id, Showcase tagging,
Forum @mentions, plus regression on magic-link auth (admin/maker/buyer)."""
import os
import sys
import time
import uuid
import requests
import pytest

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

from maker_auth import (  # noqa: E402
    issue_admin_magic_token, issue_magic_token, issue_buyer_magic_token,
)

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
ADMIN_EMAIL = os.environ.get("OPS_EMAIL", "team@craftersmarket.org")
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"


# --------------------------- fixtures ---------------------------
@pytest.fixture(scope="module")
def admin_jwt():
    tok = issue_admin_magic_token(ADMIN_EMAIL)
    r = requests.post(f"{BASE}/admin/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def maker_jwt():
    tok = issue_magic_token(MAKER_EMAIL)
    r = requests.post(f"{BASE}/maker/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def buyer_jwt():
    email = f"TEST_iter7_{uuid.uuid4().hex[:8]}@example.com"
    tok = issue_buyer_magic_token(email)
    r = requests.post(f"{BASE}/community/auth/magic/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"], email


def H(jwt):
    return {"Authorization": f"Bearer {jwt}"}


# --------------------------- admin auth basics ---------------------------
def test_admin_auth_request_silent_for_non_admin():
    r = requests.post(f"{BASE}/admin/auth/request",
                      json={"email": "stranger@example.com", "origin_url": "https://x"}, timeout=10)
    assert r.status_code == 200
    assert r.json().get("sent") is True


def test_admin_me_requires_jwt():
    r = requests.get(f"{BASE}/admin/me", timeout=10)
    assert r.status_code == 401


def test_admin_me_ok(admin_jwt):
    r = requests.get(f"{BASE}/admin/me", headers=H(admin_jwt), timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "admin"
    assert body["email"] == ADMIN_EMAIL


# --------------------------- analytics tab ---------------------------
def test_admin_analytics_shape(admin_jwt):
    r = requests.get(f"{BASE}/admin/analytics", headers=H(admin_jwt), timeout=20)
    assert r.status_code == 200, r.text
    a = r.json()
    for k in ("gmv", "gmv_30d", "gmv_7d", "paid_orders", "avg_order",
              "products_count", "makers_count", "applications_pending",
              "custom_orders_open", "community_users", "showcase_posts",
              "forum_threads", "design_files", "chat_messages_30d",
              "top_products", "top_makers"):
        assert k in a, f"missing {k}"
    assert isinstance(a["top_products"], list)
    assert isinstance(a["top_makers"], list)
    assert a["products_count"] >= 0
    assert a["makers_count"] >= 0


def test_admin_analytics_requires_admin(maker_jwt, buyer_jwt):
    bjwt, _ = buyer_jwt
    for jwt in (maker_jwt, bjwt):
        r = requests.get(f"{BASE}/admin/analytics", headers=H(jwt), timeout=10)
        assert r.status_code in (401, 403), f"expected forbid, got {r.status_code}"


# --------------------------- users tab ---------------------------
def test_admin_users_list(admin_jwt, buyer_jwt):
    # buyer_jwt fixture has just signed up a buyer so list >= 1
    _, email = buyer_jwt
    r = requests.get(f"{BASE}/admin/community-users", headers=H(admin_jwt), timeout=15)
    assert r.status_code == 200
    users = r.json()
    assert isinstance(users, list)
    # newly signed-up buyer should be present
    assert any((u.get("email") or "").lower() == email.lower() for u in users)
    # no _id leaks
    assert all("_id" not in u for u in users)


# --------------------------- listings tab ---------------------------
def test_admin_patch_product_featured(admin_jwt):
    # pick first product
    p = requests.get(f"{BASE}/products", timeout=10).json()
    assert p, "no products seeded"
    slug = p[0]["slug"]
    original = bool(p[0].get("featured", False))
    r = requests.patch(f"{BASE}/admin/products/{slug}",
                       json={"featured": not original}, headers=H(admin_jwt), timeout=10)
    assert r.status_code == 200
    assert r.json()["featured"] == (not original)
    # restore
    r2 = requests.patch(f"{BASE}/admin/products/{slug}",
                        json={"featured": original}, headers=H(admin_jwt), timeout=10)
    assert r2.status_code == 200
    assert r2.json()["featured"] == original


def test_admin_patch_product_404(admin_jwt):
    r = requests.patch(f"{BASE}/admin/products/__nope__",
                       json={"featured": True}, headers=H(admin_jwt), timeout=10)
    assert r.status_code == 404


def test_admin_listings_requires_admin(maker_jwt):
    r = requests.patch(f"{BASE}/admin/products/whatever",
                       json={"featured": True}, headers=H(maker_jwt), timeout=10)
    assert r.status_code in (401, 403)


# --------------------------- reviews tab ---------------------------
def test_admin_create_and_delete_review(admin_jwt):
    payload = {"name": "TEST_iter7", "location": "Test, ZZ", "rating": 5,
               "text": "TEST_iter7 review body"}
    r = requests.post(f"{BASE}/admin/reviews", json=payload, headers=H(admin_jwt), timeout=10)
    assert r.status_code == 200, r.text
    rev = r.json()
    assert rev["name"] == "TEST_iter7"
    assert rev["rating"] == 5
    assert "id" in rev
    rid = rev["id"]

    # GET /reviews — should include
    listed = requests.get(f"{BASE}/reviews", timeout=10).json()
    assert any(x.get("id") == rid for x in listed)

    # delete
    d = requests.delete(f"{BASE}/admin/reviews/{rid}", headers=H(admin_jwt), timeout=10)
    assert d.status_code == 200
    assert d.json().get("deleted") is True

    listed2 = requests.get(f"{BASE}/reviews", timeout=10).json()
    assert all(x.get("id") != rid for x in listed2)


def test_admin_delete_review_404(admin_jwt):
    r = requests.delete(f"{BASE}/admin/reviews/{uuid.uuid4().hex}",
                        headers=H(admin_jwt), timeout=10)
    assert r.status_code == 404


# --------------------------- moderator delete (review-style) ---------------------------
def test_moderator_delete_chat_message(admin_jwt, buyer_jwt):
    bjwt, email = buyer_jwt
    # create a chat msg via REST helper (community uses WS but msg list may have post route)
    # Use forum reply as a moderation surrogate (chat is WS-only).
    # 1. create thread
    th = requests.post(f"{BASE}/community/forum",
                       json={"title": "TEST_iter7 thread", "body": "body",
                             "tag": "general"},
                       headers=H(bjwt), timeout=10)
    assert th.status_code == 200, th.text
    tid = th.json()["id"]
    # 2. add reply
    rep = requests.post(f"{BASE}/community/forum/{tid}/reply",
                        json={"body": "TEST_iter7 reply"},
                        headers=H(bjwt), timeout=10)
    assert rep.status_code == 200, rep.text
    rid = rep.json()["id"]
    # 3. admin deletes
    d = requests.delete(f"{BASE}/admin/forum-replies/{rid}",
                        headers=H(admin_jwt), timeout=10)
    assert d.status_code == 200
    assert d.json().get("deleted") is True
    # 4. cleanup thread
    requests.delete(f"{BASE}/admin/forum-threads/{tid}", headers=H(admin_jwt), timeout=10)


# --------------------------- cart gift_note end-to-end ---------------------------
def test_checkout_accepts_gift_note():
    p = requests.get(f"{BASE}/products", timeout=10).json()
    pid = p[0]["id"]
    r = requests.post(f"{BASE}/checkout/session", json={
        "items": [{"product_id": pid, "quantity": 1}],
        "origin_url": "https://example.com",
        "customer_email": f"TEST_iter7_{uuid.uuid4().hex[:6]}@example.com",
        "gift_note": "TEST_iter7 gift note ✦ unicode ok",
    }, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "url" in body and "session_id" in body
    # status endpoint must echo gift_note (per checkout.py L171)
    sid = body["session_id"]
    s = requests.get(f"{BASE}/checkout/status/{sid}", timeout=15)
    assert s.status_code == 200


def test_checkout_works_without_gift_note():
    p = requests.get(f"{BASE}/products", timeout=10).json()
    pid = p[0]["id"]
    r = requests.post(f"{BASE}/checkout/session", json={
        "items": [{"product_id": pid, "quantity": 1}],
        "origin_url": "https://example.com",
        "customer_email": f"TEST_iter7_{uuid.uuid4().hex[:6]}@example.com",
    }, timeout=20)
    assert r.status_code == 200, r.text


# --------------------------- AI session_id persistence ---------------------------
def test_ai_chat_session_id_persists():
    r1 = requests.post(f"{BASE}/ai/chat", json={
        "message": "Hello, my favorite color is fuchsia. Remember it.",
        "session_id": None,
    }, timeout=60)
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert "reply" in body1 and "session_id" in body1
    sid = body1["session_id"]
    assert sid and isinstance(sid, str)

    # second turn — same session_id
    r2 = requests.post(f"{BASE}/ai/chat", json={
        "message": "What color did I just tell you?",
        "session_id": sid,
    }, timeout=60)
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["session_id"] == sid
    # context retained — answer should mention fuchsia
    assert "fuchsia" in body2["reply"].lower(), f"context not retained: {body2['reply'][:200]}"


# --------------------------- showcase auto-link tagging ---------------------------
def test_showcase_post_with_product_and_maker(buyer_jwt):
    bjwt, _ = buyer_jwt
    products = requests.get(f"{BASE}/products", timeout=10).json()
    pslug = products[0]["slug"]
    mslug = products[0]["maker_slug"]
    r = requests.post(f"{BASE}/community/showcase", json={
        "title": "TEST_iter7 showcase",
        "description": "checking auto-link",
        "image_url": "https://placehold.co/600x400",
        "product_slug": pslug,
        "maker_slug": mslug,
    }, headers=H(bjwt), timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["product_slug"] == pslug
    assert body["maker_slug"] == mslug
    # verify it appears in list
    listed = requests.get(f"{BASE}/community/showcase", timeout=10).json()
    assert any(x.get("id") == body["id"] for x in listed)


# --------------------------- forum @mention ---------------------------
def test_forum_reply_with_mention(buyer_jwt):
    bjwt, email = buyer_jwt
    # alice creates a thread
    th = requests.post(f"{BASE}/community/forum",
                       json={"title": "TEST_iter7 mention thread",
                             "body": "kick-off", "tag": "general"},
                       headers=H(bjwt), timeout=10)
    assert th.status_code == 200, th.text
    tid = th.json()["id"]

    # second buyer replies with @alice
    other = f"TEST_iter7_other_{uuid.uuid4().hex[:6]}@example.com"
    tok2 = issue_buyer_magic_token(other)
    v2 = requests.post(f"{BASE}/community/auth/magic/verify",
                       json={"token": tok2}, timeout=10).json()
    rep = requests.post(f"{BASE}/community/forum/{tid}/reply",
                        json={"body": f"hey @{email.split('@')[0]} look at this"},
                        headers=H(v2["token"]), timeout=10)
    assert rep.status_code == 200, rep.text
    body = rep.json()
    assert "id" in body
    # body should be persisted as-is (frontend renders mention highlight)
    assert "@" in body["body"]


# --------------------------- regression: maker auth ---------------------------
def test_maker_me(maker_jwt):
    r = requests.get(f"{BASE}/maker/me", headers=H(maker_jwt), timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body.get("email", "").lower() == MAKER_EMAIL.lower()


def test_buyer_me(buyer_jwt):
    bjwt, email = buyer_jwt
    r = requests.get(f"{BASE}/community/me", headers=H(bjwt), timeout=10)
    assert r.status_code == 200
    assert r.json().get("email", "").lower() == email.lower()


def test_cross_role_rejection(maker_jwt, buyer_jwt):
    bjwt, _ = buyer_jwt
    # buyer hits maker endpoint
    r = requests.get(f"{BASE}/maker/me", headers=H(bjwt), timeout=10)
    assert r.status_code in (401, 403)
    # maker hits admin endpoint
    r = requests.get(f"{BASE}/admin/me", headers=H(maker_jwt), timeout=10)
    assert r.status_code in (401, 403)


# --------------------------- regression: shop browse ---------------------------
def test_shop_browse_and_detail():
    r = requests.get(f"{BASE}/products", timeout=10)
    assert r.status_code == 200
    products = r.json()
    assert len(products) > 0
    slug = products[0]["slug"]
    d = requests.get(f"{BASE}/products/{slug}", timeout=10)
    assert d.status_code == 200
    assert d.json()["slug"] == slug
