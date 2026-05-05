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
    Composes the default template the user picked. High-value listings get
    a louder "🔥 NEW DROP" header to match the activity-ticker drop badge."""
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

    # Triple-fanout louder template for high-value pieces
    high_value = (
        price >= float(os.environ.get("HIGH_VALUE_PRICE", "250"))
        or bool(product.get("featured"))
        or bool(product.get("shop_of_the_week"))
        or bool(product.get("is_drop"))
    )
    if high_value:
        text = (
            f"🔥 NEW DROP — {maker_name}: {title} — ${price:.0f}\n\n"
            f"Limited piece, made-to-order. Shop direct → {url}"
        )
    else:
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


# ============================================================
#  5-star review auto-poster
# ============================================================
async def auto_post_5star_review(review: dict) -> Optional[dict]:
    """Compose + queue a Buffer post celebrating a fresh 5-star review.

    Skips silently when:
      - Buffer isn't configured
      - The `auto_publish_5star_reviews_enabled` site setting is OFF
      - The review isn't 5 stars
      - The review's maker can't be resolved (no slug or deleted)
      - No channels are connected to Buffer
      - The review text is too short / abusive (lightweight content
        guard so we don't auto-post one-word reviews to social).

    Idempotency: stamps `reviews.posted_to_buffer_at` on success so a
    subsequent edit-and-resave of the same review can't re-trigger the
    post. The DB-side guard is in `routers/catalog.create_review` —
    this function trusts the caller.

    Returns the buffer_posts row on success, None on skip, raises on
    transport errors so the caller can decide whether to retry.
    """
    if not _enabled():
        return None

    # Settings gate (default OFF — opt-in feature).
    try:
        from routers.settings import get_setting
        if not await get_setting("auto_publish_5star_reviews_enabled", False):
            return None
    except Exception as e:
        logger.warning("[buffer] settings lookup failed: %s", e)
        return None

    if int(review.get("rating") or 0) != 5:
        return None
    text_body = (review.get("text") or "").strip()
    if len(text_body) < 30:
        # One-word raves don't make great social posts. The maker can
        # always share these manually from the dashboard.
        logger.info("[buffer] skipping 5-star auto-post — too short (%d chars)", len(text_body))
        return None

    maker_slug = review.get("maker_slug")
    if not maker_slug:
        return None
    maker = await db.makers.find_one(
        {"slug": maker_slug, "deleted_at": {"$in": [None, ""]}},
        {"_id": 0, "slug": 1, "name": 1},
    )
    if not maker:
        return None

    # Resolve product image so the social post has a hero image. Fall back
    # to the maker's portrait if we can't find a product photo.
    image_url = None
    product = None
    if review.get("product_slug"):
        product = await db.products.find_one(
            {"slug": review["product_slug"], "deleted_at": {"$in": [None, ""]}},
            {"_id": 0, "slug": 1, "title": 1, "images": 1},
        )
        if product:
            imgs = product.get("images") or []
            if imgs:
                image_url = imgs[0]
    if not image_url:
        m = await db.makers.find_one(
            {"slug": maker_slug}, {"_id": 0, "portrait": 1, "cover": 1},
        )
        image_url = (m or {}).get("portrait") or (m or {}).get("cover")

    try:
        channels = await list_channels()
    except Exception as e:
        logger.warning("[buffer] list_channels failed (5-star auto-post skipped): %s", e)
        return None
    if not channels:
        return None

    # Quote the review (truncated to fit Twitter's 280-char window
    # alongside the rest of the template). Strip newlines from quoted
    # text so the post doesn't fragment.
    quote = " ".join(text_body.split())
    if len(quote) > 140:
        quote = quote[:138].rsplit(" ", 1)[0].rstrip(",;:.") + "…"

    reviewer = (review.get("name") or "").strip().split(" ", 1)[0] or "A buyer"
    maker_name = maker.get("name") or maker.get("slug")
    target = f"{SITE_URL}/shop/{product['slug']}" if product else f"{SITE_URL}/makers/{maker_slug}"
    text = (
        f"⭐⭐⭐⭐⭐ {reviewer} on {maker_name}:\n\n"
        f"\"{quote}\"\n\n"
        f"Shop the work → {target}"
    )

    posted = await create_post(
        text=text,
        channel_ids=[c["id"] for c in channels],
        image_url=image_url,
        mode="addToQueue",
        source="auto-review",
        posted_by=maker_slug,
        product_slug=product.get("slug") if product else None,
    )

    # Stamp the review so we never re-post the same row, even if it's
    # edited. Failures here are non-fatal — the post already went out;
    # at worst we re-trigger on a later edit.
    try:
        if review.get("id"):
            await db.reviews.update_one(
                {"id": review["id"]},
                {"$set": {"posted_to_buffer_at": now_iso(),
                          "posted_to_buffer_id": posted.get("id")}},
            )
    except Exception as e:
        logger.warning("[buffer] review stamp failed (post already sent): %s", e)

    logger.info(
        "[buffer] auto-posted 5-star review · maker=%s · channels=%d · ok=%d",
        maker_slug, len(channels), posted.get("success_count", 0),
    )
    return posted
