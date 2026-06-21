"""iter413bp — Admin Operations Dashboard aggregator.

Single endpoint that returns ALL 6 sections of the new admin landing
page in one round trip. Every card on the dashboard deep-links into the
existing admin tabs — this layer is read-only / surfacing only, it
never duplicates a control surface.

Design notes:
  • Static rule engine (no LLM) — AI can be plugged in later by
    replacing `_build_daily_brief()`.
  • Recent activity feeds from the "big 5" sources only: applications,
    paid orders, custom orders, maker approvals, and scheduler failures.
  • All counts are point-in-time. The page is meant to be refreshed
    explicitly (admin clicks REFRESH) — we deliberately avoid streaming
    or polling to keep cost low.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from core import db
from maker_auth import current_admin

router = APIRouter()


# ────────────────────────────── helpers ──────────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_minus(hours: int = 0, days: int = 0) -> str:
    return (_now() - timedelta(hours=hours, days=days)).isoformat()


def _age_label(iso: str | None) -> str:
    """Human-readable 'oldest:' age for action queue cards."""
    if not iso:
        return "—"
    try:
        when = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        delta = _now() - when
        secs = int(delta.total_seconds())
        if secs < 3600:
            return f"{max(1, secs // 60)}m"
        if secs < 86400:
            return f"{secs // 3600}h"
        return f"{secs // 86400}d"
    except Exception:
        return "—"


def _status_for(value: float, *, green_below: float, yellow_below: float, invert: bool = False) -> str:
    """Traffic-light thresholds. `invert=True` for metrics where higher = worse."""
    if invert:
        if value < green_below:
            return "green"
        if value < yellow_below:
            return "yellow"
        return "red"
    if value >= yellow_below:
        return "green"
    if value >= green_below:
        return "yellow"
    return "red"


# ────────────────────────── section builders ─────────────────────────
async def _section_action_queue() -> dict:
    """Group pending-action cards into CRITICAL / REVIEW / GROWTH."""
    now = _now()
    seven_days_ago = (now - timedelta(days=7)).isoformat()

    # ── CRITICAL ───────────────────────────────────────────────────
    critical: list[dict] = []

    # Stripe webhook errors in last 7d.
    stripe_err_7d = await db.stripe_webhook_log.count_documents({
        "ts": {"$gte": seven_days_ago},
        "status": {"$ne": "ok"},
    })
    if stripe_err_7d > 0:
        oldest_err = await db.stripe_webhook_log.find_one(
            {"ts": {"$gte": seven_days_ago}, "status": {"$ne": "ok"}},
            sort=[("ts", 1)],
        )
        critical.append({
            "id": "stripe_webhook_errors",
            "title": "Stripe webhook failures",
            "desc": f"{stripe_err_7d} error{'s' if stripe_err_7d != 1 else ''} in last 7 days",
            "age": _age_label(oldest_err.get("ts") if oldest_err else None),
            "cta_label": "Open Health Card",
            "cta_tab": "settings",
            "severity": "critical",
        })

    # Production endpoint failures (set by prod_health_watchdog).
    prod_failing = await db.prod_health_status.count_documents({"status": "failing"})
    if prod_failing > 0:
        critical.append({
            "id": "prod_health_failing",
            "title": "Production endpoints failing",
            "desc": f"{prod_failing} endpoint{'s' if prod_failing != 1 else ''} reporting failures",
            "age": "live",
            "cta_label": "Open Prod Health",
            "cta_tab": "prod-health",
            "severity": "critical",
        })

    # Failed scheduler jobs (last 24h).
    one_day_ago = (now - timedelta(hours=24)).isoformat()
    failed_jobs = await db.scheduler_runs.count_documents({
        "ts": {"$gte": one_day_ago}, "ok": False,
    }) if "scheduler_runs" in await db.list_collection_names() else 0
    if failed_jobs > 0:
        critical.append({
            "id": "failed_scheduler_jobs",
            "title": "Automation failures",
            "desc": f"{failed_jobs} scheduled job{'s' if failed_jobs != 1 else ''} failed in 24h",
            "age": "24h",
            "cta_label": "Open Audit Log",
            "cta_tab": "audit",
            "severity": "critical",
        })

    # ── REVIEW ─────────────────────────────────────────────────────
    review: list[dict] = []

    # Pending maker applications.
    pending_apps = await db.maker_applications.count_documents({"status": "pending"})
    if pending_apps > 0:
        oldest_app = await db.maker_applications.find_one(
            {"status": "pending"}, sort=[("created_at", 1)],
        )
        review.append({
            "id": "applications_pending",
            "title": "Applications pending",
            "desc": f"{pending_apps} waiting",
            "age": f"oldest: {_age_label(oldest_app.get('created_at') if oldest_app else None)}",
            "cta_label": "Review",
            "cta_tab": "applications",
            "severity": "review",
        })

    # Open custom orders (no `archived_at`, not delivered).
    open_custom = await db.custom_orders.count_documents({
        "archived_at": None,
        "status": {"$nin": ["delivered", "cancelled", "completed"]},
    })
    if open_custom > 0:
        review.append({
            "id": "custom_orders_open",
            "title": "Custom orders open",
            "desc": f"{open_custom} awaiting action",
            "age": "now",
            "cta_label": "Open Queue",
            "cta_tab": "custom",
            "severity": "review",
        })

    # Refund / dispute approvals.
    pending_refunds = await db.refund_approvals.count_documents({"status": "pending"}) \
        if "refund_approvals" in await db.list_collection_names() else 0
    if pending_refunds > 0:
        review.append({
            "id": "refunds_pending",
            "title": "Refund approvals",
            "desc": f"{pending_refunds} pending decision",
            "age": "—",
            "cta_label": "Review",
            "cta_tab": "approvals",
            "severity": "review",
        })

    # Reports flagged for moderation.
    flagged_reports = await db.file_reports.count_documents({"status": "open"}) \
        if "file_reports" in await db.list_collection_names() else 0
    if flagged_reports > 0:
        review.append({
            "id": "file_reports_open",
            "title": "Reports needing moderation",
            "desc": f"{flagged_reports} open report{'s' if flagged_reports != 1 else ''}",
            "age": "—",
            "cta_label": "Moderate",
            "cta_tab": "file-reports",
            "severity": "review",
        })

    # ── GROWTH ─────────────────────────────────────────────────────
    growth: list[dict] = []

    # Approved sellers with zero live listings.
    approved_makers = await db.makers.find(
        {"status": "approved"}, {"_id": 0, "slug": 1},
    ).to_list(1000)
    approved_slugs = [m["slug"] for m in approved_makers if m.get("slug")]
    if approved_slugs:
        with_listings = await db.products.distinct(
            "maker_slug",
            {"maker_slug": {"$in": approved_slugs}, "deleted_at": None},
        )
        zero_listing_count = len(set(approved_slugs) - set(with_listings))
        if zero_listing_count > 0:
            growth.append({
                "id": "sellers_no_listings",
                "title": "Sellers with no listings",
                "desc": f"{zero_listing_count} approved · 0 published",
                "age": "—",
                "cta_label": "View Makers",
                "cta_tab": "approved-makers",
                "severity": "growth",
            })

    # Founding Access applications still pending.
    founding_pending = await db.maker_applications.count_documents({
        "status": "pending",
        "is_founding_access": True,
    })
    if founding_pending > 0:
        growth.append({
            "id": "founding_access_pending",
            "title": "Founding Access applicants",
            "desc": f"{founding_pending} waiting for review",
            "age": "—",
            "cta_label": "Review",
            "cta_tab": "applications",
            "severity": "growth",
        })

    # Dormant sellers (no listing edits / new listings in 30d, last_active >30d).
    thirty_days_ago = (now - timedelta(days=30)).isoformat()
    dormant_q = {
        "status": "approved",
        "$or": [
            {"last_active": {"$lt": thirty_days_ago}},
            {"last_active": {"$exists": False}},
        ],
    }
    dormant_makers = await db.makers.count_documents(dormant_q)
    if dormant_makers > 0:
        growth.append({
            "id": "dormant_sellers",
            "title": "Dormant sellers",
            "desc": f"{dormant_makers} inactive 30d+",
            "age": "30d+",
            "cta_label": "Outreach",
            "cta_tab": "nurture-queue",
            "severity": "growth",
        })

    return {
        "critical": critical,
        "review":   review,
        "growth":   growth,
    }


async def _section_marketplace_health() -> dict:
    """7 KPI cards with traffic-light status."""
    now = _now()
    seven_days_ago = (now - timedelta(days=7)).isoformat()

    applications_submitted_7d = await db.maker_applications.count_documents(
        {"created_at": {"$gte": seven_days_ago}}
    )
    applications_approved_7d = await db.maker_applications.count_documents(
        {"status": "approved", "approved_at": {"$gte": seven_days_ago}}
    )
    active_sellers = await db.makers.count_documents({"status": "approved"})

    # Sellers with >=1 published listing.
    listings_pending = await db.products.count_documents({
        "status": "draft", "deleted_at": None,
    })
    orders_open = await db.orders.count_documents({
        "status": {"$nin": ["delivered", "cancelled", "refunded", "completed"]},
    }) if "orders" in await db.list_collection_names() else 0
    custom_orders_open = await db.custom_orders.count_documents({
        "archived_at": None,
        "status": {"$nin": ["delivered", "cancelled", "completed"]},
    })

    # Revenue today (sum of orders.created_at ≥ midnight UTC).
    midnight_iso = datetime(now.year, now.month, now.day, tzinfo=timezone.utc).isoformat()
    revenue_pipe = [
        {"$match": {"created_at": {"$gte": midnight_iso}, "status": {"$nin": ["cancelled", "refunded"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_usd"}}},
    ]
    revenue_today = 0.0
    if "orders" in await db.list_collection_names():
        async for r in db.orders.aggregate(revenue_pipe):
            revenue_today = float(r.get("total") or 0)

    return {
        "metrics": [
            {
                "id": "applications_7d",
                "label": "Applications · 7d",
                "value": applications_submitted_7d,
                "status": _status_for(applications_submitted_7d, green_below=1, yellow_below=3),
                "cta_tab": "applications",
            },
            {
                "id": "approved_7d",
                "label": "Approved · 7d",
                "value": applications_approved_7d,
                "status": _status_for(applications_approved_7d, green_below=1, yellow_below=2),
                "cta_tab": "approved-makers",
            },
            {
                "id": "active_sellers",
                "label": "Active sellers",
                "value": active_sellers,
                "status": _status_for(active_sellers, green_below=10, yellow_below=50),
                "cta_tab": "approved-makers",
            },
            {
                "id": "listings_pending",
                "label": "Listings · drafts",
                "value": listings_pending,
                "status": _status_for(listings_pending, green_below=50, yellow_below=200, invert=True),
                "cta_tab": "listings",
            },
            {
                "id": "orders_open",
                "label": "Orders open",
                "value": orders_open,
                "status": _status_for(orders_open, green_below=0, yellow_below=10, invert=True) if orders_open else "green",
                "cta_tab": "orders",
            },
            {
                "id": "custom_orders_open",
                "label": "Custom orders open",
                "value": custom_orders_open,
                "status": _status_for(custom_orders_open, green_below=0, yellow_below=5, invert=True) if custom_orders_open else "green",
                "cta_tab": "custom",
            },
            {
                "id": "revenue_today",
                "label": "Revenue today",
                "value": round(revenue_today, 2),
                "format": "usd",
                "status": _status_for(revenue_today, green_below=1, yellow_below=100),
                "cta_tab": "orders",
            },
        ],
    }


async def _section_founder_funnel() -> dict:
    """Pipeline stage counts with conversion %."""
    # Visitors come from the analytics events store. Fallback to 0 if collection missing.
    seven_days_ago = (_now() - timedelta(days=7)).isoformat()
    visitors = 0
    if "analytics_events" in await db.list_collection_names():
        visitors = await db.analytics_events.count_documents({
            "ts": {"$gte": seven_days_ago},
            "event": {"$in": ["page_view", "pageview"]},
        })

    applied = await db.maker_applications.count_documents({"created_at": {"$gte": seven_days_ago}})
    approved = await db.maker_applications.count_documents({
        "status": "approved", "approved_at": {"$gte": seven_days_ago},
    })
    # Activated = approved seller with at least 1 stripe-connect onboarding completed.
    activated_slugs = await db.makers.distinct("slug", {
        "status": "approved",
        "stripe_account_id": {"$exists": True, "$ne": None},
        "approved_at": {"$gte": seven_days_ago},
    })
    activated = len(activated_slugs)
    first_listing_slugs = await db.products.distinct("maker_slug", {
        "deleted_at": None,
        "created_at": {"$gte": seven_days_ago},
    })
    first_listing = len(first_listing_slugs)
    # First sale — count distinct maker_slugs with at least one paid order in window.
    first_sale = 0
    if "orders" in await db.list_collection_names():
        sale_slugs = await db.orders.distinct("maker_slug", {
            "status": {"$in": ["paid", "delivered", "completed"]},
            "created_at": {"$gte": seven_days_ago},
        })
        first_sale = len(sale_slugs)

    stages = [
        {"id": "visitor",       "label": "Visitor",       "count": visitors},
        {"id": "application",   "label": "Application",   "count": applied},
        {"id": "approved",      "label": "Approved",      "count": approved},
        {"id": "activated",     "label": "Activated",     "count": activated},
        {"id": "first_listing", "label": "First Listing", "count": first_listing},
        {"id": "first_sale",    "label": "First Sale",    "count": first_sale},
    ]
    # Conversion + dropoff between adjacent stages.
    for i, s in enumerate(stages):
        if i == 0:
            s["conversion_pct"] = None
            s["dropoff_pct"] = None
            continue
        prev = stages[i - 1]["count"] or 0
        s["conversion_pct"] = round(100 * s["count"] / prev, 1) if prev else 0.0
        s["dropoff_pct"] = round(100 - s["conversion_pct"], 1) if prev else 0.0

    return {"stages": stages, "window": "7d"}


async def _section_recent_activity() -> dict:
    """The 'big 5' event feed — newest first, capped at 20."""
    items: list[dict] = []

    # 1) New applications.
    async for app in db.maker_applications.find(
        {}, {"_id": 0, "id": 1, "studio_name": 1, "created_at": 1, "status": 1},
    ).sort("created_at", -1).limit(8):
        items.append({
            "kind": "application_submitted",
            "label": f"Application submitted · {app.get('studio_name') or 'unknown'}",
            "ts": app.get("created_at"),
            "cta_tab": "applications",
        })

    # 2) Paid orders.
    if "orders" in await db.list_collection_names():
        async for order in db.orders.find(
            {"status": {"$in": ["paid", "delivered", "completed"]}},
            {"_id": 0, "id": 1, "amount_usd": 1, "created_at": 1, "maker_slug": 1},
        ).sort("created_at", -1).limit(8):
            amt = order.get("amount_usd") or 0
            items.append({
                "kind": "order_placed",
                "label": f"Order placed · ${amt:.0f} · {order.get('maker_slug') or '—'}",
                "ts": order.get("created_at"),
                "cta_tab": "orders",
            })

    # 3) Custom orders.
    async for co in db.custom_orders.find(
        {}, {"_id": 0, "id": 1, "customer_name": 1, "created_at": 1},
    ).sort("created_at", -1).limit(5):
        items.append({
            "kind": "custom_request",
            "label": f"Custom request · {co.get('customer_name') or 'unknown'}",
            "ts": co.get("created_at"),
            "cta_tab": "custom",
        })

    # 4) Seller approvals.
    async for m in db.makers.find(
        {"status": "approved", "approved_at": {"$exists": True}},
        {"_id": 0, "slug": 1, "name": 1, "approved_at": 1},
    ).sort("approved_at", -1).limit(5):
        items.append({
            "kind": "seller_approved",
            "label": f"Seller approved · {m.get('name') or m.get('slug')}",
            "ts": m.get("approved_at"),
            "cta_tab": "approved-makers",
        })

    # 5) Automation failures.
    if "scheduler_runs" in await db.list_collection_names():
        async for run in db.scheduler_runs.find(
            {"ok": False},
            {"_id": 0, "job_id": 1, "ts": 1, "error": 1},
        ).sort("ts", -1).limit(5):
            items.append({
                "kind": "automation_failed",
                "label": f"Automation failed · {run.get('job_id') or 'unknown'}",
                "ts": run.get("ts"),
                "cta_tab": "audit",
            })

    # Sort all events newest-first, cap at 20.
    items.sort(key=lambda x: x.get("ts") or "", reverse=True)
    return {"items": items[:20]}


def _build_daily_brief(action_queue: dict, health: dict) -> dict:
    """Static rule engine — no LLM. Surfaces ONE opportunity, ONE risk,
    and up to 3 suggested actions based on the action queue state.
    Designed to be replaced with an AI-driven brief later by swapping
    this function with an LLM call."""
    opportunity_text = "All caught up — keep shipping."
    risk_text = "No risks detected."
    actions: list[dict] = []

    growth = action_queue.get("growth") or []
    critical = action_queue.get("critical") or []
    review = action_queue.get("review") or []

    # Opportunity rule: pick the biggest growth lever.
    if growth:
        # Prefer "sellers with no listings" → conversion is the easiest growth lever.
        no_listings = next((g for g in growth if g["id"] == "sellers_no_listings"), None)
        founding = next((g for g in growth if g["id"] == "founding_access_pending"), None)
        chosen = no_listings or founding or growth[0]
        opportunity_text = f"{chosen['desc']} — {chosen['title'].lower()}."
        actions.append({"label": chosen["cta_label"], "cta_tab": chosen["cta_tab"]})

    # Risk rule: critical > review.
    if critical:
        risk_text = f"{critical[0]['title']}: {critical[0]['desc']}"
        actions.insert(0, {"label": critical[0]["cta_label"], "cta_tab": critical[0]["cta_tab"]})
    elif review:
        risk_text = f"{review[0]['title']}: {review[0]['desc']}"
        actions.insert(0, {"label": review[0]["cta_label"], "cta_tab": review[0]["cta_tab"]})

    # Health rule: any RED metric becomes a suggested action.
    red_metrics = [m for m in health.get("metrics", []) if m.get("status") == "red"]
    if red_metrics and len(actions) < 3:
        m = red_metrics[0]
        actions.append({
            "label": f"Investigate {m['label']}",
            "cta_tab": m.get("cta_tab") or "analytics",
        })

    # Dedup CTAs by tab so we don't show duplicate buttons.
    seen = set()
    deduped = []
    for a in actions:
        key = a["cta_tab"]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(a)

    return {
        "opportunity": opportunity_text,
        "risk":        risk_text,
        "actions":     deduped[:3],
    }


# ──────────────────────────── endpoint ───────────────────────────────
@router.get("/admin/ops-dashboard/overview")
async def ops_dashboard_overview(_: dict = Depends(current_admin)):
    """Single-shot aggregator for the admin landing page. Returns all
    6 dashboard sections so the page renders in one request."""
    action_queue = await _section_action_queue()
    marketplace_health = await _section_marketplace_health()
    founder_funnel = await _section_founder_funnel()
    recent_activity = await _section_recent_activity()

    summary = {
        "critical":     sum(len(action_queue[k]) for k in ("critical",)),
        "needs_review": sum(len(action_queue[k]) for k in ("review",)),
        "healthy":      sum(1 for m in marketplace_health["metrics"] if m["status"] == "green"),
        "activity":     len(recent_activity["items"]),
    }
    daily_brief = _build_daily_brief(action_queue, marketplace_health)

    return {
        "generated_at":      _now().isoformat(),
        "summary":           summary,
        "action_queue":      action_queue,
        "marketplace_health": marketplace_health,
        "founder_funnel":    founder_funnel,
        "daily_brief":       daily_brief,
        "recent_activity":   recent_activity,
    }
