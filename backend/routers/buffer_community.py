"""iter251 — Push community clips + showcase posts to Buffer's social queue.

Two manual endpoints + one nightly cron job that picks the top-engaging
item from each surface and queues it across every connected channel
(Instagram, Facebook, Threads, Pinterest, Twitter, LinkedIn, Mastodon,
Bluesky).

Endpoints:
  • POST /api/admin/buffer/share-clip/{slug}         — manual share, admin JWT
  • POST /api/admin/buffer/share-showcase/{post_id}  — manual share, admin JWT
  • GET  /api/admin/buffer/social-history            — recent shares + outcomes
  • POST /api/admin/buffer/auto-pick-now             — manual trigger of the cron
  • GET  /api/admin/buffer/auto-settings             — fetch current toggle state
  • POST /api/admin/buffer/auto-settings             — flip the cron on/off

Buffer + Phase 2 caveat: video uploads only land natively on IG Reels +
FB Reels. For all other channels we attach `thumbnail_url` instead and
append a "▶ Watch the full clip → {public_url}" CTA to the caption so
the channel still drives traffic back to craftersmarket.org.
"""
from __future__ import annotations
import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from buffer_service import create_post, list_channels
from core import db, now_iso
from maker_auth import current_admin

logger = logging.getLogger("crafters.buffer.community")
router = APIRouter()

SITE = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
UTM_SUFFIX = "?utm_source=buffer&utm_medium=social&utm_campaign={camp}"


def _utm(slug: str, camp: str) -> str:
    return UTM_SUFFIX.format(camp=camp)


async def _maker_handle(maker_slug: str) -> str:
    if not maker_slug:
        return "a Crafters Market maker"
    m = await db.makers.find_one(
        {"slug": maker_slug},
        {"_id": 0, "shop_name": 1, "name": 1, "social_handles": 1},
    )
    if not m:
        return "a Crafters Market maker"
    handles = m.get("social_handles") or {}
    ig = (handles.get("instagram") or "").lstrip("@")
    if ig:
        return f"@{ig}"
    return m.get("shop_name") or m.get("name") or "a Crafters Market maker"


def _short(s: str, n: int) -> str:
    s = (s or "").strip().replace("\n", " ")
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _clip_caption(clip: dict, maker_label: str, public_url: str) -> str:
    title = _short(clip.get("title") or "", 80)
    desc = _short(clip.get("description") or clip.get("caption") or "", 140)
    parts = []
    if title:
        parts.append(title)
    if desc and desc.lower() != title.lower():
        parts.append(desc)
    parts.append(f"By {maker_label}")
    parts.append(f"▶ Watch the full clip → {public_url}")
    parts.append("#cnc #handmade #maker #craftersmarket")
    return "\n\n".join(parts)


def _showcase_caption(post: dict, maker_label: str, public_url: str) -> str:
    title = _short(post.get("title") or "", 80)
    desc = _short(post.get("description") or "", 160)
    parts = []
    if title:
        parts.append(title)
    if desc and desc.lower() != title.lower():
        parts.append(desc)
    parts.append(f"By {maker_label}")
    parts.append(f"See more → {public_url}")
    parts.append("#handmade #maker #craftersmarket")
    return "\n\n".join(parts)


# ─── Manual share endpoints ──────────────────────────────────────────────────
class ShareBody(BaseModel):
    channel_ids: Optional[list[str]] = None
    mode: str = "addToQueue"   # or "share-now"


