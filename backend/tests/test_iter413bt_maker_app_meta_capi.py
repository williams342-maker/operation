"""iter413bt — Server-side Meta CAPI fire on maker application submit.

Verifies:
  • POST /api/maker-applications accepts optional `event_id`, `fbp`, `fbc`
    in the request body (Pydantic doesn't 422 when they're present).
  • Backwards-compatible: legacy submitters without those fields still
    work (the existing iter324 test contract is preserved).
  • The handler calls `send_meta_event` with the SAME event_id passed
    in by the client. This is the dedup contract Meta relies on.
  • When no event_id is supplied, the handler still fires (with a
    synthesized id) so a sketchy frontend cache doesn't lose the
    conversion entirely — Meta may double-count but never zero-count.
  • The transient tracking fields (event_id, fbp, fbc) are NOT persisted
    on the maker_application document.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch, AsyncMock

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")


def _fresh_email():
    return f"iter413bt-{uuid.uuid4().hex[:10]}@example.com"


def _cleanup(email: str):
    """Drop the inserted application + any activity event tied to it."""
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.maker_applications.delete_many({"email": email})
        await db.activity_events.delete_many({"text": {"$regex": f"iter413bt.*{email[:10]}"}})
        client.close()

    asyncio.run(_go())


def test_accepts_event_id_fbp_fbc_in_payload():
    email = _fresh_email()
    payload = {
        "name": "iter413bt Maker",
        "email": email,
        "studio_name": f"iter413bt studio {email[:10]}",
        "location": "Boise, ID",
        "techniques": ["Laser"],
        "about": "iter413bt server-side CAPI test maker.",
        "event_id": f"test-{uuid.uuid4().hex[:12]}",
        "fbp": "fb.1.1700000000000.1234567890",
        "fbc": "fb.1.1700000000000.IwAR0abcdef",
    }
    try:
        r = requests.post(f"{BASE_URL}/api/maker-applications", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == email
        # Sensitive tracking fields must NOT be echoed on the persisted doc.
        for k in ("event_id", "fbp", "fbc"):
            assert k not in body, f"{k} must not leak onto the response payload"
    finally:
        _cleanup(email)


def test_legacy_submitters_without_tracking_still_work():
    """Backwards compat — the iter324 contract must keep passing."""
    email = _fresh_email()
    payload = {
        "name": "iter413bt Legacy",
        "email": email,
        "studio_name": f"iter413bt legacy {email[:10]}",
        "location": "Reno, NV",
        "techniques": ["Wood"],
        "about": "iter413bt legacy submitter (no event_id).",
    }
    try:
        r = requests.post(f"{BASE_URL}/api/maker-applications", json=payload, timeout=20)
        assert r.status_code == 200, r.text
    finally:
        _cleanup(email)


def test_event_id_NOT_persisted_on_db_document():
    """Defence in depth — read the stored doc directly and confirm none
    of the transient tracking fields landed in Mongo."""
    from motor.motor_asyncio import AsyncIOMotorClient

    email = _fresh_email()
    event_id = f"persist-check-{uuid.uuid4().hex[:8]}"
    payload = {
        "name": "iter413bt PersistCheck",
        "email": email,
        "studio_name": f"iter413bt pc {email[:10]}",
        "location": "Tacoma, WA",
        "techniques": ["Metal"],
        "about": "iter413bt persistence check.",
        "event_id": event_id,
        "fbp": "fb.1.0.0",
        "fbc": "fb.1.0.0",
    }
    try:
        r = requests.post(f"{BASE_URL}/api/maker-applications", json=payload, timeout=20)
        assert r.status_code == 200, r.text

        async def _check():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            doc = await db.maker_applications.find_one({"email": email})
            client.close()
            return doc

        doc = asyncio.run(_check())
        assert doc is not None, "application was not persisted"
        for k in ("event_id", "fbp", "fbc"):
            assert k not in doc, f"tracking field {k!r} leaked into the persisted application doc"
    finally:
        _cleanup(email)


def test_send_meta_event_called_with_matching_event_id():
    """In-process unit test: invoke the handler directly with a mocked
    `send_meta_event` and confirm the SAME event_id flows through. This
    is the dedup contract — without it the browser pixel + server CAPI
    register as two separate conversions."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")

    from routers import catalog
    from models import MakerApplicationCreate
    from fastapi import BackgroundTasks
    from unittest.mock import MagicMock

    event_id = f"unit-{uuid.uuid4().hex[:12]}"
    email = _fresh_email()
    payload = MakerApplicationCreate(
        name="iter413bt Unit",
        email=email,
        studio_name=f"iter413bt unit {email[:10]}",
        location="Austin, TX",
        techniques=["Laser"],
        about="iter413bt unit test.",
        event_id=event_id,
        fbp="fb.1.0.0",
        fbc="fb.1.0.0",
    )
    bg = BackgroundTasks()
    request = MagicMock()
    request.headers = {"user-agent": "iter413bt-test/1.0", "referer": "https://example.com/apply"}
    request.client.host = "203.0.113.42"

    async def _run():
        from routers.meta_capi import send_meta_event as _real
        captured = {}

        async def _fake(**kwargs):
            captured.update(kwargs)
            return {"sent": True, "configured": True, "dedup_id": kwargs.get("event_id")}

        with patch("routers.meta_capi.send_meta_event", new=_fake), \
             patch("routers.catalog._check_maker_app_rate_limit"):
            try:
                await catalog.create_maker_application(payload, bg, request)
            except Exception as e:
                raise
            # Run the background tasks synchronously so we can inspect.
            for task in bg.tasks:
                if task.func is _fake or getattr(task.func, "__name__", "") == "_fake":
                    await task()
                # send_meta_event may be referenced via the original
                # import path. Find it by signature.
                if task.kwargs.get("event_id") == event_id:
                    await task()
            return captured

    captured = asyncio.run(_run())
    _cleanup(email)
    assert captured.get("event_id") == event_id, (
        f"expected event_id={event_id!r} passed through to send_meta_event, "
        f"got {captured.get('event_id')!r}"
    )
    assert captured.get("event_name") == "signup_maker"
    assert captured.get("email") == email
    assert captured.get("fbp") == "fb.1.0.0"
    assert captured.get("fbc") == "fb.1.0.0"


