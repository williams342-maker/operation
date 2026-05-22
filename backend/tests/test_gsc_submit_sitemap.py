"""Regression: GSC sitemap submission (`gsc_client.submit_sitemap`).

We monkeypatch the GSC discovery client so the test never touches Google
in CI. The throttle layer is the real subject — verify it skips re-submits
inside the 60-min window.
"""
import uuid

import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")


class _FakeSubmit:
    def __init__(self):
        self.calls: list[dict] = []

    def __call__(self, siteUrl, feedpath):
        self.calls.append({"siteUrl": siteUrl, "feedpath": feedpath})
        outer = self

        class _Req:
            def execute(self_inner):
                return None
        return _Req()


class _FakeSitemaps:
    def __init__(self):
        self.submit_fn = _FakeSubmit()
    def submit(self, siteUrl, feedpath):
        return self.submit_fn(siteUrl=siteUrl, feedpath=feedpath)


class _FakeService:
    def __init__(self):
        self._sitemaps = _FakeSitemaps()
    def sitemaps(self):
        return self._sitemaps


@pytest.mark.asyncio
async def test_submit_sitemap_short_circuits_when_no_site_url(monkeypatch):
    import gsc_client
    monkeypatch.setenv("GSC_SITE_URL", "")
    r = await gsc_client.submit_sitemap()
    assert r["ok"] is False
    assert "GSC_SITE_URL" in (r["error"] or "")


@pytest.mark.asyncio
async def test_submit_sitemap_records_and_throttles(monkeypatch):
    import gsc_client
    from core import db

    fake = _FakeService()

    async def fake_client():
        return fake

    monkeypatch.setenv("GSC_SITE_URL", "https://craftersmarket.org/")
    monkeypatch.setattr(gsc_client, "_client", fake_client)

    # Use a per-run unique sitemap URL so we don't collide with throttle log
    # entries from previous runs.
    sitemap = f"https://craftersmarket.org/test-sitemap-{uuid.uuid4().hex[:8]}.xml"
    await db.gsc_sitemap_log.delete_many({"sitemap": sitemap})

    # First call → submitted, logged, fake API hit once.
    r1 = await gsc_client.submit_sitemap(sitemap)
    assert r1["ok"] is True
    assert r1["throttled"] is False
    assert r1["status"] == 200
    assert len(fake.sitemaps().submit_fn.calls) == 1

    # Second call within the 60-min window → throttled, fake API NOT hit again.
    r2 = await gsc_client.submit_sitemap(sitemap)
    assert r2["ok"] is True
    assert r2["throttled"] is True
    assert len(fake.sitemaps().submit_fn.calls) == 1

    # Latest audit row reflects the successful submit.
    last = await gsc_client.sitemap_status()
    # status() returns globally newest — only assert it's our sitemap when
    # nothing newer has landed; otherwise check our row exists explicitly.
    row = await db.gsc_sitemap_log.find_one(
        {"sitemap": sitemap}, {"_id": 0}, sort=[("ts", -1)],
    )
    assert row is not None
    assert row["ok"] is True

    # Cleanup.
    await db.gsc_sitemap_log.delete_many({"sitemap": sitemap})


@pytest.mark.asyncio
async def test_submit_sitemap_handles_no_client(monkeypatch):
    """When GSC isn't connected yet, submit returns ok=False with a clear
    'not connected' error rather than raising."""
    import gsc_client
    monkeypatch.setenv("GSC_SITE_URL", "https://craftersmarket.org/")

    async def no_client():
        return None
    monkeypatch.setattr(gsc_client, "_client", no_client)

    r = await gsc_client.submit_sitemap("https://craftersmarket.org/sitemap.xml")
    assert r["ok"] is False
    assert "not connected" in (r["error"] or "").lower() or "unavailable" in (r["error"] or "").lower()
