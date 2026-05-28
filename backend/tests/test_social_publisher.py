"""Tests for social_publisher.py (iter273).

Covers:
  1. Soft-skip when credentials are missing (no raise, returns
     {ok: False, skipped_reason: "not_configured"}).
  2. Successful publish to Instagram (two-step flow), Facebook, Pinterest
     via httpx.MockTransport intercepting the outbound calls.
  3. Per-channel error isolation in process_queue_row.
  4. publish_row_by_id status transitions:
       - any success     → status="published"
       - all skipped     → status stays "pending"
       - all errored     → status="failed"
  5. credentials_status() reflects current env vars.
  6. run_auto_publish_sweep no-ops when SOCIAL_AUTO_PUBLISH_ENABLED is off.
"""
from __future__ import annotations

import os
from unittest.mock import patch

import httpx
import pytest

from core import db
import social_publisher as sp


# ───────────────────────────── helpers ─────────────────────────────
TEST_ROW_ID = "_pytest_social_pub_row"
TEST_PRODUCT_SLUG = "_pytest_social_pub_product"
TEST_MAKER_SLUG = "_pytest_social_pub_maker"


def _row(**overrides) -> dict:
    base = {
        "id": TEST_ROW_ID,
        "status": "pending",
        "product_slug": TEST_PRODUCT_SLUG,
        "product_title": "Walnut Inlay Board",
        "product_url": "https://craftersmarket.org/shop/walnut-inlay-board",
        "image_url": "https://cdn.example.com/walnut.jpg",
        "price": 79.0,
        "maker_slug": TEST_MAKER_SLUG,
        "maker_name": "Test Maker Co.",
        "eligibility_tier": "plus",
        "channels": ["instagram", "facebook", "pinterest"],
        "queued_at": "2026-05-28T00:00:00+00:00",
        "captions": None,
    }
    base.update(overrides)
    return base


async def _cleanup():
    await db.social_auto_post_queue.delete_many({"id": TEST_ROW_ID})


async def _seed_row(**overrides):
    await _cleanup()
    row = _row(**overrides)
    await db.social_auto_post_queue.insert_one({**row})
    return row


@pytest.fixture
def env_creds(monkeypatch):
    """Set every channel's creds so publisher functions don't soft-skip."""
    monkeypatch.setenv("IG_USER_ID", "ig_user_1")
    monkeypatch.setenv("IG_USER_ACCESS_TOKEN", "ig_token_1")
    monkeypatch.setenv("FB_PAGE_ID", "fb_page_1")
    monkeypatch.setenv("FB_PAGE_ACCESS_TOKEN", "fb_token_1")
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "pin_token_1")
    monkeypatch.setenv("PINTEREST_DEFAULT_BOARD_ID", "board_1")


@pytest.fixture
def env_none(monkeypatch):
    """Wipe every channel's creds so soft-skip kicks in."""
    for k in ("IG_USER_ID", "IG_USER_ACCESS_TOKEN", "FB_PAGE_ID",
              "FB_PAGE_ACCESS_TOKEN", "PINTEREST_ACCESS_TOKEN",
              "PINTEREST_DEFAULT_BOARD_ID"):
        monkeypatch.delenv(k, raising=False)


# ───────────────────── 1. credentials_status() ─────────────────────
def test_credentials_status_all_set(env_creds):
    s = sp.credentials_status()
    assert s == {"instagram": True, "facebook": True, "pinterest": True}


def test_credentials_status_none_set(env_none):
    s = sp.credentials_status()
    assert s == {"instagram": False, "facebook": False, "pinterest": False}


def test_credentials_status_partial(monkeypatch, env_none):
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "x")
    monkeypatch.setenv("PINTEREST_DEFAULT_BOARD_ID", "b")
    s = sp.credentials_status()
    assert s["pinterest"] is True
    assert s["instagram"] is False
    assert s["facebook"] is False


