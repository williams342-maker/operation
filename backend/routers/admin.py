"""Admin console: magic-link auth, applications/custom-orders/paid-orders dashboards."""
from typing import Optional
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from core import ADMIN_EMAILS, db, logger, now_iso
from email_service import (
    send_admin_magic_link, send_application_decision, send_custom_order_quote,
)
from maker_auth import (
    current_admin, current_buyer, current_maker_slug, decode_session_jwt,
    issue_admin_magic_token, issue_session_jwt, verify_admin_magic_token,
)
from models import (
    AdminLoginRequest, AdminVerifyRequest, ApplicationDecision, CustomOrderQuote,
)

router = APIRouter()


@router.post("/admin/auth/request")
async def admin_auth_request(payload: AdminLoginRequest, bg: BackgroundTasks):
    """Issue an admin magic link only if the requested email is in the admin allow-list."""
    email = payload.email.lower().strip()
    if email in ADMIN_EMAILS:
        token = issue_admin_magic_token(email)
        link = f"{payload.origin_url.rstrip('/')}/admin/verify?token={token}"
        bg.add_task(send_admin_magic_link, email, link)
        logger.info("admin magic link issued for %s", email)
    else:
        logger.info("admin link requested for non-admin email=%s (silent)", email)
    return {"sent": True, "message": "If that email is the operator on file, a sign-in link is on its way."}


@router.post("/admin/auth/verify")
async def admin_auth_verify(payload: AdminVerifyRequest):
    email = verify_admin_magic_token(payload.token)
    if email not in ADMIN_EMAILS:
        raise HTTPException(403, "Not an admin email.")
    jwt_token = issue_session_jwt("admin", email, role="admin")
    return {"token": jwt_token, "email": email}


@router.get("/admin/me")
async def admin_me(claims: dict = Depends(current_admin)):
    return {"email": claims["email"], "role": claims["role"]}


@router.get("/admin/maker-applications")
async def admin_maker_applications(_: dict = Depends(current_admin)):
    return await db.maker_applications.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/admin/custom-orders")
async def admin_custom_orders(_: dict = Depends(current_admin)):
    return await db.custom_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/admin/orders")
async def admin_orders(_: dict = Depends(current_admin)):
    """All paid orders, newest first."""
    return await db.payment_transactions.find(
        {"payment_status": "paid"}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)


@router.post("/admin/orders/{session_id}/refund")
async def admin_refund_order(session_id: str, _: dict = Depends(current_admin)):
    """Full refund: reverses the buyer's charge AND every maker transfer for
    this session. Platform fee is also refunded (full reversal). Idempotent.
    """
    from routers.stripe_connect import refund_session
    return await refund_session(session_id)


@router.patch("/admin/maker-applications/{app_id}")
async def admin_decide_application(
    app_id: str, body: ApplicationDecision, bg: BackgroundTasks,
    claims: dict = Depends(current_admin),
):
    appn = await db.maker_applications.find_one({"id": app_id}, {"_id": 0})
    if not appn:
        raise HTTPException(404, "Application not found")
    new_status = "approved" if body.approved else "rejected"
    decided_at = now_iso()
    decided_by = claims["email"]
    await db.maker_applications.update_one(
        {"id": app_id},
        {"$set": {"status": new_status, "note": body.note,
                  "decided_at": decided_at, "decided_by": decided_by}},
    )
    bg.add_task(
        send_application_decision,
        appn["email"], appn["name"], appn["studio_name"], body.approved, body.note or "",
    )
    appn["status"] = new_status
    appn["note"] = body.note
    appn["decided_at"] = decided_at
    appn["decided_by"] = decided_by
    return appn


@router.patch("/admin/custom-orders/{order_id}")
async def admin_quote_custom_order(
    order_id: str, body: CustomOrderQuote, bg: BackgroundTasks,
    claims: dict = Depends(current_admin),
):
    order = await db.custom_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Custom order not found")
    quoted_at = now_iso()
    quoted_by = claims["email"]
    await db.custom_orders.update_one(
        {"id": order_id},
        {"$set": {"status": "quoted", "quote": body.quote, "quote_note": body.message,
                  "quoted_at": quoted_at, "quoted_by": quoted_by}},
    )
    bg.add_task(
        send_custom_order_quote,
        order["email"], order["name"], order["project_type"], body.quote, body.message or "",
    )
    order["status"] = "quoted"
    order["quote"] = body.quote
    order["quote_note"] = body.message
    order["quoted_at"] = quoted_at
    order["quoted_by"] = quoted_by
    return order



