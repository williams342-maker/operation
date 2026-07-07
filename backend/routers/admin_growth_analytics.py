"""Admin Growth Analytics — dashboard aggregation + CSV export.

Endpoints
─────────
GET  /api/admin/analytics/growth          → daily/weekly/monthly buckets + summary + funnel + top pages
GET  /api/admin/analytics/growth/export   → CSV download of the same table (streaming)

Query params (both):
  range        daily | weekly | monthly     (default: daily)
  start_date   YYYY-MM-DD                   (overrides range window)
  end_date     YYYY-MM-DD

All numbers are AGGREGATE COUNTS. No PII (no buyer email, name, address) is
ever returned by this endpoint.

Data sources
  • pageview_events   — visitors + page views
  • maker_applications — new / approved / incomplete
  • makers            — shops created
  • products          — listings (active vs draft) + created_at
  • payment_transactions — orders + gross + commission
  • analytics_events  — click-based signals (apply_click, portfolio_click,
                       add_to_cart, checkout_started, email_verified)

Where a click-based signal doesn't exist in analytics_events yet, we
gracefully return 0 for that metric; the frontend charts still render.
"""
from __future__ import annotations
import io
import csv
from datetime import datetime, timezone, timedelta, date
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.responses import StreamingResponse

from core import db
from maker_auth import current_admin

router = APIRouter(prefix="", tags=["admin-growth-analytics"])

# ─────────────────────────── time helpers ───────────────────────────────
def _parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def _resolve_window(
    range_: str, start_date: Optional[str], end_date: Optional[str],
) -> tuple[datetime, datetime, str]:
    """Return (start, end_exclusive, grain) with grain=day|week|month."""
    now = datetime.now(timezone.utc)
    today = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    if start_date and end_date:
        s = _parse_dt(start_date)
        e = _parse_dt(end_date) + timedelta(days=1)
        span = (e - s).days
        grain = "month" if span > 90 else ("week" if span > 30 else "day")
        return s, e, grain
    r = (range_ or "daily").lower()
    if r == "weekly":
        return today - timedelta(days=90), today + timedelta(days=1), "week"
    if r == "monthly":
        return today - timedelta(days=365), today + timedelta(days=1), "month"
    # daily default = last 30 days
    return today - timedelta(days=30), today + timedelta(days=1), "day"


def _bucket_key(dt: datetime, grain: str) -> str:
    if grain == "month":
        return f"{dt.year:04d}-{dt.month:02d}"
    if grain == "week":
        iso = dt.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    return dt.date().isoformat()


