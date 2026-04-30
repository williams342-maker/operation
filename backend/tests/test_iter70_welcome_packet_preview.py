"""Iter70 — Welcome-packet email preview endpoint.

Pure renderer + admin GET endpoint that returns the exact subject + html
the applicant will receive on Approve / Reject — without dispatching."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def test_render_returns_subject_and_html_for_approve_path():
    from email_service import render_application_decision_email
    r = render_application_decision_email(
        "Maya", "Forge & Fern", approved=True,
        note="Loved your portfolio.",
        sign_in_link="https://craftersmarket.org/maker/verify?token=abc",
    )
    assert "Welcome to Crafters Market" in r["subject"]
    assert "Forge & Fern" in r["subject"]
    # Hallmark welcome-packet content
    assert "Open Maker Portal" in r["html"]
    assert "abc" in r["html"]
    assert "Connect Stripe" in r["html"]
    assert "5% commission" in r["html"]
    # Inline note rendered as quote block
    assert "Loved your portfolio." in r["html"]


def test_render_decline_path_stays_short():
    from email_service import render_application_decision_email
    r = render_application_decision_email(
        "Lee", "Outlier", approved=False, note="",
    )
    assert "application update" in r["subject"].lower()
    # Decline should NOT contain the launch checklist
    assert "Connect Stripe" not in r["html"]
    assert "Open Maker Portal" not in r["html"]
    assert "feel free to reapply" in r["html"].lower()


def test_render_decline_path_includes_inline_note_as_quote():
    from email_service import render_application_decision_email
    r = render_application_decision_email(
        "Lee", "Outlier", approved=False,
        note="Pieces feel rushed — keep building.",
    )
    assert "Pieces feel rushed" in r["html"]


@pytest.mark.asyncio
async def test_send_application_decision_calls_renderer_and_dispatches():
    """Sanity — the public dispatcher should be a thin wrapper over the
    renderer + `_send`. Guarantees QA preview is bit-for-bit identical
    to what really gets sent."""
    from email_service import send_application_decision

    captured = {}

    async def fake_send(to, subj, html):
        captured["to"] = to
        captured["subject"] = subj
        captured["html"] = html
        return {"id": "ok"}

    with patch("email_service._send", fake_send):
        await send_application_decision(
            "maker@example.com", "Maya", "Forge", approved=True,
            note="Welcome aboard.",
        )
    assert captured["to"] == "maker@example.com"
    assert "Forge" in captured["subject"]
    assert "Welcome aboard." in captured["html"]
    assert "Connect Stripe" in captured["html"]


@pytest.mark.asyncio
async def test_admin_preview_endpoint_404s_for_unknown_id():
    from fastapi import HTTPException
    from routers.admin import admin_preview_application_email

    fake_db = MagicMock()
    fake_db.maker_applications.find_one = AsyncMock(return_value=None)
    with patch("routers.admin.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await admin_preview_application_email(
                "missing-id", approved=True, note="",
                _={"email": "admin@x.com"},
            )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_admin_preview_endpoint_returns_full_payload():
    """Endpoint should return recipient + subject + html + applicant
    metadata so the modal can render headers without a second roundtrip."""
    from routers.admin import admin_preview_application_email

    fake_db = MagicMock()
    fake_db.maker_applications.find_one = AsyncMock(return_value={
        "id": "app-1",
        "name": "Maya",
        "email": "maya@example.com",
        "studio_name": "Forge & Fern",
    })
    with patch("routers.admin.db", fake_db):
        r = await admin_preview_application_email(
            "app-1", approved=True, note="Excited!",
            _={"email": "admin@x.com"},
        )
    assert r["recipient"] == "maya@example.com"
    assert r["applicant_name"] == "Maya"
    assert r["studio"] == "Forge & Fern"
    assert r["approved"] is True
    assert "Forge & Fern" in r["subject"]
    assert "Excited!" in r["html"]
    # Sign-in link uses a placeholder so we don't mint real tokens at
    # preview-time
    assert "token=preview" in r["html"]


@pytest.mark.asyncio
async def test_admin_preview_endpoint_supports_reject_path():
    """When approved=False the rendered email should be the short kind
    decline copy, not the welcome packet."""
    from routers.admin import admin_preview_application_email

    fake_db = MagicMock()
    fake_db.maker_applications.find_one = AsyncMock(return_value={
        "id": "app-2",
        "name": "Lee",
        "email": "lee@example.com",
        "studio_name": "Outlier Studio",
    })
    with patch("routers.admin.db", fake_db):
        r = await admin_preview_application_email(
            "app-2", approved=False, note="",
            _={"email": "admin@x.com"},
        )
    assert r["approved"] is False
    assert "Connect Stripe" not in r["html"]
    assert "Open Maker Portal" not in r["html"]
    assert "application update" in r["subject"].lower()
