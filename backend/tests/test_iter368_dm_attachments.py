"""iter368 — DM image attachments (buyer ↔ maker messaging).

Covers:
  • POST /messages/attachments requires a maker/buyer JWT (401 anonymous).
  • Upload rejects disallowed extensions (400).
  • Full flow: buyer starts thread → uploads PNG → replies with ONLY the
    photo (empty body) → maker sees the attachment embedded on the message
    → public GET serves the bytes back.
  • Attachment ids are single-use (reusing one → 400).
  • Reply with neither body nor attachments → 400.
"""
import os
import sys
import uuid

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio

# Tiny valid PNG (1×1 transparent pixel).
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63fcffff3f0300050001ff7df49b540000000049454e44ae426082"
)


def _tokens(maker_slug: str, maker_email: str, buyer_email: str):
    from maker_auth import issue_session_jwt
    return (
        issue_session_jwt(maker_slug, maker_email, role="maker"),
        issue_session_jwt(buyer_email, buyer_email, role="buyer"),
    )


async def test_dm_attachment_full_flow():
    from core import db
    from server import app

    suffix = uuid.uuid4().hex[:8]
    maker_slug = f"iter368-maker-{suffix}"
    maker_email = f"{maker_slug}@iter368test.com"
    buyer_email = f"iter368-buyer-{suffix}@iter368test.com"
    await db.makers.insert_one({
        "slug": maker_slug, "name": "Attach Test Shop", "email": maker_email,
    })
    maker_jwt, buyer_jwt = _tokens(maker_slug, maker_email, buyer_email)
    mk = {"Authorization": f"Bearer {maker_jwt}"}
    by = {"Authorization": f"Bearer {buyer_jwt}"}

    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            # Anonymous upload → 401
            r = await c.post("/api/messages/attachments",
                             files={"file": ("x.png", PNG_BYTES, "image/png")})
            assert r.status_code == 401

            # Bad extension → 400
            r = await c.post("/api/messages/attachments", headers=by,
                             files={"file": ("evil.exe", b"MZ..", "application/octet-stream")})
            assert r.status_code == 400

            # Buyer starts a thread (public endpoint)
            r = await c.post("/api/messages/start", json={
                "maker_slug": maker_slug, "subject": "Photo question",
                "body": "Can you engrave this?", "sender_email": buyer_email,
                "sender_name": "Iter Buyer",
            })
            assert r.status_code == 200
            thread_id = r.json()["thread_id"]

            # Buyer uploads a PNG (real object-storage round trip)
            r = await c.post("/api/messages/attachments", headers=by,
                             files={"file": ("ref.png", PNG_BYTES, "image/png")})
            assert r.status_code == 200, r.text
            att = r.json()
            assert att["url"] == f"/api/messages/attachments/{att['id']}"

            # Reply with ONLY the photo (empty body is allowed)
            r = await c.post(f"/api/messages/buyer/threads/{thread_id}/reply",
                             headers=by,
                             json={"body": "", "attachment_ids": [att["id"]]})
            assert r.status_code == 200, r.text

            # Reusing the same attachment id → 400 (single-use)
            r = await c.post(f"/api/messages/buyer/threads/{thread_id}/reply",
                             headers=by,
                             json={"body": "again", "attachment_ids": [att["id"]]})
            assert r.status_code == 400

            # Empty reply (no body, no photos) → 400
            r = await c.post(f"/api/messages/buyer/threads/{thread_id}/reply",
                             headers=by, json={"body": "", "attachment_ids": []})
            assert r.status_code == 400

            # Maker can't reference the buyer's attachment (ownership check)
            r = await c.post("/api/messages/attachments", headers=mk,
                             files={"file": ("m.png", PNG_BYTES, "image/png")})
            assert r.status_code == 200
            maker_att = r.json()
            r = await c.post(f"/api/messages/maker/threads/{thread_id}/reply",
                             headers=mk,
                             json={"body": "", "attachment_ids": [att["id"]]})
            assert r.status_code == 400

            # Maker replies with their own photo
            r = await c.post(f"/api/messages/maker/threads/{thread_id}/reply",
                             headers=mk,
                             json={"body": "Sure!", "attachment_ids": [maker_att["id"]]})
            assert r.status_code == 200

            # Maker views the thread → buyer message carries the attachment
            r = await c.get(f"/api/messages/maker/threads/{thread_id}", headers=mk)
            assert r.status_code == 200
            msgs = r.json()["messages"]
            photo_msgs = [m for m in msgs if m.get("attachments")]
            assert len(photo_msgs) == 2
            a0 = photo_msgs[0]["attachments"][0]
            assert a0["id"] == att["id"]
            assert a0["filename"] == "ref.png"

            # Public serve returns the original bytes
            r = await c.get(a0["url"])
            assert r.status_code == 200
            assert r.content == PNG_BYTES
            assert r.headers["content-type"] == "image/png"
    finally:
        await db.makers.delete_one({"slug": maker_slug})
        await db.dm_threads.delete_many({"maker_slug": maker_slug})
        msgs = await db.dm_messages.find({"sender_email": {"$in": [buyer_email, maker_email]}}).to_list(50)
        await db.dm_messages.delete_many({"id": {"$in": [m["id"] for m in msgs]}})
        await db.dm_attachments.delete_many({"uploader_key": {"$in": [f"buyer:{buyer_email}", f"maker:{maker_slug}"]}})
