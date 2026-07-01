"""Regression: seo_policy_notify assembles the canonical Trust & Policy
Center URL set and fires IndexNow + GSC submit_sitemap in one call.

We do NOT hit the real IndexNow / Google endpoints — both legs are
mocked so the test is deterministic and network-free.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.mark.asyncio
async def test_notify_policy_publish_url_set():
    """The composed URL list matches the sitemap's canonical policy paths."""
    from seo_policy_notify import _absolute_policy_urls
    from routers.seo import TRUST_POLICY_PATHS

    urls = _absolute_policy_urls("https://craftersmarket.org")
    assert len(urls) == len(TRUST_POLICY_PATHS) == 17, (
        f"Expected 17 canonical trust/policy URLs, got {len(urls)}"
    )
    for p in TRUST_POLICY_PATHS:
        assert f"https://craftersmarket.org{p}" in urls
    # Deduping — a repeated path in the constant would not create a dupe.
    dupes = [u for u in urls if urls.count(u) > 1]
    assert not dupes, f"URL list has duplicates: {dupes}"


@pytest.mark.asyncio
async def test_notify_policy_publish_calls_indexnow_and_gsc():
    """Happy-path: both legs called with the composed URL list, GSC
    enabled → both statuses reported ok."""
    from seo_policy_notify import notify_policy_publish

    indexnow_stub = AsyncMock(return_value={
        "ok": True, "status": 200, "count": 17, "urls_sample": []
    })
    submit_sitemap_stub = AsyncMock(return_value={"ok": True, "status": 200})

    with patch("seo_indexnow.ping", indexnow_stub), \
         patch("gsc_client.is_gsc_enabled", return_value=True), \
         patch("gsc_client.submit_sitemap", submit_sitemap_stub):
        result = await notify_policy_publish(
            override_root="https://craftersmarket.org",
        )

    assert result["ok"] is True
    assert result["url_count"] == 17
    assert result["indexnow"]["ok"] is True
    assert result["gsc"]["ok"] is True
    assert result["gsc"]["skipped"] is False
    # IndexNow was called with the exact URL list
    indexnow_stub.assert_awaited_once()
    kwargs = indexnow_stub.await_args.kwargs
    assert len(kwargs["urls"]) == 17
    assert "https://craftersmarket.org/policies/privacy" in kwargs["urls"]
    assert "https://craftersmarket.org/policies/terms" in kwargs["urls"]
    # GSC was called with the site's sitemap URL
    submit_sitemap_stub.assert_awaited_once_with(
        "https://craftersmarket.org/sitemap.xml"
    )


@pytest.mark.asyncio
async def test_notify_policy_publish_skips_gsc_when_disabled():
    """When GSC is not configured, IndexNow still fires and the response
    surfaces a skip note without crashing."""
    from seo_policy_notify import notify_policy_publish

    indexnow_stub = AsyncMock(return_value={"ok": True, "status": 200, "count": 17})

    with patch("seo_indexnow.ping", indexnow_stub), \
         patch("gsc_client.is_gsc_enabled", return_value=False):
        result = await notify_policy_publish(
            override_root="https://craftersmarket.org",
        )

    assert result["indexnow"]["ok"] is True
    assert result["gsc"]["skipped"] is True
    assert "not configured" in result["gsc"]["reason"]


@pytest.mark.asyncio
async def test_notify_policy_publish_never_raises_on_gsc_error():
    """If submit_sitemap raises, the notifier still returns an ok=True
    response (from the IndexNow leg) and reports the GSC error inline."""
    from seo_policy_notify import notify_policy_publish

    indexnow_stub = AsyncMock(return_value={"ok": True, "status": 200, "count": 17})
    submit_sitemap_stub = AsyncMock(side_effect=RuntimeError("GSC OAuth expired"))

    with patch("seo_indexnow.ping", indexnow_stub), \
         patch("gsc_client.is_gsc_enabled", return_value=True), \
         patch("gsc_client.submit_sitemap", submit_sitemap_stub):
        result = await notify_policy_publish(
            override_root="https://craftersmarket.org",
        )

    assert result["ok"] is True  # IndexNow leg succeeded → overall ok
    assert result["gsc"]["ok"] is False
    assert result["gsc"]["skipped"] is False
    assert "OAuth expired" in result["gsc"]["error"]
