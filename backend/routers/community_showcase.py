"""Community showcase: buyer + maker photo/video posts, analytics, AI describe.

Carved out of `routers/community.py` (Feb 2026 refactor).

Surfaces:
  • Public list + recent feed (homepage + product-page strip)
  • Buyer/maker post creation with image/video uploads
  • Like + view + click analytics events
  • Admin analytics aggregation
  • Claude Haiku 4.5 vision-assisted description writer
"""
import base64
import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import httpx
from fastapi import (
    APIRouter, Body, Depends, File, HTTPException, Query, Request, UploadFile,
)
from pydantic import BaseModel
from pymongo import ReturnDocument

from core import db, logger, now_iso
from maker_auth import current_admin, current_any_user, current_buyer

from .community_common import _ensure_user_can_post

router = APIRouter()


# ===================== MODELS =====================
class ShowcasePost(BaseModel):
    title: str
    description: str
    # iter114 — multi-image showcase. New posts populate `image_urls`;
    # `image_url` is kept for backwards compat with the existing card UI
    # (it always holds image_urls[0] when present).
    image_url: Optional[str] = None
    image_urls: List[str] = []
    # Feb 2026 — optional maker-uploaded video clip (≤50 MB, ≤60 s).
    # When set, showcase cards render a <video> element in place of the
    # image carousel. The first image (if any) is used as the poster.
    video_url: Optional[str] = None
    product_slug: Optional[str] = None
    maker_slug: Optional[str] = None
    # iter174 — public view counter. Incremented at most once per
    # (post_id, visitor_id) per 24h window via the public
    # POST /community/showcase/{id}/view endpoint. Surfaces as
    # an "👁 N" badge on every card so makers can gauge organic reach.
    views: int = 0


class ShowcaseEdit(BaseModel):
    """Subset of `ShowcasePost` allowed for owner/admin edits.
    None means "leave unchanged" — empty string clears a field."""
    title: Optional[str] = None
    description: Optional[str] = None
    image_urls: Optional[List[str]] = None
    video_url: Optional[str] = None
    product_slug: Optional[str] = None
    maker_slug: Optional[str] = None


# ===================== OWNERSHIP HELPERS =====================
def _showcase_owner_id(claims: dict) -> str:
    """Translate the JWT claims into the `user_id` field stamped on the
    showcase doc at creation time. Buyers keep their `user_<uuid>` id;
    makers get the `maker:<slug>` prefix (matches `create_showcase`)."""
    role = claims.get("role")
    sub = claims.get("sub", "")
    return f"maker:{sub}" if role == "maker" else sub


def _is_showcase_owner(doc: dict, claims: dict) -> bool:
    if not doc or not claims:
        return False
    return doc.get("user_id") == _showcase_owner_id(claims)


# Public feeds exclude quarantined posts so abusive content doesn't reach
# buyers/makers while moderators decide. Moderator-approved posts stay
# visible even with stale open_reports — the approval is the explicit
# "this is fine" signal.
#
# iter231 — Also exclude `admin_hidden: True` posts. That's the admin
# curation panel's soft-hide (different from quarantine, which is for
# abuse). Quarantined = bad content. Admin-hidden = fine content the
# operator chose to retire from the showcase rotation.
_PUBLIC_FEED_FILTER = {
    "mod_status": {"$ne": "quarantined"},
    "admin_hidden": {"$ne": True},
}


# iter278 — Two homepage strips (`top-week` + `maker-of-week`) were
# rendering "NO IMAGE" tiles for video-only posts and side-by-side
# duplicates when two posts shared the same cover image. This helper
# centralizes both fixes: a Mongo filter that requires at least one
# image, and a Python-level dedupe by cover URL preserving rank order.
_HAS_IMAGE_FILTER = {
    "$or": [
        {"image_url": {"$nin": [None, ""]}},
        {"image_urls.0": {"$exists": True, "$nin": [None, ""]}},
    ],
}


def _cover_url(post: dict) -> str:
    """Mirrors the frontend's `(image_urls && image_urls[0]) || image_url`
    fallback so backend dedup matches what the user actually sees."""
    imgs = post.get("image_urls") or []
    if imgs and imgs[0]:
        return str(imgs[0]).strip()
    return str(post.get("image_url") or "").strip()


def _dedupe_by_cover(posts: list[dict]) -> list[dict]:
    """Drop posts that share a cover URL with an earlier-ranked post.
    Keeps the higher-ranked entry (which is what the caller already
    sorted into position[0])."""
    seen: set[str] = set()
    out: list[dict] = []
    for p in posts:
        url = _cover_url(p)
        if not url:
            continue  # safety — should already be filtered by _HAS_IMAGE_FILTER
        if url in seen:
            continue
        seen.add(url)
        out.append(p)
    return out


# ===================== LISTING =====================
@router.get("/community/showcase")
async def list_showcase(limit: int = 50):
    """iter231 — Order key for the public feed:
       1. admin_pinned: True first (newest pin first via pinned_at desc)
       2. admin_sort_order ascending (lower number → higher in list, nulls last)
       3. created_at descending (newest organic posts beat older ones)

    We achieve the multi-key sort with two passes in code because Mongo
    can't put `null`/missing values at the end of a single sort easily."""
    rows = await db.showcase_posts.find(_PUBLIC_FEED_FILTER, {"_id": 0}).to_list(500)
    def _key(r):
        pinned = bool(r.get("admin_pinned"))
        # Pinned-first → lower priority number
        pinned_at = r.get("admin_pinned_at") or ""
        # Non-pinned rows: sort_order ASC (None goes to the end)
        so = r.get("admin_sort_order")
        if so is None:
            so = 10_000_000        # push to bottom
        created_at = r.get("created_at") or ""
        # Build a tuple: pinned posts (0) before unpinned (1);
        # within pinned, newest pin first; within unpinned, sort_order
        # asc then created_at desc.
        if pinned:
            return (0, "", -ord(pinned_at[0]) if pinned_at else 0, _neg_str(pinned_at))
        return (1, so, _neg_str(created_at))
    rows.sort(key=_key)
    return rows[:limit]


def _neg_str(s: str) -> tuple:
    """Sort helper: returns a tuple that sorts in *reverse* alphabetical
    order when used with the default ascending sort. Lets us mix ASC and
    DESC keys in a single sort tuple."""
    return tuple(-ord(c) for c in (s or ""))



