"""Iter28 — Maker application lifecycle emails + Community EUA gate."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ────────────────────────────────────────────────────────────────────────
# email_service.send_applicant_received — application ack
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_applicant_received_email_includes_studio_and_timeline():
    from email_service import send_applicant_received
    captured = {}

    async def fake_send(to, subj, html):
        captured["to"] = to
        captured["subject"] = subj
        captured["html"] = html
        return {"id": "ack"}

    with patch("email_service._send", fake_send):
        await send_applicant_received(
            "applicant@example.com", "Maya Chen", "Forge & Fern",
        )
    assert captured["to"] == "applicant@example.com"
    assert "Forge & Fern" in captured["subject"]
    # Timeline expectations + applicant name personalisation
    assert "Maya Chen" in captured["html"]
    assert "3-5 business days" in captured["html"]
    assert "welcome packet" in captured["html"].lower()


@pytest.mark.asyncio
async def test_applicant_received_beta_flair_when_beta_flag_set():
    """Beta applicants get a Founding Seller flair + matching subject;
    core copy (timeline, welcome packet) stays identical."""
    from email_service import send_applicant_received
    captured = {}

    async def fake_send(to, subj, html):
        captured["subject"] = subj
        captured["html"] = html
        return {"id": "ack"}

    with patch("email_service._send", fake_send):
        await send_applicant_received(
            "founder@example.com", "Maya", "Forge & Fern", is_beta=True,
        )
    assert "Founding Seller" in captured["subject"]
    assert "Founding Seller Beta" in captured["html"]
    # Core promise still present
    assert "3-5 business days" in captured["html"]
    assert "welcome packet" in captured["html"].lower()


@pytest.mark.asyncio
async def test_applicant_received_skips_when_email_missing():
    from email_service import send_applicant_received
    r = await send_applicant_received("", "Maya", "Forge")
    assert r is None


# ────────────────────────────────────────────────────────────────────────
# email_service.send_application_decision — welcome packet on approval
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_welcome_packet_includes_launch_checklist_and_link():
    from email_service import send_application_decision
    captured = {}

    async def fake_send(to, subj, html):
        captured["html"] = html
        captured["subject"] = subj
        return {"id": "wp"}

    with patch("email_service._send", fake_send):
        await send_application_decision(
            "maker@x.com", "Maya", "Forge & Fern",
            approved=True, note="Loved your work.",
            sign_in_link="https://craftersmarket.org/maker/verify?token=tk123",
        )
    assert "Welcome to Crafters Market" in captured["subject"]
    html = captured["html"]
    # Magic link CTA + portal button
    assert "Open Maker Portal" in html
    assert "tk123" in html
    # Launch checklist content
    assert "Connect Stripe" in html
    assert "first 3 listings" in html.lower()
    # Fee breakdown
    assert "5% commission" in html
    assert "10 free listings" in html.lower()
    # Personalised note included as a quote block
    assert "Loved your work." in html


@pytest.mark.asyncio
async def test_decline_email_stays_short_and_kind():
    """Rejection path should NOT contain the launch checklist (welcome packet)."""
    from email_service import send_application_decision
    captured = {}

    async def fake_send(to, subj, html):
        captured["html"] = html
        captured["subject"] = subj
        return {"id": "no"}

    with patch("email_service._send", fake_send):
        await send_application_decision(
            "rejected@x.com", "Lee", "Outlier Studio",
            approved=False, note="",
        )
    assert "update" in captured["subject"].lower()
    assert "Open Maker Portal" not in captured["html"]
    assert "Connect Stripe" not in captured["html"]
    # But still warm
    assert "feel free to reapply" in captured["html"].lower()


# ────────────────────────────────────────────────────────────────────────
# Catalog router — applicant ack scheduled on apply
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_apply_to_makers_schedules_both_ops_and_applicant_emails():
    """Submitting an application should fire BOTH the ops alert and the
    applicant ack as background tasks."""
    from fastapi import BackgroundTasks
    from routers.catalog import create_maker_application
    from models import MakerApplicationCreate

    fake_db = MagicMock()
    fake_db.maker_applications.insert_one = AsyncMock()
    fake_db.activity_events.insert_one = AsyncMock()

    bg = BackgroundTasks()
    payload = MakerApplicationCreate(
        name="Maya", studio_name="Forge", location="Austin",
        email="maya@example.com", techniques=["PLASMA"], about="10 years.",
    )
    with patch("routers.catalog.db", fake_db):
        await create_maker_application(payload, bg)
    # 2 background tasks: ops alert + applicant ack
    assert len(bg.tasks) == 2
    task_fn_names = {t.func.__name__ for t in bg.tasks}
    assert "send_ops_new_application" in task_fn_names
    assert "send_applicant_received" in task_fn_names


# ────────────────────────────────────────────────────────────────────────
# Community EUA — gate + grandfathering
# ────────────────────────────────────────────────────────────────────────
def test_eua_endpoint_returns_current_version():
    from routers.community import community_eua, CURRENT_EUA_VERSION
    import asyncio
    r = asyncio.run(community_eua())
    assert r["version"] == CURRENT_EUA_VERSION
    assert "Community Terms" in r["title"]
    assert r["links"]["policy"] == "/policy"


@pytest.mark.asyncio
async def test_eua_gate_blocks_first_time_signin_without_acceptance():
    from fastapi import HTTPException
    from routers.community import (
        community_auth_magic_request, MagicRequest,
    )
    from fastapi import BackgroundTasks
    fake_db = MagicMock()
    fake_db.community_users.find_one = AsyncMock(return_value=None)
    bg = BackgroundTasks()
    with patch("routers.community.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await community_auth_magic_request(
                MagicRequest(email="new@x.com", origin_url="https://x.com"),
                bg,
            )
    assert exc.value.status_code == 400
    assert "Community Terms" in exc.value.detail


@pytest.mark.asyncio
async def test_eua_gate_blocks_when_version_mismatches():
    """User submitting an old EUA version should be re-prompted."""
    from fastapi import HTTPException, BackgroundTasks
    from routers.community import community_auth_magic_request, MagicRequest
    fake_db = MagicMock()
    fake_db.community_users.find_one = AsyncMock(return_value=None)
    bg = BackgroundTasks()
    with patch("routers.community.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await community_auth_magic_request(
                MagicRequest(
                    email="new@x.com", origin_url="https://x.com",
                    accept_eua=True, eua_version="1999-01",
                ), bg,
            )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_eua_grandfathered_for_returning_user():
    """A user who already accepted current version doesn't need to re-accept."""
    from routers.community import (
        community_auth_magic_request, MagicRequest, CURRENT_EUA_VERSION,
    )
    from fastapi import BackgroundTasks
    fake_db = MagicMock()
    # User already on current version
    fake_db.community_users.find_one = AsyncMock(return_value={
        "email": "returning@x.com", "eua_version": CURRENT_EUA_VERSION,
    })
    bg = BackgroundTasks()
    with patch("routers.community.db", fake_db):
        r = await community_auth_magic_request(
            MagicRequest(email="returning@x.com", origin_url="https://x.com"),
            bg,
        )
    assert r["sent"] is True


