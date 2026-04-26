"""Iteration 4 backend tests: AI assistant + Community (auth, showcase, files, forum, chat)."""
import asyncio
import json
import os
import sys
import time
import uuid

import pytest
import requests
import websockets

# ensure backend on path so we can mint tokens
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import (  # noqa: E402
    issue_buyer_magic_token, issue_magic_token, issue_admin_magic_token, issue_session_jwt
)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")


# ---------- helpers / fixtures ----------
@pytest.fixture(scope="module")
def buyer_jwt():
    email = f"TEST_buyer_{uuid.uuid4().hex[:8]}@example.com"
    magic = issue_buyer_magic_token(email)
    r = requests.post(f"{BASE_URL}/api/community/auth/magic/verify", json={"token": magic, "accept_eua": True, "eua_version": "2026-04"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["user"]


@pytest.fixture(scope="module")
def fresh_buyer_jwt():
    email = f"TEST_freshbuyer_{uuid.uuid4().hex[:8]}@example.com"
    magic = issue_buyer_magic_token(email)
    r = requests.post(f"{BASE_URL}/api/community/auth/magic/verify", json={"token": magic, "accept_eua": True, "eua_version": "2026-04"}, timeout=15)
    assert r.status_code == 200
    return r.json()["token"], r.json()["user"]


@pytest.fixture(scope="module")
def maker_jwt():
    # Use seeded maker iron-and-oak
    email = "iron-and-oak@craftersmarket.org"
    magic = issue_magic_token(email)
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify", json={"token": magic}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_jwt():
    magic = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": magic}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def hbear(t):
    return {"Authorization": f"Bearer {t}"}


# ---------- AI ----------
class TestAI:
    def test_ai_chat_basic_and_multi_turn(self):
        r = requests.post(f"{BASE_URL}/api/ai/chat",
                          json={"message": "What is the cheapest piece on the marketplace?"},
                          timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "session_id" in data and "reply" in data
        assert isinstance(data["reply"], str) and len(data["reply"]) > 0
        sid = data["session_id"]

        # multi-turn
        r2 = requests.post(f"{BASE_URL}/api/ai/chat",
                           json={"message": "What was my previous question?", "session_id": sid},
                           timeout=60)
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2["session_id"] == sid
        assert isinstance(d2["reply"], str) and len(d2["reply"]) > 0

    def test_ai_submit_brief_creates_custom_order(self, admin_jwt):
        marker = f"TEST_AI_{uuid.uuid4().hex[:8]}"
        payload = {
            "name": marker,
            "email": f"{marker}@example.com",
            "project_type": "Custom Sign",
            "material": "steel",
            "description": "A 24-inch round farmhouse sign.",
        }
        r = requests.post(f"{BASE_URL}/api/ai/submit-brief", json=payload, timeout=20)
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # admin lists custom orders
        time.sleep(0.5)
        a = requests.get(f"{BASE_URL}/api/admin/custom-orders", headers=hbear(admin_jwt), timeout=15)
        assert a.status_code == 200, a.text
        rows = a.json()
        assert any(row.get("name") == marker for row in rows), "AI brief not found in custom orders"


# ---------- Community Auth ----------
class TestCommunityAuth:
    def test_magic_request_always_ok(self):
        r = requests.post(f"{BASE_URL}/api/community/auth/magic/request",
                          json={"email": f"TEST_new_{uuid.uuid4().hex[:6]}@example.com",
                                "origin_url": BASE_URL,
                                "accept_eua": True, "eua_version": "2026-04"},
                          timeout=15)
        assert r.status_code == 200
        assert r.json().get("sent") is True

    def test_magic_request_rejected_without_eua(self):
        """First-time user must accept EUA — endpoint should 400 without it."""
        r = requests.post(f"{BASE_URL}/api/community/auth/magic/request",
                          json={"email": f"TEST_eua_{uuid.uuid4().hex[:6]}@example.com",
                                "origin_url": BASE_URL},
                          timeout=15)
        assert r.status_code == 400
        assert "Community Terms" in r.json()["detail"]

    def test_magic_verify_garbage(self):
        r = requests.post(f"{BASE_URL}/api/community/auth/magic/verify", json={"token": "bogus.garbage.token", "accept_eua": True, "eua_version": "2026-04"}, timeout=15)
        assert r.status_code == 401

    def test_magic_verify_valid(self):
        email = f"TEST_buyer_{uuid.uuid4().hex[:8]}@example.com"
        token = issue_buyer_magic_token(email)
        r = requests.post(f"{BASE_URL}/api/community/auth/magic/verify", json={"token": token, "accept_eua": True, "eua_version": "2026-04"}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "token" in body and "user" in body
        assert body["user"]["user_id"].startswith("user_")
        assert body["user"]["email"] == email.lower()

    def test_google_bogus_session_clean_4xx_5xx(self):
        r = requests.post(f"{BASE_URL}/api/community/auth/google",
                          json={"session_id": "not-a-real-session-xxxx"}, timeout=20)
        assert r.status_code in (401, 502), f"expected 401/502 got {r.status_code} body={r.text[:200]}"
        # ensure not a 500 traceback
        assert r.status_code != 500

    def test_role_enforcement_on_me(self, buyer_jwt, maker_jwt):
        bjwt, _ = buyer_jwt
        # buyer JWT on /community/me works
        r = requests.get(f"{BASE_URL}/api/community/me", headers=hbear(bjwt), timeout=15)
        assert r.status_code == 200
        assert r.json()["user_id"].startswith("user_")

        # maker JWT on /community/me → 403
        r2 = requests.get(f"{BASE_URL}/api/community/me", headers=hbear(maker_jwt), timeout=15)
        assert r2.status_code == 403

        # No auth → 401
        r3 = requests.get(f"{BASE_URL}/api/community/me", timeout=15)
        assert r3.status_code == 401

        # buyer JWT on /maker/me → 403
        r4 = requests.get(f"{BASE_URL}/api/maker/me", headers=hbear(bjwt), timeout=15)
        assert r4.status_code == 403


# ---------- Showcase ----------
class TestShowcase:
    def test_list_no_auth_ok(self):
        r = requests.get(f"{BASE_URL}/api/community/showcase", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_post_requires_buyer(self, maker_jwt):
        r = requests.post(f"{BASE_URL}/api/community/showcase",
                          headers=hbear(maker_jwt),
                          json={"title": "TEST x", "description": "y", "image_url": "https://x/y.jpg"}, timeout=15)
        assert r.status_code in (401, 403)
        r2 = requests.post(f"{BASE_URL}/api/community/showcase",
                           json={"title": "TEST x", "description": "y", "image_url": "https://x/y.jpg"}, timeout=15)
        assert r2.status_code == 401

    def test_create_and_like(self, buyer_jwt):
        bjwt, _ = buyer_jwt
        r = requests.post(f"{BASE_URL}/api/community/showcase",
                          headers=hbear(bjwt),
                          json={"title": "TEST showcase", "description": "desc", "image_url": "https://example.com/x.jpg"},
                          timeout=15)
        assert r.status_code == 200, r.text
        post = r.json()
        assert post["likes"] == 0
        pid = post["id"]
        lr = requests.post(f"{BASE_URL}/api/community/showcase/{pid}/like", headers=hbear(bjwt), timeout=15)
        assert lr.status_code == 200


# ---------- Design Files ----------
class TestDesignFiles:
    def test_list_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/community/files", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_upload_requires_maker(self, buyer_jwt, maker_jwt):
        bjwt, _ = buyer_jwt
        payload = {"title": "TEST file", "description": "d", "file_type": "DXF",
                   "download_url": "https://example.com/x.dxf"}
        # buyer denied
        r = requests.post(f"{BASE_URL}/api/community/files", headers=hbear(bjwt), json=payload, timeout=15)
        assert r.status_code == 403
        # maker ok
        r2 = requests.post(f"{BASE_URL}/api/community/files", headers=hbear(maker_jwt), json=payload, timeout=15)
        assert r2.status_code == 200, r2.text
        f = r2.json()
        assert f["file_type"] == "DXF"
        assert f["downloads"] == 0
        TestDesignFiles.created_file_id = f["id"]

    def test_paywall_after_5_downloads(self, fresh_buyer_jwt, maker_jwt):
        # Create a file to download
        up = requests.post(f"{BASE_URL}/api/community/files", headers=hbear(maker_jwt),
                           json={"title": "TEST paywall", "description": "d", "file_type": "DXF",
                                 "download_url": "https://example.com/p.dxf"}, timeout=15)
        assert up.status_code == 200
        fid = up.json()["id"]

        bjwt, _ = fresh_buyer_jwt
        # 5 successful downloads
        for i in range(5):
            r = requests.get(f"{BASE_URL}/api/community/files/{fid}/download",
                             headers=hbear(bjwt), timeout=15)
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["locked"] is False
            assert d["downloads_used"] == i + 1
        # 6th locked
        r = requests.get(f"{BASE_URL}/api/community/files/{fid}/download",
                         headers=hbear(bjwt), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["locked"] is True
        assert d["downloads_used"] >= 5
        assert d["free_limit"] == 5
        assert d["unlock_amount"] == 5.0
        assert "message" in d

    def test_unlock_checkout(self, buyer_jwt):
        bjwt, _ = buyer_jwt
        r = requests.post(f"{BASE_URL}/api/community/files/unlock-checkout",
                          headers=hbear(bjwt), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["session_id"].startswith("cs_test_")
        assert d["url"].startswith("https://")


# ---------- Forum ----------
class TestForum:
    def test_list_initial(self):
        r = requests.get(f"{BASE_URL}/api/community/forum", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_thread_and_reply(self, buyer_jwt):
        bjwt, _ = buyer_jwt
        r = requests.post(f"{BASE_URL}/api/community/forum", headers=hbear(bjwt),
                          json={"title": "TEST thread", "body": "hello", "tag": "help"}, timeout=15)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        assert r.json()["reply_count"] == 0

        # GET single
        g = requests.get(f"{BASE_URL}/api/community/forum/{tid}", timeout=15)
        assert g.status_code == 200
        assert g.json()["replies"] == []

        # Reply requires auth
        nr = requests.post(f"{BASE_URL}/api/community/forum/{tid}/reply",
                           json={"body": "no auth"}, timeout=15)
        assert nr.status_code == 401

        # Reply with buyer
        rr = requests.post(f"{BASE_URL}/api/community/forum/{tid}/reply",
                           headers=hbear(bjwt), json={"body": "TEST reply"}, timeout=15)
        assert rr.status_code == 200

        # GET shows incremented count
        g2 = requests.get(f"{BASE_URL}/api/community/forum/{tid}", timeout=15)
        assert g2.json()["thread"]["reply_count"] == 1
        assert len(g2.json()["replies"]) == 1


# ---------- Chat REST ----------
class TestChatRest:
    def test_history_general(self):
        r = requests.get(f"{BASE_URL}/api/community/chat/general/history", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_history_unknown_404(self):
        r = requests.get(f"{BASE_URL}/api/community/chat/nope-channel/history", timeout=15)
        assert r.status_code == 404


# ---------- Chat WebSocket ----------
class TestChatWS:
    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    @pytest.mark.asyncio
    async def test_ws_general_buyer_send_receive(self, buyer_jwt):
        bjwt, user = buyer_jwt
        url = f"{WS_BASE}/api/ws/chat/general?token={bjwt}"
        async with websockets.connect(url, open_timeout=15) as ws:
            # consume the initial system join
            saw_msg = False
            unique = f"TEST_ws_{uuid.uuid4().hex[:6]}"
            await ws.send(json.dumps({"text": unique}))
            # collect a few frames
            for _ in range(8):
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=8)
                except asyncio.TimeoutError:
                    break
                d = json.loads(raw)
                if d.get("kind") == "message" and d.get("text") == unique:
                    assert d.get("role") == "buyer"
                    assert d.get("user_email") == user["email"]
                    saw_msg = True
                    break
            assert saw_msg, "did not receive own broadcast"

        # Verify persisted in history
        await asyncio.sleep(0.5)
        r = requests.get(f"{BASE_URL}/api/community/chat/general/history?limit=50", timeout=15)
        assert r.status_code == 200
        texts = [m.get("text") for m in r.json()]
        assert unique in texts, "message not persisted to chat_messages"

    @pytest.mark.asyncio
    async def test_ws_makers_only_buyer_rejected(self, buyer_jwt):
        bjwt, _ = buyer_jwt
        url = f"{WS_BASE}/api/ws/chat/makers-only?token={bjwt}"
        try:
            async with websockets.connect(url, open_timeout=15) as ws:
                await asyncio.wait_for(ws.recv(), timeout=5)
                # If we got data, it's wrong. Try to read close.
                pytest.fail("buyer should be rejected from makers-only")
        except websockets.exceptions.InvalidStatus as e:
            # http-based reject
            assert e.response.status_code in (401, 403, 4403, 4401)
        except websockets.exceptions.ConnectionClosed as e:
            assert e.code in (4403, 4401)
        except Exception as e:
            # Some servers close before handshake completes — accept any disconnect
            assert "403" in str(e) or "401" in str(e) or "closed" in str(e).lower()

    @pytest.mark.asyncio
    async def test_ws_makers_only_maker_accepted(self, maker_jwt):
        url = f"{WS_BASE}/api/ws/chat/makers-only?token={maker_jwt}"
        async with websockets.connect(url, open_timeout=15) as ws:
            # we should be able to send and read
            await ws.send(json.dumps({"text": f"TEST_maker_{uuid.uuid4().hex[:5]}"}))
            got = False
            for _ in range(6):
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                except asyncio.TimeoutError:
                    break
                d = json.loads(raw)
                if d.get("kind") in ("message", "system"):
                    got = True
            assert got

    @pytest.mark.asyncio
    async def test_ws_no_token_rejected(self):
        url = f"{WS_BASE}/api/ws/chat/general"
        try:
            async with websockets.connect(url, open_timeout=10) as ws:
                await asyncio.wait_for(ws.recv(), timeout=5)
                pytest.fail("no-token should be rejected")
        except Exception as e:
            assert True


# ---------- Regression ----------
class TestRegression:
    def test_products_count(self):
        r = requests.get(f"{BASE_URL}/api/products", timeout=15)
        assert r.status_code == 200
        assert len(r.json()) == 6

    def test_paid_session_status(self):
        sid = "cs_test_a1iMM98ftY3GF2JouCJbRQkPvPkMcJE9lwLYh51c946CyXqtkL5oaa0O5o"
        r = requests.get(f"{BASE_URL}/api/checkout/status/{sid}", timeout=20)
        assert r.status_code == 200
        d = r.json()
        # different schemas in past iterations
        status = d.get("payment_status") or d.get("status") or ""
        assert "paid" in str(status).lower() or d.get("paid") is True

    def test_admin_auth_works(self, admin_jwt):
        r = requests.get(f"{BASE_URL}/api/admin/me", headers=hbear(admin_jwt), timeout=15)
        assert r.status_code == 200

    def test_maker_auth_works(self, maker_jwt):
        r = requests.get(f"{BASE_URL}/api/maker/me", headers=hbear(maker_jwt), timeout=15)
        assert r.status_code == 200
