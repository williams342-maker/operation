"""iter104 — Team-notification webhook fan-out (Slack + Discord).

Verifies:
- `notify_team` is a no-op when no webhook env vars are configured.
- Slack-only configured → posts to slack URL only.
- Discord-only configured → posts to discord URL only.
- Both configured → posts to both, in parallel.
- Outage and recovery bypass the dedup window (always go through).
- Non-operational kinds (feedback/contact/test) honor the dedup window.
- Slack provider failure does not prevent Discord from firing.
- Beta feedback POST schedules a `notify_team` background task.
- Contact POST schedules a `notify_team` background task.
- Outage transition in `prod_health._fire_outage_alert` calls `notify_team`.
- Recovery transition in `_fire_recovery_alert` calls `notify_team`.
"""
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock

import pytest


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


def _clear_dedup():
    """Wipe the in-memory dedup cache between tests so order doesn't matter."""
    import notify_webhook
    notify_webhook._dedup_cache.clear()


# ============================================================
# notify_team — provider routing + dedup
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_notify_team_noop_when_no_provider_configured():
    _clear_dedup()
    from notify_webhook import notify_team
    with patch.dict("os.environ", {"SLACK_WEBHOOK_URL": "", "DISCORD_WEBHOOK_URL": ""}, clear=False):
        res = await notify_team(kind="test", title="hello", summary="world")
    assert res == {"slack": False, "discord": False, "deduped": False, "skipped": "unconfigured"}


@pytest.mark.asyncio(loop_scope="module")
async def test_notify_team_posts_to_slack_only_when_only_slack_configured():
    _clear_dedup()
    import notify_webhook
    fake_resp = MagicMock(status_code=200, text="ok")
    fake_post = AsyncMock(return_value=fake_resp)
    with patch.dict("os.environ",
                    {"SLACK_WEBHOOK_URL": "https://hooks.slack.com/ABC",
                     "DISCORD_WEBHOOK_URL": ""}, clear=False), \
         patch.object(notify_webhook.httpx.AsyncClient, "post", fake_post):
        res = await notify_webhook.notify_team(kind="feedback", title="t1", summary="body")
    assert res["slack"] is True and res["discord"] is False
    assert fake_post.await_count == 1
    called_url = fake_post.await_args.args[0]
    assert "slack.com" in called_url


@pytest.mark.asyncio(loop_scope="module")
async def test_notify_team_posts_to_discord_only_when_only_discord_configured():
    _clear_dedup()
    import notify_webhook
    fake_resp = MagicMock(status_code=204, text="")
    fake_post = AsyncMock(return_value=fake_resp)
    with patch.dict("os.environ",
                    {"SLACK_WEBHOOK_URL": "",
                     "DISCORD_WEBHOOK_URL": "https://discord.com/api/webhooks/123/abc"}, clear=False), \
         patch.object(notify_webhook.httpx.AsyncClient, "post", fake_post):
        res = await notify_webhook.notify_team(kind="contact", title="t2", summary="body")
    assert res["slack"] is False and res["discord"] is True
    assert fake_post.await_count == 1
    called_url = fake_post.await_args.args[0]
    assert "discord.com" in called_url


@pytest.mark.asyncio(loop_scope="module")
async def test_notify_team_fans_out_to_both_when_both_configured():
    _clear_dedup()
    import notify_webhook
    fake_resp = MagicMock(status_code=200, text="ok")
    fake_post = AsyncMock(return_value=fake_resp)
    with patch.dict("os.environ",
                    {"SLACK_WEBHOOK_URL": "https://hooks.slack.com/XYZ",
                     "DISCORD_WEBHOOK_URL": "https://discord.com/api/webhooks/9/9"}, clear=False), \
         patch.object(notify_webhook.httpx.AsyncClient, "post", fake_post):
        res = await notify_webhook.notify_team(kind="outage", title="/api/foo", summary="HTTP 500")
    assert res["slack"] is True and res["discord"] is True
    assert fake_post.await_count == 2
    urls_called = {c.args[0] for c in fake_post.await_args_list}
    assert any("slack" in u for u in urls_called) and any("discord" in u for u in urls_called)


@pytest.mark.asyncio(loop_scope="module")
async def test_notify_team_dedupes_repeated_feedback_within_window():
    _clear_dedup()
    import notify_webhook
    fake_resp = MagicMock(status_code=200, text="ok")
    fake_post = AsyncMock(return_value=fake_resp)
    with patch.dict("os.environ",
                    {"SLACK_WEBHOOK_URL": "https://hooks.slack.com/XYZ",
                     "DISCORD_WEBHOOK_URL": ""}, clear=False), \
         patch.object(notify_webhook.httpx.AsyncClient, "post", fake_post):
        r1 = await notify_webhook.notify_team(kind="feedback", title="same-title", summary="a")
        r2 = await notify_webhook.notify_team(kind="feedback", title="same-title", summary="b")
    assert r1["slack"] is True
    assert r2 == {"slack": False, "discord": False, "deduped": True}
    assert fake_post.await_count == 1


