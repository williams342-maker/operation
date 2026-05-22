"""Regression: Showcase view counter (iter174).

Covers:
  * `POST /api/community/showcase/{id}/view` increments `views` and
    returns the fresh count with `counted=true`
  * Same visitor (same `client_id`) within the 24h window: deduped,
    `counted=false`, count unchanged
  * Different `client_id` against the same post: re-counted
  * Non-existent post: 404
  * IP+UA fallback when no `client_id` is provided (still deduped per UA)
"""
import os
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


async def _find_a_post() -> str:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/community/showcase")
        posts = r.json()
    assert posts, "Showcase has no public posts to test against."
    return posts[0]["id"]


async def _clear_views_for(post_id: str, visitors: list[str]):
    """Wipe pre-existing view rows so this test starts deterministic."""
    from core import db
    await db.showcase_views.delete_many({
        "post_id": post_id,
        "visitor": {"$in": [f"cid:{v}" for v in visitors]},
    })


@pytest.mark.asyncio
async def test_view_endpoint_increments_and_dedupes():
    post_id = await _find_a_post()
    visitor_a = "test-visitor-aaaa1111"
    visitor_b = "test-visitor-bbbb2222"
    await _clear_views_for(post_id, [visitor_a, visitor_b])

    async with httpx.AsyncClient(timeout=30) as c:
        # 1) First view from visitor A → counted
        r = await c.post(
            f"{API}/api/community/showcase/{post_id}/view",
            json={"client_id": visitor_a},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["counted"] is True
        first_count = body["views"]
        assert first_count >= 1

        # 2) Same visitor again → DEDUPED
        r = await c.post(
            f"{API}/api/community/showcase/{post_id}/view",
            json={"client_id": visitor_a},
        )
        body = r.json()
        assert body["counted"] is False
        assert body["views"] == first_count, "second view by same visitor must NOT bump"

        # 3) Different visitor → counted again
        r = await c.post(
            f"{API}/api/community/showcase/{post_id}/view",
            json={"client_id": visitor_b},
        )
        body = r.json()
        assert body["counted"] is True
        assert body["views"] == first_count + 1


@pytest.mark.asyncio
async def test_view_endpoint_404_for_unknown_post():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/community/showcase/this-id-does-not-exist/view",
            json={"client_id": "test-visitor-xyz"},
        )
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_view_dedupes_by_ip_ua_when_no_client_id():
    """When the request body has no `client_id`, the server falls back
    to hashing (IP, User-Agent). Hitting the same endpoint twice from
    the same fingerprint must still be deduped."""
    post_id = await _find_a_post()
    # Wipe the ip-ua fingerprint so we start clean
    from core import db
    import hashlib
    # The httpx test client has a stable UA. Reproduce its fingerprint:
    ua = "ipua-test-stable"  # we'll override via header below
    h = hashlib.sha256(f"0|{ua}".encode("utf-8")).hexdigest()[:24]
    # We can't actually predict the IP, but we can ensure both calls go
    # from the same client and verify the second is deduped — that's the
    # invariant we care about.

    async with httpx.AsyncClient(
        timeout=30,
        headers={"user-agent": ua},
    ) as c:
        r1 = await c.post(
            f"{API}/api/community/showcase/{post_id}/view",
            json={},
        )
        body1 = r1.json()
        r2 = await c.post(
            f"{API}/api/community/showcase/{post_id}/view",
            json={},
        )
        body2 = r2.json()

    # First MAY be counted or deduped (depends on prior runs). Second
    # call against the same client+UA must be deduped (counted=False).
    assert body2["counted"] is False
    assert body2["views"] == body1["views"]
