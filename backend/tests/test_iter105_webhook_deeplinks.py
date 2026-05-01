"""iter105 — Webhook deep-link to specific admin row.

Verifies the `link` field on each `notify_team` call:
- Beta feedback POST → link contains `?tab=feedback&open=<id>`
- Contact POST → link contains `?tab=contact&open=<id>`
- Outage transition → link contains `?tab=prod-health` (no row id — endpoint-level)
- Recovery transition → link contains `?tab=prod-health`
"""
import asyncio
from unittest.mock import patch, AsyncMock

import pytest


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.mark.asyncio(loop_scope="module")
async def test_beta_feedback_webhook_deep_links_to_feedback_row():
    from core import db
    from routers.settings import submit_beta_feedback, BetaFeedbackIn
    from fastapi import BackgroundTasks
    await db.site_settings.update_one(
        {"_id": "global"}, {"$set": {"beta_mode": True}}, upsert=True,
    )
    payload = BetaFeedbackIn(
        name="DeepLinker", email="iter105-fb@example.com",
        message="Deep-link test.", page="/shop",
    )
    bg = BackgroundTasks()
    with patch("notify_webhook.notify_team", new=AsyncMock()) as nt, \
         patch("email_service.send_beta_feedback", new=AsyncMock()):
        r = await submit_beta_feedback(payload, bg)
        await bg()
        link = nt.await_args.kwargs["link"]
        assert "/admin/dashboard" in link
        assert "tab=feedback" in link
        assert f"open={r['id']}" in link
    await db.beta_feedback.delete_many({"id": r["id"]})


@pytest.mark.asyncio(loop_scope="module")
async def test_contact_webhook_deep_links_to_contact_row():
    from core import db
    from routers.contact_messages import submit_contact_message, ContactMessageIn
    from fastapi import BackgroundTasks, Request
    payload = ContactMessageIn(
        name="DeepLinker", email="iter105-ct@example.com",
        subject="Deep-link", topic="general",
        message="Deep-link test.", phone="",
    )
    scope = {"type": "http", "client": ("127.0.0.1", 0), "headers": []}
    req = Request(scope)
    bg = BackgroundTasks()
    with patch("notify_webhook.notify_team", new=AsyncMock()) as nt, \
         patch("email_service.send_contact_message_to_ops", new=AsyncMock()), \
         patch("email_service.send_contact_message_autoreply", new=AsyncMock()):
        r = await submit_contact_message(payload, req, bg)
        await bg()
        link = nt.await_args.kwargs["link"]
        assert "/admin/dashboard" in link
        assert "tab=contact" in link
        assert f"open={r['id']}" in link
    await db.contact_messages.delete_many({"id": r["id"]})


@pytest.mark.asyncio(loop_scope="module")
async def test_outage_webhook_deep_links_to_prod_health_tab():
    from prod_health import _fire_outage_alert
    with patch("email_service.send_ops_prod_outage_alert", new=AsyncMock()), \
         patch("notify_webhook.notify_team", new=AsyncMock()) as nt:
        await _fire_outage_alert(endpoint="/api/products?limit=1", status=500, reason="HTTP 500")
        link = nt.await_args.kwargs["link"]
        assert "/admin/dashboard" in link
        assert "tab=prod-health" in link


@pytest.mark.asyncio(loop_scope="module")
async def test_recovery_webhook_deep_links_to_prod_health_tab():
    from prod_health import _fire_recovery_alert
    with patch("email_service.send_ops_prod_recovery", new=AsyncMock()), \
         patch("notify_webhook.notify_team", new=AsyncMock()) as nt:
        await _fire_recovery_alert(endpoint="/api/sitemap.xml", downtime_minutes=4)
        link = nt.await_args.kwargs["link"]
        assert "/admin/dashboard" in link
        assert "tab=prod-health" in link
