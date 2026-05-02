"""iter111 — IndexNow ping admin endpoints + key file route.

Verifies:
- /api/indexnow-key.txt returns the bare key (no whitespace/newline padding).
- The key is generated on first request and persisted (idempotent — same
  key returned on every subsequent request, no ping-pong).
- Admin /api/admin/seo/ping fires a real httpx POST (mocked here) with
  the correct body shape: host, key, keyLocation, urlList.
- urlList anchors the homepage + 4 landing pages, then fills with catalog.
- ping() captures success cleanly when IndexNow returns 200.
- ping() captures failure cleanly when IndexNow returns 4xx (real-world
  case caught during dev: 422 "URLs not related to your site").
- ping() captures timeout cleanly without raising.
- /api/admin/seo/ping/status reflects the last-ping audit row.
- Admin endpoints reject unauthenticated callers (401).
"""
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock

import pytest
from httpx import AsyncClient, ASGITransport, TimeoutException


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


async def _client():
    from server import app
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _admin_headers():
    """Mint a real admin JWT — the routes use the standard `current_admin`
    dep so we go through the full token-decode path."""
    from maker_auth import issue_session_jwt
    token = issue_session_jwt(
        maker_slug="admin", email="team@craftersmarket.org", role="admin",
    )
    return {"Authorization": f"Bearer {token}"}


async def _reset_indexnow_state():
    from core import db
    await db.system_state.delete_many({"_id": "indexnow"})


# ============================================================
# Key generation + key-file route
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_indexnow_key_generated_and_persisted_idempotently():
    from seo_indexnow import get_key
    await _reset_indexnow_state()
    k1 = await get_key()
    k2 = await get_key()
    assert k1 == k2
    assert len(k1) == 32          # 16 bytes hex = 32 chars
    assert all(c in "0123456789abcdef" for c in k1)
    await _reset_indexnow_state()


@pytest.mark.asyncio(loop_scope="module")
async def test_key_file_route_returns_bare_key_no_padding():
    from seo_indexnow import get_key
    await _reset_indexnow_state()
    expected = await get_key()
    async with await _client() as c:
        r = await c.get("/api/indexnow-key.txt")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    # Spec: response body MUST be the bare key (no trailing whitespace).
    assert r.text == expected
    await _reset_indexnow_state()


# ============================================================
# Ping logic
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_ping_collects_homepage_plus_landing_pages_plus_catalog():
    """The auto-collected URL list anchors the homepage + 4 known landing
    pages and fills the rest with the most-recent catalog URLs."""
    from seo_indexnow import _collect_recent_urls
    urls = await _collect_recent_urls(budget=20)
    # Homepage + /shop + /makers + /journal + /updates always present.
    for must in ["https://craftersmarket.org/",
                 "https://craftersmarket.org/shop",
                 "https://craftersmarket.org/makers",
                 "https://craftersmarket.org/journal",
                 "https://craftersmarket.org/updates"]:
        assert must in urls, f"missing anchor URL: {must}"
    # Sub-cap respected.
    assert len(urls) <= 20
    # No dupes.
    assert len(urls) == len(set(urls))


@pytest.mark.asyncio(loop_scope="module")
async def test_ping_ok_path_records_audit_row():
    from seo_indexnow import ping
    await _reset_indexnow_state()
    fake_resp = MagicMock(status_code=200, text="OK")
    fake_post = AsyncMock(return_value=fake_resp)
    import seo_indexnow
    with patch.object(seo_indexnow.httpx.AsyncClient, "post", fake_post):
        res = await ping(budget=8)
    assert res["ok"] is True
    assert res["status"] == 200
    assert res["host"] == "craftersmarket.org"
    assert res["count"] >= 5
    assert res["urls_sample"][0] == "https://craftersmarket.org/"
    # Body shape sent to IndexNow.
    sent_payload = fake_post.await_args.kwargs.get("json") or fake_post.await_args.args[-1]
    assert sent_payload["host"] == "craftersmarket.org"
    assert sent_payload["keyLocation"].endswith("/api/indexnow-key.txt")
    assert isinstance(sent_payload["urlList"], list)
    # Audit row written.
    from seo_indexnow import status as ping_status
    s = await ping_status()
    assert s["last_ping_ok"] is True
    assert s["last_ping_status"] == 200
    await _reset_indexnow_state()


@pytest.mark.asyncio(loop_scope="module")
async def test_ping_records_failure_status_without_raising():
    """The real-world 422 we caught during dev — IndexNow rejects URLs
    when the keyLocation isn't reachable. The endpoint must capture
    cleanly so the admin UI can surface the error."""
    from seo_indexnow import ping
    await _reset_indexnow_state()
    fake_resp = MagicMock(status_code=422,
                          text='{"errorCode":"InvalidRequestParameters","message":"..."}')
    fake_post = AsyncMock(return_value=fake_resp)
    import seo_indexnow
    with patch.object(seo_indexnow.httpx.AsyncClient, "post", fake_post):
        res = await ping(budget=8)
    assert res["ok"] is False
    assert res["status"] == 422
    assert "InvalidRequestParameters" in res["response_excerpt"]
    await _reset_indexnow_state()


@pytest.mark.asyncio(loop_scope="module")
async def test_ping_handles_timeout_without_raising():
    from seo_indexnow import ping
    await _reset_indexnow_state()

    async def fake_post(self, *a, **kw):
        raise TimeoutException("simulated timeout")

    import seo_indexnow
    with patch.object(seo_indexnow.httpx.AsyncClient, "post", fake_post):
        res = await ping(budget=8)
    assert res["ok"] is False
    assert res["status"] == 0
    assert res["error"] == "timeout"
    await _reset_indexnow_state()


# ============================================================
# Admin endpoints
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_admin_ping_endpoint_requires_auth():
    async with await _client() as c:
        r = await c.post("/api/admin/seo/ping")
    assert r.status_code == 401


@pytest.mark.asyncio(loop_scope="module")
async def test_admin_ping_status_endpoint_requires_auth():
    async with await _client() as c:
        r = await c.get("/api/admin/seo/ping/status")
    assert r.status_code == 401


@pytest.mark.asyncio(loop_scope="module")
async def test_admin_ping_endpoint_returns_full_result_shape():
    """Verifies the admin endpoint returns the underlying `ping()` result
    untouched. The internals of `ping()` are exercised by the earlier
    tests; here we only care about the route-level wiring."""
    import seo_indexnow
    fake_result = {
        "ok": True, "status": 200, "error": None, "count": 5,
        "urls_sample": ["https://craftersmarket.org/", "https://craftersmarket.org/shop"],
        "key_location": "https://craftersmarket.org/api/indexnow-key.txt",
        "host": "craftersmarket.org",
        "response_excerpt": "OK",
        "google_search_console_url": "https://search.google.com/search-console/...",
        "next_step_for_google": "Submit /api/sitemap.xml manually...",
    }
    headers = await _admin_headers()
    with patch("seo_indexnow.ping", new=AsyncMock(return_value=fake_result)):
        async with await _client() as c:
            r = await c.post("/api/admin/seo/ping", headers=headers, json={"budget": 8})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "google_search_console_url" in body
    assert "next_step_for_google" in body
    assert body["urls_sample"][0] == "https://craftersmarket.org/"