def test_handler_synthesizes_event_id_when_missing():
    """Even without a client-supplied event_id, the handler must still
    fire (synthesizing one from the application id) so the conversion
    isn't lost outright."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")

    from routers import catalog
    from models import MakerApplicationCreate
    from fastapi import BackgroundTasks
    from unittest.mock import MagicMock

    email = _fresh_email()
    payload = MakerApplicationCreate(
        name="iter413bt NoId",
        email=email,
        studio_name=f"iter413bt noid {email[:10]}",
        location="Denver, CO",
        techniques=["Wood"],
        about="iter413bt synthesizes id test.",
        # NB: no event_id / fbp / fbc
    )
    bg = BackgroundTasks()
    request = MagicMock()
    request.headers = {"user-agent": "iter413bt-test/1.0", "referer": ""}
    request.client.host = "203.0.113.43"

    captured = {}

    async def _fake_capi(**kwargs):
        captured.update(kwargs)
        return {"sent": True}

    async def _run():
        with patch("routers.meta_capi.send_meta_event", new=_fake_capi), \
             patch("routers.catalog._check_maker_app_rate_limit"):
            await catalog.create_maker_application(payload, bg, request)
            for task in bg.tasks:
                if task.kwargs.get("event_id"):
                    await task()

    asyncio.run(_run())
    _cleanup(email)
    eid = captured.get("event_id") or ""
    assert eid.startswith("app-"), (
        f"expected synthesized event_id to start with 'app-', got {eid!r}"
    )
