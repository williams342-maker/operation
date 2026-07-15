"""Auto-publish social posts to Instagram, Facebook Page, and Pinterest.

Consumes rows from the `social_auto_post_queue` collection (created by
`social_auto_post_service.enqueue_listing`) and pushes them to the
external APIs using credentials from `backend/.env`.

Designed to be safe-by-default:
  • If a platform's credentials are missing, that channel is **skipped**
    (returns `{ok: False, skipped_reason: "not_configured"}`) — never
    raises. Lets the admin enable channels one at a time.
  • Per-channel failures are isolated; one failing platform never blocks
    the others on the same queue row.
  • Outbound calls are wrapped in try/except + a 30s timeout so a hung
    upstream can't stall the scheduler.

Triggered from two places:
  1. Admin "Publish now" button → `POST /api/admin/social-auto-post/{id}/publish-now`
  2. Optional cron in `scheduler.py` (`SOCIAL_AUTO_PUBLISH_ENABLED=true`)

Env vars (all optional — missing one just skips that platform):
  FB_PAGE_ID                    Facebook Page numeric ID
  FB_PAGE_ACCESS_TOKEN          Long-lived Page access token
  IG_USER_ID                    Instagram Business account ID
  IG_USER_ACCESS_TOKEN          User access token w/ instagram_content_publish
  PINTEREST_ACCESS_TOKEN        Pinterest API v5 bearer token
  PINTEREST_DEFAULT_BOARD_ID    Board ID to pin into

  META_GRAPH_VERSION            (optional, default v20.0)
"""
from __future__ import annotations
from config import env_get

import os
from typing import Optional

import httpx

from core import db, logger, now_iso


META_GRAPH_VERSION = env_get("META_GRAPH_VERSION", "v20.0").strip() or "v20.0"
FB_GRAPH_BASE = f"https://graph.facebook.com/{META_GRAPH_VERSION}"
PINTEREST_API_BASE = "https://api.pinterest.com/v5"

CHANNELS = ("instagram", "facebook", "pinterest")


# ─────────────────────────── helpers ────────────────────────────
def _env(key: str) -> str:
    return (env_get(key) or "").strip()


def credentials_status() -> dict:
    """Reports which channels currently have all required creds set.
    Used by the admin UI to enable/disable the 'Publish now' button."""
    return {
        "instagram": bool(_env("IG_USER_ID") and _env("IG_USER_ACCESS_TOKEN")),
        "facebook":  bool(_env("FB_PAGE_ID") and _env("FB_PAGE_ACCESS_TOKEN")),
        "pinterest": bool(_env("PINTEREST_ACCESS_TOKEN") and _env("PINTEREST_DEFAULT_BOARD_ID")),
    }


