"""iter413bb — Lead → Apply attribution contract.

Verifies:
  • POST /api/attribution/track
      - accepts an apply_started touch
      - is idempotent within a single day (re-firing collapses)
      - rejects unknown event kinds
      - reports `linked_to_lead: true` when visitor_id was previously
        attached to a lead_magnet_subscribers row
  • POST /api/lead-magnet/starter-pack/subscribe
      - now accepts an optional visitor_id and stores it on the row
        (so a subsequent /attribution/track call can link the two)
  • GET /api/admin/attribution/stale-leads
      - lists lead-magnet subscribers >N days old with no application
"""
from __future__ import annotations

import os
import sys
import uuid
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")


def _vid() -> str:
    """A throwaway 32-hex visitor id."""
    return secrets.token_hex(16)


def test_track_apply_started_basic():
    vid = _vid()
    r = requests.post(
        f"{BASE_URL}/api/attribution/track",
        json={"visitor_id": vid, "kind": "apply_started",
              "source": "organic", "campaign": "test_iter413bb"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["new_event"] is True
    assert body["linked_to_lead"] is False


def test_track_is_same_day_idempotent():
    vid = _vid()
    # Fire twice — the second call should NOT create a new event.
    r1 = requests.post(
        f"{BASE_URL}/api/attribution/track",
        json={"visitor_id": vid, "kind": "apply_started"}, timeout=15,
    )
    r2 = requests.post(
        f"{BASE_URL}/api/attribution/track",
        json={"visitor_id": vid, "kind": "apply_started"}, timeout=15,
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["new_event"] is True
    assert r2.json()["new_event"] is False


def test_track_rejects_invalid_kind():
    r = requests.post(
        f"{BASE_URL}/api/attribution/track",
        json={"visitor_id": _vid(), "kind": "something-else"}, timeout=15,
    )
    assert r.status_code == 422, r.text


def test_lead_magnet_subscribe_persists_visitor_id():
    """The /lead-magnet/starter-pack/subscribe endpoint now accepts a
    visitor_id and writes it to lead_magnet_subscribers."""
    vid = _vid()
    email = f"iter413bb-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/lead-magnet/starter-pack/subscribe",
        json={"email": email, "consent_marketing": False,
              "campaign": "iter413bb-test", "visitor_id": vid},
        timeout=15,
    )
    assert r.status_code == 200, r.text

    # Re-read directly from Mongo (test runs in-cluster).
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _check():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        sub = await db.lead_magnet_subscribers.find_one(
            {"email": email}, {"_id": 0, "visitor_id": 1, "email": 1},
        )
        assert sub is not None
        assert sub.get("visitor_id") == vid
        # Cleanup
        await db.lead_magnet_subscribers.delete_one({"email": email})
        client.close()

    asyncio.run(_check())


def test_apply_started_links_to_lead_by_visitor_id():
    """When a /attribution/track call uses the same visitor_id that an
    earlier lead-magnet subscribe used, the resulting attribution_event
    must be linked back to that lead."""
    vid = _vid()
    email = f"iter413bb-link-{uuid.uuid4().hex[:8]}@example.com"
    # Step 1 — subscribe to the lead magnet with visitor_id.
    sub_r = requests.post(
        f"{BASE_URL}/api/lead-magnet/starter-pack/subscribe",
        json={"email": email, "consent_marketing": False,
              "campaign": "iter413bb-link", "visitor_id": vid},
        timeout=15,
    )
    assert sub_r.status_code == 200, sub_r.text
    # Step 2 — track an apply_started from the SAME visitor.
    track_r = requests.post(
        f"{BASE_URL}/api/attribution/track",
        json={"visitor_id": vid, "kind": "apply_started"},
        timeout=15,
    )
    assert track_r.status_code == 200, track_r.text
    body = track_r.json()
    assert body["ok"] is True
    assert body["linked_to_lead"] is True

    # Cleanup
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _wipe():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.lead_magnet_subscribers.delete_one({"email": email})
        await db.attribution_events.delete_many({"visitor_id": vid})
        client.close()

    asyncio.run(_wipe())


def test_stale_leads_endpoint_shape():
    """Public route (admin-gated upstream) returns shape the funnel
    warning logic relies on."""
    r = requests.get(f"{BASE_URL}/api/admin/attribution/stale-leads?days=7", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["days"] == 7
    assert "count" in body
    assert isinstance(body["leads"], list)
    for lead in body["leads"]:
        assert "email" in lead
