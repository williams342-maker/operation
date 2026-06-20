"""iter413ba — Founder Funnel Dashboard.

Single source of truth for the 8-stage seller-acquisition funnel that
ties Crafters Market's Primary KPI ("Live Listings") to the upstream
acquisition signals.

Stages (top → bottom):
  0. Traffic          — unique visitors to /apply (pageview_events)
  1. Qualified Lead   — lead_magnet_subscribers ONLY
                        (newsletter / waitlist / update subs excluded
                         by design — too mixed, inflates conversion)
  2. Application      — maker_applications submitted
  3. Approved         — maker_applications.status=approved OR makers
                        doc exists (whichever is greater — covers
                        manually-seeded historical makers)
  4. Store Created    — maker has logged in OR filled bio / portrait /
                        banner. ("They actually set the shop up.")
  5. First Listing    — maker has >= 1 non-deleted published product
  6. Featured Founder — founder_status="active" on makers doc
  7. First Sale       — appears in maker_payouts with succeeded status

Conversion percentages are computed between adjacent stages (NOT
against Stage 0) so a low rate isolates exactly where the funnel leaks.

Warning cards fire when configured thresholds are crossed.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from core import db
from maker_auth import current_admin as _current_admin


router = APIRouter()


# Configurable windows. Most ops want "last 30 days" for current health
# and "all time" for absolute counts; the route returns both.
_DEFAULT_WINDOW_DAYS = 30


def _pct(num: int, denom: int) -> float:
    """Conversion percentage with safe divide-by-zero."""
    if not denom:
        return 0.0
    return round((num / denom) * 100, 1)


async def _count_with_window(
    collection: str,
    *,
    window_field: str,
    since_iso: Optional[str],
    extra_filter: Optional[dict] = None,
) -> int:
    q = dict(extra_filter or {})
    if since_iso:
        q[window_field] = {"$gte": since_iso}
    return await db[collection].count_documents(q)


async def _build_funnel(since_iso: Optional[str]) -> dict:
    """Compute counts for each of the 8 stages within the given window
    (or all-time if `since_iso` is None)."""

    # Stage 0 — Traffic. Unique visitors that reached /apply.
    # `distinct` is fine here — pageview_events is bounded (~thousands)
    # not millions, so the round trip is cheap.
    visitor_q: dict = {"path": "/apply"}
    if since_iso:
        visitor_q["ts"] = {"$gte": since_iso}
    apply_visitors = await db.pageview_events.distinct("visitor_id", visitor_q)
    s0_traffic = len([v for v in apply_visitors if v])
    s0_views = await db.pageview_events.count_documents(visitor_q)

    # Stage 1 — Qualified Lead. lead_magnet_subscribers only.
    s1_leads = await _count_with_window(
        "lead_magnet_subscribers", window_field="created_at", since_iso=since_iso,
    )

    # Stage 2 — Application Submitted.
    s2_apps = await _count_with_window(
        "maker_applications", window_field="created_at", since_iso=since_iso,
    )

    # Stage 3 — Approved. Two possible signals:
    #   • maker_applications.status="approved" — proper flow
    #   • makers doc — covers manually seeded historical makers
    # Use the MAX of both so we never under-count.
    s3_apps_approved = await _count_with_window(
        "maker_applications", window_field="decided_at", since_iso=since_iso,
        extra_filter={"status": "approved"},
    )
    s3_maker_docs = await _count_with_window(
        "makers", window_field="created_at", since_iso=since_iso,
    )
    s3_approved = max(s3_apps_approved, s3_maker_docs)

    # Stage 4 — Store Created. Any of: logged in, set bio, uploaded
    # portrait, uploaded banner. Counts makers with at least one signal.
    store_filter: dict = {
        "$or": [
            {"last_login_at": {"$nin": [None, ""]}},
            {"bio": {"$nin": [None, ""]}},
            {"portrait": {"$nin": [None, ""]}},
            {"banner_image_url": {"$nin": [None, ""]}},
        ],
    }
    s4_stores = await _count_with_window(
        "makers", window_field="created_at", since_iso=since_iso,
        extra_filter=store_filter,
    )

    # Stage 5 — First Listing. Distinct makers with >=1 published,
    # non-deleted product. Window applied via products.created_at.
    listing_q: dict = {"deleted_at": None, "status": "published"}
    if since_iso:
        listing_q["created_at"] = {"$gte": since_iso}
    makers_with_listing = await db.products.distinct("maker", listing_q)
    s5_listings = len([m for m in makers_with_listing if m])

    # Stage 6 — Featured Founder. founder_status="active".
    founder_filter = {"founder_status": "active"}
    s6_founders = await _count_with_window(
        "makers", window_field="founder_started_at", since_iso=since_iso,
        extra_filter=founder_filter,
    )

    # Stage 7 — First Sale. Distinct makers with at least one succeeded
    # payout. (Window applied via maker_payouts.created_at.)
    sale_q: dict = {"status": {"$in": ["succeeded", "succeeded-zero"]}}
    if since_iso:
        sale_q["created_at"] = {"$gte": since_iso}
    makers_with_sale = await db.maker_payouts.distinct("maker_slug", sale_q)
    s7_sales = len([m for m in makers_with_sale if m])

    stages = [
        {"key": "traffic",   "label": "Apply visitors",   "value": s0_traffic,
         "secondary": f"{s0_views} total views",
         "source": "pageview_events"},
        {"key": "lead",      "label": "Qualified leads",  "value": s1_leads,
         "secondary": "lead-magnet downloads",
         "source": "lead_magnet_subscribers"},
        {"key": "applied",   "label": "Applications",     "value": s2_apps,
         "secondary": "submitted",
         "source": "maker_applications"},
        {"key": "approved",  "label": "Approved",         "value": s3_approved,
         "secondary": f"{s3_apps_approved} via flow · {s3_maker_docs} seeded",
         "source": "maker_applications + makers"},
        {"key": "store",     "label": "Store created",    "value": s4_stores,
         "secondary": "bio · portrait · banner · or login",
         "source": "makers"},
        {"key": "listing",   "label": "First listing",    "value": s5_listings,
         "secondary": "≥1 published",
         "source": "products"},
        {"key": "founder",   "label": "Featured founder", "value": s6_founders,
         "secondary": "founder_status=active",
         "source": "makers"},
        {"key": "sale",      "label": "First sale",       "value": s7_sales,
         "secondary": "settled payout",
         "source": "maker_payouts"},
    ]

    # Conversion deltas between adjacent stages — exactly the six the
    # ops doc asks for.
    conversions = [
        {"from": "traffic",  "to": "lead",     "pct": _pct(s1_leads,    s0_traffic)},
        {"from": "lead",     "to": "applied",  "pct": _pct(s2_apps,     s1_leads)},
        {"from": "applied",  "to": "approved", "pct": _pct(s3_approved, s2_apps)},
        {"from": "approved", "to": "store",    "pct": _pct(s4_stores,   s3_approved)},
        {"from": "store",    "to": "listing",  "pct": _pct(s5_listings, s4_stores)},
        {"from": "listing",  "to": "sale",     "pct": _pct(s7_sales,    s5_listings)},
    ]

    # Warning cards — same logic the ops doc specifies.
    # Thresholds are intentionally generous so they only fire on real
    # leaks, not seed-data noise.
    warnings: list[dict] = []
    if s0_traffic >= 100 and _pct(s1_leads, s0_traffic) < 2:
        warnings.append({
            "key": "low_lead_capture",
            "severity": "warn",
            "title": "High traffic, low leads",
            "detail": (
                f"{s0_traffic} visitors hit /apply but only {s1_leads} downloaded "
                f"the lead magnet ({_pct(s1_leads, s0_traffic)}%). Tune the page CTA "
                f"or add an inline lead magnet."
            ),
        })
    if s1_leads >= 20 and _pct(s2_apps, s1_leads) < 10:
        warnings.append({
            "key": "low_lead_to_app",
            "severity": "warn",
            "title": "High leads, low applications",
            "detail": (
                f"{s1_leads} leads but only {s2_apps} applied "
                f"({_pct(s2_apps, s1_leads)}%). Lead-nurture sequence may be cold "
                f"— review the welcome email and CTA cadence."
            ),
        })
    if s3_approved >= 5 and _pct(s4_stores, s3_approved) < 50:
        warnings.append({
            "key": "low_activation",
            "severity": "alert",
            "title": "High approvals, low activation",
            "detail": (
                f"{s3_approved} approved but only {s4_stores} have set up their "
                f"store ({_pct(s4_stores, s3_approved)}%). Onboarding email may "
                f"not be landing — check the approval email render + sender."
            ),
        })

    # Stage-4 → Stage-5 timeout warning. Find makers who have a store
    # set up but no listing 7+ days later. Doesn't depend on window.
    seven_days_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    listed_slugs = set(await db.products.distinct(
        "maker", {"deleted_at": None, "status": "published"},
    ))
    stale_cur = db.makers.find(
        {**store_filter, "created_at": {"$lt": seven_days_ago}},
        {"_id": 0, "slug": 1, "name": 1, "created_at": 1, "email": 1},
    ).limit(200)
    stale_examples: list[dict] = []
    async for m in stale_cur:
        if m.get("slug") and m["slug"] not in listed_slugs:
            stale_examples.append(m)
    if stale_examples:
        warnings.append({
            "key": "store_no_listing_7d",
            "severity": "alert",
            "title": f"{len(stale_examples)} store(s) created but no listing after 7 days",
            "detail": (
                "Makers set up their profile but never listed an item. "
                "Trigger the 'add your first listing' email + Slack alert."
            ),
            "examples": stale_examples[:10],
        })

    return {
        "window_days": (
            None if since_iso is None
            else (datetime.now(timezone.utc) - datetime.fromisoformat(since_iso)).days
        ),
        "stages": stages,
        "conversions": conversions,
        "warnings": warnings,
    }


@router.get("/admin/founder-funnel")
async def founder_funnel(
    window: str = Query("30d", pattern=r"^(7d|30d|90d|all)$"),
    _admin: dict = Depends(_current_admin),
):
    """The 8-stage founder funnel. `window`: 7d / 30d / 90d / all.

    Response is shaped for direct rendering — every metric the dashboard
    needs is pre-computed server-side so the React component is dumb
    presentation only.
    """
    if window == "all":
        since_iso = None
    else:
        days = int(window.rstrip("d"))
        since_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    funnel = await _build_funnel(since_iso)
    funnel["window"] = window
    funnel["generated_at"] = datetime.now(timezone.utc).isoformat()
    return funnel