@router.post("/admin/buffer/share-clip/{slug}")
async def share_clip(
    slug: str, body: ShareBody, admin: dict = Depends(current_admin),
):
    clip = await db.clips.find_one({"slug": slug}, {"_id": 0})
    if not clip:
        raise HTTPException(404, "Clip not found")
    if not (clip.get("thumbnail_url") or clip.get("video_url")):
        raise HTTPException(422, "Clip is missing both thumbnail_url and video_url")

    maker_label = await _maker_handle(clip.get("maker_slug", ""))
    public_url = f"{SITE}/clips/{slug}{_utm(slug, 'clip-share')}"
    text = _clip_caption(clip, maker_label, public_url)
    image_url = clip.get("thumbnail_url") or ""

    channel_ids = body.channel_ids
    if not channel_ids:
        try:
            channel_ids = [c["id"] for c in await list_channels()]
        except Exception as e:
            msg = str(e)
            if "401" in msg or "UNAUTHENTICATED" in msg:
                raise HTTPException(503, "Buffer access token is expired. Reconnect Buffer via /admin/buffer/connect.")
            raise HTTPException(503, f"Buffer channel lookup failed: {msg[:200]}")
    result = await create_post(
        text=text,
        channel_ids=channel_ids,
        image_url=image_url or None,
        mode=body.mode,
        source="clip-share",
        posted_by=admin.get("email", ""),
        product_slug=clip.get("product_slug"),
    )
    await db.social_share_log.insert_one({
        "kind": "clip",
        "source_slug": slug,
        "buffer_result": result,
        "created_at": now_iso(),
        "by": admin.get("email", ""),
    })
    return {"ok": True, "result": result, "caption": text, "image_url": image_url}


@router.post("/admin/buffer/share-showcase/{post_id}")
async def share_showcase(
    post_id: str, body: ShareBody, admin: dict = Depends(current_admin),
):
    post = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(404, "Showcase post not found")
    # Prefer the first absolute image URL; fall back to relative.
    image_url = post.get("image_url") or ""
    if post.get("image_urls"):
        image_url = post["image_urls"][0]
    if image_url and image_url.startswith("/"):
        image_url = f"{SITE}{image_url}"

    maker_label = await _maker_handle(post.get("maker_slug", ""))
    public_url = f"{SITE}/community?tab=showcase&post={post_id}{_utm(post_id, 'showcase-share')[1:]}"
    text = _showcase_caption(post, maker_label, public_url)

    channel_ids = body.channel_ids
    if not channel_ids:
        try:
            channel_ids = [c["id"] for c in await list_channels()]
        except Exception as e:
            msg = str(e)
            if "401" in msg or "UNAUTHENTICATED" in msg:
                raise HTTPException(503, "Buffer access token is expired. Reconnect Buffer via /admin/buffer/connect.")
            raise HTTPException(503, f"Buffer channel lookup failed: {msg[:200]}")

    result = await create_post(
        text=text,
        channel_ids=channel_ids,
        image_url=image_url or None,
        mode=body.mode,
        source="showcase-share",
        posted_by=admin.get("email", ""),
    )
    await db.social_share_log.insert_one({
        "kind": "showcase",
        "source_id": post_id,
        "buffer_result": result,
        "created_at": now_iso(),
        "by": admin.get("email", ""),
    })
    return {"ok": True, "result": result, "caption": text, "image_url": image_url}


# ─── History + settings ──────────────────────────────────────────────────────
@router.get("/admin/buffer/social-history")
async def social_history(_: dict = Depends(current_admin), limit: int = 30):
    limit = max(1, min(limit, 100))
    rows = await db.social_share_log.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"items": rows}


class AutoSettings(BaseModel):
    enabled: bool


@router.get("/admin/buffer/auto-settings")
async def auto_settings(_: dict = Depends(current_admin)):
    doc = await db.app_settings.find_one({"_id": "buffer_auto"}, {"_id": 0})
    return {"enabled": bool((doc or {}).get("enabled", False))}


@router.post("/admin/buffer/auto-settings")
async def update_auto_settings(body: AutoSettings, admin: dict = Depends(current_admin)):
    await db.app_settings.update_one(
        {"_id": "buffer_auto"},
        {"$set": {"enabled": body.enabled, "updated_at": now_iso(),
                  "updated_by": admin.get("email", "")}},
        upsert=True,
    )
    return {"ok": True, "enabled": body.enabled}


