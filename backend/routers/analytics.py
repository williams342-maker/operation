"""Web analytics — privacy-respecting pageview tracking.

Privacy posture (locked at iter11):
  • IPv4 last octet truncated, IPv6 truncated to /48 — never store full IP.
  • Geo lookup via ipapi.co with permanent in-Mongo cache (one lookup per IP).
  • Bot filter via UA pattern.
  • Sessions defined by 30-min inactivity gap (frontend mints session_id; we
    just count distinct values).
"""
import ipaddress
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_admin

router = APIRouter()

BOT_RE = re.compile(
    r"bot|crawler|spider|crawling|slurp|googlebot|bingbot|yahoo|duckduck|baidu|yandex|"
    r"facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|preview|monitor|headless",
    re.I,
)

SOCIAL_HOSTS = (
    "facebook.com", "fb.com", "twitter.com", "x.com", "instagram.com",
    "linkedin.com", "reddit.com", "pinterest.com", "pinterest.de",
    "youtube.com", "youtu.be", "tiktok.com", "threads.net",
)
SEARCH_HOSTS = (
    "google.", "bing.com", "duckduckgo.com", "yahoo.com", "baidu.com",
    "yandex.", "ecosia.org", "qwant.com", "brave.com",
)


def _anon_ip(ip: str) -> str:
    """Drop precision to comply with our locked privacy default (option b)."""
    try:
        a = ipaddress.ip_address(ip)
    except (ValueError, TypeError):
        return ""
    if a.version == 4:
        parts = ip.split(".")
        if len(parts) == 4:
            return ".".join(parts[:3] + ["0"])
        return ""
    # IPv6 → keep /48
    full = int(a)
    masked = full & ((1 << 128) - (1 << 80))
    return str(ipaddress.ip_address(masked)) + "/48"


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


def _parse_device(ua: str) -> str:
    if not ua:
        return "unknown"
    u = ua.lower()
    # Tablets first (iPad, "Android" without "Mobile")
    if "ipad" in u or "tablet" in u:
        return "tablet"
    if "android" in u and "mobile" not in u:
        return "tablet"
    if any(k in u for k in ("mobi", "iphone", "blackberry", "iemobile", "opera mini")):
        return "mobile"
    if "android" in u and "mobile" in u:
        return "mobile"
    return "desktop"


def _parse_browser(ua: str) -> str:
    if not ua:
        return "Unknown"
    if "Edg/" in ua:
        return "Edge"
    if "OPR/" in ua or "Opera" in ua:
        return "Opera"
    if "Firefox/" in ua:
        return "Firefox"
    if "Chrome/" in ua and "Safari/" in ua:
        return "Chrome"
    if "Safari/" in ua:
        return "Safari"
    return "Other"


def _classify_referer(referer: str, our_host: str) -> dict:
    if not referer:
        return {"source": "Direct", "medium": "direct"}
    try:
        p = urlparse(referer)
        host = (p.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
    except Exception:
        return {"source": "Direct", "medium": "direct"}
    if not host:
        return {"source": "Direct", "medium": "direct"}
    our = (our_host or "").lower().replace("www.", "")
    if host == our:
        return {"source": our, "medium": "internal"}
    if any(s in host for s in SEARCH_HOSTS):
        return {"source": host, "medium": "organic"}
    if any(host.endswith(s) or host == s for s in SOCIAL_HOSTS):
        return {"source": host, "medium": "social"}
    return {"source": host, "medium": "referral"}


async def _geo_lookup(ip: str) -> dict:
    """Return {country, city} for the given IP. Cached forever in Mongo."""
    if not ip:
        return {}
    try:
        a = ipaddress.ip_address(ip)
        if a.is_private or a.is_loopback or a.is_reserved or a.is_link_local or a.is_multicast:
            return {}
    except (ValueError, TypeError):
        return {}
    cached = await db.ip_geo_cache.find_one({"ip": ip}, {"_id": 0})
    if cached:
        return {"country": cached.get("country", ""), "city": cached.get("city", "")}
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"https://ipapi.co/{ip}/json/")
        if r.status_code == 200:
            j = r.json() or {}
            country = j.get("country_name") or j.get("country") or ""
            city = j.get("city") or ""
            await db.ip_geo_cache.update_one(
                {"ip": ip},
                {"$set": {"ip": ip, "country": country, "city": city,
                          "looked_up_at": now_iso()}},
                upsert=True,
            )
            return {"country": country, "city": city}
    except Exception as e:
        logger.warning("geo lookup failed for %s: %s", ip, e)
    return {}


