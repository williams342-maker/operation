"""iter115 — Vision upgrade for the showcase AI description endpoint.

Verifies:
- `_fetch_image_for_vision` returns base64 on a successful image fetch.
- `_fetch_image_for_vision` returns None for non-image content-types,
  HTTP errors, oversized payloads, and timeouts (best-effort).
- ai-describe response surfaces `vision_used=True` + `images_seen=N`
  when at least one image fetch succeeded.
- ai-describe falls back gracefully (`vision_used=False`) when EVERY
  image fetch fails — no 500, no aborted request.
- The Claude call receives `file_contents=[ImageContent...]` of length
  matching the number of successfully-fetched images.
- Cap of `SHOWCASE_AI_VISION_MAX_IMAGES` (3) is enforced even when the
  buyer attached more (8 in the picker).
"""
import asyncio
import base64
from unittest.mock import patch, AsyncMock, MagicMock

import pytest
from httpx import AsyncClient, ASGITransport


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


async def _client():
    from server import app
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed_buyer():
    from core import db, now_iso
    from maker_auth import issue_session_jwt
    user_id = "iter115-buyer"
    await db.community_users.update_one(
        {"user_id": user_id},
        {"$set": {
            "user_id": user_id, "email": "iter115@example.com",
            "name": "Iter115", "picture": "",
            "created_at": now_iso(), "is_banned": False,
        }},
        upsert=True,
    )
    return {"Authorization": f"Bearer {issue_session_jwt(maker_slug=user_id, email='iter115@example.com', role='buyer')}"}


# ============================================================
# _fetch_image_for_vision — happy + sad paths
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_fetch_image_returns_base64_on_success():
    from routers.community import _fetch_image_for_vision
    raw = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    fake_resp = MagicMock(
        status_code=200, content=raw,
        headers={"content-type": "image/png"},
    )
    fake_get = AsyncMock(return_value=fake_resp)
    import routers.community as cm
    with patch.object(cm.__dict__.get("httpx", None) or __import__("httpx").AsyncClient,
                      "get", fake_get, create=True):
        b64 = await _fetch_image_for_vision("https://cdn.example.com/x.png")
    # If patch didn't bite (httpx imported lazily inside fn), do it again
    # via the canonical path:
    if b64 is None:
        import httpx as _httpx
        with patch.object(_httpx.AsyncClient, "get", fake_get):
            b64 = await _fetch_image_for_vision("https://cdn.example.com/x.png")
    assert b64 == base64.b64encode(raw).decode("ascii")


@pytest.mark.asyncio(loop_scope="module")
async def test_fetch_image_returns_none_on_non_image_content_type():
    from routers.community import _fetch_image_for_vision
    import httpx as _httpx
    fake_resp = MagicMock(status_code=200, content=b"hi", headers={"content-type": "text/html"})
    fake_get = AsyncMock(return_value=fake_resp)
    with patch.object(_httpx.AsyncClient, "get", fake_get):
        b64 = await _fetch_image_for_vision("https://cdn.example.com/page.html")
    assert b64 is None


@pytest.mark.asyncio(loop_scope="module")
async def test_fetch_image_returns_none_on_http_error():
    from routers.community import _fetch_image_for_vision
    import httpx as _httpx
    fake_resp = MagicMock(status_code=404, content=b"", headers={})
    fake_get = AsyncMock(return_value=fake_resp)
    with patch.object(_httpx.AsyncClient, "get", fake_get):
        b64 = await _fetch_image_for_vision("https://cdn.example.com/missing.png")
    assert b64 is None


@pytest.mark.asyncio(loop_scope="module")
async def test_fetch_image_returns_none_on_timeout():
    from routers.community import _fetch_image_for_vision
    import httpx as _httpx

    async def fake_get(self, url, **kw):
        raise _httpx.TimeoutException("simulated")

    with patch.object(_httpx.AsyncClient, "get", fake_get):
        b64 = await _fetch_image_for_vision("https://cdn.example.com/slow.png")
    assert b64 is None


@pytest.mark.asyncio(loop_scope="module")
async def test_fetch_image_returns_none_on_oversize():
    from routers.community import _fetch_image_for_vision, SHOWCASE_AI_VISION_MAX_BYTES
    import httpx as _httpx
    huge = b"\x89PNG" + b"\x00" * (SHOWCASE_AI_VISION_MAX_BYTES + 1)
    fake_resp = MagicMock(status_code=200, content=huge,
                          headers={"content-type": "image/png"})
    fake_get = AsyncMock(return_value=fake_resp)
    with patch.object(_httpx.AsyncClient, "get", fake_get):
        b64 = await _fetch_image_for_vision("https://cdn.example.com/huge.png")
    assert b64 is None


