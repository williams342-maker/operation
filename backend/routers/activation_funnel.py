"""iter413dh-evidence — Founder Activation Funnel (read-only admin report).

Pure evidence-gathering surface for Phase D. Aggregates data that
already exists in MongoDB into the activation funnel the user defined:

    Approved → Welcome delivered → Magic link clicked / First login →
    Profile completed → First listing created → First listing published →
    First buyer inquiry → First sale

Plus the Time-to-First-Listing (TTFL) KPI per founder.

**This is NOT a product feature.** No writes. No new schema. No
maker-facing surface. Just exposes existing columns so the Week-4
review has a structured dataset instead of a manual spreadsheet.

Endpoint:
    GET /api/admin/activation-funnel?tier=founder&include_rows=true

Response:
    {
      "generated_at": "...",
      "cohort": "founder|all_approved",
      "funnel": {                  # aggregate counts + percentages
        "approved": {"count": 17, "pct": 100.0},
        "welcome_delivered": {"count": 16, "pct": 94.1},
        "first_login": {"count": 14, "pct": 82.4},
        ...
      },
      "ttfl": {                    # Time-to-First-Listing distribution
        "median_days": 3.5, "p25_days": 1, "p75_days": 9,
        "count_with_listing": 12,
      },
      "rows": [...]                # per-founder activation timeline
    }
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends

from core import db
from maker_auth import current_admin

router = APIRouter()


def _parse_ts(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _days_between(a, b) -> Optional[float]:
    a, b = _parse_ts(a), _parse_ts(b)
    if not (a and b):
        return None
    return round((b - a).total_seconds() / 86400, 1)


def _profile_complete(m: dict) -> bool:
    return all(bool((m.get(k) or "").strip()) for k in ("portrait", "cover", "bio", "location"))


def _percentile(values: list, pct: float) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round((pct / 100) * (len(s) - 1)))))
    return s[k]


@router.get("/admin/activation-funnel")
async def admin_activation_funnel(
    tier: str = "founder",
    include_rows: bool = True,
    limit: int = 200,
    _: dict = Depends(current_admin),
):
    """Read-only aggregation. `tier=founder` (default) reports only on
    Founders; `tier=all_approved` covers every approved maker."""
    maker_query: dict = {"status": "approved"}
    if tier == "founder":
        maker_query["tier"] = "founder"
    makers = await db.makers.find(
        maker_query,
        {"_id": 0, "slug": 1, "name": 1, "email": 1, "created_at": 1,
         "updated_at": 1, "founder_number": 1, "founder_status": 1, "tier": 1,
         "portrait": 1, "cover": 1, "bio": 1, "location": 1},
    ).sort("created_at", 1).to_list(limit)

    # Bulk-fetch correlated rows so we don't N+1.
    emails = [m["email"] for m in makers if m.get("email")]
    slugs = [m["slug"] for m in makers if m.get("slug")]
    apps_by_email = {
        a["email"]: a async for a in db.maker_applications.find(
            {"email": {"$in": emails}, "status": "approved"},
            {"_id": 0, "email": 1, "decided_at": 1},
        )
    }
    # Welcome email signal — any successfully-dispatched message whose
    # subject mentions Founder / "launch packet". Failed sends (e.g.
    # the rate-limited Mailersend rows we saw) are excluded.
    welcome_by_email: dict = {}
    async for e in db.email_events.find(
        {
            "to": {"$in": emails},
            "$or": [
                {"subject": {"$regex": "Founder", "$options": "i"}},
                {"subject": {"$regex": "launch packet", "$options": "i"}},
                {"subject": {"$regex": "Welcome to Crafters Market", "$options": "i"}},
            ],
        },
        {"_id": 0, "to": 1, "subject": 1, "status": 1, "created_at": 1},
    ):
        if e.get("status") == "failed":
            continue
        ts = e.get("created_at")
        if not ts:
            continue
        cur = welcome_by_email.get(e["to"])
        if not cur or ts < cur["created_at"]:
            welcome_by_email[e["to"]] = e
    # First login proxy — earliest successful login_attempt per email.
    login_by_email: dict = {}
    async for la in db.login_attempts.find(
        {"email": {"$in": emails}, "success": True},
        {"_id": 0, "email": 1, "created_at": 1},
    ):
        ts = la.get("created_at")
        if not ts:
            continue
        cur = login_by_email.get(la["email"])
        if not cur or ts < cur["created_at"]:
            login_by_email[la["email"]] = la
    # First listing created / published per maker_slug.
    first_listing: dict = {}
    first_published: dict = {}
    async for p in db.products.find(
        {"maker_slug": {"$in": slugs}, "deleted_at": None},
        {"_id": 0, "maker_slug": 1, "created_at": 1, "status": 1},
    ):
        sl = p["maker_slug"]
        ts = p.get("created_at")
        if not ts:
            continue
        if sl not in first_listing or ts < first_listing[sl]:
            first_listing[sl] = ts
        if p.get("status") == "active":
            if sl not in first_published or ts < first_published[sl]:
                first_published[sl] = ts
    # First buyer inquiry per maker (dm_threads where buyer initiated).
    first_inquiry: dict = {}
    async for t in db.dm_threads.find(
        {"maker_slug": {"$in": slugs}},
        {"_id": 0, "maker_slug": 1, "created_at": 1},
    ):
        sl = t["maker_slug"]
        ts = t.get("created_at")
        if not ts:
            continue
        if sl not in first_inquiry or ts < first_inquiry[sl]:
            first_inquiry[sl] = ts
    # First sale — earliest paid order containing one of these makers.
    first_sale: dict = {}
    async for o in db.orders.find(
        {"status": {"$in": ["paid", "fulfilled", "shipped", "delivered"]}},
        {"_id": 0, "items": 1, "created_at": 1, "status": 1},
    ).sort("created_at", 1):
        for item in (o.get("items") or []):
            sl = item.get("maker_slug")
            if not sl or sl not in slugs:
                continue
            if sl not in first_sale:
                first_sale[sl] = o["created_at"]

    # Build per-founder rows + aggregate counters.
    rows: list = []
    counts = {k: 0 for k in (
        "approved", "welcome_delivered", "first_login",
        "profile_completed", "first_listing_created",
        "first_listing_published", "first_buyer_inquiry", "first_sale",
    )}
    ttfl_days: list = []
    now = datetime.now(timezone.utc)
    for m in makers:
        slug = m.get("slug")
        email = m.get("email")
        approved_at = (apps_by_email.get(email) or {}).get("decided_at") or m.get("created_at")
        welcome_at = (welcome_by_email.get(email) or {}).get("created_at")
        login_at = (login_by_email.get(email) or {}).get("created_at")
        profile_done = _profile_complete(m)
        first_created = first_listing.get(slug)
        first_pub = first_published.get(slug)
        first_inq = first_inquiry.get(slug)
        first_sl = first_sale.get(slug)

        counts["approved"] += 1
        if welcome_at:
            counts["welcome_delivered"] += 1
        if login_at:
            counts["first_login"] += 1
        if profile_done:
            counts["profile_completed"] += 1
        if first_created:
            counts["first_listing_created"] += 1
        if first_pub:
            counts["first_listing_published"] += 1
        if first_inq:
            counts["first_buyer_inquiry"] += 1
        if first_sl:
            counts["first_sale"] += 1

        ttfl = _days_between(approved_at, first_pub) if first_pub else None
        if ttfl is not None:
            ttfl_days.append(ttfl)

        # Stall classification — informs the early-promotion trigger.
        days_since_approval = _days_between(approved_at, now.isoformat()) or 0
        if first_pub:
            status_class = "active"
        elif first_created:
            status_class = "drafting"
        elif profile_done:
            status_class = "onboarding"
        elif days_since_approval >= 30:
            status_class = "dormant"
        elif days_since_approval >= 14:
            status_class = "stalled"
        else:
            status_class = "new"

        rows.append({
            "slug": slug, "name": m.get("name"), "email": email,
            "founder_number": m.get("founder_number"),
            "founder_status": m.get("founder_status"),
            "approved_at": approved_at,
            "welcome_delivered_at": welcome_at,
            "first_login_at": login_at,
            "profile_completed": profile_done,
            "first_listing_created_at": first_created,
            "first_listing_published_at": first_pub,
            "first_buyer_inquiry_at": first_inq,
            "first_sale_at": first_sl,
            "days_since_approval": round(days_since_approval, 1),
            "ttfl_days": ttfl,
            "activation_status": status_class,
        })

    rows.sort(key=lambda r: r["days_since_approval"], reverse=True)
    n = counts["approved"] or 1
    funnel = {
        k: {"count": v, "pct": round(100 * v / n, 1)} for k, v in counts.items()
    }
    ttfl_stats = {
        "count_with_listing": len(ttfl_days),
        "median_days": _percentile(ttfl_days, 50),
        "p25_days": _percentile(ttfl_days, 25),
        "p75_days": _percentile(ttfl_days, 75),
    }
    # Early-promotion trigger flag — surfaces directly in the report
    # so we don't need to re-derive it offline.
    stalled_with_welcome_no_login = sum(
        1 for r in rows
        if r["activation_status"] in ("stalled", "dormant")
        and r["welcome_delivered_at"] and not r["first_login_at"]
    )
    return {
        "generated_at": now.isoformat(),
        "cohort": tier,
        "funnel": funnel,
        "ttfl": ttfl_stats,
        "early_promotion_trigger": {
            "condition": "multiple founders: welcome delivered, no login, ≥14 days idle",
            "matching_count": stalled_with_welcome_no_login,
            "fires_at": 2,
            "active": stalled_with_welcome_no_login >= 2,
        },
        "rows": rows if include_rows else [],
    }
