"""Marketplace Command Center (iter419).

Endpoints powering the widget-based landing dashboard:

- ``GET /api/admin/command/growth``           — Today's Growth Engine
- ``GET /api/admin/command/activity``         — Live Activity Feed
- ``GET /api/admin/command/recruitment``      — Recruitment Opportunities
- (Founder Slots widget reuses ``/api/admin/founders/slots-detail`` from iter418)

Design notes
------------
* Each endpoint is admin-only and returns a **self-contained widget
  payload** (headline + rows + metadata). This lets the widget shell
  render generically without domain-specific glue.
* Nothing here writes state. All widgets read from existing DB
  collections plus the ``search_events`` collection introduced in
  ``search_intent.py`` (iter419).
* "Today" is computed against **UTC**. Ops can re-frame in a later
  iter if that becomes an issue; keeping UTC dodges the timezone
  minefield for now.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core import db
from maker_auth import current_admin

router = APIRouter(tags=["admin", "command"])


# --------------------- Time helpers --------------------- #
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_start_of_day() -> str:
    n = _now()
    return n.replace(hour=0, minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")


def _iso_start_of_yesterday() -> str:
    n = _now() - timedelta(days=1)
    return n.replace(hour=0, minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")


def _iso_ago(days: int) -> str:
    return (_now() - timedelta(days=days)).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# =========================================================
#   GROWTH ENGINE
# =========================================================
class GrowthMetric(BaseModel):
    key: str
    label: str
    value_today: int | float
    delta_vs_yesterday: Optional[int | float] = None
    unit: Optional[str] = None  # "currency" | None
    hint: Optional[str] = None


class CategoryGrowth(BaseModel):
    category: str
    listings_added_today: int


class GrowthResponse(BaseModel):
    metrics: list[GrowthMetric]
    categories: list[CategoryGrowth]
    generated_at: str


async def _count(collection, filt: dict) -> int:
    try:
        return int(await getattr(db, collection).count_documents(filt))
    except Exception:
        return 0


async def _sum_orders(match: dict) -> float:
    """Sum of `total` across orders matching `match`. Falls back to 0."""
    try:
        cur = db.orders.aggregate([
            {"$match": match},
            {"$group": {"_id": None, "total": {"$sum": "$total"}}},
        ])
        docs = await cur.to_list(1)
        return float(docs[0]["total"]) if docs else 0.0
    except Exception:
        return 0.0


@router.get("/admin/command/growth", response_model=GrowthResponse)
async def growth(_: dict = Depends(current_admin)):
    today = _iso_start_of_day()
    yday = _iso_start_of_yesterday()

    async def paired(fn):
        """Run counter for today + yesterday windows and return (today, yday_delta)."""
        t = await fn(gte=today, lt=None)
        y = await fn(gte=yday, lt=today)
        return t, (t - y)

    # ---- Visitors (24h page_view events) ---- #
    async def _visitors(gte, lt):
        m = {"type": "page_view", "created_at": {"$gte": gte}}
        if lt: m["created_at"]["$lt"] = lt
        try:
            distinct = await db.events.distinct("session_id", m)
            return len([d for d in distinct if d])
        except Exception:
            return 0

    visitors_today, visitors_delta = await paired(_visitors)

    # ---- Buyers registered today ---- #
    async def _buyers(gte, lt):
        m = {"created_at": {"$gte": gte}}
        if lt: m["created_at"]["$lt"] = lt
        try:
            return int(await db.buyers.count_documents(m))
        except Exception:
            return 0

    buyers_today, buyers_delta = await paired(_buyers)

    # ---- Founder applications today ---- #
    async def _apps(gte, lt):
        m = {"created_at": {"$gte": gte}}
        if lt: m["created_at"]["$lt"] = lt
        # `beta_applications` is the Founding Access surface; `applications`
        # is the standard maker apply flow. Both count for a growth signal.
        c1 = await _count("beta_applications", m)
        c2 = await _count("applications", m)
        return c1 + c2
    apps_today, apps_delta = await paired(_apps)

    # ---- New makers approved today ---- #
    async def _new_makers(gte, lt):
        m = {"approved_at": {"$gte": gte}}
        if lt: m["approved_at"]["$lt"] = lt
        return await _count("makers", m)
    new_makers_today, new_makers_delta = await paired(_new_makers)

    # ---- Products added today ---- #
    async def _products(gte, lt):
        m = {"created_at": {"$gte": gte}}
        if lt: m["created_at"]["$lt"] = lt
        return await _count("products", m)
    products_today, products_delta = await paired(_products)

    # ---- Orders today ---- #
    async def _orders(gte, lt):
        m = {"created_at": {"$gte": gte}, "status": {"$in": ["paid", "fulfilled", "shipped", "succeeded", "complete"]}}
        if lt: m["created_at"]["$lt"] = lt
        return await _count("orders", m)
    orders_today, orders_delta = await paired(_orders)

    # ---- Revenue today ---- #
    revenue_today = await _sum_orders({
        "created_at": {"$gte": today},
        "status": {"$in": ["paid", "fulfilled", "shipped", "succeeded", "complete"]},
    })
    revenue_yday = await _sum_orders({
        "created_at": {"$gte": yday, "$lt": today},
        "status": {"$in": ["paid", "fulfilled", "shipped", "succeeded", "complete"]},
    })
    revenue_delta = revenue_today - revenue_yday

    # ---- Conversion rate today (orders / visitors) ---- #
    conv_today = round((orders_today / visitors_today * 100), 2) if visitors_today > 0 else 0.0
    conv_yday_orders = await _count("orders", {
        "created_at": {"$gte": yday, "$lt": today},
        "status": {"$in": ["paid", "fulfilled", "shipped", "succeeded", "complete"]},
    })
    conv_yday_visitors = 0
    try:
        conv_yday_visitors = len([d for d in await db.events.distinct("session_id", {
            "type": "page_view", "created_at": {"$gte": yday, "$lt": today},
        }) if d])
    except Exception:
        pass
    conv_yday = round((conv_yday_orders / conv_yday_visitors * 100), 2) if conv_yday_visitors > 0 else 0.0

    metrics = [
        GrowthMetric(key="visitors_today", label="Visitors Today", value_today=visitors_today, delta_vs_yesterday=visitors_delta),
        GrowthMetric(key="buyers_registered", label="Buyers Registered", value_today=buyers_today, delta_vs_yesterday=buyers_delta),
        GrowthMetric(key="applications", label="Founder Applications", value_today=apps_today, delta_vs_yesterday=apps_delta),
        GrowthMetric(key="new_makers", label="New Makers Approved", value_today=new_makers_today, delta_vs_yesterday=new_makers_delta),
        GrowthMetric(key="products_added", label="Products Added", value_today=products_today, delta_vs_yesterday=products_delta),
        GrowthMetric(key="orders", label="Orders", value_today=orders_today, delta_vs_yesterday=orders_delta),
        GrowthMetric(key="revenue", label="Revenue", value_today=round(revenue_today, 2), delta_vs_yesterday=round(revenue_delta, 2), unit="currency"),
        GrowthMetric(key="conversion_rate", label="Conversion Rate", value_today=conv_today, delta_vs_yesterday=round(conv_today - conv_yday, 2), unit="percent"),
    ]

    # ---- Category growth (listings added today per category) ---- #
    categories: list[CategoryGrowth] = []
    try:
        cur = db.products.aggregate([
            {"$match": {"created_at": {"$gte": today}}},
            {"$group": {"_id": "$category", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
            {"$limit": 12},
        ])
        async for d in cur:
            if d.get("_id"):
                categories.append(CategoryGrowth(category=str(d["_id"]), listings_added_today=int(d["n"])))
    except Exception:
        pass

    return GrowthResponse(
        metrics=metrics,
        categories=categories,
        generated_at=_now().isoformat().replace("+00:00", "Z"),
    )


# =========================================================
#   ACTIVITY FEED
# =========================================================
class ActivityItem(BaseModel):
    id: str
    kind: str            # semantic event type — drives the icon/label
    text: str            # human-readable one-liner
    ts: str              # ISO
    subject_slug: Optional[str] = None   # link target if applicable
    subject_kind: Optional[str] = None   # "maker" | "product" | "order"


class ActivityResponse(BaseModel):
    items: list[ActivityItem]
    generated_at: str


# The eight momentum-worthy event kinds per the ticket:
#   New founder application · Email verified · Maker approved
#   Shop published · Product listed · First product listed
#   First sale for maker · Custom order brief submitted
_MOMENTUM_KINDS = {
    "founder_application",
    "email_verified",
    "maker_approved",
    "shop_published",
    "product_listed",
    "first_product_listed",
    "first_sale",
    "custom_order_brief",
}


@router.get("/admin/command/activity", response_model=ActivityResponse)
async def activity(limit: int = 25, _: dict = Depends(current_admin)):
    """Pull the latest N momentum events. Events land here via multiple
    sources — application submits, approvals, product creates, order
    fulfillment, and custom-order briefs. We inline-derive most of them
    from the primary tables so we don't need every write path to
    emit events explicitly."""
    limit = max(5, min(int(limit or 25), 100))
    since = _iso_ago(3)  # 3-day rolling window keeps the feed relevant

    items: list[ActivityItem] = []

    # 1. Founder applications (both surfaces).
    try:
        cur = db.beta_applications.find(
            {"created_at": {"$gte": since}},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "studio_name": 1, "created_at": 1, "verified": 1},
        ).sort("created_at", -1).limit(limit)
        async for d in cur:
            items.append(ActivityItem(
                id=f"betaapp-{d.get('id','')}",
                kind="founder_application",
                text=f"New Founder application — {d.get('studio_name') or d.get('name') or 'anonymous'}",
                ts=d.get("created_at") or "",
                subject_slug=None, subject_kind=None,
            ))
            if d.get("verified") and d.get("created_at"):
                items.append(ActivityItem(
                    id=f"betaver-{d.get('id','')}",
                    kind="email_verified",
                    text=f"Email verified — {d.get('studio_name') or d.get('name') or 'anonymous'}",
                    ts=d.get("created_at") or "",
                ))
    except Exception:
        pass

    # 2. Maker approvals + shop publishing.
    try:
        cur = db.makers.find(
            {"approved_at": {"$gte": since}},
            {"_id": 0, "slug": 1, "name": 1, "shop_title": 1, "approved_at": 1, "published_at": 1, "listings_count": 1},
        ).sort("approved_at", -1).limit(limit)
        async for d in cur:
            items.append(ActivityItem(
                id=f"maker-{d.get('slug','')}",
                kind="maker_approved",
                text=f"Maker approved — {d.get('shop_title') or d.get('name') or d.get('slug')}",
                ts=d.get("approved_at") or "",
                subject_slug=d.get("slug"), subject_kind="maker",
            ))
            if d.get("published_at") and d["published_at"] >= since:
                items.append(ActivityItem(
                    id=f"shop-{d.get('slug','')}",
                    kind="shop_published",
                    text=f"Shop published — {d.get('shop_title') or d.get('slug')}",
                    ts=d["published_at"],
                    subject_slug=d.get("slug"), subject_kind="maker",
                ))
    except Exception:
        pass

    # 3. Product listings — count per maker to detect "first product listed"
    #    which is a higher-signal milestone than routine adds.
    try:
        cur = db.products.find(
            {"created_at": {"$gte": since}, "status": {"$in": ["published", None]}},
            {"_id": 0, "slug": 1, "title": 1, "maker_slug": 1, "created_at": 1},
        ).sort("created_at", -1).limit(limit)
        async for d in cur:
            maker_slug = d.get("maker_slug")
            # Is this the maker's *first* published listing? cheap check:
            older = 0
            if maker_slug:
                try:
                    older = await db.products.count_documents({
                        "maker_slug": maker_slug,
                        "created_at": {"$lt": d.get("created_at")},
                        "status": {"$in": ["published", None]},
                    })
                except Exception:
                    older = 1
            kind = "first_product_listed" if older == 0 else "product_listed"
            label = "First product listed" if older == 0 else "New product listed"
            items.append(ActivityItem(
                id=f"prod-{d.get('slug','')}",
                kind=kind,
                text=f"{label} — {d.get('title') or d.get('slug')}",
                ts=d.get("created_at") or "",
                subject_slug=d.get("slug"), subject_kind="product",
            ))
    except Exception:
        pass

    # 4. First-sale-for-maker milestone.
    try:
        cur = db.orders.find(
            {"created_at": {"$gte": since},
             "status": {"$in": ["paid", "fulfilled", "shipped", "succeeded", "complete"]}},
            {"_id": 0, "id": 1, "maker_slug": 1, "created_at": 1, "total": 1},
        ).sort("created_at", -1).limit(limit)
        async for d in cur:
            m = d.get("maker_slug")
            if not m: continue
            try:
                older = await db.orders.count_documents({
                    "maker_slug": m,
                    "created_at": {"$lt": d.get("created_at")},
                    "status": {"$in": ["paid", "fulfilled", "shipped", "succeeded", "complete"]},
                })
            except Exception:
                older = 1
            if older == 0:
                items.append(ActivityItem(
                    id=f"firstsale-{m}",
                    kind="first_sale",
                    text=f"First sale for maker — {m}",
                    ts=d.get("created_at") or "",
                    subject_slug=m, subject_kind="maker",
                ))
    except Exception:
        pass

    # 5. Custom-order briefs submitted.
    try:
        cur = db.custom_orders.find(
            {"created_at": {"$gte": since}},
            {"_id": 0, "id": 1, "brief": 1, "created_at": 1, "buyer_email": 1, "target_maker_slug": 1},
        ).sort("created_at", -1).limit(limit)
        async for d in cur:
            snippet = ((d.get("brief") or "")[:60]).strip()
            if snippet:
                snippet = snippet + ("…" if len(d.get("brief") or "") > 60 else "")
            items.append(ActivityItem(
                id=f"brief-{d.get('id','')}",
                kind="custom_order_brief",
                text=f"Custom-order brief submitted{': ' + snippet if snippet else ''}",
                ts=d.get("created_at") or "",
                subject_slug=d.get("target_maker_slug"), subject_kind="maker",
            ))
    except Exception:
        pass

    items = [i for i in items if i.ts]
    items.sort(key=lambda i: i.ts, reverse=True)
    items = items[:limit]

    return ActivityResponse(
        items=items,
        generated_at=_now().isoformat().replace("+00:00", "Z"),
    )


# =========================================================
#   RECRUITMENT OPPORTUNITIES
# =========================================================
class RecruitmentRow(BaseModel):
    normalized_query: str
    latest_query: str
    count: int
    last_searched_at: str
    marked_opportunity: bool = False


class RecruitmentResponse(BaseModel):
    window_days: int
    rows: list[RecruitmentRow]
    generated_at: str


@router.get("/admin/command/recruitment", response_model=RecruitmentResponse)
async def recruitment(
    window_days: int = 7,
    limit: int = 8,
    _: dict = Depends(current_admin),
):
    """Compact recruitment queue for the Command Center. Same source
    as the full Zero-Result search view, trimmed for the widget."""
    window_days = max(1, min(int(window_days or 7), 90))
    cutoff = (_now() - timedelta(days=window_days)).isoformat().replace("+00:00", "Z")

    try:
        pipeline = [
            {"$match": {"zero_result": True, "created_at": {"$gte": cutoff}}},
            {"$group": {
                "_id": "$normalized_query",
                "count": {"$sum": 1},
                "latest_query": {"$last": "$query"},
                "last_searched_at": {"$max": "$created_at"},
            }},
            {"$sort": {"count": -1, "last_searched_at": -1}},
            {"$limit": int(limit)},
        ]
        docs = await db.search_events.aggregate(pipeline).to_list(None)
    except Exception:
        docs = []

    ann_docs = []
    try:
        ann_docs = await db.search_intent_annotations.find({}, {"_id": 0}).to_list(None)
    except Exception:
        pass
    annotations = {a["normalized_query"]: a for a in ann_docs}

    rows: list[RecruitmentRow] = []
    for d in docs:
        nq = d["_id"] or ""
        ann = annotations.get(nq) or {}
        if ann.get("hidden"):
            continue
        rows.append(RecruitmentRow(
            normalized_query=nq,
            latest_query=d.get("latest_query") or nq,
            count=int(d.get("count") or 0),
            last_searched_at=d.get("last_searched_at") or "",
            marked_opportunity=bool(ann.get("marked_opportunity")),
        ))

    return RecruitmentResponse(
        window_days=window_days,
        rows=rows,
        generated_at=_now().isoformat().replace("+00:00", "Z"),
    )