@pytest.mark.asyncio(loop_scope="module")
async def test_notify_team_outage_bypasses_dedup_window():
    """Outages must always go through — operational alerting never deduped."""
    _clear_dedup()
    import notify_webhook
    fake_resp = MagicMock(status_code=200, text="ok")
    fake_post = AsyncMock(return_value=fake_resp)
    with patch.dict("os.environ",
                    {"SLACK_WEBHOOK_URL": "https://hooks.slack.com/XYZ",
                     "DISCORD_WEBHOOK_URL": ""}, clear=False), \
         patch.object(notify_webhook.httpx.AsyncClient, "post", fake_post):
        r1 = await notify_webhook.notify_team(kind="outage", title="/api/foo", summary="500")
        r2 = await notify_webhook.notify_team(kind="outage", title="/api/foo", summary="500")
    assert r1["slack"] is True and r2["slack"] is True
    assert fake_post.await_count == 2


@pytest.mark.asyncio(loop_scope="module")
async def test_notify_team_one_provider_failure_does_not_block_other():
    _clear_dedup()
    import notify_webhook

    async def fake_post(self, url, **kw):
        if "slack" in url:
            raise notify_webhook.httpx.TimeoutException("slack down")
        return MagicMock(status_code=204, text="")

    with patch.dict("os.environ",
                    {"SLACK_WEBHOOK_URL": "https://hooks.slack.com/XYZ",
                     "DISCORD_WEBHOOK_URL": "https://discord.com/api/webhooks/9/9"}, clear=False), \
         patch.object(notify_webhook.httpx.AsyncClient, "post", fake_post):
        # Should not raise even though slack errored.
        res = await notify_webhook.notify_team(kind="outage", title="/api/x", summary="boom")
    assert res["slack"] is True and res["discord"] is True  # both attempted


# ============================================================
# Call-site wiring — beta feedback + contact + prod outage
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_beta_feedback_post_schedules_notify_team():
    from core import db
    from routers.settings import submit_beta_feedback, BetaFeedbackIn
    from fastapi import BackgroundTasks
    # Force beta_mode on for the duration of the test.
    await db.site_settings.update_one(
        {"_id": "global"}, {"$set": {"beta_mode": True}}, upsert=True,
    )
    payload = BetaFeedbackIn(
        name="WebhookTester",
        email="iter104-beta@example.com",
        message="Slack/Discord wiring smoke test.",
        page="/checkout",
    )
    bg = BackgroundTasks()
    with patch("notify_webhook.notify_team", new=AsyncMock(return_value={"slack": True})) as nt, \
         patch("email_service.send_beta_feedback", new=AsyncMock()):
        r = await submit_beta_feedback(payload, bg)
        await bg()
        assert r["received"] is True
        assert nt.await_count == 1
        kw = nt.await_args.kwargs
        assert kw["kind"] == "feedback"
        assert "WebhookTester" in kw["title"]
        assert "Slack/Discord wiring" in kw["summary"]
    await db.beta_feedback.delete_many({"id": r["id"]})


@pytest.mark.asyncio(loop_scope="module")
async def test_contact_post_schedules_notify_team():
    from core import db
    from routers.contact_messages import submit_contact_message, ContactMessageIn
    from fastapi import BackgroundTasks, Request

    payload = ContactMessageIn(
        name="WhTester",
        email="iter104-contact@example.com",
        subject="Bulk pricing",
        topic="general",
        message="Quick webhook smoke for contact form.",
        phone="555-0100",
    )
    # Build a minimal Request stub so the rate-limit code can grab an IP.
    scope = {"type": "http", "client": ("127.0.0.1", 0), "headers": []}
    req = Request(scope)
    bg = BackgroundTasks()
    with patch("notify_webhook.notify_team", new=AsyncMock(return_value={"slack": True})) as nt, \
         patch("email_service.send_contact_message_to_ops", new=AsyncMock()), \
         patch("email_service.send_contact_message_autoreply", new=AsyncMock()):
        r = await submit_contact_message(payload, req, bg)
        await bg()
        assert r["received"] is True
        assert nt.await_count == 1
        kw = nt.await_args.kwargs
        assert kw["kind"] == "contact"
        assert "Bulk pricing" in kw["title"] or "WhTester" in kw["title"]
    await db.contact_messages.delete_many({"id": r["id"]})


@pytest.mark.asyncio(loop_scope="module")
async def test_prod_outage_alert_calls_notify_team_with_outage_kind():
    from prod_health import _fire_outage_alert
    with patch("email_service.send_ops_prod_outage_alert", new=AsyncMock()), \
         patch("notify_webhook.notify_team", new=AsyncMock()) as nt:
        await _fire_outage_alert(endpoint="/api/products?limit=1", status=500, reason="HTTP 500")
        assert nt.await_count == 1
        kw = nt.await_args.kwargs
        assert kw["kind"] == "outage"
        assert kw["title"] == "/api/products?limit=1"
        assert "HTTP 500" in kw["summary"]


@pytest.mark.asyncio(loop_scope="module")
async def test_prod_recovery_alert_calls_notify_team_with_recovery_kind():
    from prod_health import _fire_recovery_alert
    with patch("email_service.send_ops_prod_recovery", new=AsyncMock()), \
         patch("notify_webhook.notify_team", new=AsyncMock()) as nt:
        await _fire_recovery_alert(endpoint="/api/sitemap.xml", downtime_minutes=7)
        assert nt.await_count == 1
        kw = nt.await_args.kwargs
        assert kw["kind"] == "recovery"
        assert "7 min" in kw["summary"]
