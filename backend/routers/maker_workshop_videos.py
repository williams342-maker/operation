"""Maker workshop videos (iter186).

Accepts YouTube and Vimeo URLs from the maker, extracts provider + video
ID, and stores up to 6 embeds on `db.makers.<slug>.workshop_videos`.
Public maker profile renders them above "From the workshop" section.

Why URL embeds instead of direct upload:
  * Zero bandwidth + storage cost for us
  * Makers keep ownership on their own YouTube channel (SEO benefit
    for them too)
  * No transcoding pain — YouTube/Vimeo already serve responsive,
    mobile-friendly playback

Supported URL shapes:
  * https://www.youtube.com/watch?v=<id>[&...]
  * https://youtu.be/<id>[?...]
  * https://www.youtube.com/shorts/<id>
  * https://www.youtube.com/embed/<id>
  * https://vimeo.com/<id>
  * https://player.vimeo.com/video/<id>
"""
from __future__ import annotations

import re
import uuid
from typing import Optional
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_maker_slug

router = APIRouter()

MAX_VIDEOS_PER_MAKER = 6


# ───── URL parsing ────────────────────────────────────────────────────────

_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,15}$")
_VIMEO_ID_RE = re.compile(r"^\d{6,12}$")


def parse_video_url(raw: str) -> Optional[dict]:
    """Returns `{provider, video_id, embed_url, thumbnail}` or None when
    the URL isn't a recognized YouTube/Vimeo shape."""
    if not raw:
        return None
    url = raw.strip()
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    try:
        u = urlparse(url)
    except Exception:
        return None
    host = (u.netloc or "").lower().lstrip("www.")

    # YouTube — multiple shapes
    if host in ("youtube.com", "m.youtube.com", "music.youtube.com"):
        qs = parse_qs(u.query)
        vid = (qs.get("v") or [None])[0]
        if not vid:
            # /shorts/<id> or /embed/<id>
            parts = [p for p in u.path.split("/") if p]
            if len(parts) >= 2 and parts[0] in ("shorts", "embed", "v", "live"):
                vid = parts[1]
        if vid and _YOUTUBE_ID_RE.match(vid):
            return {
                "provider": "youtube",
                "video_id": vid,
                "embed_url": f"https://www.youtube.com/embed/{vid}",
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            }
        return None
    if host == "youtu.be":
        vid = (u.path or "").strip("/").split("/")[0]
        if vid and _YOUTUBE_ID_RE.match(vid):
            return {
                "provider": "youtube",
                "video_id": vid,
                "embed_url": f"https://www.youtube.com/embed/{vid}",
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            }
        return None

    # Vimeo
    if host in ("vimeo.com", "player.vimeo.com"):
        parts = [p for p in u.path.split("/") if p]
        # `/123456789` or `/video/123456789`
        vid = parts[-1] if parts else ""
        if _VIMEO_ID_RE.match(vid):
            return {
                "provider": "vimeo",
                "video_id": vid,
                "embed_url": f"https://player.vimeo.com/video/{vid}",
                "thumbnail": None,   # Vimeo thumbnails need an API hop — skip
            }
        return None

    return None


# ───── Request models ─────────────────────────────────────────────────────

class _AddVideo(BaseModel):
    url: str = Field(..., min_length=8, max_length=400)
    title: Optional[str] = Field(default=None, max_length=120)


class _ReorderVideos(BaseModel):
    """Frontend sends the new order as a list of video_id strings.
    Any IDs not in the list are dropped from the persisted order — the
    UI is expected to send the full set."""
    video_ids: list[str]


# ───── Endpoints ──────────────────────────────────────────────────────────

@router.get("/maker/workshop-videos")
async def list_workshop_videos(slug: str = Depends(current_maker_slug)):
    """Return the signed-in maker's videos in display order."""
    m = await db.makers.find_one({"slug": slug},
                                 {"_id": 0, "workshop_videos": 1}) or {}
    return {"items": m.get("workshop_videos") or [],
            "max": MAX_VIDEOS_PER_MAKER}


@router.post("/maker/workshop-videos")
async def add_workshop_video(
    payload: _AddVideo = Body(...),
    slug: str = Depends(current_maker_slug),
):
    """Append a new video. Rejects on cap, duplicate, or unparseable URL."""
    parsed = parse_video_url(payload.url)
    if not parsed:
        raise HTTPException(
            422,
            "URL not recognized. Paste a YouTube watch link "
            "(`youtube.com/watch?v=…` or `youtu.be/…`) or a Vimeo link "
            "(`vimeo.com/…`).",
        )
    m = await db.makers.find_one({"slug": slug},
                                 {"_id": 0, "workshop_videos": 1})
    if not m:
        raise HTTPException(404, "Maker not found.")
    existing = m.get("workshop_videos") or []
    if len(existing) >= MAX_VIDEOS_PER_MAKER:
        raise HTTPException(
            409,
            f"You've hit the {MAX_VIDEOS_PER_MAKER}-video cap. "
            "Remove an older one first.",
        )
    if any(v.get("video_id") == parsed["video_id"] and
           v.get("provider") == parsed["provider"] for v in existing):
        raise HTTPException(409, "You've already added this video.")

    row = {
        "id": str(uuid.uuid4()),
        "url": payload.url.strip(),
        "title": (payload.title or "").strip()[:120] or None,
        "provider": parsed["provider"],
        "video_id": parsed["video_id"],
        "embed_url": parsed["embed_url"],
        "thumbnail": parsed.get("thumbnail"),
        "added_at": now_iso(),
    }
    await db.makers.update_one(
        {"slug": slug},
        {"$push": {"workshop_videos": row}},
    )
    logger.info("[workshop_video] %s added %s/%s", slug,
                parsed["provider"], parsed["video_id"])
    return {"ok": True, "video": row,
            "count": len(existing) + 1,
            "max": MAX_VIDEOS_PER_MAKER}


@router.delete("/maker/workshop-videos/{video_row_id}")
async def remove_workshop_video(
    video_row_id: str,
    slug: str = Depends(current_maker_slug),
):
    """Remove a video by its row `id` (not the provider video_id —
    multiple rows could theoretically point at the same video_id if we
    relax the dedupe later)."""
    res = await db.makers.update_one(
        {"slug": slug},
        {"$pull": {"workshop_videos": {"id": video_row_id}}},
    )
    if res.modified_count == 0:
        raise HTTPException(404, "Video not found.")
    return {"ok": True, "removed": video_row_id}


@router.patch("/maker/workshop-videos/reorder")
async def reorder_workshop_videos(
    payload: _ReorderVideos = Body(...),
    slug: str = Depends(current_maker_slug),
):
    """Reorder videos. Frontend sends the full desired sequence of row IDs;
    any rows whose IDs aren't in the list keep their existing relative
    position at the end (defensive — we never delete via reorder)."""
    m = await db.makers.find_one({"slug": slug},
                                 {"_id": 0, "workshop_videos": 1}) or {}
    existing = m.get("workshop_videos") or []
    by_id = {v["id"]: v for v in existing if v.get("id")}
    reordered: list[dict] = []
    seen: set[str] = set()
    for vid in payload.video_ids:
        if vid in by_id and vid not in seen:
            reordered.append(by_id[vid])
            seen.add(vid)
    # Append any rows missing from the request (defensive — keeps data).
    for v in existing:
        if v.get("id") not in seen:
            reordered.append(v)
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"workshop_videos": reordered}},
    )
    return {"ok": True, "items": reordered}
