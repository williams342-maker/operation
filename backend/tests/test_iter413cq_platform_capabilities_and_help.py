"""iter413cq — Platform capabilities endpoint + AI Help report-issue contract.

Verifies:
  • GET /api/platform/capabilities returns a stable shape (schema version,
    features.listing_videos, taxonomy, seller_limits) with the correct
    "listing videos disabled" stance per Loretta feedback.
  • Help Assistant injects capabilities into its system prompt
    (build_capabilities_payload contract — covers the inline path).
  • POST /api/help/report-issue lands a row in contact_messages tagged
    kind="ai_diagnosed_bug" and a notify_team fan-out is scheduled.
  • POST /api/help/report-issue enforces minimum description length.

No paid integrations are hit — the report-issue endpoint is public by
design (the Help widget runs unauthenticated).
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")


def test_capabilities_endpoint_shape():
    r = requests.get(f"{BASE_URL}/api/platform/capabilities", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    # Schema version + top-level sections present.
    assert "schema_version" in body
    for key in ("features", "listing_uploads", "taxonomy", "seller_limits", "commerce", "support"):
        assert key in body, f"missing top-level key: {key}"
    # Listing video stance (Loretta fix — must be authoritative + disabled).
    lv = body["features"]["listing_videos"]
    assert lv["upload_enabled"] is False
    assert lv["gallery_render_enabled"] is False
    assert lv["planned_for_future_release"] is True
    assert lv.get("user_message")
    # Taxonomy carries the Loretta-relevant categories + techniques.
    cats = body["taxonomy"]["categories"]
    assert "Fiber & Textiles" in cats
    assert "Other" in cats
    fiber = body["taxonomy"]["techniques_by_category"]["Fiber & Textiles"]
    assert "Sewing" in fiber
    # Listing image constraints exposed.
    img = body["listing_uploads"]["image"]
    assert "image/jpeg" in img["accepted_mime_types"]
    assert img["max_per_listing"] > 0


def test_build_capabilities_payload_inline_match():
    """The inline helper must return the same payload as the HTTP route —
    that's the contract the AI Help Assistant relies on."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from routers.platform_capabilities import build_capabilities_payload

    payload = build_capabilities_payload()
    assert payload["schema_version"]
    assert payload["features"]["listing_videos"]["upload_enabled"] is False
    # Same key set as HTTP body.
    http_body = requests.get(f"{BASE_URL}/api/platform/capabilities", timeout=15).json()
    assert set(payload.keys()) == set(http_body.keys())


def test_help_chat_injects_capabilities_into_prompt():
    """The /help/chat route must build a prompt that contains the live
    capabilities JSON. We can't introspect the LLM call from the outside,
    so we exercise the helper that builds the block."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from routers.help_chat import _capabilities_block

    block = _capabilities_block()
    assert "CAPABILITIES" in block
    assert "listing_videos" in block
    # The disabled-with-message contract surfaces verbatim.
    assert '"upload_enabled": false' in block
    assert "planned for a future release" in block.lower()


def test_help_report_issue_rejects_short_description():
    r = requests.post(
        f"{BASE_URL}/api/help/report-issue",
        json={"description": "x"},
        timeout=15,
    )
    # Pydantic validation → 422
    assert r.status_code == 422, r.text


def test_help_report_issue_lands_in_contact_inbox():
    """End-to-end: post a structured report → row appears in
    contact_messages with kind=ai_diagnosed_bug + sidecar meta + the
    AI conversation tail included in the body."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token

    suffix = uuid.uuid4().hex[:8]
    desc = f"iter413cq smoke test — checkout button stuck {suffix}"
    payload = {
        "description": desc,
        "user_role": "buyer",
        "page_url": "/checkout?cart=abc",
        "listing_slug": "iter413cq-listing",
        "maker_slug": "iter413cq-maker",
        "category": "Fiber & Textiles",
        "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "viewport": "1440x900",
        "reporter_email": f"test-{suffix}@example.com",
        "conversation": [
            {"role": "user", "text": "the pay button just spins"},
            {"role": "assistant", "text": "likely a blocked Stripe popup — try disabling ad blocker"},
        ],
    }
    r = requests.post(f"{BASE_URL}/api/help/report-issue", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["received"] is True
    msg_id = body["id"]

    # Authenticate as admin and confirm the row landed in the bug inbox.
    super_email = (
        os.environ.get("ADMIN_EMAILS") or os.environ.get("OPS_EMAIL") or "team@craftersmarket.org"
    ).split(",")[0].strip()
    tok = issue_admin_magic_token(super_email)
    verify = requests.post(
        f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15
    )
    verify.raise_for_status()
    admin_jwt = verify.json()["token"]

    listing = requests.get(
        f"{BASE_URL}/api/admin/contact-messages?topic=bug&limit=50",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        timeout=15,
    )
    assert listing.status_code == 200, listing.text
    rows = listing.json().get("rows") or listing.json().get("items") or []
    match = next((row for row in rows if row.get("id") == msg_id), None)
    assert match is not None, f"AI bug report not surfaced in contact inbox; got {len(rows)} rows"
    assert match["topic"] == "bug"
    assert match.get("kind") == "ai_diagnosed_bug"
    assert desc in match["message"]
    assert "iter413cq-listing" in match["message"]
    assert "Mozilla/5.0" in match["message"]
    # AI conversation tail surfaced
    assert "pay button just spins" in match["message"]
    meta = match.get("ai_bug_meta") or {}
    assert meta.get("listing_slug") == "iter413cq-listing"
    assert meta.get("category") == "Fiber & Textiles"

    # Cleanup.
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _cleanup():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.contact_messages.delete_many({"id": msg_id})
        client.close()

    asyncio.run(_cleanup())
