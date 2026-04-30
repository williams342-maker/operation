"""Reddit subreddit feeds — read-only aggregation pinned to the Forum.

Why public JSON, not OAuth?
- Reddit's anonymous `https://www.reddit.com/r/<sub>/<sort>.json` endpoints
  serve up to ~60 req/min per IP. We cache aggressively (15 min) per
  subreddit/sort tuple, so a busy forum tab never breaches that budget.
- A custom User-Agent is the ONLY hard requirement. Reddit blocks anonymous
  requests with empty / browser-like UAs.
- Admin can add/remove subreddits live without redeploys.

Endpoints:
- `GET /api/community/reddit`                     — public aggregated feed
- `GET /api/community/reddit/subreddits`          — public list (so the UI
   can show a sub-filter chip strip)
- `GET /api/admin/reddit/subreddits`              — admin list
- `POST /api/admin/reddit/subreddits` {name}      — add (no leading "r/")
- `DELETE /api/admin/reddit/subreddits/{name}`    — remove
- `POST /api/admin/reddit/refresh`                — bust the cache
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Optional, List

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_admin


router = APIRouter()

# ---------------- Defaults ----------------
DEFAULT_SUBREDDITS: List[str] = [
    "forhire",
    "CNC",
    "woodworking",
    "metalfabrication",
    "3Dprinting",
]

ALLOWED_SORTS = {"hot", "new", "top"}
DEFAULT_SORT = "hot"
CACHE_TTL_SECONDS = 15 * 60   # 15 minutes per (sub, sort)
PER_SUB_LIMIT = 12            # posts per sub on a single fetch
USER_AGENT = "web:craftersmarket.org:v1.0 (forum-aggregator)"

# Subreddit slug — Reddit's own constraint: 3-21 chars, [a-zA-Z0-9_].
_SUB_RE = re.compile(r"^[A-Za-z0-9_]{3,21}$")

# In-process cache (sub, sort) → (timestamp, posts list)
_cache: dict = {}
_cache_lock = asyncio.Lock()


# ---------------- Mongo helpers ----------------
async def _get_subreddits() -> List[str]:
    """Return the admin-configured subreddit list. Seeds from DEFAULT
    list on first run so the feature works out of the box."""
    doc = await db.reddit_config.find_one({"_id": "global"}, {"_id": 0})
    if not doc:
        await db.reddit_config.insert_one(
            {"_id": "global", "subreddits": DEFAULT_SUBREDDITS.copy(),
             "updated_at": now_iso()},
        )
        return DEFAULT_SUBREDDITS.copy()
    subs = doc.get("subreddits") or DEFAULT_SUBREDDITS
    return [s for s in subs if isinstance(s, str) and _SUB_RE.match(s)]


async def _set_subreddits(subs: List[str]) -> None:
    await db.reddit_config.update_one(
        {"_id": "global"},
        {"$set": {"subreddits": subs, "updated_at": now_iso()}},
        upsert=True,
    )


# ---------------- Reddit fetch ----------------
def _normalise(item: dict, sub: str) -> Optional[dict]:
    """Pluck only the fields we render — avoids bloating mongo / network
    when the cache spills onto the wire."""
    d = item.get("data") or {}
    if d.get("over_18") or d.get("hidden") or d.get("removed_by_category"):
        return None
    title = (d.get("title") or "").strip()
    if not title:
        return None
    # Only keep image-y previews — Reddit serves HTML-encoded URLs.
    thumb = d.get("thumbnail")
    if thumb in {"self", "default", "nsfw", "spoiler", "image", ""} or not thumb:
        thumb = None
    elif not thumb.startswith("http"):
        thumb = None
    return {
        "id": d.get("id"),
        "subreddit": sub,
        "title": title[:240],
        "author": d.get("author"),
        "url": "https://www.reddit.com" + (d.get("permalink") or ""),
        "external_url": d.get("url_overridden_by_dest"),
        "thumbnail": thumb,
        "selftext": (d.get("selftext") or "")[:400],
        "score": int(d.get("score") or 0),
        "num_comments": int(d.get("num_comments") or 0),
        "created_utc": int(d.get("created_utc") or 0),
        "flair": d.get("link_flair_text") or None,
    }


async def _fetch_subreddit(sub: str, sort: str) -> List[dict]:
    """Hit reddit.com once for a (sub, sort) tuple. Cached 15 min."""
    sort = sort if sort in ALLOWED_SORTS else DEFAULT_SORT
    cache_key = (sub, sort)
    now = time.time()
    async with _cache_lock:
        cached = _cache.get(cache_key)
        if cached and (now - cached[0]) < CACHE_TTL_SECONDS:
            return cached[1]

    url = f"https://www.reddit.com/r/{sub}/{sort}.json"
    params = {"limit": PER_SUB_LIMIT}
    if sort == "top":
        params["t"] = "week"
    try:
        async with httpx.AsyncClient(
            timeout=8.0,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            follow_redirects=True,
        ) as client:
            r = await client.get(url, params=params)
        if r.status_code != 200:
            logger.warning("[reddit] %s/%s → HTTP %s", sub, sort, r.status_code)
            # Stale cache > broken UI: serve last good if present.
            if cached:
                return cached[1]
            return []
        body = r.json()
        children = (body.get("data") or {}).get("children") or []
        posts = [p for p in (_normalise(c, sub) for c in children) if p]
    except Exception as e:
        logger.warning("[reddit] %s/%s fetch failed: %s", sub, sort, e)
        if cached:
            return cached[1]
        return []

    async with _cache_lock:
        _cache[cache_key] = (now, posts)
    return posts


# ---------------- Public endpoints ----------------
@router.get("/community/reddit/subreddits")
async def list_subreddits_public():
    return {"subreddits": await _get_subreddits()}


@router.get("/community/reddit")
async def aggregated_feed(
    sort: str = DEFAULT_SORT,
    subreddit: Optional[str] = None,
    limit: int = 60,
):
    """Pulls every configured sub (or just one if `subreddit` is provided),
    sorts by score desc, and returns up to `limit` rows. The UI's filter
    chips toggle the `subreddit` query param."""
    if sort not in ALLOWED_SORTS:
        sort = DEFAULT_SORT
    limit = max(1, min(200, int(limit)))

    subs = await _get_subreddits()
    if subreddit:
        if subreddit not in subs:
            raise HTTPException(404, "Subreddit not configured.")
        subs = [subreddit]

    results = await asyncio.gather(*[_fetch_subreddit(s, sort) for s in subs])
    merged: List[dict] = [p for chunk in results for p in chunk]
    if sort == "new":
        merged.sort(key=lambda p: p.get("created_utc", 0), reverse=True)
    else:
        merged.sort(key=lambda p: p.get("score", 0), reverse=True)
    return {"posts": merged[:limit], "sort": sort, "subreddits": subs}


# ---------------- Admin endpoints ----------------
class AddSubreddit(BaseModel):
    name: str = Field(min_length=3, max_length=21)


@router.get("/admin/reddit/subreddits")
async def admin_list(_: dict = Depends(current_admin)):
    return {"subreddits": await _get_subreddits(),
            "defaults": DEFAULT_SUBREDDITS,
            "cache_ttl_seconds": CACHE_TTL_SECONDS}


@router.post("/admin/reddit/subreddits")
async def admin_add(body: AddSubreddit, _: dict = Depends(current_admin)):
    name = body.name.strip().lstrip("/").removeprefix("r/")
    if not _SUB_RE.match(name):
        raise HTTPException(400, "Invalid subreddit name (3-21 letters, digits, or _).")
    subs = await _get_subreddits()
    if any(s.lower() == name.lower() for s in subs):
        raise HTTPException(400, f"r/{name} is already in the list.")
    subs.append(name)
    await _set_subreddits(subs)
    return {"ok": True, "subreddits": subs}


@router.delete("/admin/reddit/subreddits/{name}")
async def admin_remove(name: str, _: dict = Depends(current_admin)):
    subs = await _get_subreddits()
    new_subs = [s for s in subs if s.lower() != name.lower()]
    if len(new_subs) == len(subs):
        raise HTTPException(404, f"r/{name} not found.")
    await _set_subreddits(new_subs)
    # Drop cached entries for the removed sub so its posts disappear immediately.
    async with _cache_lock:
        for k in list(_cache.keys()):
            if k[0].lower() == name.lower():
                _cache.pop(k, None)
    return {"ok": True, "subreddits": new_subs}


@router.post("/admin/reddit/refresh")
async def admin_refresh_cache(_: dict = Depends(current_admin)):
    """Manual cache bust — useful right after publishing a brand or sale
    push to a relevant sub and wanting to see it in the forum immediately."""
    async with _cache_lock:
        _cache.clear()
    return {"ok": True, "cache": "cleared"}
