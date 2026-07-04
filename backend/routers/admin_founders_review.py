"""Founder final-review + closeout admin surfaces (iter418).

This module supplements ``founders.py`` with the *closeout* half of the
lifecycle:

* Activity-based classification (Active / Needs-Review) so an approved
  Founder who never used the account doesn't hold a slot forever.
* Admin review queue exposing every Founder + their activity signals.
* Manual downgrade action ("Move to Free Tier") that opens the slot
  back up **without** deleting the maker or their listings.
* Auto-close of the applications gate the moment the active-Founder
  headcount reaches the configured cap. Manual re-open by admin is
  supported (the classifier never *auto-reopens* — the user decided
  reopen must be a deliberate admin action).

Public surface for the /founders page reads the flag via the existing
`GET /api/settings` endpoint (`founder_applications_open`, added in
``settings.py``). Nothing here is public — every endpoint requires
``current_admin``.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_admin

router = APIRouter(tags=["admin", "founders"])


# --------------------------- Constants --------------------------- #
DEFAULT_FOUNDER_SLOTS = 100

# The four activity signals that make a Founder "Active". A Founder
# only needs to satisfy ANY ONE of them to remain active — the bar is
# intentionally low because the goal is to identify *dormant* accounts
# (never logged in, no shop, no listings), not to hound working makers.
_ACTIVITY_SIGNALS = (
    "has_shop_profile",       # Studio/bio filled beyond seed defaults
    "has_published_product",  # >=1 published listing
    "recent_login",           # signed in within 90 days
    "has_sales",              # >=1 order/sale on record
)
_RECENT_LOGIN_DAYS = 90


# --------------------------- Helpers --------------------------- #
async def _get_slots_total() -> int:
    """Cap of concurrent Active Founder slots. Falls back to 100."""
    doc = await db.site_settings.find_one({"_id": "global"}) or {}
    v = doc.get("founder_slots_total")
    return int(v) if isinstance(v, int) and v > 0 else DEFAULT_FOUNDER_SLOTS


async def _get_applications_open() -> bool:
    doc = await db.site_settings.find_one({"_id": "global"}) or {}
    return bool(doc.get("founder_applications_open", True))


async def _set_applications_open(value: bool, actor_email: str) -> None:
    await db.site_settings.update_one(
        {"_id": "global"},
        {"$set": {
            "founder_applications_open": bool(value),
            "founder_applications_open_updated_at": now_iso(),
            "founder_applications_open_updated_by": actor_email,
        }},
        upsert=True,
    )


def _cutoff_iso(days: int) -> str:
    from datetime import timedelta
    return (datetime.now(timezone.utc) - timedelta(days=days)) \
        .replace(microsecond=0).isoformat().replace("+00:00", "Z")


async def _activity_signals_for(maker: dict) -> dict:
    """Compute the four activity booleans + supporting metrics for a
    single Founder maker. Result is used by both classify() below and
    exposed verbatim to the admin review UI so the moderator can see
    *why* a maker is flagged.

    iter421 additionally computes the composite Maker Health Score
    (0-100 → 1-5 stars) and its breakdown so the review UI can render
    the star + verdict inline.
    """
    slug = maker.get("slug")

    # Product counts (published + total draft).
    total_products = await db.products.count_documents({"maker_slug": slug})
    published_products = await db.products.count_documents({
        "maker_slug": slug, "status": "published",
    })

    # Last product update — Mongo aggregate to pick max(updated_at).
    last_product_update = None
    if total_products:
        cur = db.products.find(
            {"maker_slug": slug},
            {"updated_at": 1, "_id": 0},
        ).sort("updated_at", -1).limit(1)
        async for row in cur:
            last_product_update = row.get("updated_at")

    # Sales. Two collections exist historically (orders and payments);
    # count either as a valid sales signal.
    sales_count = 0
    try:
        sales_count = await db.orders.count_documents({"maker_slug": slug})
    except Exception:
        sales_count = 0
    if sales_count == 0:
        try:
            sales_count = await db.payments.count_documents(
                {"maker_slug": slug, "status": {"$in": ["succeeded", "paid"]}}
            )
        except Exception:
            pass

    # Recent sales (last 30 days) for the health score.
    sales_30d = 0
    try:
        sales_30d = await db.orders.count_documents({
            "maker_slug": slug,
            "created_at": {"$gte": _cutoff_iso(30)},
        })
    except Exception:
        pass

    # 7-day product-view volume across all of this maker's listings.
    views_7d = 0
    try:
        maker_slugs_cur = db.products.find(
            {"maker_slug": slug}, {"slug": 1, "_id": 0},
        )
        product_slugs = [p["slug"] async for p in maker_slugs_cur if p.get("slug")]
        if product_slugs:
            views_7d = await db.events.count_documents({
                "type": "product_view",
                "product_slug": {"$in": product_slugs},
                "created_at": {"$gte": _cutoff_iso(7)},
            })
    except Exception:
        pass

    # Shop-profile completion — has a bio > 40 chars and either
    # `studio_name` or `shop_title` beyond seed defaults.
    bio = (maker.get("bio") or "").strip()
    studio = (maker.get("studio_name") or maker.get("shop_title") or "").strip()
    has_shop_profile = bool(len(bio) >= 40 and len(studio) >= 3)

    # Recent login — last_login within 90 days.
    last_login = maker.get("last_login")
    recent_login = bool(
        last_login and last_login >= _cutoff_iso(_RECENT_LOGIN_DAYS)
    )

    signals = {
        "has_shop_profile": has_shop_profile,
        "has_published_product": published_products >= 1,
        "recent_login": recent_login,
        "has_sales": sales_count >= 1,
    }

    # iter421 — Composite health score.
    health = _compute_health_score(
        maker=maker,
        last_login=last_login,
        published_products=published_products,
        last_product_update=last_product_update,
        sales_count=sales_count,
        sales_30d=sales_30d,
        views_7d=views_7d,
    )

    return {
        "signals": signals,
        "total_products": total_products,
        "published_products": published_products,
        "last_product_update": last_product_update,
        "last_login": last_login,
        "sales_count": sales_count,
        "sales_30d": sales_30d,
        "views_7d": views_7d,
        "health": health,
    }


# ---------------------- Health score (iter421) ---------------------- #
_HEALTH_MAX = 100


def _completeness_breakdown(m: dict) -> tuple[int, dict]:
    """Return (points_earned, per-field breakdown). Max = 15 points."""
    checks = {
        "shop_title":       (2, bool((m.get("shop_title") or "").strip())),
        "bio_40_chars":     (2, len((m.get("bio") or "").strip()) >= 40),
        "cover_image":      (2, bool(m.get("cover") or m.get("banner_image_url"))),
        "portrait_image":   (2, bool(m.get("portrait"))),
        "techniques":       (1, bool(m.get("techniques"))),
        "location":         (1, bool((m.get("location") or "").strip())),
        "social_link":      (1, any(str(k).startswith("social_") and m.get(k) for k in m.keys())),
        "website_url":      (1, bool(m.get("website_url"))),
        "machinery":        (1, bool(m.get("machinery"))),
        "shop_announcement": (2, bool((m.get("shop_announcement") or "").strip() or (m.get("message_to_buyers") or "").strip())),
    }
    total = 0
    detail: dict = {}
    for field, (pts, ok) in checks.items():
        detail[field] = bool(ok)
        if ok:
            total += pts
    return total, detail


def _compute_health_score(
    *, maker: dict,
    last_login: Optional[str],
    published_products: int,
    last_product_update: Optional[str],
    sales_count: int,
    sales_30d: int,
    views_7d: int,
) -> dict:
    """Weighted 0-100 composite that maps to a 1-5 star rating.

    Weight budget:
      Login recency        20
      Published listings   20
      Recent updates       10
      Sales (30d + total)  15
      Product view volume  10
      Store completeness   15
      Response-time set    10
                           ---
      total                100
    """
    # 1. Login recency (max 20)
    login_pts = 0
    if last_login:
        if last_login >= _cutoff_iso(7):    login_pts = 20
        elif last_login >= _cutoff_iso(30): login_pts = 15
        elif last_login >= _cutoff_iso(60): login_pts = 10
        elif last_login >= _cutoff_iso(90): login_pts = 5

    # 2. Published listings (max 20)
    listings_pts = 0
    if published_products >= 10:  listings_pts = 20
    elif published_products >= 5: listings_pts = 15
    elif published_products >= 3: listings_pts = 10
    elif published_products >= 1: listings_pts = 5

    # 3. Recent product updates (max 10)
    updates_pts = 0
    if last_product_update:
        if last_product_update >= _cutoff_iso(30):  updates_pts = 10
        elif last_product_update >= _cutoff_iso(90): updates_pts = 5

    # 4. Sales activity (max 15)
    sales_pts = 0
    if sales_30d >= 5:        sales_pts = 15
    elif sales_30d >= 1:      sales_pts = 10
    elif sales_count >= 1:    sales_pts = 5

    # 5. Product view volume (max 10)
    views_pts = 0
    if views_7d >= 50:  views_pts = 10
    elif views_7d >= 10: views_pts = 5

    # 6. Store completeness (max 15)
    completeness_pts, completeness_detail = _completeness_breakdown(maker)

    # 7. Response-time set (max 10)
    rt = maker.get("response_time_hours")
    rt_pts = 0
    if isinstance(rt, (int, float)) and rt > 0:
        if rt <= 24:  rt_pts = 10
        elif rt <= 72: rt_pts = 5

    total = min(_HEALTH_MAX, login_pts + listings_pts + updates_pts + sales_pts + views_pts + completeness_pts + rt_pts)

    # Star rating + verdict
    # iter422 — verdict labels aligned to spec: Excellent / Strong / Steady / At Risk / Dormant.
    if total >= 90:   stars, verdict = 5, "Excellent"
    elif total >= 75: stars, verdict = 4, "Strong"
    elif total >= 60: stars, verdict = 3, "Steady"
    elif total >= 40: stars, verdict = 2, "At Risk"
    else:             stars, verdict = 1, "Dormant"

    return {
        "score": total,
        "stars": stars,
        "verdict": verdict,
        "breakdown": {
            "login": login_pts,
            "listings": listings_pts,
            "updates": updates_pts,
            "sales": sales_pts,
            "views": views_pts,
            "completeness": completeness_pts,
            "response_time": rt_pts,
        },
        "completeness_detail": completeness_detail,
        "completeness_pct": round(completeness_pts / 15 * 100),
    }


def _classify(signals: dict) -> str:
    """Map the four boolean signals into a review verdict.

    A Founder is **active** if ANY signal is true. If ALL four are
    false the account is dormant and flagged for admin review. We do
    NOT auto-classify anyone as ``downgrade_to_free`` — that
    designation only exists as an admin *action* (see downgrade
    endpoint below), never as an auto-verdict.
    """
    if any(signals.values()):
        return "active"
    return "needs_review"


async def _refresh_close_flag(actor_email: str = "system") -> dict:
    """Re-count active founders and flip the applications gate CLOSED
    if we've hit the cap. NEVER auto-*opens* the gate — reopening is
    always a deliberate admin choice."""
    cap = await _get_slots_total()
    active_slug_count = await _count_active_founders()
    if active_slug_count >= cap:
        was_open = await _get_applications_open()
        if was_open:
            await _set_applications_open(False, actor_email)
            logger.info(
                "[founders] auto-closed applications: %d/%d active founders",
                active_slug_count, cap,
            )
    return {"active_count": active_slug_count, "cap": cap}


async def _count_active_founders() -> int:
    """Number of ``tier == 'founder'`` makers who satisfy the activity
    test. Iterates through the (small — capped at 100ish) founder set
    and counts those NOT classified as needs_review."""
    active = 0
    cur = db.makers.find({"tier": "founder"})
    async for m in cur:
        a = await _activity_signals_for(m)
        if _classify(a["signals"]) == "active":
            active += 1
    return active


# --------------------------- Endpoints --------------------------- #
class SlotsDetail(BaseModel):
    active: int
    needs_review: int
    total_founders: int  # everyone still on tier=founder
    cap: int
    applications_open: bool


@router.get("/admin/founders/slots-detail", response_model=SlotsDetail)
async def slots_detail(_: dict = Depends(current_admin)):
    """Powers the admin dashboard "Founder Slots" card. Everything is
    computed live from the current DB state — no cached counters."""
    cap = await _get_slots_total()
    applications_open = await _get_applications_open()
    total = await db.makers.count_documents({"tier": "founder"})
    active = 0
    needs_review = 0
    cur = db.makers.find({"tier": "founder"})
    async for m in cur:
        a = await _activity_signals_for(m)
        if _classify(a["signals"]) == "active":
            active += 1
        else:
            needs_review += 1
    return SlotsDetail(
        active=active,
        needs_review=needs_review,
        total_founders=total,
        cap=cap,
        applications_open=applications_open,
    )


class FounderReviewRow(BaseModel):
    slug: str
    name: str
    shop_title: Optional[str] = None
    email: Optional[str] = None
    approved_at: Optional[str] = None       # aka founder_started_at
    last_login: Optional[str] = None
    total_products: int
    published_products: int
    last_product_update: Optional[str] = None
    sales_count: int
    sales_30d: int = 0
    views_7d: int = 0
    signals: dict
    status: str  # "active" | "needs_review"
    founder_number: Optional[int] = None
    founder_status: Optional[str] = None    # inaugural / regular
    health: dict = {}                       # iter421


class FounderReviewResponse(BaseModel):
    rows: list[FounderReviewRow]
    active: int
    needs_review: int
    cap: int
    applications_open: bool


@router.get("/admin/founders/review", response_model=FounderReviewResponse)
async def founder_review(_: dict = Depends(current_admin)):
    """Full list of Founder makers with activity metrics + verdict.

    Sorted so needs_review rows float to the top, then by
    founder_number ascending. Includes every founder — the admin decides
    what to do with each row."""
    cap = await _get_slots_total()
    applications_open = await _get_applications_open()

    rows: list[FounderReviewRow] = []
    active = 0
    needs_review = 0

    cur = db.makers.find({"tier": "founder"}).sort("founder_number", 1)
    async for m in cur:
        a = await _activity_signals_for(m)
        status = _classify(a["signals"])
        if status == "active":
            active += 1
        else:
            needs_review += 1
        rows.append(FounderReviewRow(
            slug=m.get("slug") or "",
            name=m.get("name") or "",
            shop_title=m.get("shop_title") or m.get("studio_name"),
            email=m.get("email"),
            approved_at=m.get("founder_started_at") or m.get("approved_at"),
            last_login=a["last_login"],
            total_products=a["total_products"],
            published_products=a["published_products"],
            last_product_update=a["last_product_update"],
            sales_count=a["sales_count"],
            sales_30d=a.get("sales_30d", 0),
            views_7d=a.get("views_7d", 0),
            signals=a["signals"],
            status=status,
            founder_number=m.get("founder_number"),
            founder_status=m.get("founder_status"),
            health=a.get("health") or {},
        ))

    # Sort: needs_review first, then by founder_number ASC (nulls last).
    rows.sort(key=lambda r: (
        0 if r.status == "needs_review" else 1,
        r.founder_number if r.founder_number is not None else 10**6,
    ))

    return FounderReviewResponse(
        rows=rows,
        active=active,
        needs_review=needs_review,
        cap=cap,
        applications_open=applications_open,
    )


class DowngradeRequest(BaseModel):
    reason: Optional[str] = None


@router.post("/admin/founders/{slug}/downgrade")
async def downgrade_to_free(
    slug: str,
    body: DowngradeRequest,
    claims: dict = Depends(current_admin),
):
    """Move a Founder back to the Free tier — frees a slot without
    deleting anything.

    - Keeps the maker record and every product/listing intact.
    - Strips ``tier``, ``founder_status``, ``founder_number``, and any
      inflight founder expiry timestamps.
    - Appends an entry to ``activity_events`` for the audit trail.
    - Recomputes the applications gate but never auto-reopens it — an
      admin has to click "Reopen".
    """
    m = await db.makers.find_one({"slug": slug})
    if not m:
        raise HTTPException(404, "Maker not found.")
    if (m.get("tier") or "") != "founder":
        raise HTTPException(400, "This maker is not on the Founder tier.")

    prev_founder_number = m.get("founder_number")
    prev_status = m.get("founder_status")

    # iter421b — Snapshot the maker's full activity + health *before*
    # the downgrade so the audit event captures why the decision was
    # made. Turning a subjective call into a documented, reviewable one.
    activity_snapshot = await _activity_signals_for(m)

    await db.makers.update_one(
        {"slug": slug},
        {
            "$set": {
                "tier": "standard",
                "founder_downgraded_at": now_iso(),
                "founder_downgraded_by": claims["email"],
                "founder_downgrade_reason": (body.reason or "").strip()[:400] or None,
            },
            "$unset": {
                "founder_status": "",
                "founder_number": "",
                "founder_started_at": "",
                "founder_expires_at": "",
                "founder_grace_until": "",
            },
        },
    )

    health = activity_snapshot.get("health") or {}
    # Audit trail — captures the decision maker, the decision reason,
    # AND the marketplace state at decision time.
    await db.activity_events.insert_one({
        "id": str(uuid.uuid4()),
        "kind": "admin",
        "actor": claims["email"],
        "action": "founder_downgrade",
        "target_slug": slug,
        "target_founder_number": prev_founder_number,
        "target_founder_status": prev_status,
        "reason": (body.reason or "").strip()[:400] or None,
        "text": (
            f"{claims['email']} moved {slug} from Founder "
            f"(#{prev_founder_number or '?'}, {prev_status or '?'}) → Free"
        ),
        # iter421b — Full state snapshot at decision time.
        "snapshot": {
            "health_score": health.get("score"),
            "health_stars": health.get("stars"),
            "health_verdict": health.get("verdict"),
            "health_breakdown": health.get("breakdown"),
            "completeness_pct": health.get("completeness_pct"),
            "signals": activity_snapshot.get("signals"),
            "last_login": activity_snapshot.get("last_login"),
            "published_products": activity_snapshot.get("published_products"),
            "total_products": activity_snapshot.get("total_products"),
            "last_product_update": activity_snapshot.get("last_product_update"),
            "sales_count": activity_snapshot.get("sales_count"),
            "sales_30d": activity_snapshot.get("sales_30d"),
            "views_7d": activity_snapshot.get("views_7d"),
        },
        "created_at": now_iso(),
    })

    logger.info(
        "[founders] downgrade: %s → free (was #%s / %s) by %s",
        slug, prev_founder_number, prev_status, claims["email"],
    )

    # Applications gate: recount but do NOT auto-reopen.
    active = await _count_active_founders()
    cap = await _get_slots_total()

    return {
        "downgraded": True,
        "slug": slug,
        "active_founders_after": active,
        "cap": cap,
        "applications_open": await _get_applications_open(),
        "slots_available": max(0, cap - active),
    }


class GateRequest(BaseModel):
    open: bool


@router.post("/admin/founders/applications-gate")
async def set_applications_gate(
    body: GateRequest,
    claims: dict = Depends(current_admin),
):
    """Manual open/close of the Founder application gate.

    Reopening still respects the cap — if the marketplace is at or
    over the active-Founder cap, we surface a warning but honor the
    admin's decision (they may want to reopen at 88/100 to keep
    momentum during downgrade sweeps)."""
    await _set_applications_open(body.open, claims["email"])
    logger.info(
        "[founders] admin %s set applications_open=%s",
        claims["email"], body.open,
    )
    active = await _count_active_founders()
    cap = await _get_slots_total()
    return {
        "applications_open": body.open,
        "active_founders": active,
        "cap": cap,
        "at_or_over_cap": active >= cap,
    }


# =========================================================
#   FOUNDER TIMELINE (iter421b)
# =========================================================
class TimelineEvent(BaseModel):
    ts: str
    kind: str        # applied, verified, approved, shop_published, first_product,
                     # ten_products, first_sale, downgraded, reinstated
    label: str       # human-readable
    detail: Optional[str] = None
    actor: Optional[str] = None
    snapshot: Optional[dict] = None  # populated for downgrade events


class TimelineResponse(BaseModel):
    slug: str
    name: Optional[str] = None
    events: list[TimelineEvent]


@router.get("/admin/founders/{slug}/timeline", response_model=TimelineResponse)
async def founder_timeline(slug: str, _: dict = Depends(current_admin)):
    """Chronological history of a founder account. Composed on-demand
    from existing collections so no new writes were needed to enable
    it. Events surface: application, email verification, approval, first
    shop publish, first product, 10-product milestone, first sale,
    any admin downgrade/reinstate audit entries.

    Support-facing utility — if a founder emails asking "why was I
    moved" you can pull this and see the whole story."""
    m = await db.makers.find_one({"slug": slug})
    if not m:
        raise HTTPException(404, "Maker not found.")

    events: list[TimelineEvent] = []

    # 1. Application submitted / verified (from beta_applications, matched by email).
    email = (m.get("email") or "").lower()
    if email:
        try:
            app_doc = await db.beta_applications.find_one({"email": email})
            if app_doc:
                if app_doc.get("created_at"):
                    events.append(TimelineEvent(
                        ts=app_doc["created_at"], kind="applied",
                        label="Applied to Founding Access",
                        detail=app_doc.get("studio_name"),
                    ))
                if app_doc.get("verified") and app_doc.get("verified_at"):
                    events.append(TimelineEvent(
                        ts=app_doc["verified_at"], kind="verified",
                        label="Email Verified",
                    ))
        except Exception:
            pass

    # 2. Approved as Founder.
    if m.get("approved_at"):
        events.append(TimelineEvent(
            ts=m["approved_at"], kind="approved",
            label="Approved as Founder",
            detail=(f"#{m.get('founder_number')} · {m.get('founder_status') or 'regular'}"
                    if m.get("founder_number") else None),
        ))

    # 3. Shop published (first time the shop went live).
    if m.get("published_at"):
        events.append(TimelineEvent(
            ts=m["published_at"], kind="shop_published",
            label="Shop Published",
        ))

    # 4. First product + 10-product milestone.
    try:
        first = await db.products.find_one(
            {"maker_slug": slug, "status": {"$in": ["published", None]}},
            sort=[("created_at", 1)],
        )
        if first and first.get("created_at"):
            events.append(TimelineEvent(
                ts=first["created_at"], kind="first_product",
                label="First Product Listed",
                detail=first.get("title") or first.get("slug"),
            ))

        # 10th product — find the 10th earliest.
        tenth_cur = db.products.find(
            {"maker_slug": slug, "status": {"$in": ["published", None]}},
            {"created_at": 1, "title": 1, "_id": 0},
        ).sort("created_at", 1).limit(10)
        tenth = await tenth_cur.to_list(10)
        if len(tenth) >= 10:
            events.append(TimelineEvent(
                ts=tenth[-1]["created_at"], kind="ten_products",
                label="10-Product Milestone",
                detail=tenth[-1].get("title"),
            ))
    except Exception:
        pass

    # 5. First sale.
    try:
        first_sale = await db.orders.find_one(
            {"maker_slug": slug,
             "status": {"$in": ["paid", "fulfilled", "shipped", "succeeded", "complete"]}},
            sort=[("created_at", 1)],
        )
        if first_sale and first_sale.get("created_at"):
            events.append(TimelineEvent(
                ts=first_sale["created_at"], kind="first_sale",
                label="First Sale",
                detail=f"${first_sale.get('total', 0):.2f}"
                       if first_sale.get("total") is not None else None,
            ))
    except Exception:
        pass

    # 6. Admin actions — downgrade + any future reinstate events.
    try:
        audits_cur = db.activity_events.find(
            {"kind": "admin", "target_slug": slug,
             "action": {"$in": ["founder_downgrade", "founder_reinstate"]}},
        ).sort("created_at", 1)
        async for a in audits_cur:
            events.append(TimelineEvent(
                ts=a.get("created_at") or "",
                kind="downgraded" if a["action"] == "founder_downgrade" else "reinstated",
                label="Moved to Free" if a["action"] == "founder_downgrade" else "Reinstated as Founder",
                detail=a.get("reason"),
                actor=a.get("actor"),
                snapshot=a.get("snapshot"),
            ))
    except Exception:
        pass

    # Sort chronologically ascending.
    events = [e for e in events if e.ts]
    events.sort(key=lambda e: e.ts)

    return TimelineResponse(
        slug=slug,
        name=m.get("name"),
        events=events,
    )
