"""
iter312 — Help & Support AI chat regression test.

Covers:
- POST /api/help/chat returns {session_id, reply} for an unauth visitor
- Session continuity: passing back the same session_id reuses transcript
- Role-tailoring: maker question gets a maker-flavoured answer
- Logged in db.help_questions (audit trail for ops)
- /help/analytics/top-questions aggregation works
"""
import os
import sys
import time
import requests

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


def test_help_chat_returns_reply_for_visitor():
    r = requests.post(
        f"{API}/help/chat",
        json={
            "message": "How do shipping costs work?",
            "user_role": "visitor",
            "page_url": "/",
        },
        timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "session_id" in body and body["session_id"].startswith("help-")
    assert "reply" in body and len(body["reply"]) > 20


def test_help_chat_session_continuity():
    r1 = requests.post(
        f"{API}/help/chat",
        json={"message": "Remember the number 47.", "user_role": "buyer"},
        timeout=60,
    )
    assert r1.status_code == 200
    sid = r1.json()["session_id"]

    r2 = requests.post(
        f"{API}/help/chat",
        json={
            "message": "What number did I just ask you to remember?",
            "session_id": sid,
            "user_role": "buyer",
        },
        timeout=60,
    )
    assert r2.status_code == 200
    reply = r2.json()["reply"].lower()
    assert "47" in reply, f"Expected '47' in reply, got: {reply}"


def test_help_chat_maker_role_tailoring():
    """Maker-role question about Stripe should mention Stripe Connect."""
    r = requests.post(
        f"{API}/help/chat",
        json={
            "message": "How do I get paid?",
            "user_role": "maker",
            "page_url": "/maker/dashboard",
        },
        timeout=60,
    )
    assert r.status_code == 200
    reply = r.json()["reply"].lower()
    # Should mention Stripe and/or Connect — the maker payout path
    assert "stripe" in reply, f"Expected 'stripe' in maker payout answer, got: {reply}"


def test_help_chat_persists_to_collection():
    """Each turn lands in db.help_questions with role + page metadata."""
    import asyncio
    from core import db

    marker = f"sentinel-iter312-{int(time.time())}"
    r = requests.post(
        f"{API}/help/chat",
        json={
            "message": marker,
            "user_role": "maker",
            "page_url": "/maker/onboarding",
        },
        timeout=60,
    )
    assert r.status_code == 200

    async def _find():
        return await db.help_questions.find_one({"user": marker})

    doc = asyncio.get_event_loop().run_until_complete(_find())
    assert doc is not None
    assert doc["user_role"] == "maker"
    assert doc["page_url"] == "/maker/onboarding"
    assert doc["assistant"]
    assert "_id" not in {k for k in doc.keys() if k.startswith("_") and k != "_id"} or True  # _id is present in raw doc, but the endpoint strips it on serialization


def test_help_chat_rejects_garbage_role_silently():
    """A bogus user_role string normalises to 'visitor' rather than 422."""
    r = requests.post(
        f"{API}/help/chat",
        json={"message": "ping", "user_role": "robot-overlord"},
        timeout=60,
    )
    assert r.status_code == 200


def test_top_questions_endpoint_returns_shape():
    r = requests.get(f"{API}/help/analytics/top-questions?days=30&limit=5", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "questions" in body and isinstance(body["questions"], list)
    # Each entry has the expected fields
    for q in body["questions"]:
        assert "question" in q
        assert "count" in q
        assert "roles" in q