# ============================================================
# ai-describe endpoint with vision
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_ai_describe_with_vision_passes_image_contents_to_claude():
    """When images fetch successfully, the LLM call must receive
    file_contents of matching length, and the response must surface
    vision_used=True + images_seen=N."""
    headers = await _seed_buyer()
    captured = {}

    async def fake_describe(*, system, user_text, image_b64s):
        captured["image_b64s"] = list(image_b64s)
        captured["user_text"] = user_text
        return {"description": "Sharp cuts catch the morning light."}

    fake_b64 = base64.b64encode(b"\x89PNG\r\n\x1a\n").decode("ascii")

    async def fake_fetch(url):
        return fake_b64  # always succeed for this test

    with patch("routers.community._claude_vision_describe", new=fake_describe), \
         patch("routers.community._fetch_image_for_vision", new=fake_fetch):
        async with await _client() as c:
            r = await c.post(
                "/api/community/showcase/ai-describe",
                json={
                    "title": "Mounted in living room",
                    "image_urls": [
                        "https://cdn.example.com/a.png",
                        "https://cdn.example.com/b.png",
                    ],
                },
                headers=headers,
            )
    assert r.status_code == 200
    body = r.json()
    assert body["vision_used"] is True
    assert body["images_seen"] == 2
    assert body["description"] == "Sharp cuts catch the morning light."
    # Both fetched images made it into the LLM call.
    assert len(captured["image_b64s"]) == 2
    # Vision-mode prompt branch was used.
    assert "Look carefully at the photos" in captured["user_text"]


@pytest.mark.asyncio(loop_scope="module")
async def test_ai_describe_caps_at_max_vision_images():
    """If the buyer attached 8 photos, only the first 3 are fetched +
    sent to Claude — keeps latency + token cost bounded."""
    headers = await _seed_buyer()
    fetched_urls: list[str] = []

    async def fake_fetch(url):
        fetched_urls.append(url)
        return base64.b64encode(b"\x89PNG fake").decode("ascii")

    async def fake_describe(*, system, user_text, image_b64s):
        return {"description": "ok"}

    with patch("routers.community._claude_vision_describe", new=fake_describe), \
         patch("routers.community._fetch_image_for_vision", new=fake_fetch):
        async with await _client() as c:
            r = await c.post(
                "/api/community/showcase/ai-describe",
                json={
                    "title": "Eight-photo post",
                    "image_urls": [f"https://cdn.example.com/{i}.png" for i in range(8)],
                },
                headers=headers,
            )
    assert r.status_code == 200
    assert r.json()["images_seen"] == 3   # capped
    assert len(fetched_urls) == 3
    # Order preserved — first 3 of the 8 attached.
    assert fetched_urls == [f"https://cdn.example.com/{i}.png" for i in range(3)]


@pytest.mark.asyncio(loop_scope="module")
async def test_ai_describe_falls_back_when_every_image_fetch_fails():
    """All image fetches return None (broken URLs / R2 down) → endpoint
    must NOT 500, must surface vision_used=False, must still attempt the
    text-only Claude call."""
    headers = await _seed_buyer()

    async def fake_fetch(url):
        return None  # every fetch fails

    async def fake_describe(*, system, user_text, image_b64s):
        # In fallback mode, the text-only branch of the prompt is used.
        assert image_b64s == []
        assert "no photos were attached" in user_text
        return {"description": "Text-only fallback worked."}

    with patch("routers.community._claude_vision_describe", new=fake_describe), \
         patch("routers.community._fetch_image_for_vision", new=fake_fetch):
        async with await _client() as c:
            r = await c.post(
                "/api/community/showcase/ai-describe",
                json={
                    "title": "Broken image URLs",
                    "image_urls": ["https://cdn.example.com/dead.png"],
                },
                headers=headers,
            )
    assert r.status_code == 200
    body = r.json()
    assert body["vision_used"] is False
    assert body["images_seen"] == 0
    assert body["description"] == "Text-only fallback worked."


@pytest.mark.asyncio(loop_scope="module")
async def test_ai_describe_no_images_provided_uses_text_only_prompt_branch():
    """The buyer hasn't uploaded any photos yet → no fetch attempts,
    the text-only branch of the prompt fires, vision_used=False."""
    headers = await _seed_buyer()
    fetch_call_count = 0

    async def fake_fetch(url):
        nonlocal fetch_call_count
        fetch_call_count += 1
        return None

    async def fake_describe(*, system, user_text, image_b64s):
        assert image_b64s == []
        return {"description": "From the title alone."}

    with patch("routers.community._claude_vision_describe", new=fake_describe), \
         patch("routers.community._fetch_image_for_vision", new=fake_fetch):
        async with await _client() as c:
            r = await c.post(
                "/api/community/showcase/ai-describe",
                json={"title": "No photos yet", "image_urls": []},
                headers=headers,
            )
    assert r.status_code == 200
    assert r.json()["vision_used"] is False
    assert fetch_call_count == 0
