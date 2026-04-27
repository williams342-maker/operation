"""Public catalog: products, makers, reviews, blog, activity, custom-orders, maker-applications."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile

from core import db, now_iso
from email_service import (
    send_applicant_received, send_buyer_custom_ack,
    send_ops_new_application, send_ops_new_custom_order,
)
from models import (
    ActivityEvent, BlogPost, CustomOrder, CustomOrderCreate,
    Maker, MakerApplication, MakerApplicationCreate,
    Product, Review, ReviewCreate,
)

router = APIRouter()


@router.get("/policy/version")
async def policy_version():
    """Public — frontend stamps this onto consent payloads so audit trail
    and live UI agree on the policy text the buyer agreed to."""
    from core import POLICY_VERSION
    return {"version": POLICY_VERSION}


@router.get("/policy/fee-policy")
async def fee_policy():
    """Public — surfaces the live fee structure (commission, processing,
    listing fees, Plus tier, off-site ad fee) so the Apply page and the
    Stripe Connect onboarding card render numbers from a single source of
    truth instead of hard-coded copy that can drift from `backend/.env`."""
    from revenue import (
        LISTING_FEE_CENTS, LISTING_FREE_QUOTA,
        PROMOTION_WEEKLY_FEE_CENTS, PLUS_PLATFORM_FEE_BPS,
        PLUS_MONTHLY_LISTING_QUOTA, PLUS_PRICE_USD, OFFSITE_AD_FEE_BPS,
    )
    from routers.stripe_connect import PLATFORM_FEE_BPS, PROCESSING_FEE_BPS
    return {
        "platform_fee_bps": PLATFORM_FEE_BPS,
        "processing_fee_bps": PROCESSING_FEE_BPS,
        "plus_platform_fee_bps": PLUS_PLATFORM_FEE_BPS,
        "offsite_ad_fee_bps": OFFSITE_AD_FEE_BPS,
        "listing_fee_cents": LISTING_FEE_CENTS,
        "listing_free_quota": LISTING_FREE_QUOTA,
        "plus_monthly_listing_quota": PLUS_MONTHLY_LISTING_QUOTA,
        "plus_price_usd": PLUS_PRICE_USD,
        "promotion_weekly_fee_cents": PROMOTION_WEEKLY_FEE_CENTS,
    }


@router.get("/")
async def root():
    return {"service": "crafters-market", "status": "ok"}


@router.get("/products", response_model=List[Product])
async def list_products(category: Optional[str] = None, technique: Optional[str] = None,
                        q: Optional[str] = None, featured: Optional[bool] = None,
                        maker: Optional[str] = None):
    # Exclude soft-deleted listings AND drafts. In Mongo, `field: None` matches
    # both missing-field AND explicit-null docs — covers Pydantic's habit of
    # serializing Optional fields as null. Backwards-compat: products predating
    # the `status` field have no `status` key, so we use $ne:"draft" instead of
    # status:"published" so they keep showing up.
    query: Dict = {"deleted_at": None, "status": {"$ne": "draft"}}
    if category:
        query["category"] = category
    if technique:
        query["technique"] = technique.upper()
    if featured is not None:
        query["featured"] = featured
    if maker:
        query["maker_slug"] = maker
    if q:
        query["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
        ]
    # Promoted listings (those with promoted_until in the future) bubble to
    # the top. Sort key: is_promoted desc, then created_at desc.
    from core import now_iso
    products = await db.products.find(query, {"_id": 0}).to_list(400)
    nowiso = now_iso()

    def _sort_key(p):
        promo = p.get("promoted_until")
        is_promoted = bool(promo and promo > nowiso)
        return (0 if is_promoted else 1, -(p.get("created_at") or "").__hash__())
    # Stable sort: promoted first, then most-recent.
    products.sort(key=lambda p: (
        0 if (p.get("promoted_until") and p["promoted_until"] > nowiso) else 1,
        p.get("created_at") or "",
    ), reverse=False)
    # The reverse-sort trick: tuple (group, created) — group ascending puts
    # promoted first; we then re-sort within each group by created_at desc.
    promoted = [p for p in products if p.get("promoted_until") and p["promoted_until"] > nowiso]
    rest = [p for p in products if not (p.get("promoted_until") and p["promoted_until"] > nowiso)]
    promoted.sort(key=lambda p: p.get("created_at") or "", reverse=True)
    rest.sort(key=lambda p: p.get("created_at") or "", reverse=True)
    return (promoted + rest)[:200]


@router.get("/products/{slug}", response_model=Product)
async def get_product(slug: str):
    doc = await db.products.find_one(
        {"slug": slug, "deleted_at": None, "status": {"$ne": "draft"}}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(404, "Product not found")
    return doc


@router.get("/makers", response_model=List[Maker])
async def list_makers():
    return await db.makers.find({}, {"_id": 0}).to_list(200)


@router.get("/makers/{slug}", response_model=Maker)
async def get_maker(slug: str):
    doc = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Maker not found")
    return doc


@router.get("/reviews", response_model=List[Review])
async def list_reviews(
    limit: int = 20,
    maker_slug: Optional[str] = None,
    product_slug: Optional[str] = None,
):
    """Returns recent reviews. Optional filters by maker or product slug."""
    q: Dict = {}
    if maker_slug:
        q["maker_slug"] = maker_slug
    if product_slug:
        q["product_slug"] = product_slug
    return await db.reviews.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.post("/reviews", response_model=Review)
async def create_review(payload: ReviewCreate):
    """Public review submission. Lightly validated — no auth required to keep
    the post-purchase email CTA frictionless."""
    if not payload.name.strip() or not payload.text.strip():
        raise HTTPException(400, "Name and text are required.")
    if not (1 <= payload.rating <= 5):
        raise HTTPException(400, "Rating must be between 1 and 5.")
    if not (payload.maker_slug or payload.product_slug):
        raise HTTPException(400, "Either maker_slug or product_slug is required.")
    # If only product is given, derive the maker so listings can roll up cleanly.
    maker_slug = payload.maker_slug
    if payload.product_slug and not maker_slug:
        prod = await db.products.find_one(
            {"slug": payload.product_slug}, {"_id": 0, "maker_slug": 1},
        )
        if prod:
            maker_slug = prod.get("maker_slug")
    review = Review(
        name=payload.name.strip()[:80],
        location=(payload.location or "").strip()[:60],
        rating=payload.rating,
        text=payload.text.strip()[:1500],
        product_slug=payload.product_slug,
        maker_slug=maker_slug,
    )
    await db.reviews.insert_one(review.model_dump())
    return review


@router.get("/blog", response_model=List[BlogPost])
async def list_posts():
    return await db.blog_posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)


@router.get("/blog/{slug}", response_model=BlogPost)
async def get_post(slug: str):
    doc = await db.blog_posts.find_one({"slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Post not found")
    return doc


@router.post("/custom-orders", response_model=CustomOrder)
async def create_custom_order(payload: CustomOrderCreate, bg: BackgroundTasks):
    if not payload.policy_accepted:
        raise HTTPException(400, "You must accept the Site Policies to submit a custom order.")
    from core import POLICY_VERSION
    data = payload.model_dump()
    # Policy audit trail — stamp server time, server-known version.
    data["policy_version"] = POLICY_VERSION
    data["policy_accepted_at"] = now_iso()
    data.pop("policy_accepted", None)
    order = CustomOrder(**data)
    await db.custom_orders.insert_one(order.model_dump())
    await db.activity_events.insert_one(
        ActivityEvent(kind="applied",
                      text=f"New custom order — {payload.project_type}",
                      location="Custom queue").model_dump()
    )
    bg.add_task(send_ops_new_custom_order,
                payload.name, payload.email, payload.project_type,
                payload.material, payload.description, payload.budget)
    bg.add_task(send_buyer_custom_ack, payload.email, payload.name, payload.project_type)
    return order


@router.post("/custom-orders/upload-design")
async def upload_custom_order_design(file: UploadFile = File(...)):
    """Upload a buyer's design/sketch/reference for a custom-order brief.

    Public endpoint (no auth) because the custom-order wizard is itself
    public. Hard-capped at 10 MB and limited to common design formats so
    we don't accept arbitrary uploads from anonymous traffic.
    """
    try:
        from r2_storage import is_configured as _r2_ok, upload_bytes
    except Exception:
        raise HTTPException(503, "Upload service is not available.")
    if not _r2_ok():
        raise HTTPException(503, "Upload service is not configured.")

    fname = (file.filename or "").lower()
    allowed_ext = (".jpg", ".jpeg", ".png", ".svg", ".pdf", ".dxf", ".webp")
    if not fname.endswith(allowed_ext):
        raise HTTPException(400, f"Supported formats: {', '.join(allowed_ext)}")

    body = await file.read()
    if len(body) > 10 * 1024 * 1024:
        raise HTTPException(413, "Max file size is 10 MB.")

    ct_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".svg": "image/svg+xml",
        ".pdf": "application/pdf", ".dxf": "application/dxf",
    }
    ext = next((e for e in ct_map if fname.endswith(e)), ".bin")
    ct = ct_map[ext]
    import uuid as _uuid
    key = f"custom-orders/designs/{_uuid.uuid4().hex}{ext}"
    try:
        url = upload_bytes(body, key, ct, max_bytes=10 * 1024 * 1024)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(502, "Could not upload design.")
    return {"url": url, "filename": file.filename, "size": len(body)}


@router.post("/maker-applications", response_model=MakerApplication)
async def create_maker_application(payload: MakerApplicationCreate, bg: BackgroundTasks):
    # Honour the "Allow new maker applications" admin switch.
    from routers.settings import get_setting
    if not await get_setting("allow_maker_applications", True):
        msg = await get_setting(
            "applications_closed_message",
            "We're at capacity for new makers right now. Applications will reopen soon.",
        )
        raise HTTPException(403, msg)
    app_obj = MakerApplication(**payload.model_dump())
    # Auto-detect Founding Seller Beta signups (BetaPage prefixes the about
    # field with this marker before hitting /api/maker-applications).
    if "[FOUNDING SELLER BETA]" in (payload.about or ""):
        app_obj.is_beta = True
    await db.maker_applications.insert_one(app_obj.model_dump())
    await db.activity_events.insert_one(
        ActivityEvent(kind="applied",
                      text=f"{payload.studio_name} applied to the program",
                      location=payload.location).model_dump()
    )
    bg.add_task(send_ops_new_application,
                payload.name, payload.studio_name, payload.location,
                payload.email, payload.about)
    # Confirm receipt to the applicant immediately so they know we got it.
    bg.add_task(send_applicant_received,
                payload.email, payload.name, payload.studio_name)
    return app_obj


@router.get("/activity", response_model=List[ActivityEvent])
async def list_activity(limit: int = 20):
    return await db.activity_events.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


# ---------------------------------------------------------------------------
# Shop of the Week — Crafters Plus spotlight
# ---------------------------------------------------------------------------
# Surfaces the highest-GMV active Plus subscriber on the homepage with their
# custom shop banner + 3 best-selling products. Designed to give Plus
# subscribers a tangible, visible payoff and incentivise upgrades.
# ---------------------------------------------------------------------------
@router.get("/shop-of-the-week")
async def shop_of_the_week():
    # 1) Find all Plus subscribers (active OR trialing — both have full perks).
    plus_makers = await db.makers.find(
        {"subscription_status": {"$in": ["active", "trialing"]}}, {"_id": 0}
    ).to_list(200)
    if not plus_makers:
        return {"maker": None, "products": [], "weekly_gmv": 0.0}

    # 2) Aggregate paid GMV per maker over last 30 days. We pull from
    #    `maker_payouts` (already keyed by maker_slug + session) and resolve
    #    per-item units via `payment_transactions.items` joined to products.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    payout_rows = await db.maker_payouts.find(
        {"updated_at": {"$gte": cutoff}},
        {"_id": 0, "maker_slug": 1, "amount": 1, "session_id": 1},
    ).to_list(2000)

    gmv_by_maker: Dict[str, float] = defaultdict(float)
    sessions_by_maker: Dict[str, set] = defaultdict(set)
    for row in payout_rows:
        slug = row.get("maker_slug")
        if not slug:
            continue
        try:
            gmv_by_maker[slug] += float(row.get("amount") or 0)
        except (TypeError, ValueError):
            continue
        if row.get("session_id"):
            sessions_by_maker[slug].add(row["session_id"])

    # 3) Pick winner: highest GMV among Plus subscribers; tie-break on most
    #    recent subscription start (newest energetic shops bubble up).
    plus_slugs = {m["slug"] for m in plus_makers}
    ranked = sorted(
        plus_makers,
        key=lambda m: (
            -gmv_by_maker.get(m["slug"], 0.0),
            -((m.get("subscription_started_at") or "").__hash__()),
        ),
    )
    winner = ranked[0]

    # 4) Top 3 best-selling products in last 30d, fallback to newest published.
    #    Resolve via the winner's paid sessions → items → products.
    top_slugs: List[str] = []
    winner_sessions = list(sessions_by_maker.get(winner["slug"], set()))
    if winner_sessions:
        units: Dict[str, int] = defaultdict(int)
        txs = await db.payment_transactions.find(
            {"session_id": {"$in": winner_sessions[:500]}},
            {"_id": 0, "items": 1},
        ).to_list(500)
        # Build a set of product ids referenced, then resolve to slugs in one shot.
        wanted_ids: set[str] = set()
        line_qty: Dict[str, int] = defaultdict(int)
        for tx in txs:
            for it in tx.get("items") or []:
                pid = it.get("product_id")
                if not pid:
                    continue
                try:
                    qty = max(1, int(it.get("quantity") or 1))
                except (TypeError, ValueError):
                    qty = 1
                line_qty[pid] += qty
                wanted_ids.add(pid)
        if wanted_ids:
            id_docs = await db.products.find(
                {"$or": [{"id": {"$in": list(wanted_ids)}},
                         {"slug": {"$in": list(wanted_ids)}}],
                 "maker_slug": winner["slug"]},
                {"_id": 0, "id": 1, "slug": 1},
            ).to_list(200)
            for doc in id_docs:
                key = doc["id"] if doc["id"] in line_qty else doc.get("slug")
                if key in line_qty:
                    units[doc["slug"]] += line_qty[key]
        top_slugs = [s for s, _ in sorted(units.items(), key=lambda kv: kv[1], reverse=True)][:3]
    products: List[dict] = []
    if top_slugs:
        seen = set()
        docs = await db.products.find(
            {"slug": {"$in": top_slugs}, "deleted_at": None,
             "status": {"$ne": "draft"}, "maker_slug": winner["slug"]},
            {"_id": 0},
        ).to_list(10)
        # Preserve top-sellers order.
        by_slug = {d["slug"]: d for d in docs}
        for s in top_slugs:
            if s in by_slug and s not in seen:
                products.append(by_slug[s])
                seen.add(s)
    if len(products) < 3:
        # Fill with newest published from the same maker.
        existing = {p["slug"] for p in products}
        fillers = await db.products.find(
            {"maker_slug": winner["slug"], "deleted_at": None,
             "status": {"$ne": "draft"}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(10)
        for f in fillers:
            if f["slug"] not in existing:
                products.append(f)
            if len(products) >= 3:
                break

    return {
        "maker": winner,
        "products": products[:3],
        "weekly_gmv": round(gmv_by_maker.get(winner["slug"], 0.0), 2),
        "plus_subscribers_count": len(plus_slugs),
    }
