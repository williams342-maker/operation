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
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_admin
from routers.seo import SEO_LANDING_PATHS, SEO_LANDING_SLUGS

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
        "id": str(uuid.uuid4()),
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
        "dwell_ms": 0,
    }
    event.update(_classify_referer(req.referer, host))
    await db.pageview_events.insert_one(event)
    return {"ok": True, "event_id": event["id"]}


# --------------- Time-on-page (dwell) update --------------------------

class DwellRequest(BaseModel):
    event_id: str
    dwell_ms: int


@router.post("/analytics/dwell")
async def dwell(req: DwellRequest):
    """Record how long the visitor stayed on a page. Called from
    visibilitychange (hidden) + beforeunload via navigator.sendBeacon."""
    if not req.event_id or req.dwell_ms <= 0:
        return {"ok": False}
    # Cap at 30 min to absorb forgotten tabs.
    capped = min(int(req.dwell_ms), 30 * 60 * 1000)
    await db.pageview_events.update_one(
        {"id": req.event_id},
        {"$max": {"dwell_ms": capped}},
    )
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


async def _top_pages_with_dwell(since_iso: str, limit: int = 10) -> list[dict]:
    """Top pages + avg time-on-page (seconds)."""
    pipe = [
        {"$match": {"ts": {"$gte": since_iso}}},
        {"$group": {
            "_id": "$path",
            "count": {"$sum": 1},
            "avg_dwell_ms": {"$avg": "$dwell_ms"},
        }},
        {"$sort": {"count": -1}},
        {"$limit": limit},
    ]
    rows = await db.pageview_events.aggregate(pipe).to_list(limit)
    out = []
    for r in rows:
        if not r.get("_id"):
            continue
        avg_ms = r.get("avg_dwell_ms") or 0
        out.append({
            "key": str(r["_id"]),
            "count": int(r.get("count", 0)),
            "avg_dwell_s": round(float(avg_ms) / 1000.0, 1),
        })
    return out


@router.get("/admin/analytics/web")
async def admin_web_analytics(_: dict = Depends(current_admin)):
    now = datetime.now(timezone.utc)
    cutoff_30 = (now - timedelta(days=30)).isoformat()
    cutoff_7 = (now - timedelta(days=7)).isoformat()
    cutoff_14 = (now - timedelta(days=14)).isoformat()

    # ---------- Bounce rate (sessions with exactly 1 pageview, last 30d) -----
    # Aggregate per-session view counts so we can derive both bounce_rate and
    # avg pages-per-session in a single round-trip.
    bounce_pipe = [
        {"$match": {"ts": {"$gte": cutoff_30}}},
        {"$group": {"_id": "$session_id", "views": {"$sum": 1}}},
        {"$group": {
            "_id": None,
            "sessions": {"$sum": 1},
            "bounces": {"$sum": {"$cond": [{"$eq": ["$views", 1]}, 1, 0]}},
            "total_views": {"$sum": "$views"},
        }},
        {"$project": {"_id": 0, "sessions": 1, "bounces": 1, "total_views": 1}},
    ]
    br = await db.pageview_events.aggregate(bounce_pipe).to_list(1)
    if br:
        sess = int(br[0]["sessions"])
        bounces = int(br[0]["bounces"])
        bounce_rate_pct = round(bounces * 100.0 / sess, 1) if sess else 0.0
        pages_per_session = round(br[0]["total_views"] / sess, 2) if sess else 0.0
    else:
        bounces = 0
        bounce_rate_pct = 0.0
        pages_per_session = 0.0

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

    # 7-day vs prior-7-day deltas
    async def _window_metrics(start_iso: str, end_iso: str | None) -> dict:
        match = {"ts": {"$gte": start_iso}}
        if end_iso:
            match["ts"]["$lt"] = end_iso
        p = [
            {"$match": match},
            {"$group": {
                "_id": None,
                "views": {"$sum": 1},
                "visitors": {"$addToSet": "$visitor_id"},
                "sessions": {"$addToSet": "$session_id"},
            }},
            {"$project": {"_id": 0, "views": 1,
                          "visitors_n": {"$size": "$visitors"},
                          "sessions_n": {"$size": "$sessions"}}},
        ]
        r = await db.pageview_events.aggregate(p).to_list(1)
        if r:
            return {"views": int(r[0]["views"]),
                    "visitors": int(r[0]["visitors_n"]),
                    "sessions": int(r[0]["sessions_n"])}
        return {"views": 0, "visitors": 0, "sessions": 0}

    cur = await _window_metrics(cutoff_7, None)
    prev = await _window_metrics(cutoff_14, cutoff_7)

    def _delta(now_v: int, prev_v: int) -> dict:
        if prev_v == 0:
            return {"current": now_v, "prior": 0,
                    "delta_pct": None,         # "new" — no comparison possible
                    "direction": "new" if now_v > 0 else "flat"}
        pct = round((now_v - prev_v) * 100.0 / prev_v, 1)
        return {"current": now_v, "prior": prev_v, "delta_pct": pct,
                "direction": "up" if pct > 0 else ("down" if pct < 0 else "flat")}

    deltas = {
        "views": _delta(cur["views"], prev["views"]),
        "visitors": _delta(cur["visitors"], prev["visitors"]),
        "sessions": _delta(cur["sessions"], prev["sessions"]),
    }

    return {
        "window_days": 30,
        "total_views": total_views,
        "unique_visitors": unique_visitors,
        "sessions": sessions,
        "views_7d": cur["views"],
        "deltas": deltas,
        "bounce_rate_pct": bounce_rate_pct,
        "bounces": bounces,
        "pages_per_session": pages_per_session,
        "top_pages": await _top_pages_with_dwell(cutoff_30, 10),
        "devices": await _top("device", cutoff_30, 5),
        "top_countries": await _top("country", cutoff_30, 10),
        "top_cities": await _top("city", cutoff_30, 10),
        "traffic_sources": await _top("medium", cutoff_30, 5),
        "top_referrers": await _top("source", cutoff_30, 10,
                                    extra_match={"medium": {"$nin": ["direct", "internal"]}}),
    }