@pytest.mark.asyncio
async def test_eua_acceptance_stamps_user_record():
    """First-time sign-in with acceptance should write eua_version + timestamp."""
    from routers.community import (
        community_auth_magic_request, MagicRequest, CURRENT_EUA_VERSION,
    )
    from fastapi import BackgroundTasks

    # The first find_one returns None (first sign-in), then _upsert_buyer
    # internally calls find_one again — we let it return the inserted doc.
    inserted = []

    fake_db = MagicMock()
    find_calls = [None, None]  # first for gate, second for upsert path

    async def find_one(*a, **kw):
        return find_calls.pop(0) if find_calls else None
    fake_db.community_users.find_one = AsyncMock(side_effect=find_one)
    fake_db.community_users.insert_one = AsyncMock(side_effect=lambda doc: inserted.append(doc))

    bg = BackgroundTasks()
    with patch("routers.community.db", fake_db):
        await community_auth_magic_request(
            MagicRequest(
                email="first@x.com", origin_url="https://x.com",
                accept_eua=True, eua_version=CURRENT_EUA_VERSION,
            ), bg,
        )
    assert inserted, "user should have been inserted"
    assert inserted[0]["email"] == "first@x.com"
    assert inserted[0]["eua_version"] == CURRENT_EUA_VERSION
    assert inserted[0]["eua_accepted_at"] is not None