# ─── Nightly auto-pick — exposed manually + scheduled via scheduler.py ───────
@router.post("/admin/buffer/auto-pick-now")
async def auto_pick_now(_: dict = Depends(current_admin)):
    """Manual trigger of the same logic the nightly cron runs."""
    summary = await run_auto_pick()
    return summary


async def run_auto_pick() -> dict:
    """Pick the top-engaging clip + showcase post from the last 24h
    and push each to Buffer's queue. Idempotent — skips if the same
    source_id was shared within the last 24h."""
    from datetime import datetime, timedelta, timezone
    settings = await db.app_settings.find_one({"_id": "buffer_auto"}, {"_id": 0})
    if not settings or not settings.get("enabled"):
        return {"skipped": True, "reason": "auto-pick is disabled"}

    cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    # Already-shared filter — don't repost the same item twice in a day.
    recently_shared = await db.social_share_log.distinct(
        "source_slug", {"created_at": {"$gte": cutoff_24h}, "kind": "clip"}
    )
    recently_shared_ids = await db.social_share_log.distinct(
        "source_id", {"created_at": {"$gte": cutoff_24h}, "kind": "showcase"}
    )

    summary = {"clip": None, "showcase": None}

    # Pick top clip by view_count over the last 7d that isn't hidden / seed.
    top_clip = await db.clips.find_one(
        {
            "admin_hidden": {"$ne": True},
            "slug": {"$nin": recently_shared},
            "$or": [
                {"thumbnail_url": {"$exists": True, "$ne": ""}},
                {"video_url": {"$regex": "^https?://"}},
            ],
        },
        sort=[("view_count", -1), ("created_at", -1)],
    )
    if top_clip:
        try:
            maker_label = await _maker_handle(top_clip.get("maker_slug", ""))
            slug = top_clip["slug"]
            url = f"{SITE}/clips/{slug}{_utm(slug, 'clip-auto')}"
            text = _clip_caption(top_clip, maker_label, url)
            result = await create_post(
                text=text,
                channel_ids=[c["id"] for c in await list_channels()],
                image_url=top_clip.get("thumbnail_url") or None,
                mode="addToQueue",
                source="clip-auto",
            )
            await db.social_share_log.insert_one({
                "kind": "clip", "source_slug": slug, "buffer_result": result,
                "created_at": now_iso(), "by": "auto-cron",
            })
            summary["clip"] = {"slug": slug, "title": top_clip.get("title")}
        except Exception as e:
            logger.exception("[buffer.auto] clip share failed")
            summary["clip"] = {"error": str(e)[:200]}

    # Top showcase post by likes (likes is an integer counter in the schema).
    top_show = await db.showcase_posts.find_one(
        {
            "admin_hidden": {"$ne": True},
            "id": {"$nin": recently_shared_ids},
            "image_url": {"$exists": True, "$ne": ""},
        },
        sort=[("likes", -1), ("created_at", -1)],
    )
    if top_show:
        try:
            maker_label = await _maker_handle(top_show.get("maker_slug", ""))
            pid = top_show["id"]
            url = f"{SITE}/community?tab=showcase&post={pid}{_utm(pid, 'showcase-auto')[1:]}"
            text = _showcase_caption(top_show, maker_label, url)
            img = top_show.get("image_url") or ""
            if img and img.startswith("/"):
                img = f"{SITE}{img}"
            result = await create_post(
                text=text,
                channel_ids=[c["id"] for c in await list_channels()],
                image_url=img or None,
                mode="addToQueue",
                source="showcase-auto",
            )
            await db.social_share_log.insert_one({
                "kind": "showcase", "source_id": pid, "buffer_result": result,
                "created_at": now_iso(), "by": "auto-cron",
            })
            summary["showcase"] = {"id": pid, "title": top_show.get("title")}
        except Exception as e:
            logger.exception("[buffer.auto] showcase share failed")
            summary["showcase"] = {"error": str(e)[:200]}

    return summary