# ───────────────────── 2. Soft-skip on missing creds ─────────────────────
@pytest.mark.asyncio
async def test_instagram_skips_when_not_configured(env_none):
    r = await sp.publish_to_instagram("https://x/img.jpg", "hi")
    assert r == {"ok": False, "skipped_reason": "not_configured"}


@pytest.mark.asyncio
async def test_facebook_skips_when_not_configured(env_none):
    r = await sp.publish_to_facebook_page("https://x/img.jpg", "hi")
    assert r == {"ok": False, "skipped_reason": "not_configured"}


@pytest.mark.asyncio
async def test_pinterest_skips_when_not_configured(env_none):
    r = await sp.publish_to_pinterest(
        "https://x/img.jpg", "title", "desc",
        "https://x.com/listing", board_id=None,
    )
    assert r == {"ok": False, "skipped_reason": "not_configured"}


# ───────────────────── 3. httpx.MockTransport happy-path ─────────────────────
def _mock_transport(handler):
    """Build an httpx.AsyncClient with a MockTransport."""
    return httpx.MockTransport(handler)


def _ig_handler(request: httpx.Request) -> httpx.Response:
    """Two-step IG flow: /media → container id, /media_publish → media id."""
    path = request.url.path
    if path.endswith("/media"):
        assert "image_url" in request.url.params
        assert "caption" in request.url.params
        return httpx.Response(200, json={"id": "ig_container_42"})
    if path.endswith("/media_publish"):
        assert request.url.params.get("creation_id") == "ig_container_42"
        return httpx.Response(200, json={"id": "ig_media_99"})
    return httpx.Response(404, text=f"unexpected {path}")


@pytest.mark.asyncio
async def test_publish_to_instagram_happy_path(env_creds, monkeypatch):
    transport = _mock_transport(_ig_handler)
    real_AsyncClient = httpx.AsyncClient
    monkeypatch.setattr(
        sp.httpx, "AsyncClient",
        lambda **kw: real_AsyncClient(transport=transport, **kw),
    )
    r = await sp.publish_to_instagram(
        "https://cdn.example.com/walnut.jpg", "🌟 NEW")
    assert r == {"ok": True, "platform_id": "ig_media_99"}


def _fb_handler(request: httpx.Request) -> httpx.Response:
    """`/{page-id}/photos` → 200 with photo id."""
    assert request.url.path.endswith("/photos")
    # data is sent as application/x-www-form-urlencoded
    body = request.content.decode() if request.content else ""
    assert "url=" in body and "message=" in body and "access_token=" in body
    return httpx.Response(200, json={"id": "fb_photo_77"})


@pytest.mark.asyncio
async def test_publish_to_facebook_page_happy_path(env_creds, monkeypatch):
    transport = _mock_transport(_fb_handler)
    real_AsyncClient = httpx.AsyncClient
    monkeypatch.setattr(
        sp.httpx, "AsyncClient",
        lambda **kw: real_AsyncClient(transport=transport, **kw),
    )
    r = await sp.publish_to_facebook_page(
        "https://cdn.example.com/walnut.jpg", "hi")
    assert r == {"ok": True, "platform_id": "fb_photo_77"}


def _pin_handler(request: httpx.Request) -> httpx.Response:
    """`/v5/pins` → 201 with pin id."""
    assert request.url.path.endswith("/pins")
    assert request.headers.get("Authorization", "").startswith("Bearer ")
    payload = request.read()
    import json
    body = json.loads(payload)
    assert body["board_id"] == "board_1"
    assert body["media_source"]["source_type"] == "image_url"
    return httpx.Response(201, json={"id": "pin_55"})


@pytest.mark.asyncio
async def test_publish_to_pinterest_happy_path(env_creds, monkeypatch):
    transport = _mock_transport(_pin_handler)
    real_AsyncClient = httpx.AsyncClient
    monkeypatch.setattr(
        sp.httpx, "AsyncClient",
        lambda **kw: real_AsyncClient(transport=transport, **kw),
    )
    r = await sp.publish_to_pinterest(
        image_url="https://cdn.example.com/walnut.jpg",
        title="walnut", description="a really lovely board",
        link="https://craftersmarket.org/shop/walnut",
    )
    assert r == {"ok": True, "platform_id": "pin_55"}


