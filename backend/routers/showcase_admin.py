"""Admin showcase curation — pin / hide / reorder / shuffle.

iter231 — Public showcase feed previously sorted strictly by
`created_at DESC`, so the moment 10 newer posts arrived the older
hand-picked highlights vanished. This router gives the admin manual
curation controls without touching the underlying post data:

  GET    /admin/showcase                — list ALL posts (includes hidden)
  POST   /admin/showcase/{id}/pin       — toggle admin_pinned
  POST   /admin/showcase/{id}/hide      — toggle admin_hidden
  POST   /admin/showcase/{id}/move-up   — swap admin_sort_order with prev
  POST   /admin/showcase/{id}/move-down — swap admin_sort_order with next
  POST   /admin/showcase/shuffle        — randomize admin_sort_order on
                                          non-pinned, visible posts

The public `/community/showcase` route reads these three fields
(admin_pinned, admin_hidden, admin_sort_order) and orders the feed
accordingly. None of the buyer/maker-facing UIs need updates — the
new fields are additive and ignored where absent.
"""
from __future__ import annotations

import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core import db, logger
from maker_auth import current_admin

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _shape(doc: dict) -> dict:
    """Trim Mongo internals + only return the fields the admin UI needs.
    Keeps the curation list light even on installs with 1000+ posts."""
    doc.pop("_id", None)
    return {
        "id": doc.get("id"),
        "title": doc.get("title") or doc.get("caption") or "Untitled",
        "image_url": doc.get("image_url") or (doc.get("image_urls") or [None])[0],
        "maker_slug": doc.get("maker_slug"),
        "user_name": doc.get("user_name"),
        "created_at": doc.get("created_at"),
        "views": doc.get("views") or 0,
        "admin_pinned": bool(doc.get("admin_pinned")),
        "admin_pinned_at": doc.get("admin_pinned_at"),
        "admin_hidden": bool(doc.get("admin_hidden")),
        "admin_sort_order": doc.get("admin_sort_order"),
        "is_seed": bool(doc.get("is_seed")),
        "mod_status": doc.get("mod_status") or "ok",
    }


@router.get("/admin/showcase")
async def list_for_admin(_: dict = Depends(current_admin)):
    """All showcase posts (including admin-hidden, excluding only
    quarantined which are abuse-flagged). Pinned posts first (newest pin
    first), then by admin_sort_order ASC (nulls last), then created_at
    DESC — same ordering the public feed uses, so the admin sees the
    rotation in the exact form visitors do."""
    rows = await db.showcase_posts.find(
        {"mod_status": {"$ne": "quarantined"}}, {"_id": 0},
    ).to_list(500)
    def _key(r):
        pinned = bool(r.get("admin_pinned"))
        pinned_at = r.get("admin_pinned_at") or ""
        so = r.get("admin_sort_order")
        if so is None:
            so = 10_000_000
        created_at = r.get("created_at") or ""
        if pinned:
            # Newest pin first
            return (0, tuple(-ord(c) for c in pinned_at))
        # Then sort_order ASC, then created_at DESC
        return (1, so, tuple(-ord(c) for c in created_at))
    rows.sort(key=_key)
    return {"items": [_shape(r) for r in rows]}


@router.post("/admin/showcase/{post_id}/pin")
async def toggle_pin(post_id: str, _: dict = Depends(current_admin)):
    # Project `id` too — without it, the projection returns `{}` for
    # any doc that doesn't carry `admin_pinned` yet (which is most of
    # them on first run), and `{}` is falsy in Python → bogus 404.
    doc = await db.showcase_posts.find_one(
        {"id": post_id}, {"_id": 0, "id": 1, "admin_pinned": 1}
    )
    if not doc:
        raise HTTPException(404, "Showcase post not found")
    new_state = not bool(doc.get("admin_pinned"))
    update = {"admin_pinned": new_state}
    if new_state:
        update["admin_pinned_at"] = _now_iso()
    else:
        # Clear timestamp so the order doesn't get confused if pinned
        # again later — fresh pin = fresh timestamp.
        update["admin_pinned_at"] = None
    await db.showcase_posts.update_one({"id": post_id}, {"$set": update})
    return {"ok": True, "admin_pinned": new_state}


@router.post("/admin/showcase/{post_id}/hide")
async def toggle_hide(post_id: str, _: dict = Depends(current_admin)):
    doc = await db.showcase_posts.find_one(
        {"id": post_id}, {"_id": 0, "id": 1, "admin_hidden": 1}
    )
    if not doc:
        raise HTTPException(404, "Showcase post not found")
    new_state = not bool(doc.get("admin_hidden"))
    await db.showcase_posts.update_one({"id": post_id}, {"$set": {"admin_hidden": new_state}})
    return {"ok": True, "admin_hidden": new_state}