@router.get("/community/maker-of-the-week")
async def get_maker_of_the_week():
    """Hottest maker over the last 7 days.

    Algorithm:
      1. Aggregate `showcase_views` for the rolling 7-day window
      2. Join each post to its `maker_slug`, sum the view-events
      3. Return the maker with the highest weekly view count along with
         the top 3 contributing pieces

    Falls back to the maker with the most lifetime showcase `views`
    when nothing happened in the last 7 days (so the homepage spotlight
    is never empty on quiet weeks).

    Returns `{maker, top_posts, weekly_views, mode}` where
    `mode` ∈ {"trending", "lifetime"}. Frontend self-hides the
    spotlight when `maker` is null.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    # ----- Trending mode (7-day events) -----
    # 1. Get top posts in the window
    pipe = [
        {"$match": {"ts": {"$gte": cutoff}}},
        {"$group": {"_id": "$post_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 50},
    ]
    weekly_by_post: dict[str, int] = {}
    async for row in db.showcase_views.aggregate(pipe):
        weekly_by_post[row["_id"]] = int(row["n"])

    maker_slug: Optional[str] = None
    weekly_views = 0
    mode = "trending"
    top_posts: list[dict] = []

    if weekly_by_post:
        # 2. Pull just the maker_slug for those post ids, then sum per
        #    maker. Posts with NO maker_slug (buyer-only posts) don't
        #    qualify — the spotlight is a maker recognition feature.
        post_meta = await db.showcase_posts.find(
            {
                "id": {"$in": list(weekly_by_post.keys())},
                "maker_slug": {"$ne": None, "$nin": ["", None]},
                **_PUBLIC_FEED_FILTER,
            },
            {"_id": 0, "id": 1, "maker_slug": 1},
        ).to_list(100)
        per_maker: dict[str, int] = {}
        for p in post_meta:
            ms = p.get("maker_slug")
            if not ms:
                continue
            per_maker[ms] = per_maker.get(ms, 0) + weekly_by_post.get(p["id"], 0)
        if per_maker:
            maker_slug, weekly_views = max(per_maker.items(), key=lambda kv: kv[1])

    # ----- Lifetime fallback -----
    if not maker_slug:
        # Pick the maker whose published showcase posts have the
        # highest *lifetime* view sum. Equivalent to "all-time most
        # viewed maker".
        pipe = [
            {"$match": {
                "maker_slug": {"$ne": None, "$nin": ["", None]},
                "mod_status": {"$ne": "quarantined"},
            }},
            {"$group": {"_id": "$maker_slug", "v": {"$sum": "$views"}}},
            {"$match": {"v": {"$gt": 0}}},
            {"$sort": {"v": -1}},
            {"$limit": 1},
        ]
        async for row in db.showcase_posts.aggregate(pipe):
            maker_slug = row["_id"]
            mode = "lifetime"
            weekly_views = 0  # explicitly 0 — UI hides the "this week" badge
            break

    if not maker_slug:
        return {"maker": None, "top_posts": [], "weekly_views": 0, "mode": mode}

    # Fetch the maker doc (slim projection)
    maker = await db.makers.find_one(
        {"slug": maker_slug},
        {"_id": 0, "slug": 1, "name": 1, "initials": 1, "location": 1,
         "bio": 1, "techniques": 1, "portrait": 1, "cover": 1,
         "banner_image_url": 1, "subscription_status": 1,
         "is_veteran_owned": 1, "custom_url": 1},
    )
    if not maker:
        return {"maker": None, "top_posts": [], "weekly_views": 0, "mode": mode}

    # Top 3 contributing posts from this maker — sort by weekly views
    # (when trending) or by lifetime views (when lifetime fallback).
    # iter278 — Require an image so the spotlight strip doesn't render
    # "NO IMAGE" tiles for video-only posts.
    sort_field = "weekly_views" if mode == "trending" else "views"
    contributing = await db.showcase_posts.find(
        {"maker_slug": maker_slug, **_PUBLIC_FEED_FILTER, **_HAS_IMAGE_FILTER},
        {"_id": 0, "id": 1, "title": 1, "image_url": 1, "image_urls": 1,
         "views": 1, "likes": 1},
    ).to_list(50)
    for p in contributing:
        p["weekly_views"] = weekly_by_post.get(p["id"], 0)
    contributing.sort(key=lambda p: p.get(sort_field) or 0, reverse=True)
    # iter278 — Dedup by cover so we never show two identical tiles.
    top_posts = _dedupe_by_cover(contributing)[:3]

    return {
        "maker": maker,
        "top_posts": top_posts,
        "weekly_views": weekly_views,
        "mode": mode,
    }


@router.get("/community/showcase/top-week")
async def list_top_week_showcase(limit: int = 6):
    """Most-viewed showcase pieces over the last 7 days.

    Returns posts sorted by their view-event count inside the rolling
    7-day window (NOT lifetime `views`), so freshly-popular work
    surfaces above older posts that just have a tall historical total.

    Used by the homepage "Trending in the community" strip. Self-hides
    on the frontend when fewer than 2 posts qualify, so quiet weeks
    don't render a half-empty section.
    """
    try:
        n = int(limit) if limit is not None else 6
    except (TypeError, ValueError):
        n = 6
    n = max(2, min(n, 12))

    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    # Aggregate the recent view-event collection (`showcase_views`) to
    # get a (post_id → recent_view_count) map. Avoids leaning on the
    # lifetime `views` field, which would tilt the leaderboard toward
    # ancient posts.
    pipe = [
        {"$match": {"ts": {"$gte": cutoff}}},
        {"$group": {"_id": "$post_id", "recent_views": {"$sum": 1}}},
        {"$sort": {"recent_views": -1}},
        {"$limit": n * 3},  # pull extras in case some posts are quarantined
    ]
    top_rows = []
    async for row in db.showcase_views.aggregate(pipe):
        top_rows.append((row["_id"], int(row.get("recent_views") or 0)))

    seen_ids = {pid for pid, _ in top_rows}

    # Top-up fallback — when recent activity is sparse (early launch, low
    # traffic week), pad the list with posts ranked by their *lifetime*
    # view count so the homepage strip never renders half-empty. These
    # fallback rows return `views_this_week=0` so the UI can decide
    # whether to badge them differently.
    if len(top_rows) < n:
        fallback = await db.showcase_posts.find(
            {
                **_PUBLIC_FEED_FILTER,
                **_HAS_IMAGE_FILTER,  # iter278 — no "no image" tiles in the fallback
                "id": {"$nin": list(seen_ids)},
                "views": {"$gt": 0},
            },
            {"_id": 0, "id": 1, "views": 1},
        ).sort("views", -1).limit(n - len(top_rows)).to_list(n)
        for p in fallback:
            top_rows.append((p["id"], 0))

    if not top_rows:
        return {"items": []}

    post_ids = [pid for pid, _ in top_rows]
    proj = {
        "_id": 0, "id": 1, "title": 1, "description": 1,
        "image_url": 1, "image_urls": 1, "video_url": 1,
        "product_slug": 1, "maker_slug": 1,
        "user_name": 1, "user_picture": 1, "user_role": 1,
        "likes": 1, "views": 1, "created_at": 1,
    }
    posts = await db.showcase_posts.find(
        {"id": {"$in": post_ids}, **_PUBLIC_FEED_FILTER, **_HAS_IMAGE_FILTER},
        proj,
    ).to_list(len(post_ids))
    by_id = {p["id"]: p for p in posts}

    # Re-sort to the aggregation order + decorate each post with the
    # 7-day count (lets the frontend show "🔥 24 this week" if it wants).
    items: list[dict] = []
    for pid, cnt in top_rows:
        p = by_id.get(pid)
        if not p:
            continue
        p["views_this_week"] = cnt
        items.append(p)
    # iter278 — Drop visual duplicates (two different posts using the
    # same cover image render as identical tiles). Dedup happens AFTER
    # the rank-order reassembly so we keep the higher-ranked post.
    items = _dedupe_by_cover(items)[:n]
    return {"items": items}




@router.get("/community/showcase/recent")
async def list_recent_showcase(
    limit: int = 4,
    product_slug: Optional[str] = None,
    maker_slug: Optional[str] = None,
    strict: bool = False,
    only_makers: bool = False,
):
    """Public, no-auth, lightweight feed for the homepage + product-page
    'Recently shared by buyers' strip (iter116). Prefers posts tagged with
    the requested product or maker; falls back to general newest-first
    when nothing is tagged or the tagged feed is too thin to render a
    full row.

    `strict=true` disables the newest-first fallback — used by maker
    profile pages where showing another maker's work would be confusing.

    `only_makers=true` restricts the results to maker-authored posts —
    used by the homepage "Built in Real Workshops" workshop-imagery
    mosaic so it doesn't accidentally surface buyer photos.
    """
    try:
        n = int(limit) if limit is not None else 4
    except (TypeError, ValueError):
        n = 4
    limit = max(1, min(n, 12))
    proj = {
        "_id": 0, "id": 1, "title": 1,
        "image_url": 1, "image_urls": 1, "video_url": 1,
        "product_slug": 1, "maker_slug": 1,
        "user_name": 1, "user_picture": 1, "user_role": 1,
        "likes": 1, "created_at": 1,
        # iter237 — surface AI provenance so the showcase carousel can
        # render a small "◆ AI · Studio" badge on AI-published designs.
        "source": 1, "design_file_id": 1, "ai_generated": 1,
    }

    async def _query(filt: dict, n: int) -> list[dict]:
        # Always exclude quarantined posts from the public recent feed.
        # iter279 — Also require an image and the row is a strip-style
        # visual feed; we never want "NO IMAGE" tiles on the homepage or
        # product page.
        merged = {**filt, **_PUBLIC_FEED_FILTER, **_HAS_IMAGE_FILTER}
        # `only_makers=true` restricts to maker-authored posts (used by
        # the homepage "Built in Real Workshops" workshop-imagery
        # mosaic — buyer posts go elsewhere).
        if only_makers:
            merged["user_role"] = "maker"
        return await db.showcase_posts.find(merged, proj).sort("created_at", -1).limit(n).to_list(n)

    rows: list[dict] = []
    seen_ids: set[str] = set()

    if product_slug:
        rows = await _query({"product_slug": product_slug}, limit)
        seen_ids = {r["id"] for r in rows}

    if maker_slug and len(rows) < limit:
        more = await _query(
            {"maker_slug": maker_slug, "id": {"$nin": list(seen_ids)}},
            limit - len(rows),
        )
        rows.extend(more)
        seen_ids.update(r["id"] for r in more)

    if len(rows) < limit and not strict:
        more = await _query({"id": {"$nin": list(seen_ids)}}, limit - len(rows))
        rows.extend(more)

    # iter279 — Dedup by cover so two posts with the same hero photo
    # don't render side-by-side. Newest-first ordering is already
    # applied by `.sort("created_at", -1)`, so the dedupe keeps the
    # most-recently-posted version when two posts share a cover.
    rows = _dedupe_by_cover(rows)
    return {"items": rows[:limit], "count": len(rows[:limit])}


@router.post("/community/showcase")
async def create_showcase(post: ShowcasePost, claims: dict = Depends(current_any_user)):
    """Create a showcase post. Accepts buyer OR maker JWTs.
    Buyers post photos of items they bought (original surface).
    Makers post photos + optional video clips of work in their shop.

    The user-attribution fields (`user_email/name/picture`) are sourced
    from `community_users` for buyers and from `makers` for makers so
    the card renders identically regardless of who posted."""
    role = claims.get("role")
    if role == "maker":
        maker = await db.makers.find_one(
            {"slug": claims["sub"]},
            {"_id": 0, "email": 1, "name": 1, "shop_name": 1, "portrait": 1, "slug": 1},
        )
        if not maker:
            raise HTTPException(404, "Maker not found.")
        user_email = maker.get("email", "")
        user_name = maker.get("shop_name") or maker.get("name", "")
        user_picture = maker.get("portrait", "")
        user_id_for_doc = f"maker:{maker['slug']}"
        if not post.maker_slug:
            post.maker_slug = maker["slug"]
    else:
        user = await db.community_users.find_one({"user_id": claims["sub"]}, {"_id": 0})
        if not user:
            raise HTTPException(404, "User not found")
        user_email = user["email"]
        user_name = user.get("name", "")
        user_picture = user.get("picture", "")
        user_id_for_doc = claims["sub"]

    payload = post.model_dump()
    urls = list(payload.get("image_urls") or [])
    if payload.get("image_url") and payload["image_url"] not in urls:
        urls.insert(0, payload["image_url"])
    has_video = bool(payload.get("video_url"))
    if not urls and not has_video:
        raise HTTPException(400, "Add at least one image — or a video clip.")
    if has_video and role != "maker":
        # Defence in depth — only makers can attach videos via upload-video,
        # but reject any buyer attempt to post a `video_url` directly.
        raise HTTPException(403, "Video clips are a maker-only feature for now.")
    urls = urls[:8]
    payload["image_urls"] = urls
    payload["image_url"] = urls[0] if urls else None

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id_for_doc,
        "user_email": user_email,
        "user_name": user_name,
        "user_picture": user_picture,
        "user_role": role,
        **payload,
        "likes": 0,
        "created_at": now_iso(),
    }
    await db.showcase_posts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/community/showcase/{post_id}/like")
async def like_showcase(post_id: str, claims: dict = Depends(current_buyer)):
    r = await db.showcase_posts.update_one({"id": post_id}, {"$inc": {"likes": 1}})
    if r.matched_count == 0:
        raise HTTPException(404, "Post not found")
    return {"ok": True}


# iter174 — public view counter. Anyone (signed-in or anon) can mark a
# showcase post as viewed. We dedupe by (post_id, visitor_id) within a
# rolling 24-hour window so a single browser tab refresh doesn't inflate
# the counter, and so makers see roughly "unique viewers per day".
VIEW_DEDUPE_WINDOW_HOURS = 24


def _visitor_fingerprint(request: Request, client_id: Optional[str]) -> str:
    """Composite visitor id: prefer the client-supplied UUID stored in
    localStorage (`cm_anon_id`), fall back to (IP, UA) hash. Both modes
    give us enough granularity to throttle without storing PII."""
    if client_id and len(client_id) >= 8 and len(client_id) <= 64:
        return f"cid:{client_id}"
    ip = (request.client.host if request.client else "0") or "0"
    ua = request.headers.get("user-agent", "")[:200]
    h = hashlib.sha256(f"{ip}|{ua}".encode("utf-8")).hexdigest()[:24]
    return f"ipua:{h}"


@router.post("/community/showcase/{post_id}/view")
async def mark_showcase_viewed(
    post_id: str,
    request: Request,
    client_id: Optional[str] = Body(default=None, embed=True),
):
    """Idempotent per (post_id, visitor) within VIEW_DEDUPE_WINDOW_HOURS.
    Returns `{counted: bool, views: int}` so the frontend can render the
    fresh number without a separate fetch."""
    post = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0, "views": 1})
    if not post:
        raise HTTPException(404, "Post not found")
    visitor = _visitor_fingerprint(request, client_id)
    cutoff = (
        datetime.now(timezone.utc) - timedelta(hours=VIEW_DEDUPE_WINDOW_HOURS)
    ).isoformat()
    # Try to claim a fresh view-event row. If one already exists for
    # this visitor within the window, modified_count==0 and we no-op.
    existing = await db.showcase_views.find_one(
        {"post_id": post_id, "visitor": visitor, "ts": {"$gte": cutoff}},
        {"_id": 1},
    )
    if existing:
        return {"counted": False, "views": int(post.get("views") or 0)}
    await db.showcase_views.insert_one({
        "post_id": post_id,
        "visitor": visitor,
        "ts": now_iso(),
    })
    r = await db.showcase_posts.find_one_and_update(
        {"id": post_id},
        {"$inc": {"views": 1}},
        projection={"_id": 0, "views": 1},
        return_document=ReturnDocument.AFTER,
    ) or {}
    return {"counted": True, "views": int(r.get("views") or 0)}




# ===================== POST REPORTING (community abuse flagging) =====================
# Auto-quarantine: when a post hits this many open reports inside the
# rolling window, it disappears from public feeds and shoots to the top
# of the admin queue. Tuned for a small community — 3 is enough to
# catch a coordinated flag-bomb without ever firing on legit posts.
AUTO_QUARANTINE_THRESHOLD = 3
AUTO_QUARANTINE_WINDOW_HOURS = 24

SHOWCASE_REPORT_REASONS = {
    "spam":         "Spam or self-promotion abuse",
    "harassment":   "Harassment or hate speech",
    "nudity":       "Adult / explicit content",
    "ip":           "IP / copyright infringement",
    "misleading":   "Misleading or fraudulent",
    "off-topic":    "Off-topic for the community",
    "other":        "Other concern",
}


class _ShowcaseReportBody(BaseModel):
    reason: str
    details: Optional[str] = None


@router.post("/community/showcase/{post_id}/report")
async def report_showcase(
    post_id: str,
    body: _ShowcaseReportBody,
    claims: dict = Depends(current_any_user),
):
    """Open a moderation flag against a showcase post. Both buyers and
    makers can report; the post's own creator gets a friendly 400 so
    they don't report themselves by accident.

    Each (reporter, post) pair is deduped while a previous report is
    still `open`, so spamming the button doesn't multiply the counter.
    """
    reason = (body.reason or "").strip()
    if reason not in SHOWCASE_REPORT_REASONS:
        raise HTTPException(400, "Invalid reason.")
    details = (body.details or "").strip()[:1000]

    post = await db.showcase_posts.find_one(
        {"id": post_id},
        {"_id": 0, "id": 1, "title": 1, "user_id": 1, "user_email": 1, "user_name": 1},
    )
    if not post:
        raise HTTPException(404, "Post not found.")

    reporter_id = _showcase_owner_id(claims)
    if reporter_id == post.get("user_id"):
        raise HTTPException(400, "You can't report your own post — delete it instead.")

    # Dedup while a previous report from this user is still open.
    existing = await db.showcase_reports.find_one(
        {"post_id": post_id, "reported_by": reporter_id, "status": "open"},
        {"_id": 0, "id": 1},
    )
    if existing:
        return {"ok": True, "duplicate": True, "id": existing["id"]}

    doc = {
        "id": str(uuid.uuid4()),
        "post_id": post_id,
        "post_title": post.get("title"),
        "post_user_id": post.get("user_id"),
        "post_user_email": post.get("user_email"),
        "post_user_name": post.get("user_name"),
        "reported_by": reporter_id,
        "reporter_role": claims.get("role"),
        "reason": reason,
        "reason_label": SHOWCASE_REPORT_REASONS[reason],
        "details": details,
        "status": "open",
        "created_at": now_iso(),
        "resolved_at": None,
        "resolver": None,
    }
    await db.showcase_reports.insert_one(doc)
    await db.showcase_posts.update_one(
        {"id": post_id},
        {
            "$inc": {"open_reports": 1},
            "$set": {"mod_status": "reported"},
        },
    )

    # ─── Auto-quarantine ────────────────────────────────────────────
    # If the post has racked up ≥ AUTO_QUARANTINE_THRESHOLD reports
    # within AUTO_QUARANTINE_WINDOW_HOURS, hide it from public feeds
    # immediately and flag it for top-of-queue moderator review.
    # Real-time check (no cron needed) — fires from the same request
    # that pushed the post over the line. Idempotent: re-running the
    # check on an already-quarantined post is a no-op aside from one
    # extra mod_history audit row, which is fine for accountability.
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=AUTO_QUARANTINE_WINDOW_HOURS)).isoformat()
    recent_reports = await db.showcase_reports.count_documents({
        "post_id": post_id, "status": "open",
        "created_at": {"$gte": cutoff},
    })
    if recent_reports >= AUTO_QUARANTINE_THRESHOLD:
        fresh = await db.showcase_posts.find_one(
            {"id": post_id}, {"_id": 0, "mod_status": 1, "user_email": 1, "user_name": 1, "title": 1},
        )
        if fresh and fresh.get("mod_status") != "quarantined":
            await db.showcase_posts.update_one(
                {"id": post_id},
                {
                    "$set": {
                        "mod_status": "quarantined",
                        "quarantined_at": now_iso(),
                        "auto_quarantined": True,
                    },
                    "$push": {"mod_history": {
                        "ts": now_iso(),
                        "by": "system:auto-quarantine",
                        "action": "quarantine",
                        "reason": f"{recent_reports} reports in {AUTO_QUARANTINE_WINDOW_HOURS}h",
                    }},
                },
            )
            logger.info(
                "[auto_quarantine] post=%s reports=%d window_h=%d",
                post_id, recent_reports, AUTO_QUARANTINE_WINDOW_HOURS,
            )
            # Notify the poster — best-effort, never blocks the quarantine.
            poster_email = (fresh.get("user_email") or "").strip().lower()
            if poster_email:
                try:
                    from email_service import send_showcase_quarantine_notice
                    await send_showcase_quarantine_notice(
                        email=poster_email,
                        name=fresh.get("user_name") or "",
                        post_title=fresh.get("title") or "",
                        report_count=recent_reports,
                    )
                except Exception as e:
                    logger.warning(
                        "[auto_quarantine] notice email failed for %s: %s",
                        poster_email, e,
                    )

    return {"ok": True, "duplicate": False, "id": doc["id"]}


@router.get("/community/showcase/report-reasons")
async def list_showcase_report_reasons():
    """Public — used by the report dialog to render reason options."""
    return {"reasons": [
        {"id": k, "label": v} for k, v in SHOWCASE_REPORT_REASONS.items()
    ]}


# ===================== OWNER/ADMIN EDIT + DELETE =====================
def _apply_showcase_edit(doc: dict, payload: ShowcaseEdit, *, is_admin: bool) -> dict:
    """Build the Mongo `$set` update from the patch payload. Validates
    sizes + the maker-only video constraint. Returns the dict to persist."""
    updates: dict = {}
    if payload.title is not None:
        title = payload.title.strip()
        if not title or len(title) > 200:
            raise HTTPException(400, "Title is required (max 200 chars).")
        updates["title"] = title
    if payload.description is not None:
        desc = payload.description.strip()
        if not desc:
            raise HTTPException(400, "Description is required.")
        updates["description"] = desc[:2000]
    if payload.image_urls is not None:
        urls = [u for u in (payload.image_urls or []) if u][:8]
        # Must end with at least one image OR a video — same rule as create.
        ending_video = payload.video_url if payload.video_url is not None else doc.get("video_url")
        if not urls and not ending_video:
            raise HTTPException(400, "Keep at least one image or a video clip.")
        updates["image_urls"] = urls
        updates["image_url"] = urls[0] if urls else None
    if payload.video_url is not None:
        # Only the original maker (or admin) may attach/edit a video.
        if payload.video_url and doc.get("user_role") != "maker" and not is_admin:
            raise HTTPException(403, "Video clips are a maker-only feature.")
        ending_urls = updates.get("image_urls", doc.get("image_urls") or [])
        if not payload.video_url and not ending_urls:
            raise HTTPException(400, "Keep at least one image or a video clip.")
        updates["video_url"] = payload.video_url or None
    if payload.product_slug is not None:
        updates["product_slug"] = payload.product_slug or None
    if payload.maker_slug is not None:
        updates["maker_slug"] = payload.maker_slug or None
    if updates:
        updates["edited_at"] = now_iso()
    return updates


@router.patch("/community/showcase/{post_id}")
async def edit_showcase(
    post_id: str, payload: ShowcaseEdit,
    claims: dict = Depends(current_any_user),
):
    """Owner-only edit (admin path lives at /admin/community/showcase/{id}).
    The owner check uses the same `user_id` we stamp at creation, so a
    maker can only edit their own posts and a buyer can only edit theirs.
    """
    doc = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Post not found.")
    if not _is_showcase_owner(doc, claims):
        raise HTTPException(403, "You can only edit your own posts.")
    updates = _apply_showcase_edit(doc, payload, is_admin=False)
    if updates:
        await db.showcase_posts.update_one({"id": post_id}, {"$set": updates})
    fresh = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0})
    return fresh or {}


@router.delete("/community/showcase/{post_id}")
async def delete_showcase(
    post_id: str, claims: dict = Depends(current_any_user),
):
    """Owner-only delete. Admins use the parallel /admin/ route below so
    deletions are audit-logged separately."""
    doc = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0, "user_id": 1})
    if not doc:
        raise HTTPException(404, "Post not found.")
    if not _is_showcase_owner(doc, claims):
        raise HTTPException(403, "You can only delete your own posts.")
    await db.showcase_posts.delete_one({"id": post_id})
    # Also reap any analytics rows so they don't dangle.
    await db.showcase_events.delete_many({"post_id": post_id})
    return {"ok": True, "deleted": post_id}


# ===================== ADMIN MODERATION =====================
@router.get("/admin/community/showcase")
async def admin_list_showcase(
    status: str = Query("all", regex="^(all|pending|approved|featured|reported|quarantined)$"),
    limit: int = 50, skip: int = 0,
    _: dict = Depends(current_admin),
):
    """Paged showcase queue for admin moderation.

    Status filters:
      • `all`         — every post, quarantined first then newest-first.
      • `pending`     — posts that haven't been explicitly approved / featured / reported / quarantined.
      • `approved` / `featured` — exact mod_status match.
      • `reported`    — posts with at least one open report. Sorted by
        report count (most-flagged first), then by created_at.
      • `quarantined` — auto- or manually-quarantined posts only.
    """
    q: dict = {}
    n = max(1, min(int(limit), 200))
    skip = max(0, int(skip))
    if status == "pending":
        q = {"mod_status": {"$in": [None, "pending"]}}
    elif status in ("approved", "featured"):
        q = {"mod_status": status}
    elif status == "reported":
        q = {"open_reports": {"$gt": 0}, "mod_status": {"$ne": "quarantined"}}
        total = await db.showcase_posts.count_documents(q)
        rows = await db.showcase_posts.find(q, {"_id": 0}).sort(
            [("open_reports", -1), ("created_at", -1)],
        ).skip(skip).limit(n).to_list(n)
        return {"total": total, "rows": rows, "skip": skip, "limit": n}
    elif status == "quarantined":
        q = {"mod_status": "quarantined"}
    total = await db.showcase_posts.count_documents(q)
    # In the "all" view, surface quarantined posts at the top — they're
    # the ones that need an admin's attention first. Other filters keep
    # their natural newest-first ordering.
    if status == "all":
        cursor = db.showcase_posts.find(q, {"_id": 0}).sort([
            # Boolean sort: quarantined posts win because True > False.
            ("auto_quarantined", -1), ("open_reports", -1), ("created_at", -1),
        ])
    else:
        cursor = db.showcase_posts.find(q, {"_id": 0}).sort("created_at", -1)
    rows = await cursor.skip(skip).limit(n).to_list(n)
    return {"total": total, "rows": rows, "skip": skip, "limit": n}


@router.patch("/admin/community/showcase/{post_id}")
async def admin_edit_showcase(
    post_id: str, payload: ShowcaseEdit,
    claims: dict = Depends(current_admin),
):
    """Admin override — edit any showcase post. Stamps an audit entry so
    the maker can see who touched their content."""
    doc = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Post not found.")
    updates = _apply_showcase_edit(doc, payload, is_admin=True)
    if updates:
        diff = {k: {"before": doc.get(k), "after": v} for k, v in updates.items()
                if k not in ("edited_at",) and doc.get(k) != v}
        updates.setdefault("mod_history", doc.get("mod_history") or [])
        updates["mod_history"] = (doc.get("mod_history") or []) + [{
            "ts": now_iso(),
            "by": claims.get("sub"),
            "action": "edit",
            "diff": diff,
        }]
        await db.showcase_posts.update_one({"id": post_id}, {"$set": updates})
    fresh = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0})
    return fresh or {}


@router.post("/admin/community/showcase/{post_id}/approve")
async def admin_approve_showcase(
    post_id: str,
    body: dict = Body(default={}),
    claims: dict = Depends(current_admin),
):
    """Mark a showcase post as moderator-approved. Pass `featured=true`
    to additionally promote it (frontends can boost featured posts to
    the top of recent feeds). Idempotent — calling twice with the same
    flags is a no-op aside from the audit timestamp."""
    doc = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Post not found.")
    # Capture the pre-approval state so we can decide whether to send
    # the "restored" courtesy email. Only fire when the approval
    # actually flips a quarantined post — not on every routine approve.
    was_quarantined = doc.get("mod_status") == "quarantined"
    featured = bool(body.get("featured"))
    status = "featured" if featured else "approved"
    history_entry = {
        "ts": now_iso(),
        "by": claims.get("sub"),
        "action": status,
    }
    await db.showcase_posts.update_one(
        {"id": post_id},
        {
            "$set": {
                "mod_status": status,
                "mod_approved_at": now_iso(),
                "mod_approved_by": claims.get("sub"),
                # Approval clears the open-report counter — the admin's
                # explicit "this is fine" closes any outstanding flags.
                "open_reports": 0,
            },
            "$push": {"mod_history": history_entry},
        },
    )
    # Close all open reports on this post, attributing the resolution
    # to the admin. Preserves report history for analytics.
    await db.showcase_reports.update_many(
        {"post_id": post_id, "status": "open"},
        {"$set": {
            "status": "dismissed",
            "resolved_at": now_iso(),
            "resolver": claims.get("sub"),
        }},
    )
    # Restored-from-quarantine courtesy email — fail-soft so the API
    # never errors over a Mailgun blip. Sends only on the transition
    # OUT of quarantine, so routine approvals don't spam makers.
    if was_quarantined:
        poster_email = (doc.get("user_email") or "").strip().lower()
        if poster_email:
            try:
                from email_service import send_showcase_restored_notice
                await send_showcase_restored_notice(
                    email=poster_email,
                    name=doc.get("user_name") or "",
                    post_title=doc.get("title") or "",
                )
            except Exception as e:
                logger.warning(
                    "[showcase_restore] notice email failed for %s: %s",
                    poster_email, e,
                )
    fresh = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0})
    return fresh or {}


@router.delete("/admin/community/showcase/{post_id}")
async def admin_delete_showcase(
    post_id: str, claims: dict = Depends(current_admin),
):
    """Admin hard-delete + audit-log row in `admin_moderation_actions`.
    Keeps a copy of the deleted doc so we can answer 'who deleted my post?'
    questions from makers without ambiguity."""
    doc = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Post not found.")
    await db.admin_moderation_actions.insert_one({
        "id": str(uuid.uuid4()),
        "kind": "showcase_delete",
        "target_id": post_id,
        "by": claims.get("sub"),
        "ts": now_iso(),
        "snapshot": {
            "title": doc.get("title"),
            "user_id": doc.get("user_id"),
            "user_email": doc.get("user_email"),
            "user_name": doc.get("user_name"),
            "created_at": doc.get("created_at"),
            "image_url": doc.get("image_url"),
            "video_url": doc.get("video_url"),
        },
    })
    await db.showcase_posts.delete_one({"id": post_id})
    await db.showcase_events.delete_many({"post_id": post_id})
    # Mark any open reports as upheld (post was removed for cause).
    await db.showcase_reports.update_many(
        {"post_id": post_id, "status": "open"},
        {"$set": {
            "status": "upheld",
            "resolved_at": now_iso(),
            "resolver": claims.get("sub"),
        }},
    )
    return {"ok": True, "deleted": post_id}


# ============================================================
# Showcase analytics — view + click events (iter117)
# ============================================================
class _ShowcaseEventBody(BaseModel):
    source: Optional[str] = None


async def _record_showcase_event(post_id: str, kind: str, source: Optional[str], request: Request):
    """Insert one event row + bump the denormalized counter on the post."""
    if kind not in ("view", "click"):
        return False
    post = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0, "id": 1})
    if not post:
        return False
    raw_ip = (request.client.host if request.client else "") + (request.headers.get("user-agent") or "")
    fingerprint = hashlib.sha1(raw_ip.encode("utf-8", "ignore")).hexdigest()[:16]
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    recent = await db.showcase_events.find_one({
        "post_id": post_id, "kind": kind,
        "fingerprint": fingerprint,
        "created_at": {"$gte": cutoff},
    }, {"_id": 0, "post_id": 1})
    if recent:
        return True
    await db.showcase_events.insert_one({
        "post_id": post_id,
        "kind": kind,
        "source": (source or "")[:32],
        "fingerprint": fingerprint,
        "created_at": now_iso(),
    })
    counter_field = "views" if kind == "view" else "clicks"
    await db.showcase_posts.update_one({"id": post_id}, {"$inc": {counter_field: 1}})
    return True


@router.post("/community/showcase/{post_id}/view")
async def record_showcase_view(post_id: str, request: Request,
                                body: _ShowcaseEventBody = Body(default=_ShowcaseEventBody())):
    """Public — fired by `RecentShowcaseStrip` when a tile becomes visible."""
    ok = await _record_showcase_event(post_id, "view", body.source, request)
    return {"ok": ok}


@router.post("/community/showcase/{post_id}/click")
async def record_showcase_click(post_id: str, request: Request,
                                 body: _ShowcaseEventBody = Body(default=_ShowcaseEventBody())):
    """Public — fired when a buyer clicks a strip tile."""
    ok = await _record_showcase_event(post_id, "click", body.source, request)
    return {"ok": ok}


@router.get("/admin/community/showcase/mod-stats")
async def admin_showcase_mod_stats(_: dict = Depends(current_admin)):
    """Lightweight moderation health card for the admin dashboard:

    Returns counts of every state that needs (or needed) attention:
      • pending_review  — unapproved posts still in the queue (mod_status pending/null)
      • reported        — posts with one or more open reports, not yet quarantined
      • quarantined     — auto- OR manually-quarantined, awaiting admin decision
      • approved_24h    — moderator-approved within the last 24 hours
      • removed_24h     — admin-deleted within the last 24 hours
      • auto_quarantined_24h — auto-quarantined by the 3-report threshold in 24h

    Designed to load in <50ms via cheap count_documents queries against
    indexed fields. No aggregation pipelines — one count per metric."""
    now = datetime.now(timezone.utc)
    cutoff_24h = (now - timedelta(hours=24)).isoformat()

    pending = await db.showcase_posts.count_documents(
        {"mod_status": {"$in": [None, "pending"]}},
    )
    reported = await db.showcase_posts.count_documents(
        {"open_reports": {"$gt": 0}, "mod_status": {"$ne": "quarantined"}},
    )
    quarantined = await db.showcase_posts.count_documents(
        {"mod_status": "quarantined"},
    )
    approved_24h = await db.showcase_posts.count_documents(
        {"mod_status": {"$in": ["approved", "featured"]},
         "approved_at": {"$gte": cutoff_24h}},
    )
    removed_24h = await db.admin_moderation_actions.count_documents(
        {"kind": "showcase_delete", "ts": {"$gte": cutoff_24h}},
    )
    auto_quarantined_24h = await db.showcase_posts.count_documents(
        {"auto_quarantined": True, "quarantined_at": {"$gte": cutoff_24h}},
    )
    return {
        "pending_review": pending,
        "reported": reported,
        "quarantined": quarantined,
        "approved_24h": approved_24h,
        "removed_24h": removed_24h,
        "auto_quarantined_24h": auto_quarantined_24h,
        "now": now.isoformat(),
    }


@router.get("/admin/community/showcase/analytics")
async def admin_showcase_analytics(
    days: int = 7,
    limit: int = 10,
    _: dict = Depends(current_admin),
):
    """Top showcase posts by views in the last `days` days, with their
    click count and computed CTR. Source-attribution counts (home vs.
    product strip) are surfaced alongside so the operator can see which
    placement converts harder."""
    try:
        d = int(days) if days is not None else 7
        n = int(limit) if limit is not None else 10
    except (TypeError, ValueError):
        d, n = 7, 10
    days = max(1, min(d, 90))
    limit = max(1, min(n, 50))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    pipeline_views = [
        {"$match": {"kind": "view", "created_at": {"$gte": cutoff}}},
        {"$group": {"_id": "$post_id", "n": {"$sum": 1},
                    "by_source": {"$push": "$source"}}},
        {"$sort": {"n": -1}}, {"$limit": limit},
    ]
    top_views = await db.showcase_events.aggregate(pipeline_views).to_list(limit)

    if not top_views:
        return {"days": days, "rows": [], "totals": {"views": 0, "clicks": 0}}

    post_ids = [r["_id"] for r in top_views]
    posts = await db.showcase_posts.find(
        {"id": {"$in": post_ids}},
        {"_id": 0, "id": 1, "title": 1, "user_name": 1, "image_url": 1,
         "image_urls": 1, "product_slug": 1, "maker_slug": 1, "created_at": 1},
    ).to_list(len(post_ids))
    posts_by_id = {p["id"]: p for p in posts}

    clicks_pipeline = [
        {"$match": {"kind": "click", "post_id": {"$in": post_ids},
                    "created_at": {"$gte": cutoff}}},
        {"$group": {"_id": "$post_id", "n": {"$sum": 1}}},
    ]
    clicks_rows = await db.showcase_events.aggregate(clicks_pipeline).to_list(len(post_ids))
    clicks_by_id = {r["_id"]: r["n"] for r in clicks_rows}

    rows = []
    for v in top_views:
        pid = v["_id"]
        p = posts_by_id.get(pid)
        if not p:
            continue
        view_count = v["n"]
        click_count = clicks_by_id.get(pid, 0)
        source_counts: dict[str, int] = {}
        for s in (v.get("by_source") or []):
            if s:
                source_counts[s] = source_counts.get(s, 0) + 1
        cover = (p.get("image_urls") or [None])[0] or p.get("image_url")
        rows.append({
            "post_id": pid,
            "title": p.get("title", ""),
            "user_name": p.get("user_name", ""),
            "image_url": cover,
            "product_slug": p.get("product_slug"),
            "maker_slug": p.get("maker_slug"),
            "post_created_at": p.get("created_at"),
            "views": view_count,
            "clicks": click_count,
            "ctr": round((click_count / view_count) * 100, 1) if view_count else 0,
            "by_source": source_counts,
        })

    return {
        "days": days,
        "rows": rows,
        "totals": {
            "views": sum(r["views"] for r in rows),
            "clicks": sum(r["clicks"] for r in rows),
        },
    }


# ===================== SHOWCASE — image + video upload =====================
SHOWCASE_MAX_IMAGE_BYTES = 8 * 1024 * 1024
SHOWCASE_ALLOWED_IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

# Maker video clips (Feb 2026). 50 MB cap matches a ~60s 1080p H.264 export.
SHOWCASE_MAX_VIDEO_BYTES = 50 * 1024 * 1024
SHOWCASE_ALLOWED_VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v"}
SHOWCASE_ALLOWED_VIDEO_MIME = {
    "video/mp4", "video/webm", "video/quicktime", "video/x-m4v",
}


@router.post("/community/showcase/upload")
async def upload_showcase_image(
    file: UploadFile = File(...), claims: dict = Depends(current_buyer),
):
    """Image-only uploader for the showcase form. The frontend calls this
    once per picked file (the picker accepts up to 8) and accumulates the
    returned URLs into `image_urls[]` before POST /community/showcase."""
    await _ensure_user_can_post(claims["sub"])
    from r2_storage import is_configured as r2_ok, upload_bytes
    if not r2_ok():
        raise HTTPException(503, "File uploads are not configured.")
    raw = await file.read()
    size = len(raw)
    mime = (file.content_type or "").lower()
    name = file.filename or "upload"
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext not in SHOWCASE_ALLOWED_IMG_EXT or not mime.startswith("image/"):
        raise HTTPException(400, f"Images only — got '{name}' ({mime or ext or 'unknown'})")
    if size > SHOWCASE_MAX_IMAGE_BYTES:
        raise HTTPException(400, f"Image must be ≤ {SHOWCASE_MAX_IMAGE_BYTES // (1024 * 1024)}MB.")
    key = f"showcase/{claims['sub']}/{uuid.uuid4().hex}{ext}"
    url = upload_bytes(data=raw, key=key, content_type=mime)
    return {"url": url, "filename": name[:120], "size": size}


@router.post("/community/showcase/upload-video")
async def upload_showcase_video(
    file: UploadFile = File(...), claims: dict = Depends(current_any_user),
):
    """Maker-only video clip uploader for the showcase form. One clip per
    showcase post — the returned URL is stored in `ShowcasePost.video_url`.

    50 MB cap. Allowed: .mp4, .webm, .mov, .m4v. We don't transcode and we
    don't enforce duration server-side — the size cap is a hard backstop
    against multi-minute uploads. The client trims to 60s before upload
    when supported by the browser/media-recorder API."""
    if claims.get("role") != "maker":
        raise HTTPException(403, "Maker access required for video uploads.")
    from r2_storage import is_configured as r2_ok, upload_bytes
    if not r2_ok():
        raise HTTPException(503, "File uploads are not configured.")
    raw = await file.read()
    size = len(raw)
    mime = (file.content_type or "").lower()
    name = file.filename or "upload"
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext not in SHOWCASE_ALLOWED_VIDEO_EXT:
        raise HTTPException(400, f"Allowed formats: mp4, webm, mov, m4v — got '{name}'.")
    if mime and mime not in SHOWCASE_ALLOWED_VIDEO_MIME:
        if not mime.startswith("video/") and mime != "application/octet-stream":
            raise HTTPException(400, f"Video files only — got '{mime}'.")
    if size > SHOWCASE_MAX_VIDEO_BYTES:
        raise HTTPException(400, f"Clip must be ≤ {SHOWCASE_MAX_VIDEO_BYTES // (1024 * 1024)}MB.")
    served_mime = (
        mime if mime in SHOWCASE_ALLOWED_VIDEO_MIME
        else {"mp4": "video/mp4", "m4v": "video/x-m4v", "webm": "video/webm",
              "mov": "video/quicktime"}.get(ext.lstrip("."), "video/mp4")
    )
    key = f"showcase/videos/{claims['sub']}/{uuid.uuid4().hex}{ext}"
    url = upload_bytes(
        data=raw, key=key, content_type=served_mime,
        max_bytes=SHOWCASE_MAX_VIDEO_BYTES,
    )
    return {"url": url, "filename": name[:120], "size": size, "mime": served_mime}


# ===================== SHOWCASE — AI description help (iter114) =====================
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
SHOWCASE_AI_VISION_MAX_IMAGES = 3
SHOWCASE_AI_VISION_MAX_BYTES = 4 * 1024 * 1024


async def _fetch_image_for_vision(url: str) -> str | None:
    """Download an image URL → base64 string. Returns None on any failure
    (timeout, oversized, non-image content-type) so the caller can move
    on without aborting the whole request."""
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            r = await client.get(url)
            if r.status_code != 200:
                logger.info("[showcase_ai] image fetch %s → HTTP %s", url, r.status_code)
                return None
            ctype = (r.headers.get("content-type") or "").lower()
            if not ctype.startswith("image/"):
                logger.info("[showcase_ai] %s is not an image (%s)", url, ctype)
                return None
            blob = r.content
            if len(blob) > SHOWCASE_AI_VISION_MAX_BYTES:
                logger.info("[showcase_ai] %s skipped (%d B > cap)", url, len(blob))
                return None
            return base64.b64encode(blob).decode("ascii")
    except Exception as e:
        logger.info("[showcase_ai] image fetch failed for %s: %s", url, e)
        return None


async def _claude_vision_describe(*, system: str, user_text: str,
                                  image_b64s: list[str]) -> dict | None:
    """One-shot Claude call with optional image attachments. Returns the
    parsed JSON dict or None on any LLM error (caller fails open).
    Uses the playbook-confirmed full model id `claude-haiku-4-5-20251001`
    — the version that supports vision via the universal multimodal path."""
    if not EMERGENT_LLM_KEY:
        return None
    from emergentintegrations.llm.chat import (
        LlmChat, UserMessage, ImageContent,
    )
    from routers.ai_marketing import _parse_json
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"showcase-{uuid.uuid4().hex[:12]}",
        system_message=system,
    ).with_model("anthropic", "claude-haiku-4-5-20251001")
    msg_kwargs: dict = {"text": user_text[:4000]}
    if image_b64s:
        msg_kwargs["file_contents"] = [ImageContent(image_base64=b) for b in image_b64s]
    try:
        reply = await chat.send_message(UserMessage(**msg_kwargs))
    except Exception as e:
        logger.exception("[showcase_ai] LLM error: %s", e)
        return None
    return _parse_json(reply)


class _ShowcaseAiBody(BaseModel):
    title: str
    image_urls: List[str] = []
    product_slug: Optional[str] = None
    maker_slug: Optional[str] = None


@router.post("/community/showcase/ai-describe")
async def ai_describe_showcase(body: _ShowcaseAiBody, claims: dict = Depends(current_buyer)):
    """Generate a punchy 2-3 sentence showcase description from the title,
    optional product/maker context, AND the actual photos the buyer
    just uploaded. Fail-open: returns `{description: ""}` on any LLM
    error so the UI can fall back to manual entry without a broken state.
    """
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "Title is required to generate a description.")

    context_lines: list[str] = []
    if body.product_slug:
        p = await db.products.find_one(
            {"slug": body.product_slug},
            {"_id": 0, "title": 1, "category": 1, "description": 1, "maker_name": 1},
        )
        if p:
            context_lines.append(f"Tagged product: {p.get('title','')} "
                                 f"(category: {p.get('category','')}, "
                                 f"maker: {p.get('maker_name','')})")
            if p.get("description"):
                context_lines.append(f"Product description: {p['description'][:400]}")
    if body.maker_slug and not body.product_slug:
        m = await db.makers.find_one(
            {"slug": body.maker_slug},
            {"_id": 0, "name": 1, "tagline": 1, "bio": 1},
        )
        if m:
            context_lines.append(f"Tagged maker: {m.get('name','')} — {m.get('tagline','') or m.get('bio','')[:200]}")

    import asyncio as _asyncio
    image_b64s: list[str] = []
    if body.image_urls:
        results = await _asyncio.gather(
            *[_fetch_image_for_vision(u) for u in body.image_urls[:SHOWCASE_AI_VISION_MAX_IMAGES]],
            return_exceptions=False,
        )
        image_b64s = [r for r in results if r]
        if image_b64s:
            context_lines.append(
                f"Buyer attached {len(body.image_urls)} photo(s); "
                f"the {len(image_b64s)} highest-priority are shown below."
            )

    user_msg = (
        f"Title: {title}\n"
        + ("\n".join(context_lines) if context_lines else "(No additional context provided.)")
        + (
            "\n\nLook carefully at the photos and describe what stands out — "
            "the actual cuts, colors, mounting, lighting, materials. "
            if image_b64s else
            "\n\nWrite a description from the title and context alone "
            "(no photos were attached)."
        )
        + " Write a 2-3 sentence first-person description: where the piece "
          "lives in the buyer's space, what catches the eye, why they love "
          "it. Conversational, not salesy. "
          'Return ONLY a JSON object: {"description": "..."}.'
    )
    system_msg = (
        "You are a concise copywriter helping buyers post about a "
        "hand-built CNC art / wood / metal piece they bought on Crafters Market. "
        "When images are attached, describe what you actually see — concrete "
        "details ground the post and make it feel real. "
        'Respond ONLY with valid JSON: {"description": "..."}. '
        "Keep the description 2-3 sentences, under 280 characters, "
        "warm and authentic, no marketing fluff."
    )
    parsed = await _claude_vision_describe(
        system=system_msg, user_text=user_msg, image_b64s=image_b64s,
    )
    desc = ((parsed or {}).get("description") or "").strip()
    return {
        "description": desc,
        "vision_used": len(image_b64s) > 0,
        "images_seen": len(image_b64s),
    }
