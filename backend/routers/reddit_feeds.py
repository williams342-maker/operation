"""Reddit subreddit feeds — read-only aggregation pinned to the Forum.

Reddit shut down anonymous server-side .json access in 2024 — every public
subreddit listing now requires an OAuth2 bearer token even though we only
read public content. Setup (free, 60 req/min):
  1. Visit https://www.reddit.com/prefs/apps → "create another app"
  2. Type: "script" · about_url: https://craftersmarket.org · redirect: anything
  3. Set in /app/backend/.env:
       REDDIT_CLIENT_ID=<14-char string under the app name>
       REDDIT_CLIENT_SECRET=<27-char "secret" field>
  4. Restart backend. The aggregator activates automatically.

Until the keys are set, every fetch returns an empty list AND the public
status endpoint reports `configured: false` so the UI can show a "coming
soon" placeholder instead of a broken feed. No crashes, no log spam.

Endpoints:
- `GET  /api/community/reddit`                 — public aggregated feed
- `GET  /api/community/reddit/status`          — UI gate (configured / cache age)
- `GET  /api/community/reddit/subreddits`      — public sub list
- `GET  /api/admin/reddit/subreddits`          — admin list
- `POST /api/admin/reddit/subreddits` {name}   — add (no leading "r/")
- `DELETE /api/admin/reddit/subreddits/{name}` — remove
- `POST /api/admin/reddit/refresh`             — bust the cache
"""
from __future__ import annotations

import asyncio
import os
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

# Reddit's slug constraint: 3-21 chars, [a-zA-Z0-9_].
_SUB_RE = re.compile(r"^[A-Za-z0-9_]{3,21}$")

# In-process caches.
_cache: dict = {}                 # (sub, sort) → (timestamp, posts list)
_cache_lock = asyncio.Lock()
_token_state: dict = {"token": None, "expires_at": 0.0}
_token_lock = asyncio.Lock()


def _credentials_present() -> bool:
    return bool(os.environ.get("REDDIT_CLIENT_ID")) and bool(os.environ.get("REDDIT_CLIENT_SECRET"))


# ---------------- Mongo helpers ----------------
async def _get_subreddits() -> List[str]:
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


# ---------------- OAuth2 (client credentials) ----------------
async def _get_bearer_token() -> Optional[str]:
    """Return a cached bearer token, refreshing 5 min before expiry. Returns
    None when REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are not configured."""
    if not _credentials_present():
        return None
    now = time.time()
    async with _token_lock:
        if _token_state["token"] and now < (_token_state["expires_at"] - 300):
            return _token_state["token"]
        try:
            async with httpx.AsyncClient(
                timeout=10.0, headers={"User-Agent": USER_AGENT},
            ) as client:
                r = await client.post(
                    "https://www.reddit.com/api/v1/access_token",
                    auth=(os.environ["REDDIT_CLIENT_ID"], os.environ["REDDIT_CLIENT_SECRET"]),
                    data={"grant_type": "client_credentials"},
                )
            if r.status_code != 200:
                logger.warning("[reddit] token endpoint → HTTP %s · %s", r.status_code, r.text[:200])
                return None
            j = r.json()
            _token_state["token"] = j["access_token"]
            _token_state["expires_at"] = now + int(j.get("expires_in") or 3600)
            return _token_state["token"]
        except Exception as e:
            logger.warning("[reddit] token acquisition failed: %s", e)
            return None


# ---------------- Reddit fetch ----------------
def _normalise(item: dict, sub: str) -> Optional[dict]:
    d = item.get("data") or {}
    if d.get("over_18") or d.get("hidden") or d.get("removed_by_category"):
        return None
    title = (d.get("title") or "").strip()
    if not title:
        return None
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
    """Hit oauth.reddit.com once for a (sub, sort) tuple. Cached 15 min.
    Silently returns [] (or last-good cache) when credentials are missing
    or Reddit returns an error."""
    sort = sort if sort in ALLOWED_SORTS else DEFAULT_SORT
    cache_key = (sub, sort)
    now = time.time()
    async with _cache_lock:
        cached = _cache.get(cache_key)
        if cached and (now - cached[0]) < CACHE_TTL_SECONDS:
            return cached[1]

    token = await _get_bearer_token()
    if not token:
        # No credentials yet — return whatever stale cache we have, else empty.
        return cached[1] if cached else []

    url = f"https://oauth.reddit.com/r/{sub}/{sort}"
    params = {"limit": PER_SUB_LIMIT}
    if sort == "top":
        params["t"] = "week"
    try:
        async with httpx.AsyncClient(
            timeout=8.0,
            headers={
                "User-Agent": USER_AGENT,
                "Authorization": f"bearer {token}",
                "Accept": "application/json",
            },
            follow_redirects=True,
        ) as client:
            r = await client.get(url, params=params)
        if r.status_code == 401:
            # Token rejected — invalidate and try once more.
            async with _token_lock:
                _token_state["token"] = None
                _token_state["expires_at"] = 0.0
            token = await _get_bearer_token()
            if token:
                async with httpx.AsyncClient(
                    timeout=8.0,
                    headers={"User-Agent": USER_AGENT,
                             "Authorization": f"bearer {token}",
                             "Accept": "application/json"},
                    follow_redirects=True,
                ) as client:
                    r = await client.get(url, params=params)
        if r.status_code != 200:
            logger.warning("[reddit] %s/%s → HTTP %s", sub, sort, r.status_code)
            return cached[1] if cached else []
        body = r.json()
        children = (body.get("data") or {}).get("children") or []
        posts = [p for p in (_normalise(c, sub) for c in children) if p]
    except Exception as e:
        logger.warning("[reddit] %s/%s fetch failed: %s", sub, sort, e)
        return cached[1] if cached else []

    async with _cache_lock:
        _cache[cache_key] = (now, posts)
    return posts


# ---------------- Public endpoints ----------------
@router.get("/community/reddit/status")
async def feed_status():
    """Lets the UI tell the difference between 'no credentials yet' and
    'credentials present but Reddit is hiccuping'. The frontend uses this
    to decide between rendering a 'coming soon' placeholder vs an empty
    state."""
    return {
        "configured": _credentials_present(),
        "subreddits": await _get_subreddits(),
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
    }


@router.get("/community/reddit/subreddits")
async def list_subreddits_public():
    return {"subreddits": await _get_subreddits()}


@router.get("/community/reddit")
async def aggregated_feed(
    sort: str = DEFAULT_SORT,
    subreddit: Optional[str] = None,
    limit: int = 60,
):
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
    return {
        "posts": merged[:limit],
        "sort": sort,
        "subreddits": subs,
        "configured": _credentials_present(),
    }


# ---------------- Admin endpoints ----------------
class AddSubreddit(BaseModel):
    name: str = Field(min_length=3, max_length=21)


@router.get("/admin/reddit/subreddits")
async def admin_list(_: dict = Depends(current_admin)):
    return {
        "subreddits": await _get_subreddits(),
        "defaults": DEFAULT_SUBREDDITS,
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "configured": _credentials_present(),
    }


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
    async with _cache_lock:
        for k in list(_cache.keys()):
            if k[0].lower() == name.lower():
                _cache.pop(k, None)
    return {"ok": True, "subreddits": new_subs}


@router.post("/admin/reddit/refresh")
async def admin_refresh_cache(_: dict = Depends(current_admin)):
    async with _cache_lock:
        _cache.clear()
    return {"ok": True, "cache": "cleared"}