async def _list_unpinned_visible_in_admin_order() -> list[dict]:
    """Helper used by move-up / move-down / shuffle. Returns the
    non-pinned, non-hidden posts in the current admin sort order so we
    can swap adjacent rows safely."""
    rows = await db.showcase_posts.find(
        {
            "mod_status": {"$ne": "quarantined"},
            "admin_pinned": {"$ne": True},
            "admin_hidden": {"$ne": True},
        },
        {"_id": 0, "id": 1, "admin_sort_order": 1, "created_at": 1},
    ).to_list(500)
    def _key(r):
        so = r.get("admin_sort_order")
        if so is None:
            so = 10_000_000
        return (so, tuple(-ord(c) for c in (r.get("created_at") or "")))
    rows.sort(key=_key)
    return rows


async def _ensure_sort_orders(rows: list[dict]) -> list[dict]:
    """For rows whose `admin_sort_order` is None (never reordered), assign
    a stable integer based on their current position so move-up/down has
    something to swap. Idempotent — already-numbered rows aren't touched."""
    needs_update = []
    for idx, r in enumerate(rows):
        if r.get("admin_sort_order") is None:
            r["admin_sort_order"] = (idx + 1) * 100
            needs_update.append(r)
    for r in needs_update:
        await db.showcase_posts.update_one(
            {"id": r["id"]}, {"$set": {"admin_sort_order": r["admin_sort_order"]}}
        )
    return rows


@router.post("/admin/showcase/{post_id}/move-up")
async def move_up(post_id: str, _: dict = Depends(current_admin)):
    rows = await _ensure_sort_orders(await _list_unpinned_visible_in_admin_order())
    idx = next((i for i, r in enumerate(rows) if r["id"] == post_id), -1)
    if idx == -1:
        raise HTTPException(404, "Post not in reorderable list (may be pinned/hidden)")
    if idx == 0:
        return {"ok": True, "moved": False, "reason": "already at top"}
    prev_row = rows[idx - 1]
    me = rows[idx]
    # Swap sort_order with the previous row.
    await db.showcase_posts.update_one(
        {"id": me["id"]}, {"$set": {"admin_sort_order": prev_row["admin_sort_order"]}}
    )
    await db.showcase_posts.update_one(
        {"id": prev_row["id"]}, {"$set": {"admin_sort_order": me["admin_sort_order"]}}
    )
    return {"ok": True, "moved": True}


@router.post("/admin/showcase/{post_id}/move-down")
async def move_down(post_id: str, _: dict = Depends(current_admin)):
    rows = await _ensure_sort_orders(await _list_unpinned_visible_in_admin_order())
    idx = next((i for i, r in enumerate(rows) if r["id"] == post_id), -1)
    if idx == -1:
        raise HTTPException(404, "Post not in reorderable list (may be pinned/hidden)")
    if idx == len(rows) - 1:
        return {"ok": True, "moved": False, "reason": "already at bottom"}
    next_row = rows[idx + 1]
    me = rows[idx]
    await db.showcase_posts.update_one(
        {"id": me["id"]}, {"$set": {"admin_sort_order": next_row["admin_sort_order"]}}
    )
    await db.showcase_posts.update_one(
        {"id": next_row["id"]}, {"$set": {"admin_sort_order": me["admin_sort_order"]}}
    )
    return {"ok": True, "moved": True}


@router.post("/admin/showcase/shuffle")
async def shuffle(_: dict = Depends(current_admin)):
    """Randomize admin_sort_order on all non-pinned, non-hidden posts.
    Pinned posts keep their positions at the top (operator's explicit
    intent). Hidden posts aren't shown at all. Returns the new count
    of shuffled items so the admin UI can render a toast."""
    rows = await db.showcase_posts.find(
        {
            "mod_status": {"$ne": "quarantined"},
            "admin_pinned": {"$ne": True},
            "admin_hidden": {"$ne": True},
        },
        {"_id": 0, "id": 1},
    ).to_list(500)
    if not rows:
        return {"ok": True, "shuffled": 0}
    # Generate well-spaced sort_orders (100, 200, 300…) so subsequent
    # move-up/down ops have room to swap without colliding.
    new_orders = list(range(100, 100 * (len(rows) + 1), 100))
    random.shuffle(new_orders)
    for r, so in zip(rows, new_orders):
        await db.showcase_posts.update_one(
            {"id": r["id"]}, {"$set": {"admin_sort_order": so}}
        )
    logger.info("[showcase-curation] shuffled %d posts", len(rows))
    return {"ok": True, "shuffled": len(rows)}
