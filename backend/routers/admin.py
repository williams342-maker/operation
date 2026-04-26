"""Admin console: magic-link auth, applications/custom-orders/paid-orders dashboards."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from core import ADMIN_EMAILS, db, logger, now_iso
from email_service import (
    send_admin_magic_link, send_application_decision, send_custom_order_quote,
)
from maker_auth import (
    current_admin, issue_admin_magic_token, issue_session_jwt, verify_admin_magic_token,
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
