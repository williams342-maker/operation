"""Regression: IndexNow auto-ping helper (`seo_indexnow.submit_urls`).

We don't want this test to actually hit api.indexnow.org on every CI run
(IndexNow has per-IP daily quotas), so we monkeypatch `ping` to a stub
that records what it was called with. The throttling layer is the real
target — verify it dedupes inside the 30-min window.
"""
import asyncio
import uuid

import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")


@pytest.mark.asyncio
async def test_submit_urls_throttles_within_window(monkeypatch):
    import seo_indexnow as si
    from core import db

    calls: list[list[str]] = []

    async def fake_ping(*, urls=None, budget=50):
        calls.append(list(urls or []))
        return {"ok": True, "status": 202, "count": len(urls or []),
                "urls_sample": list(urls or [])[:3], "key_location": "x",
                "host": "craftersmarket.org", "response_excerpt": ""}

    monkeypatch.setattr(si, "ping", fake_ping)

    # Use a unique URL per test run so we don't collide with prior throttle log entries.
    u = f"https://craftersmarket.org/shop/test-{uuid.uuid4().hex[:8]}"

    # Clean any stale rows.
    await db.indexnow_url_log.delete_many({"url": u})

    r1 = await si.submit_urls([u], reason="unit_test")
    assert r1 is not None
    assert r1["ok"] is True
    assert calls[-1] == [u]

    # Second call within the window must be throttled — fake_ping NOT re-invoked.
    r2 = await si.submit_urls([u], reason="unit_test")
    assert r2 is None
    assert len(calls) == 1, "ping must not be re-fired during throttle window"

    # Mixed call: throttled url + new url → only new url gets pinged.
    u2 = f"https://craftersmarket.org/shop/test-{uuid.uuid4().hex[:8]}"
    await db.indexnow_url_log.delete_many({"url": u2})
    r3 = await si.submit_urls([u, u2], reason="unit_test")
    assert r3 is not None
    assert calls[-1] == [u2]

    # Cleanup.
    await db.indexnow_url_log.delete_many({"url": {"$in": [u, u2]}})


@pytest.mark.asyncio
async def test_submit_urls_handles_empty_input():
    import seo_indexnow as si
    assert await si.submit_urls([]) is None
    assert await si.submit_urls(None) is None  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_url_helpers_use_canonical_apex(monkeypatch):
    import seo_indexnow as si
    monkeypatch.setenv("PUBLIC_SITE_URL", "https://craftersmarket.org")
    assert si.url_for_product("foo").startswith("https://craftersmarket.org/shop/")
    assert si.url_for_maker("foo").startswith("https://craftersmarket.org/makers/")
    assert si.url_for_journal("foo").startswith("https://craftersmarket.org/journal/")
