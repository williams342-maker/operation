"""Buffer (publish.buffer.com) GraphQL API service.

Single shared Crafters Market Buffer account (token in BUFFER_API_KEY).
The new GraphQL API at https://api.buffer.com replaces the deprecated v1 REST
(sunset 2026-07-08). All requests are POSTs with a Bearer token.

This module exposes three operations:
  - list_channels()   : the social profiles connected to our Buffer account
  - create_post(...)  : enqueue a post on one or many channels (+ image)
  - auto_post_listing(...) : compose the default listing-publish post + fan out

Every send attempt is persisted to db.buffer_posts so the admin can see
exactly what went out (mirrors the email_events pattern).
"""
from __future__ import annotations

import os
import uuid
from typing import Optional

import httpx

from core import db, logger, now_iso

BUFFER_API_URL = os.environ.get("BUFFER_API_URL", "https://api.buffer.com")
BUFFER_API_KEY = os.environ.get("BUFFER_API_KEY", "")
BUFFER_ORG_ID = os.environ.get("BUFFER_ORG_ID", "")
BUFFER_AUTO_PUBLISH = os.environ.get("BUFFER_AUTO_PUBLISH", "true").lower() == "true"
SITE_URL = os.environ.get("SITE_URL", "https://craftersmarket.org").rstrip("/")


def _enabled() -> bool:
    return bool(BUFFER_API_KEY and BUFFER_ORG_ID)


async def _graphql(query: str, variables: Optional[dict] = None) -> dict:
    """Single POST to the Buffer GraphQL endpoint. Raises RuntimeError on
    transport failure or GraphQL `errors` payload."""
    if not BUFFER_API_KEY:
        raise RuntimeError("BUFFER_API_KEY not configured")
    payload: dict = {"query": query}
    if variables:
        payload["variables"] = variables
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            BUFFER_API_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {BUFFER_API_KEY}",
                "Content-Type": "application/json",
            },
        )
    if r.status_code >= 400:
        raise RuntimeError(f"buffer http {r.status_code}: {r.text[:300]}")
    body = r.json()
    if body.get("errors"):
        msg = body["errors"][0].get("message", "graphql_error")
        raise RuntimeError(f"buffer graphql: {msg}")
    return body.get("data") or {}


# ============================================================
#  Public service API
# ============================================================
async def list_channels() -> list[dict]:
    """Connected social profiles. Empty list if not configured."""
    if not _enabled():
        return []
    data = await _graphql(
        "query($orgId: OrganizationId!) { channels(input: {organizationId: $orgId})"
        " { id name service } }",
        {"orgId": BUFFER_ORG_ID},
    )
    return data.get("channels") or []


async def _create_one(
    text: str, channel: dict, image_url: Optional[str], mode: str,
) -> dict:
    """Single-channel createPost mutation. Returns {success, post_id, error}.

    `channel` is a {id, service, name} dict so we can attach per-service
    metadata (Instagram/Facebook require a `type`, etc.)."""
    mutation = (
        "mutation($input: CreatePostInput!) {"
        " createPost(input: $input) {"
        " ... on PostActionSuccess { post { id } }"
        " ... on MutationError { message }"
        " } }"
    )
    cid = channel["id"]
    service = (channel.get("service") or "").lower()
    post_input: dict = {
        "text": text,
        "channelId": cid,
        "schedulingType": "automatic",
        "mode": mode,
    }
    if image_url:
        post_input["assets"] = {"images": [{"url": image_url}]}

    # Per-service metadata. Buffer rejects IG/FB without a `type` enum.
    if service == "instagram":
        post_input["metadata"] = {
            "instagram": {"type": "post", "shouldShareToFeed": True},
        }
    elif service == "facebook":
        post_input["metadata"] = {"facebook": {"type": "post"}}
    elif service == "threads":
        post_input["metadata"] = {"threads": {"type": "post"}}
    # Pinterest auto-picks the default board; Twitter/LinkedIn/Mastodon/
    # Bluesky/StartPage don't need a metadata block.

    try:
        data = await _graphql(mutation, {"input": post_input})
        result = (data or {}).get("createPost") or {}
        if result.get("post"):
            return {"channel_id": cid, "service": service, "success": True,
                    "post_id": result["post"].get("id"), "error": None}
        return {"channel_id": cid, "service": service, "success": False,
                "post_id": None,
                "error": result.get("message") or "unknown_error"}
    except Exception as e:
        return {"channel_id": cid, "service": service, "success": False,
                "post_id": None, "error": str(e)[:300]}


async def create_post(
    *, text: str, channel_ids: list[str], image_url: Optional[str] = None,
    mode: str = "addToQueue", source: str = "admin",
    posted_by: str = "", product_slug: Optional[str] = None,
) -> dict:
    """Fan out a post to every requested channel and persist a log row."""
    if not _enabled():
        raise RuntimeError("Buffer is not configured (BUFFER_API_KEY/BUFFER_ORG_ID).")
    if not text.strip():
        raise ValueError("text must not be empty")
    if not channel_ids:
        raise ValueError("at least one channel_id is required")

    # Resolve IDs → full channel records so we can pick the right metadata.
    all_channels = {c["id"]: c for c in await list_channels()}
    channels = [all_channels[cid] for cid in channel_ids if cid in all_channels]
    if not channels:
        raise ValueError("none of the supplied channel IDs are connected")

    results: list[dict] = []
    for ch in channels:
        results.append(await _create_one(text, ch, image_url, mode))

    success = sum(1 for r in results if r["success"])
    failed = len(results) - success

    row = {
        "id": str(uuid.uuid4()),
        "text": text[:500],
        "image_url": image_url,
        "mode": mode,
        "source": source,            # "admin" | "maker" | "auto"
        "posted_by": posted_by,
        "product_slug": product_slug,
        "channel_ids": channel_ids,
        "results": results,
        "success_count": success,
        "failed_count": failed,
        "created_at": now_iso(),
    }
    try:
        await db.buffer_posts.insert_one(row.copy())
    except Exception as e:
        logger.warning("[buffer] persist failed: %s", e)

    logger.info(
        "[buffer] post · source=%s · channels=%d · ok=%d · failed=%d",
        source, len(channel_ids), success, failed,
    )
    # Strip _id-ish key in case insert_one stamped it
    row.pop("_id", None)
    return row


async def auto_post_listing(product: dict, maker: dict) -> Optional[dict]:
    """Listing-publish auto-post. No-op when disabled or no channels connected.
    Composes the default template the user picked: 'New from {maker}: {title}
    — ${price} → {url}'."""
    if not _enabled() or not BUFFER_AUTO_PUBLISH:
        return None
    try:
        channels = await list_channels()
    except Exception as e:
        logger.warning("[buffer] list_channels failed (auto-post skipped): %s", e)
        return None
    if not channels:
        return None

    title = product.get("title") or "New piece"
    slug = product.get("slug") or ""
    price = float(product.get("price") or 0)
    url = f"{SITE_URL}/shop/{slug}"
    maker_name = maker.get("name") or maker.get("slug") or "a maker"
    image = (product.get("images") or [None])[0]
    text = f"New from {maker_name}: {title} — ${price:.0f} → {url}"

    return await create_post(
        text=text,
        channel_ids=[c["id"] for c in channels],
        image_url=image,
        mode="addToQueue",
        source="auto",
        posted_by=maker.get("slug") or "",
        product_slug=slug,
    )


async def list_recent_posts(limit: int = 50) -> list[dict]:
    return await db.buffer_posts.find(
        {}, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