# ===================== ANALYTICS =====================
@router.get("/admin/analytics")
async def admin_analytics(_: dict = Depends(current_admin)):
    """Aggregated marketplace stats — used by the dashboard's Analytics tab."""
    paid = await db.payment_transactions.find(
        {"payment_status": "paid"}, {"_id": 0}
    ).to_list(2000)
    gmv = round(sum(float(t.get("amount", 0)) for t in paid), 2)
    avg_order = round(gmv / len(paid), 2) if paid else 0.0

    cutoff_30 = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    cutoff_7 = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    paid_30 = [t for t in paid if t.get("created_at", "") >= cutoff_30]
    paid_7 = [t for t in paid if t.get("created_at", "") >= cutoff_7]
    gmv_30 = round(sum(float(t.get("amount", 0)) for t in paid_30), 2)
    gmv_7 = round(sum(float(t.get("amount", 0)) for t in paid_7), 2)

    units: dict[str, int] = {}
    for t in paid:
        for ci in t.get("items", []):
            pid = ci.get("product_id", "")
            units[pid] = units.get(pid, 0) + int(ci.get("quantity", 1))
    top = []
    for pid, n in sorted(units.items(), key=lambda x: -x[1])[:5]:
        prod = await db.products.find_one(
            {"$or": [{"id": pid}, {"slug": pid}]},
            {"_id": 0, "slug": 1, "title": 1, "price": 1, "maker_slug": 1},
        )
        if prod:
            top.append({"slug": prod["slug"], "title": prod["title"],
                        "maker_slug": prod["maker_slug"], "units": n,
                        "revenue": round(float(prod["price"]) * n, 2)})

    maker_gmv: dict[str, float] = {}
    for t in paid:
        for ci in t.get("items", []):
            pid = ci.get("product_id", "")
            prod = await db.products.find_one(
                {"$or": [{"id": pid}, {"slug": pid}]},
                {"_id": 0, "maker_slug": 1, "price": 1},
            )
            if prod:
                maker_gmv[prod["maker_slug"]] = (
                    maker_gmv.get(prod["maker_slug"], 0.0)
                    + float(prod["price"]) * int(ci.get("quantity", 1))
                )
    top_makers = []
    for slug, rev in sorted(maker_gmv.items(), key=lambda x: -x[1])[:5]:
        m = await db.makers.find_one({"slug": slug}, {"_id": 0, "slug": 1, "name": 1})
        if m:
            top_makers.append({"slug": m["slug"], "name": m["name"], "revenue": round(rev, 2)})

    return {
        "gmv": gmv, "gmv_30d": gmv_30, "gmv_7d": gmv_7,
        "paid_orders": len(paid),
        "paid_orders_30d": len(paid_30),
        "paid_orders_7d": len(paid_7),
        "avg_order": avg_order,
        "products_count": await db.products.count_documents({}),
        "makers_count": await db.makers.count_documents({}),
        "applications_pending": await db.maker_applications.count_documents({"status": {"$exists": False}}),
        "custom_orders_open": await db.custom_orders.count_documents({"status": {"$ne": "quoted"}}),
        "community_users": await db.community_users.count_documents({}),
        "showcase_posts": await db.showcase_posts.count_documents({}),
        "forum_threads": await db.forum_threads.count_documents({}),
        "design_files": await db.design_files.count_documents({}),
        "chat_messages_30d": await db.chat_messages.count_documents({"created_at": {"$gte": cutoff_30}}),
        "top_products": top,
        "top_makers": top_makers,
    }


# ===================== USERS =====================
@router.get("/admin/community-users")
async def admin_community_users(_: dict = Depends(current_admin)):
    return await db.community_users.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)


# ===================== LISTINGS =====================
class AdminProductPatch(BaseModel):
    featured: Optional[bool] = None
    in_stock: Optional[int] = None
    price: Optional[float] = None
    title: Optional[str] = None


@router.patch("/admin/products/{slug}")
async def admin_patch_product(slug: str, body: AdminProductPatch, _: dict = Depends(current_admin)):
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if updates:
        r = await db.products.update_one({"slug": slug}, {"$set": updates})
        if r.matched_count == 0:
            raise HTTPException(404, "Product not found")
    return await db.products.find_one({"slug": slug}, {"_id": 0})


@router.delete("/admin/products/{slug}")
async def admin_delete_product(slug: str, _: dict = Depends(current_admin)):
    r = await db.products.delete_one({"slug": slug})
    if r.deleted_count == 0:
        raise HTTPException(404, "Product not found")
    return {"deleted": True}


# ===================== REVIEWS =====================
class ReviewCreate(BaseModel):
    name: str
    location: str
    rating: int = 5
    text: str
    product_slug: Optional[str] = None


@router.post("/admin/reviews")
async def admin_create_review(body: ReviewCreate, _: dict = Depends(current_admin)):
    import uuid
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": now_iso()}
    await db.reviews.insert_one(doc.copy())
    return {k: v for k, v in doc.items() if k != "_id"}


@router.delete("/admin/reviews/{review_id}")
async def admin_delete_review(review_id: str, _: dict = Depends(current_admin)):
    r = await db.reviews.delete_one({"id": review_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Review not found")
    return {"deleted": True}


# ===================== MODERATOR (admin OR maker can hard-delete) =====================
from fastapi import Header  # noqa: E402


def _require_mod(authorization: str | None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_session_jwt(token)
    if claims.get("role") not in ("admin", "maker"):
        raise HTTPException(403, "Moderator access required.")
    return claims


@router.delete("/admin/chat-messages/{msg_id}")
async def mod_delete_chat_message(msg_id: str, authorization: str | None = Header(default=None)):
    claims = _require_mod(authorization)
    r = await db.chat_messages.delete_one({"id": msg_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Message not found")
    return {"deleted": True, "by": claims["email"]}


@router.delete("/admin/forum-threads/{thread_id}")
async def mod_delete_forum_thread(thread_id: str, authorization: str | None = Header(default=None)):
    claims = _require_mod(authorization)
    await db.forum_threads.delete_one({"id": thread_id})
    await db.forum_replies.delete_many({"thread_id": thread_id})
    return {"deleted": True, "by": claims["email"]}


@router.delete("/admin/forum-replies/{reply_id}")
async def mod_delete_forum_reply(reply_id: str, authorization: str | None = Header(default=None)):
    claims = _require_mod(authorization)
    rep = await db.forum_replies.find_one({"id": reply_id}, {"_id": 0})
    if not rep:
        raise HTTPException(404, "Reply not found")
    await db.forum_replies.delete_one({"id": reply_id})
    await db.forum_threads.update_one(
        {"id": rep.get("thread_id")}, {"$inc": {"reply_count": -1}}
    )
    return {"deleted": True, "by": claims["email"]}