# ───────────────────── 4. Error path surfaces detail ─────────────────────
@pytest.mark.asyncio
async def test_pinterest_400_returns_error_dict(env_creds, monkeypatch):
    def handler(req):
        return httpx.Response(400, text='{"code":42,"message":"bad image"}')
    transport = _mock_transport(handler)
    real_AsyncClient = httpx.AsyncClient
    monkeypatch.setattr(
        sp.httpx, "AsyncClient",
        lambda **kw: real_AsyncClient(transport=transport, **kw),
    )
    r = await sp.publish_to_pinterest(
        image_url="https://cdn.example.com/img.jpg",
        title="t", description="d", link="https://x.com/y",
    )
    assert r["ok"] is False
    assert r["error"]["step"] == "create_pin"
    assert r["error"]["status"] == 400


# ───────────────────── 5. process_queue_row isolation ─────────────────────
@pytest.mark.asyncio
async def test_process_queue_row_isolates_per_channel_failures(
    env_creds, monkeypatch,
):
    """IG succeeds, FB 500s, Pinterest succeeds → per-channel results
    reflect that and one platform's failure doesn't block the others."""
    def handler(req: httpx.Request) -> httpx.Response:
        p = req.url.path
        if p.endswith("/media"):
            return httpx.Response(200, json={"id": "ig_ctr"})
        if p.endswith("/media_publish"):
            return httpx.Response(200, json={"id": "ig_xyz"})
        if p.endswith("/photos"):
            return httpx.Response(500, text="FB exploded")
        if p.endswith("/pins"):
            return httpx.Response(201, json={"id": "pin_abc"})
        return httpx.Response(404, text=f"unexpected {p}")

    transport = _mock_transport(handler)
    real_AsyncClient = httpx.AsyncClient
    monkeypatch.setattr(
        sp.httpx, "AsyncClient",
        lambda **kw: real_AsyncClient(transport=transport, **kw),
    )

    r = await sp.process_queue_row(_row())
    assert r["platform_ids"] == {"instagram": "ig_xyz", "pinterest": "pin_abc"}
    assert list(r["errors"]) == ["facebook"]
    assert r["errors"]["facebook"]["status"] == 500
    assert r["any_ok"] is True
    assert r["all_skipped"] is False


@pytest.mark.asyncio
async def test_process_queue_row_all_skipped_when_no_creds(env_none):
    """Every channel soft-skips when no creds are configured."""
    r = await sp.process_queue_row(_row())
    assert r["platform_ids"] == {}
    assert r["errors"] == {}
    assert set(r["skipped"]) == {"instagram", "facebook", "pinterest"}
    assert r["any_ok"] is False
    assert r["all_skipped"] is True


# ───────────────────── 6. publish_row_by_id status flips ─────────────────────
@pytest.mark.asyncio
async def test_publish_row_by_id_marks_published_on_any_success(
    env_creds, monkeypatch,
):
    await _seed_row(channels=["instagram"])
    def handler(req):
        p = req.url.path
        if p.endswith("/media"):     return httpx.Response(200, json={"id": "c"})
        if p.endswith("/media_publish"): return httpx.Response(200, json={"id": "m"})
        return httpx.Response(404)
    transport = _mock_transport(handler)
    real_AsyncClient = httpx.AsyncClient
    monkeypatch.setattr(
        sp.httpx, "AsyncClient",
        lambda **kw: real_AsyncClient(transport=transport, **kw),
    )
    res = await sp.publish_row_by_id(TEST_ROW_ID)
    assert res["status"] == "published"
    row = await db.social_auto_post_queue.find_one({"id": TEST_ROW_ID}, {"_id": 0})
    assert row["status"] == "published"
    assert row["platform_post_ids"] == {"instagram": "m"}
    assert row["published_by"] == "admin"
    await _cleanup()