def _iter_buckets(start: datetime, end: datetime, grain: str) -> list[str]:
    keys: list[str] = []
    cur = start
    if grain == "month":
        while cur < end:
            keys.append(_bucket_key(cur, "month"))
            y, m = cur.year + (cur.month // 12), cur.month % 12 + 1
            cur = datetime(y, m, 1, tzinfo=timezone.utc)
    elif grain == "week":
        while cur < end:
            keys.append(_bucket_key(cur, "week"))
            cur = cur + timedelta(days=7)
    else:
        while cur < end:
            keys.append(_bucket_key(cur, "day"))
            cur = cur + timedelta(days=1)
    # dedup preserving order (weekly buckets may repeat once for edges)
    seen: set[str] = set()
    out: list[str] = []
    for k in keys:
        if k not in seen:
            out.append(k); seen.add(k)
    return out


# ─────────────────────────── aggregators ────────────────────────────────
async def _visitors_by_bucket(start: datetime, end: datetime, grain: str) -> dict[str, int]:
    """Distinct visitors per bucket from pageview_events.ts (ISO string)."""
    out: dict[str, int] = {}
    try:
        docs = await db.pageview_events.find(
            {"ts": {"$gte": start.isoformat(), "$lt": end.isoformat()}},
            {"_id": 0, "ts": 1, "visitor_id": 1},
        ).to_list(500_000)
    except Exception:
        docs = []
    seen: dict[str, set] = {}
    for d in docs:
        vid = d.get("visitor_id")
        if not vid:
            continue
        try:
            dt = datetime.fromisoformat(d["ts"].replace("Z", "+00:00"))
        except Exception:
            continue
        k = _bucket_key(dt, grain)
        seen.setdefault(k, set()).add(vid)
    for k, s in seen.items():
        out[k] = len(s)
    return out


async def _pageviews_by_bucket(start: datetime, end: datetime, grain: str) -> dict[str, int]:
    out: dict[str, int] = {}
    try:
        docs = await db.pageview_events.find(
            {"ts": {"$gte": start.isoformat(), "$lt": end.isoformat()}},
            {"_id": 0, "ts": 1},
        ).to_list(500_000)
    except Exception:
        docs = []
    for d in docs:
        try:
            dt = datetime.fromisoformat(d["ts"].replace("Z", "+00:00"))
        except Exception:
            continue
        k = _bucket_key(dt, grain)
        out[k] = out.get(k, 0) + 1
    return out


async def _events_by_bucket(kind: str, start: datetime, end: datetime,
                            grain: str) -> dict[str, int]:
    """Count analytics_events docs matching kind."""
    out: dict[str, int] = {}
    try:
        docs = await db.analytics_events.find(
            {"event_type": kind,
             "created_at": {"$gte": start.isoformat(), "$lt": end.isoformat()}},
            {"_id": 0, "created_at": 1},
        ).to_list(500_000)
    except Exception:
        docs = []
    for d in docs:
        try:
            dt = datetime.fromisoformat(d["created_at"].replace("Z", "+00:00"))
        except Exception:
            continue
        k = _bucket_key(dt, grain)
        out[k] = out.get(k, 0) + 1
    return out


async def _applications_by_bucket(start, end, grain: str, *,
                                  status: Optional[str] = None,
                                  incomplete: bool = False) -> dict[str, int]:
    q: dict = {"created_at": {"$gte": start.isoformat(), "$lt": end.isoformat()}}
    if status:
        q["status"] = status
    if incomplete:
        q["$or"] = [{"status": {"$in": ["draft", "incomplete", "pending_verification"]}},
                    {"email_verified": {"$ne": True}}]
    out: dict[str, int] = {}
    try:
        docs = await db.maker_applications.find(q, {"_id": 0, "created_at": 1}).to_list(50_000)
    except Exception:
        docs = []
    for d in docs:
        try:
            dt = datetime.fromisoformat(str(d["created_at"]).replace("Z", "+00:00"))
        except Exception:
            continue
        k = _bucket_key(dt, grain)
        out[k] = out.get(k, 0) + 1
    return out


async def _makers_by_bucket(start, end, grain: str) -> dict[str, int]:
    out: dict[str, int] = {}
    try:
        docs = await db.makers.find(
            {"created_at": {"$gte": start.isoformat(), "$lt": end.isoformat()}},
            {"_id": 0, "created_at": 1},
        ).to_list(50_000)
    except Exception:
        docs = []
    for d in docs:
        try:
            dt = datetime.fromisoformat(str(d["created_at"]).replace("Z", "+00:00"))
        except Exception:
            continue
        k = _bucket_key(dt, grain)
        out[k] = out.get(k, 0) + 1
    return out


async def _listings_by_bucket(start, end, grain: str) -> dict[str, int]:
    out: dict[str, int] = {}
    try:
        docs = await db.products.find(
            {"created_at": {"$gte": start.isoformat(), "$lt": end.isoformat()}},
            {"_id": 0, "created_at": 1},
        ).to_list(50_000)
    except Exception:
        docs = []
    for d in docs:
        try:
            dt = datetime.fromisoformat(str(d["created_at"]).replace("Z", "+00:00"))
        except Exception:
            continue
        k = _bucket_key(dt, grain)
        out[k] = out.get(k, 0) + 1
    return out


async def _orders_by_bucket(start, end, grain: str) -> tuple[dict, dict, dict]:
    """Return (count, gross, commission) buckets."""
    count, gross, commission = {}, {}, {}
    try:
        docs = await db.payment_transactions.find(
            {"payment_status": "paid",
             "created_at": {"$gte": start.isoformat(), "$lt": end.isoformat()}},
            {"_id": 0, "created_at": 1, "amount": 1, "platform_fee": 1},
        ).to_list(50_000)
    except Exception:
        docs = []
    for d in docs:
        try:
            dt = datetime.fromisoformat(str(d["created_at"]).replace("Z", "+00:00"))
        except Exception:
            continue
        k = _bucket_key(dt, grain)
        count[k] = count.get(k, 0) + 1
        gross[k] = gross.get(k, 0.0) + float(d.get("amount") or 0)
        commission[k] = commission.get(k, 0.0) + float(d.get("platform_fee") or 0)
    return count, gross, commission


async def _top_pages(start, end, limit: int = 10) -> list[dict]:
    try:
        pipe = [
            {"$match": {"ts": {"$gte": start.isoformat(), "$lt": end.isoformat()}}},
            {"$group": {"_id": "$path", "views": {"$sum": 1},
                        "visitors": {"$addToSet": "$visitor_id"}}},
            {"$project": {"_id": 0, "path": "$_id", "views": 1,
                          "visitors": {"$size": "$visitors"}}},
            {"$sort": {"views": -1}},
            {"$limit": int(limit)},
        ]
        return await db.pageview_events.aggregate(pipe).to_list(limit)
    except Exception:
        return []


async def _active_and_draft_listings() -> tuple[int, int]:
    try:
        active = await db.products.count_documents({"active": True})
    except Exception:
        active = 0
    try:
        draft = await db.products.count_documents(
            {"$or": [{"active": False}, {"status": "draft"}, {"draft": True}]}
        )
    except Exception:
        draft = 0
    return active, draft


# ─────────────────────────── main endpoint ──────────────────────────────
async def _build_growth(range_: str, start_date: Optional[str],
                        end_date: Optional[str]) -> dict:
    start, end, grain = _resolve_window(range_, start_date, end_date)
    buckets = _iter_buckets(start, end, grain)

    (visitors_map, pageviews_map,
     apps_new_map, apps_approved_map, apps_incomplete_map,
     makers_map, listings_map) = await _multi(
        _visitors_by_bucket(start, end, grain),
        _pageviews_by_bucket(start, end, grain),
        _applications_by_bucket(start, end, grain),
        _applications_by_bucket(start, end, grain, status="approved"),
        _applications_by_bucket(start, end, grain, incomplete=True),
        _makers_by_bucket(start, end, grain),
        _listings_by_bucket(start, end, grain),
    )
    orders_count, orders_gross, orders_commission = await _orders_by_bucket(start, end, grain)

    apply_click        = await _events_by_bucket("apply_click", start, end, grain)
    portfolio_click    = await _events_by_bucket("portfolio_click", start, end, grain)
    add_to_cart        = await _events_by_bucket("add_to_cart", start, end, grain)
    checkout_started   = await _events_by_bucket("checkout_started", start, end, grain)
    email_verified     = await _events_by_bucket("email_verified", start, end, grain)

    top_pages = await _top_pages(start, end)
    active_listings, draft_listings = await _active_and_draft_listings()

    # Build row per bucket
    rows: list[dict] = []
    for k in buckets:
        visitors = visitors_map.get(k, 0)
        apps = apps_new_map.get(k, 0)
        approved = apps_approved_map.get(k, 0)
        ord_count = orders_count.get(k, 0)
        conv = (apps / visitors * 100) if visitors else 0
        rows.append({
            "bucket": k,
            "unique_visitors": visitors,
            "page_views":      pageviews_map.get(k, 0),
            "applications":    apps,
            "approved_applications": approved,
            "shops_created":   makers_map.get(k, 0),
            "listings_posted": listings_map.get(k, 0),
            "orders":          ord_count,
            "gross_sales":     round(orders_gross.get(k, 0.0), 2),
            "commission":      round(orders_commission.get(k, 0.0), 2),
            "add_to_cart":     add_to_cart.get(k, 0),
            "checkout_started": checkout_started.get(k, 0),
            "apply_clicks":    apply_click.get(k, 0),
            "portfolio_clicks": portfolio_click.get(k, 0),
            "email_verified":  email_verified.get(k, 0),
            "conversion_rate": round(conv, 2),
        })

    # Summary totals
    def _sum(field: str) -> float:
        return sum(r[field] for r in rows) if rows else 0

    total_visitors    = int(_sum("unique_visitors"))
    total_applications = int(_sum("applications"))
    total_approved     = int(_sum("approved_applications"))
    total_listings     = int(_sum("listings_posted"))
    total_atc          = int(_sum("add_to_cart"))
    conv_vis_app     = round(total_applications / total_visitors * 100, 2) if total_visitors else 0
    conv_app_appr    = round(total_approved / total_applications * 100, 2) if total_applications else 0
    conv_view_atc    = round(total_atc / max(1, int(_sum("page_views"))) * 100, 2)

    summary = {
        "visitors":       total_visitors,
        "page_views":     int(_sum("page_views")),
        "applications":   total_applications,
        "approved":       total_approved,
        "incomplete_applications": sum(apps_incomplete_map.values()),
        "new_listings":   total_listings,
        "active_listings": active_listings,
        "draft_listings": draft_listings,
        "orders":         int(_sum("orders")),
        "gross_sales":    round(_sum("gross_sales"), 2),
        "commission":     round(_sum("commission"), 2),
        "add_to_cart":    total_atc,
        "checkout_started": int(_sum("checkout_started")),
        "email_verified": int(_sum("email_verified")),
        "portfolio_clicks": int(_sum("portfolio_clicks")),
        "apply_clicks":   int(_sum("apply_clicks")),
        "conv_visitor_to_application": conv_vis_app,
        "conv_application_to_approved": conv_app_appr,
        "conv_pageview_to_cart": conv_view_atc,
    }

    funnel = [
        {"stage": "Visitors", "count": total_visitors},
        {"stage": "Applications", "count": total_applications},
        {"stage": "Approved Makers", "count": total_approved},
        {"stage": "Listings Posted", "count": total_listings},
    ]

    return {
        "range": range_ or "daily",
        "grain": grain,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "summary": summary,
        "rows": rows,
        "top_pages": top_pages,
        "funnel": funnel,
    }


async def _multi(*coros):
    """asyncio.gather but returns a tuple."""
    import asyncio
    return await asyncio.gather(*coros)


@router.get("/admin/analytics/growth")
async def growth(
    range: Literal["daily", "weekly", "monthly"] = "daily",
    start_date: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: Optional[str]   = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _: dict = Depends(current_admin),
):
    return await _build_growth(range, start_date, end_date)


# ─────────────────────────── CSV export ─────────────────────────────────
_CSV_COLS = [
    ("bucket",                "Date"),
    ("unique_visitors",       "Unique visitors"),
    ("page_views",            "Page views"),
    ("applications",          "Applications"),
    ("approved_applications", "Approved applications"),
    ("shops_created",         "Shops created"),
    ("listings_posted",       "Listings posted"),
    ("orders",                "Orders"),
    ("gross_sales",           "Gross sales"),
    ("commission",            "Commission"),
    ("add_to_cart",           "Add to cart"),
    ("checkout_started",      "Checkout started"),
    ("apply_clicks",          "Apply clicks"),
    ("portfolio_clicks",      "Portfolio clicks"),
    ("email_verified",        "Email verified"),
    ("conversion_rate",       "Visitor→application %"),
]


@router.get("/admin/analytics/growth/export")
async def growth_export(
    range: Literal["daily", "weekly", "monthly"] = "daily",
    start_date: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: Optional[str]   = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _: dict = Depends(current_admin),
):
    data = await _build_growth(range, start_date, end_date)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([h for _, h in _CSV_COLS])
    for row in data["rows"]:
        w.writerow([row.get(k, "") for k, _ in _CSV_COLS])
    buf.seek(0)
    filename = f"crafters-growth-{data['grain']}-{data['start'][:10]}-to-{data['end'][:10]}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