# ----------------- SEO landing-page analytics --------------------------------

@router.get("/admin/analytics/seo-landing")
async def admin_seo_landing_analytics(days: int = 30, _: dict = Depends(current_admin)):
    """Per-landing-page analytics for the buyer-intent SEO pages defined in
    routers/seo.py::SEO_LANDING_SLUGS. Returns one row per slug with views,
    unique visitors, sessions, avg dwell, and top external referrer."""
    days = max(1, min(int(days or 30), 365))
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    pipe = [
        {"$match": {"ts": {"$gte": cutoff_iso}, "path": {"$in": list(SEO_LANDING_PATHS)}}},
        {"$group": {
            "_id": "$path",
            "views": {"$sum": 1},
            "visitors": {"$addToSet": "$visitor_id"},
            "sessions": {"$addToSet": "$session_id"},
            "avg_dwell_ms": {"$avg": "$dwell_ms"},
        }},
        {"$project": {
            "_id": 0,
            "path": "$_id",
            "views": 1,
            "unique_visitors": {"$size": "$visitors"},
            "sessions_count": {"$size": "$sessions"},
            "avg_dwell_ms": 1,
        }},
    ]
    rows = await db.pageview_events.aggregate(pipe).to_list(100)

    by_path = {r["path"]: r for r in rows}

    # Top external referrer per landing page (medium != direct/internal).
    ref_pipe = [
        {"$match": {
            "ts": {"$gte": cutoff_iso},
            "path": {"$in": list(SEO_LANDING_PATHS)},
            "medium": {"$nin": ["direct", "internal"]},
        }},
        {"$group": {"_id": {"path": "$path", "source": "$source"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    ref_rows = await db.pageview_events.aggregate(ref_pipe).to_list(2000)
    top_ref: dict[str, dict] = {}
    for r in ref_rows:
        p = r["_id"]["path"]
        if p not in top_ref:
            top_ref[p] = {"source": r["_id"]["source"] or "—", "count": int(r["count"])}

    # Emit one row per configured slug so the UI always shows the full grid
    # (even if a page has zero traffic yet).
    out: list[dict] = []
    for slug in SEO_LANDING_SLUGS:
        path = f"/{slug}"
        r = by_path.get(path, {})
        avg_ms = r.get("avg_dwell_ms") or 0
        ref = top_ref.get(path, {"source": "—", "count": 0})
        out.append({
            "slug": slug,
            "path": path,
            "views": int(r.get("views", 0)),
            "unique_visitors": int(r.get("unique_visitors", 0)),
            "sessions": int(r.get("sessions_count", 0)),
            "avg_dwell_s": round(float(avg_ms) / 1000.0, 1),
            "top_referrer": ref["source"],
            "top_referrer_count": ref["count"],
        })

    out.sort(key=lambda x: x["views"], reverse=True)
    totals = {
        "total_views": sum(r["views"] for r in out),
        "total_visitors": sum(r["unique_visitors"] for r in out),
        "total_sessions": sum(r["sessions"] for r in out),
        "pages": len(out),
        "window_days": days,
    }
    return {"totals": totals, "pages": out}


# ----------------- Live now (distinct visitors last 5 min) ------------------

@router.get("/admin/analytics/live")
async def admin_live_now(_: dict = Depends(current_admin)):
    """Real-time pulse — distinct visitor IDs seen in the last 5 minutes
    (and a tighter 1-minute count for the heartbeat dot).

    iter425 — When GA4 is connected, we ALSO surface GA's `activeUsers`
    (last-30-min window). The admin nav badge and Operations "LIVE" pill
    display whichever number is higher so the admin dashboard matches the
    same number the "Google Analytics" card shows a few sections below.
    Our first-party beacon undercounts (SPA route changes, crawler blocks,
    adblock) — GA gives the honest live count.
    """
    now = datetime.now(timezone.utc)
    cutoff_5m = (now - timedelta(minutes=5)).isoformat()
    cutoff_1m = (now - timedelta(minutes=1)).isoformat()
    pipe5 = [
        {"$match": {"ts": {"$gte": cutoff_5m}}},
        {"$group": {"_id": None, "v": {"$addToSet": "$visitor_id"}}},
        {"$project": {"_id": 0, "n": {"$size": "$v"}}},
    ]
    pipe1 = [
        {"$match": {"ts": {"$gte": cutoff_1m}}},
        {"$group": {"_id": None, "v": {"$addToSet": "$visitor_id"}}},
        {"$project": {"_id": 0, "n": {"$size": "$v"}}},
    ]
    r5 = await db.pageview_events.aggregate(pipe5).to_list(1)
    r1 = await db.pageview_events.aggregate(pipe1).to_list(1)
    first_party_5m = int(r5[0]["n"]) if r5 else 0
    first_party_1m = int(r1[0]["n"]) if r1 else 0

    ga_active = 0
    ga_source = "unavailable"
    try:
        # Local import to avoid startup coupling / hard dep on GA creds.
        from starlette.concurrency import run_in_threadpool
        from .ga4_analytics import (
            _client, GA4_PROPERTY_RESOURCE, _friendly_ga4_error,  # noqa: F401
        )
        from google.analytics.data_v1beta.types import (
            RunRealtimeReportRequest, Metric,
        )
        req = RunRealtimeReportRequest(
            property=GA4_PROPERTY_RESOURCE,
            metrics=[Metric(name="activeUsers")],
        )
        resp = await run_in_threadpool(_client().run_realtime_report, req)
        if resp.totals:
            ga_active = int(resp.totals[0].metric_values[0].value)
        elif resp.rows:
            ga_active = sum(int(r.metric_values[0].value) for r in resp.rows)
        ga_source = "ga4"
    except Exception:
        # GA4 not configured / not connected / transient error — silently fall
        # back to first-party. Never break the live badge.
        ga_active = 0
        ga_source = "unavailable"

    # Show the higher of GA (30-min window) or first-party (5-min window).
    # GA is broader by design and matches what the "Google Analytics" card
    # displays lower on the same admin page.
    live_5m_display = max(first_party_5m, ga_active)
    return {
        "live_5m": live_5m_display,
        "live_1m": first_party_1m,
        # iter425 debug/insight fields (used by tooltips; safe to expose to admin)
        "first_party_5m": first_party_5m,
        "ga_active_users": ga_active,
        "source": ga_source,
    }