@pytest.mark.asyncio
async def test_publish_row_by_id_leaves_pending_when_all_skipped(env_none):
    await _seed_row(channels=["instagram", "facebook", "pinterest"])
    res = await sp.publish_row_by_id(TEST_ROW_ID)
    assert res["status"] == "pending"
    row = await db.social_auto_post_queue.find_one({"id": TEST_ROW_ID}, {"_id": 0})
    assert row["status"] == "pending"
    assert row.get("last_attempt_at")
    assert set(row.get("platform_skipped") or {}) == {"instagram", "facebook", "pinterest"}
    await _cleanup()


@pytest.mark.asyncio
async def test_publish_row_by_id_marks_failed_when_all_error(
    env_creds, monkeypatch,
):
    await _seed_row(channels=["pinterest"])
    def handler(req):
        return httpx.Response(400, text="bad image")
    transport = _mock_transport(handler)
    real_AsyncClient = httpx.AsyncClient
    monkeypatch.setattr(
        sp.httpx, "AsyncClient",
        lambda **kw: real_AsyncClient(transport=transport, **kw),
    )
    res = await sp.publish_row_by_id(TEST_ROW_ID)
    assert res["status"] == "failed"
    row = await db.social_auto_post_queue.find_one({"id": TEST_ROW_ID}, {"_id": 0})
    assert row["status"] == "failed"
    assert "pinterest" in row["platform_errors"]
    await _cleanup()


@pytest.mark.asyncio
async def test_publish_row_by_id_rejects_already_published_row(env_creds):
    await _seed_row(status="published")
    res = await sp.publish_row_by_id(TEST_ROW_ID)
    assert res["ok"] is False
    assert res["reason"] == "not_pending"
    await _cleanup()


@pytest.mark.asyncio
async def test_publish_row_by_id_404_on_missing():
    await _cleanup()
    res = await sp.publish_row_by_id("does-not-exist")
    assert res == {"ok": False, "reason": "not_found"}


# ───────────────────── 7. captions override defaults ─────────────────────
@pytest.mark.asyncio
async def test_captions_override_default_template(env_creds, monkeypatch):
    """When the admin saves a custom IG caption, the publisher must
    send THAT exact text, not the fallback template."""
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/media"):
            captured["caption"] = req.url.params.get("caption")
            return httpx.Response(200, json={"id": "c"})
        if req.url.path.endswith("/media_publish"):
            return httpx.Response(200, json={"id": "m"})
        return httpx.Response(404)

    transport = _mock_transport(handler)
    real_AsyncClient = httpx.AsyncClient
    monkeypatch.setattr(
        sp.httpx, "AsyncClient",
        lambda **kw: real_AsyncClient(transport=transport, **kw),
    )

    custom = "Limited drop! 24h only."
    row = _row(channels=["instagram"], captions={"instagram": custom})
    res = await sp.process_queue_row(row)
    assert res["platform_ids"] == {"instagram": "m"}
    assert captured["caption"] == custom


# ───────────────────── 8. sweep is OFF by default ─────────────────────
@pytest.mark.asyncio
async def test_sweep_noop_when_flag_disabled(monkeypatch):
    monkeypatch.delenv("SOCIAL_AUTO_PUBLISH_ENABLED", raising=False)
    r = await sp.run_auto_publish_sweep(limit=10)
    assert r == {"ran": False, "reason": "disabled_via_env"}


@pytest.mark.asyncio
async def test_sweep_runs_when_flag_enabled(monkeypatch, env_none):
    """With the flag on but no creds, sweep should run, process pending
    rows, and leave them pending (all_skipped)."""
    monkeypatch.setenv("SOCIAL_AUTO_PUBLISH_ENABLED", "true")
    await _seed_row(channels=["instagram"])
    r = await sp.run_auto_publish_sweep(limit=5)
    assert r["ran"] is True
    assert r["processed"] >= 1
    # No creds → row stays pending, counts under "skipped"
    assert r["published"] == 0
    assert r["skipped"] >= 1
    await _cleanup()