def _truncate(s: str, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


# ─────────────────────────── publishers ────────────────────────────
async def publish_to_instagram(image_url: str, caption: str) -> dict:
    """Two-step IG Graph publish (create container → publish container).
    Returns `{ok, platform_id?, error?, skipped_reason?}`."""
    ig_user_id = _env("IG_USER_ID")
    token = _env("IG_USER_ACCESS_TOKEN")
    if not (ig_user_id and token):
        return {"ok": False, "skipped_reason": "not_configured"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as c:
            # 1. create container
            r1 = await c.post(
                f"{FB_GRAPH_BASE}/{ig_user_id}/media",
                params={"image_url": image_url, "caption": caption, "access_token": token},
            )
            if r1.status_code >= 400:
                return {"ok": False, "error": {"step": "create_media",
                                               "status": r1.status_code,
                                               "body": r1.text[:400]}}
            cid = (r1.json() or {}).get("id")
            if not cid:
                return {"ok": False, "error": {"step": "create_media",
                                               "body": "missing container id"}}
            # 2. publish container
            r2 = await c.post(
                f"{FB_GRAPH_BASE}/{ig_user_id}/media_publish",
                params={"creation_id": cid, "access_token": token},
            )
            if r2.status_code >= 400:
                return {"ok": False, "error": {"step": "media_publish",
                                               "status": r2.status_code,
                                               "body": r2.text[:400]}}
            media_id = (r2.json() or {}).get("id")
            if not media_id:
                return {"ok": False, "error": {"step": "media_publish",
                                               "body": "missing media id"}}
            return {"ok": True, "platform_id": str(media_id)}
    except Exception as e:
        return {"ok": False, "error": {"exception": type(e).__name__, "msg": str(e)[:400]}}


async def publish_to_facebook_page(image_url: str, caption: str) -> dict:
    """POST `/{page-id}/photos` with `url=<image>` + `message=<caption>`."""
    page_id = _env("FB_PAGE_ID")
    token = _env("FB_PAGE_ACCESS_TOKEN")
    if not (page_id and token):
        return {"ok": False, "skipped_reason": "not_configured"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as c:
            r = await c.post(
                f"{FB_GRAPH_BASE}/{page_id}/photos",
                data={"url": image_url, "message": caption,
                      "published": "true", "access_token": token},
            )
            if r.status_code >= 400:
                return {"ok": False, "error": {"step": "photos",
                                               "status": r.status_code,
                                               "body": r.text[:400]}}
            photo_id = (r.json() or {}).get("id") or (r.json() or {}).get("post_id")
            if not photo_id:
                return {"ok": False, "error": {"step": "photos",
                                               "body": "missing photo id"}}
            return {"ok": True, "platform_id": str(photo_id)}
    except Exception as e:
        return {"ok": False, "error": {"exception": type(e).__name__, "msg": str(e)[:400]}}


async def publish_to_pinterest(
    image_url: str, title: str, description: str, link: str,
    board_id: Optional[str] = None,
) -> dict:
    """POST `/v5/pins` with image_url source. Title capped at 100,
    description capped at 500 per Pinterest API limits."""
    token = _env("PINTEREST_ACCESS_TOKEN")
    board = (board_id or _env("PINTEREST_DEFAULT_BOARD_ID")).strip()
    if not (token and board):
        return {"ok": False, "skipped_reason": "not_configured"}
    body = {
        "board_id": board,
        "title": _truncate(title, 100),
        "description": _truncate(description, 500),
        "link": link,
        "media_source": {"source_type": "image_url", "url": image_url},
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as c:
            r = await c.post(
                f"{PINTEREST_API_BASE}/pins",
                json=body,
                headers={"Authorization": f"Bearer {token}",
                         "Content-Type": "application/json"},
            )
            if r.status_code >= 400:
                return {"ok": False, "error": {"step": "create_pin",
                                               "status": r.status_code,
                                               "body": r.text[:400]}}
            pin_id = (r.json() or {}).get("id")
            if not pin_id:
                return {"ok": False, "error": {"step": "create_pin",
                                               "body": "missing pin id"}}
            return {"ok": True, "platform_id": str(pin_id)}
    except Exception as e:
        return {"ok": False, "error": {"exception": type(e).__name__, "msg": str(e)[:400]}}


# ─────────────────────── default caption templates ───────────────────────
def _default_caption(channel: str, row: dict) -> str:
    """Fallback caption when the admin didn't save a per-channel override.

    Mirrors the templates from the in-browser CaptionEditorPanel
    (`AdminSocialQueueCard`) so the published copy looks identical
    whether the admin clicked 'copy' manually or hit 'Publish now'."""
    title = row.get("product_title") or "New listing"
    maker = row.get("maker_name") or "the maker"
    url = row.get("product_url") or "https://craftersmarket.org"
    price = f"{float(row.get('price') or 0):.0f}"
    if channel == "instagram":
        return (
            f"✨ NEW DROP — {maker}\n\n"
            f"{title} · ${price}\n\n"
            "Hand-crafted in a small workshop, made to order. Click the link in "
            "our bio (or the URL below) to grab one before it's gone — these "
            "tend to go fast.\n\n"
            f"🔗 {url}\n\n"
            "#handmade #cncwoodworking #cncart #makersgonnamake #shopsmall "
            "#homedecor #craftersmarket #woodworking #smallbusiness #supportlocal"
        )
    if channel == "pinterest":
        return (
            f"{title} · CNC-crafted on Crafters Market · ${price} · made to order "
            "· ships from a small US workshop. Perfect for housewarming, "
            "anniversary, wedding, and gift ideas. Discover unique handmade "
            "decor, signs, and furniture made by independent fabricators.\n\n"
            f"Shop: {url}"
        )
    # facebook
    return (
        f"New from {maker}: {title} (${price}) →\n\n{url}\n\n"
        "Hand-crafted, made-to-order, ships from a small US workshop."
    )


# ─────────────────────── queue orchestrator ───────────────────────
async def process_queue_row(
    row: dict,
    *,
    only_channels: Optional[list[str]] = None,
) -> dict:
    """Publish a single queue row to every channel in `row['channels']`.

    Per-channel failures are isolated. Returns a summary dict that's
    also written back onto the queue row by the caller.
    """
    image_url = row.get("image_url") or ""
    captions = row.get("captions") or {}  # {instagram, facebook, pinterest}
    channels = only_channels or row.get("channels") or list(CHANNELS)

    results: dict[str, dict] = {}
    platform_ids: dict[str, str] = {}
    errors: dict[str, dict] = {}
    skipped: dict[str, str] = {}

    for ch in channels:
        if ch not in CHANNELS:
            continue
        caption = (captions.get(ch) or _default_caption(ch, row)).strip()
        if ch == "instagram":
            res = await publish_to_instagram(image_url=image_url, caption=caption)
        elif ch == "facebook":
            res = await publish_to_facebook_page(image_url=image_url, caption=caption)
        else:  # pinterest
            res = await publish_to_pinterest(
                image_url=image_url,
                title=row.get("product_title") or "New listing",
                description=caption,
                link=row.get("product_url") or "https://craftersmarket.org",
            )
        results[ch] = res
        if res.get("ok"):
            platform_ids[ch] = res["platform_id"]
        elif res.get("skipped_reason"):
            skipped[ch] = res["skipped_reason"]
        else:
            errors[ch] = res.get("error") or {"body": "unknown"}

    any_ok = bool(platform_ids)
    all_skipped = (not platform_ids and not errors and len(skipped) == len(channels))
    return {
        "results": results,
        "platform_ids": platform_ids,
        "errors": errors,
        "skipped": skipped,
        "any_ok": any_ok,
        "all_skipped": all_skipped,
    }


async def publish_row_by_id(row_id: str, *, actor: str = "admin") -> dict:
    """Look up a pending queue row by id, publish it, persist results.

    Status transitions:
      • At least one channel succeeded → status="published"
      • All requested channels missing creds → status stays "pending",
        we just stamp `last_attempt_at` so the admin knows we tried
      • Every channel attempt errored (no successes) → status="failed",
        admin can retry after fixing creds
    """
    row = await db.social_auto_post_queue.find_one(
        {"id": row_id}, {"_id": 0})
    if not row:
        return {"ok": False, "reason": "not_found"}
    if row.get("status") not in ("pending", "failed"):
        return {"ok": False, "reason": "not_pending",
                "current_status": row.get("status")}

    summary = await process_queue_row(row)
    now = now_iso()

    if summary["any_ok"]:
        new_status = "published"
    elif summary["all_skipped"]:
        new_status = "pending"  # nothing tried — leave for next run
    else:
        new_status = "failed"

    updates = {
        "platform_post_ids": summary["platform_ids"],
        "platform_errors":   summary["errors"],
        "platform_skipped":  summary["skipped"],
        "last_attempt_at":   now,
        "last_attempt_by":   actor,
        "status":            new_status,
    }
    if new_status == "published":
        updates["published_at"] = now
        updates["published_by"] = actor

    await db.social_auto_post_queue.update_one(
        {"id": row_id}, {"$set": updates})

    logger.info(
        "[social_publisher] row=%s actor=%s → status=%s ids=%s errors=%s skipped=%s",
        row_id, actor, new_status,
        list(summary["platform_ids"]), list(summary["errors"]), list(summary["skipped"]),
    )
    return {"ok": new_status != "failed", "status": new_status, **summary}


async def run_auto_publish_sweep(*, limit: int = 50) -> dict:
    """Cron entrypoint — publishes up to `limit` pending rows.

    No-op (and quiet) when `SOCIAL_AUTO_PUBLISH_ENABLED` env var isn't
    explicitly truthy. The admin keeps full control over rollout.
    """
    flag = (env_get("SOCIAL_AUTO_PUBLISH_ENABLED") or "").lower()
    if flag not in ("true", "1", "yes", "on"):
        return {"ran": False, "reason": "disabled_via_env"}

    rows = await db.social_auto_post_queue.find(
        {"status": "pending"},
        {"_id": 0, "id": 1},
        sort=[("queued_at", 1)],  # FIFO
    ).to_list(limit)
    if not rows:
        return {"ran": True, "processed": 0, "published": 0, "failed": 0, "skipped": 0}

    published = failed = skipped = 0
    for r in rows:
        try:
            res = await publish_row_by_id(r["id"], actor="cron")
            if res.get("status") == "published":
                published += 1
            elif res.get("status") == "failed":
                failed += 1
            else:
                skipped += 1
        except Exception as e:
            logger.exception("[social_publisher] sweep row=%s failed: %s", r["id"], e)
            failed += 1
    return {"ran": True, "processed": len(rows),
            "published": published, "failed": failed, "skipped": skipped}