# ------------------------- Public ingest --------------------------------

class TrackRequest(BaseModel):
    path: str
    referer: str = ""
    visitor_id: str
    session_id: str
    title: str = ""


@router.post("/analytics/track")
async def track(req: TrackRequest, request: Request):
    ua = request.headers.get("user-agent", "")
    if BOT_RE.search(ua):
        return {"ok": True, "skipped": "bot"}
    if not req.visitor_id or not req.session_id:
        return {"ok": False, "skipped": "missing-ids"}

    ip = _client_ip(request)
    anon = _anon_ip(ip)
    host = (request.headers.get("host") or "").split(":")[0]
    geo = await _geo_lookup(ip)

    event = {
        "ts": now_iso(),
        "path": (req.path or "/")[:300],
        "title": (req.title or "")[:300],
        "visitor_id": req.visitor_id[:64],
        "session_id": req.session_id[:64],
        "ip_anon": anon,
        "device": _parse_device(ua),
        "browser": _parse_browser(ua),
        "referer": (req.referer or "")[:500],
        "country": geo.get("country", ""),
        "city": geo.get("city", ""),
    }
    event.update(_classify_referer(req.referer, host))
    await db.pageview_events.insert_one(event)
    return {"ok": True}


# ------------------------- Admin aggregation ----------------------------

async def _top(field: str, since_iso: str, limit: int = 10,
               extra_match: dict | None = None) -> list[dict]:
    match = {"ts": {"$gte": since_iso}}
    if extra_match:
        match.update(extra_match)
    pipe = [
        {"$match": match},
        {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": limit},
    ]
    rows = await db.pageview_events.aggregate(pipe).to_list(limit)
    out = []
    for r in rows:
        key = r.get("_id")
        if not key:
            continue
        out.append({"key": str(key), "count": int(r.get("count", 0))})
    return out


@router.get("/admin/analytics/web")
async def admin_web_analytics(_: dict = Depends(current_admin)):
    now = datetime.now(timezone.utc)
    cutoff_30 = (now - timedelta(days=30)).isoformat()
    cutoff_7 = (now - timedelta(days=7)).isoformat()

    # Totals (last 30 days)
    pipe = [
        {"$match": {"ts": {"$gte": cutoff_30}}},
        {"$group": {
            "_id": None,
            "total_views": {"$sum": 1},
            "visitors": {"$addToSet": "$visitor_id"},
            "sessions": {"$addToSet": "$session_id"},
        }},
        {"$project": {
            "_id": 0,
            "total_views": 1,
            "unique_visitors": {"$size": "$visitors"},
            "sessions_count": {"$size": "$sessions"},
        }},
    ]
    rows = await db.pageview_events.aggregate(pipe).to_list(1)
    if rows:
        s = rows[0]
        total_views = int(s.get("total_views", 0))
        unique_visitors = int(s.get("unique_visitors", 0))
        sessions = int(s.get("sessions_count", 0))
    else:
        total_views = unique_visitors = sessions = 0

    views_7d = await db.pageview_events.count_documents({"ts": {"$gte": cutoff_7}})

    return {
        "window_days": 30,
        "total_views": total_views,
        "unique_visitors": unique_visitors,
        "sessions": sessions,
        "views_7d": views_7d,
        "top_pages": await _top("path", cutoff_30, 10),
        "devices": await _top("device", cutoff_30, 5),
        "top_countries": await _top("country", cutoff_30, 10),
        "top_cities": await _top("city", cutoff_30, 10),
        "traffic_sources": await _top("medium", cutoff_30, 5),
        "top_referrers": await _top("source", cutoff_30, 10,
                                    extra_match={"medium": {"$nin": ["direct", "internal"]}}),
    }
