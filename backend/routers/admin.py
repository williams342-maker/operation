"""Admin console: magic-link auth, applications/custom-orders/paid-orders dashboards."""
from typing import Optional
import os
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from core import ADMIN_CAPABILITIES, ADMIN_CAP_PRESETS, ADMIN_EMAILS, db, logger, now_iso
from email_service import (
    send_admin_magic_link, send_admin_team_invite,
    send_application_decision, send_custom_order_quote,
)
from maker_auth import (
    admin_capabilities, current_admin, current_buyer, current_maker_slug,
    decode_session_jwt, issue_admin_magic_token, issue_session_jwt,
    require_super_admin, verify_admin_magic_token,
)
from models import (
    AdminLoginRequest, AdminVerifyRequest, ApplicationDecision, CustomOrderQuote,
)

router = APIRouter()


@router.post("/admin/auth/request")
async def admin_auth_request(payload: AdminLoginRequest, bg: BackgroundTasks):
    """Issue an admin magic link if the email is a super admin OR an active row in `admin_users`."""
    email = payload.email.lower().strip()
    is_team_admin = await db.admin_users.find_one({"email": email, "is_active": True}, {"_id": 0, "email": 1})
    if email in ADMIN_EMAILS or is_team_admin:
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
    is_super = email in ADMIN_EMAILS
    if not is_super:
        # Must be an active multi-tier admin
        row = await db.admin_users.find_one({"email": email, "is_active": True}, {"_id": 0})
        if not row:
            raise HTTPException(403, "This email is no longer authorized for admin access.")
    jwt_token = issue_session_jwt("admin", email, role="admin")
    # Stamp last_seen for audit trail
    await db.admin_users.update_one(
        {"email": email}, {"$set": {"last_seen": now_iso()}}, upsert=False,
    )
    return {"token": jwt_token, "email": email}


@router.get("/admin/me")
async def admin_me(claims: dict = Depends(current_admin)):
    is_super, caps = await admin_capabilities(claims)
    # Surface the password rotation status so the admin dashboard can render
    # a blocking "rotate your password" modal on page refresh (not just on
    # initial login). Cheap — one extra admin_users lookup per dashboard hit.
    email = claims["email"]
    user = await db.admin_users.find_one(
        {"email": email},
        {"_id": 0, "password_hash": 1, "last_password_change_at": 1, "password_set_at": 1},
    ) or {}
    from routers.auth_password import password_rotation_status
    rotation = password_rotation_status("admin", user)
    return {
        "email": email,
        "role": claims["role"],
        "is_super_admin": is_super,
        "capabilities": caps,
        "requires_password_rotation": rotation["required"],
        "password_rotation": rotation,
    }


# ─────────────────────── Team management (super-admin only) ───────────────────────
class AdminTeamInvite(BaseModel):
    email: EmailStr
    capabilities: list[str] = []
    note: Optional[str] = None


class AdminTeamUpdate(BaseModel):
    capabilities: Optional[list[str]] = None
    is_active: Optional[bool] = None


def _validate_caps(caps: list[str]) -> list[str]:
    cleaned = [c for c in (caps or []) if c in ADMIN_CAPABILITIES]
    if "read_only" in cleaned and len(cleaned) > 1:
        # Read-only is mutually exclusive — silently drop the others.
        cleaned = ["read_only"]
    # Dedupe while preserving order
    seen, out = set(), []
    for c in cleaned:
        if c not in seen:
            seen.add(c); out.append(c)
    return out


@router.get("/admin/team")
async def admin_team_list(claims: dict = Depends(require_super_admin())):
    rows = await db.admin_users.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    super_rows = [
        {
            "email": e, "is_super_admin": True, "is_active": True,
            "capabilities": list(ADMIN_CAPABILITIES),
            "added_by": "env:ADMIN_EMAILS", "added_at": None, "last_seen": None,
        }
        for e in sorted(ADMIN_EMAILS)
    ]
    # Surface presets for the UI dropdown
    return {
        "team": super_rows + rows,
        "presets": ADMIN_CAP_PRESETS,
        "capabilities": list(ADMIN_CAPABILITIES),
    }


@router.post("/admin/team")
async def admin_team_invite(
    payload: AdminTeamInvite, bg: BackgroundTasks,
    claims: dict = Depends(require_super_admin()),
):
    email = payload.email.lower().strip()
    if email in ADMIN_EMAILS:
        raise HTTPException(400, "This email is already a super admin via env.")
    caps = _validate_caps(payload.capabilities)
    if not caps:
        raise HTTPException(400, "Pick at least one capability.")
    soft_cap = await db.admin_users.count_documents({"is_active": True})
    if soft_cap >= 10:
        # Soft cap warning per PRD — log but allow.
        logger.warning("[admin-team] soft cap exceeded — %d active admins", soft_cap)
    existing = await db.admin_users.find_one({"email": email}, {"_id": 0})
    now = now_iso()
    if existing:
        await db.admin_users.update_one(
            {"email": email},
            {"$set": {"capabilities": caps, "is_active": True, "added_by": claims["email"]}},
        )
    else:
        await db.admin_users.insert_one({
            "email": email,
            "capabilities": caps,
            "is_active": True,
            "added_by": claims["email"],
            "added_at": now,
            "last_seen": None,
            "created_at": now,
        })
    # Email the new admin a branded invitation magic link.
    origin = (os.environ.get("PUBLIC_SITE_URL") or "").rstrip("/")
    if origin:
        token = issue_admin_magic_token(email)
        link = f"{origin}/admin/verify?token={token}"
        labels = ", ".join(c.replace("_", " ").title() for c in caps)
        bg.add_task(send_admin_team_invite, email, labels, link, claims["email"])
    # Audit trail + notify all super admins of the change
    await db.audit_log.insert_one({
        "kind": "admin_team_invite",
        "actor": claims["email"], "target": email, "capabilities": caps,
        "note": payload.note, "created_at": now,
    })
    return {"ok": True, "email": email, "capabilities": caps}


@router.patch("/admin/team/{email}")
async def admin_team_update(
    email: str, payload: AdminTeamUpdate,
    claims: dict = Depends(require_super_admin()),
):
    target = email.lower().strip()
    if target in ADMIN_EMAILS:
        raise HTTPException(400, "Super admins are managed via .env, not the UI.")
    if target == claims["email"].lower():
        raise HTTPException(400, "You can't modify your own row.")
    row = await db.admin_users.find_one({"email": target}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Admin not found.")
    update: dict = {}
    if payload.capabilities is not None:
        caps = _validate_caps(payload.capabilities)
        if not caps:
            raise HTTPException(400, "Pick at least one capability.")
        update["capabilities"] = caps
    if payload.is_active is not None:
        update["is_active"] = bool(payload.is_active)
    if not update:
        return {"ok": True, "noop": True}
    update["updated_at"] = now_iso()
    update["updated_by"] = claims["email"]
    await db.admin_users.update_one({"email": target}, {"$set": update})
    # Bump session_version so any active token they hold is invalidated.
    if "is_active" in update or "capabilities" in update:
        await db.session_versions.update_one(
            {"role": "admin", "subject": target},
            {"$inc": {"version": 1}}, upsert=True,
        )
    await db.audit_log.insert_one({
        "kind": "admin_team_update",
        "actor": claims["email"], "target": target, "patch": update,
        "created_at": now_iso(),
    })
    return {"ok": True, "patch": update}


@router.delete("/admin/team/{email}")
async def admin_team_delete(
    email: str, claims: dict = Depends(require_super_admin()),
):
    target = email.lower().strip()
    if target in ADMIN_EMAILS:
        raise HTTPException(400, "Super admins are managed via .env.")
    if target == claims["email"].lower():
        raise HTTPException(400, "You can't revoke your own access.")
    r = await db.admin_users.delete_one({"email": target})
    if r.deleted_count == 0:
        raise HTTPException(404, "Admin not found.")
    await db.session_versions.update_one(
        {"role": "admin", "subject": target},
        {"$inc": {"version": 1}}, upsert=True,
    )
    await db.audit_log.insert_one({
        "kind": "admin_team_revoke",
        "actor": claims["email"], "target": target, "created_at": now_iso(),
    })
    return {"ok": True, "revoked": target}


@router.get("/admin/maker-applications")
async def admin_maker_applications(_: dict = Depends(current_admin)):
    apps = await db.maker_applications.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Enrich approved apps with the maker's current beta status so the
    # ApplicationsList UI can render the 90-day countdown and toggle switch
    # without a second roundtrip per row.
    emails = [a.get("email") for a in apps if a.get("status") == "approved" and a.get("email")]
    if emails:
        makers = await db.makers.find(
            {"email": {"$in": emails}},
            {"_id": 0, "slug": 1, "email": 1, "is_beta": 1,
             "beta_approved_at": 1, "beta_expires_at": 1},
        ).to_list(len(emails))
        by_email = {m["email"]: m for m in makers if m.get("email")}
        for a in apps:
            m = by_email.get(a.get("email"))
            if m:
                a["maker_slug"] = m.get("slug")
                a["maker_is_beta"] = bool(m.get("is_beta"))
                a["maker_beta_approved_at"] = m.get("beta_approved_at")
                a["maker_beta_expires_at"] = m.get("beta_expires_at")
    return apps


class BetaToggleRequest(BaseModel):
    enabled: bool


@router.post("/admin/makers/{slug}/beta")
async def admin_toggle_maker_beta(
    slug: str, body: BetaToggleRequest, _: dict = Depends(current_admin),
):
    """Turn Founding Seller Beta on/off for a maker.

    Enabling stamps `is_beta=True`, `beta_approved_at=now`, and
    `beta_expires_at=now + 90 days` so the admin countdown starts on toggle.
    Disabling clears all three fields. Idempotent — re-enabling an already
    beta maker resets the 90-day window (documented, explicit admin action).
    """
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0, "slug": 1})
    if not maker:
        raise HTTPException(404, "Maker not found")
    if body.enabled:
        now_dt = datetime.now(timezone.utc)
        update = {
            "is_beta": True,
            "beta_approved_at": now_dt.isoformat(),
            "beta_expires_at": (now_dt + timedelta(days=90)).isoformat(),
        }
    else:
        update = {"is_beta": False, "beta_approved_at": None, "beta_expires_at": None}
    await db.makers.update_one({"slug": slug}, {"$set": update})
    logger.info("admin toggled beta: slug=%s enabled=%s", slug, body.enabled)
    return {"ok": True, "slug": slug, **update}


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
async def admin_refund_order(
    session_id: str, approval_id: str | None = None,
    claims: dict = Depends(current_admin),
):
    """Full refund: reverses the buyer's charge AND every maker transfer for
    this session. Platform fee is also refunded (full reversal). Idempotent.

    **Two-person rule**: refunds at or above `REFUND_DUAL_APPROVAL_USD`
    (default $500) require a second admin to approve via
    `/api/admin/refund-approvals/{id}/approve` before the refund executes.
    Without `approval_id`, the first call creates a pending approval and
    returns 202. The frontend then re-calls this endpoint with the
    `approval_id` once a different admin has approved.
    """
    threshold = float(os.environ.get("REFUND_DUAL_APPROVAL_USD") or 500)
    tx = await db.transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Order not found.")
    refund_amount = float(tx.get("total") or 0)

    # If above threshold and no approval, create / require one.
    if refund_amount >= threshold and not approval_id:
        existing = await db.refund_approvals.find_one(
            {"session_id": session_id, "status": "pending"}, {"_id": 0},
        )
        if not existing:
            ap_id = secrets.token_urlsafe(8)
            doc = {
                "id": ap_id,
                "session_id": session_id,
                "amount": round(refund_amount, 2),
                "buyer_email": tx.get("buyer_email"),
                "requested_by": claims["email"],
                "requested_at": now_iso(),
                "status": "pending",
                "approved_by": None, "approved_at": None,
                "denied_by": None, "denied_at": None,
                "executed_at": None,
            }
            await db.refund_approvals.insert_one(doc)
            await db.audit_log.insert_one({
                "kind": "refund_approval_requested",
                "actor": claims["email"], "session_id": session_id,
                "amount": refund_amount, "approval_id": ap_id,
                "created_at": now_iso(),
            })
            existing = doc
        return {
            "requires_approval": True, "approval_id": existing["id"],
            "amount": existing["amount"], "threshold": threshold,
            "requested_by": existing["requested_by"],
            "message": f"Refund ≥ ${threshold:.0f} needs a second admin's approval.",
        }

    # If approval_id provided, verify it's approved AND the approver isn't the requester.
    if approval_id:
        ap = await db.refund_approvals.find_one({"id": approval_id}, {"_id": 0})
        if not ap or ap.get("session_id") != session_id:
            raise HTTPException(404, "Approval not found for this order.")
        if ap.get("status") != "approved":
            raise HTTPException(409, f"Approval is {ap.get('status')}, not approved.")
        if ap.get("approved_by") and ap["approved_by"].lower() == claims["email"].lower():
            # Belt + braces — the approve endpoint already enforces this.
            raise HTTPException(403, "The approving admin must be different from the executor.")
        # Mark executed below after the actual refund succeeds.

    from routers.stripe_connect import refund_session
    result = await refund_session(session_id)
    if approval_id:
        await db.refund_approvals.update_one(
            {"id": approval_id}, {"$set": {"status": "executed", "executed_at": now_iso()}},
        )
    await db.audit_log.insert_one({
        "kind": "refund_executed",
        "actor": claims["email"], "session_id": session_id,
        "amount": refund_amount, "approval_id": approval_id,
        "created_at": now_iso(),
    })
    return result


# ─────────────────────── Refund approvals (two-person rule) ───────────────────────
@router.get("/admin/refund-approvals")
async def admin_list_refund_approvals(
    status: str = "pending", _: dict = Depends(current_admin),
):
    if status not in ("pending", "approved", "denied", "executed", "all"):
        raise HTTPException(400, "Invalid status.")
    q: dict = {} if status == "all" else {"status": status}
    rows = await db.refund_approvals.find(q, {"_id": 0}).sort("requested_at", -1).limit(200).to_list(200)
    threshold = float(os.environ.get("REFUND_DUAL_APPROVAL_USD") or 500)
    return {"approvals": rows, "threshold_usd": threshold}


@router.post("/admin/refund-approvals/{approval_id}/approve")
async def admin_approve_refund(
    approval_id: str, claims: dict = Depends(current_admin),
):
    ap = await db.refund_approvals.find_one({"id": approval_id}, {"_id": 0})
    if not ap:
        raise HTTPException(404, "Approval not found.")
    if ap.get("status") != "pending":
        raise HTTPException(409, f"Approval is {ap['status']}, not pending.")
    if ap.get("requested_by", "").lower() == claims["email"].lower():
        raise HTTPException(
            403, "Two-person rule: a different admin must approve this refund.",
        )
    await db.refund_approvals.update_one(
        {"id": approval_id},
        {"$set": {"status": "approved", "approved_by": claims["email"],
                  "approved_at": now_iso()}},
    )
    await db.audit_log.insert_one({
        "kind": "refund_approval_granted",
        "actor": claims["email"], "approval_id": approval_id,
        "session_id": ap.get("session_id"), "amount": ap.get("amount"),
        "created_at": now_iso(),
    })
    return {"ok": True, "approval_id": approval_id, "status": "approved"}


@router.post("/admin/refund-approvals/{approval_id}/deny")
async def admin_deny_refund(
    approval_id: str, claims: dict = Depends(current_admin),
):
    ap = await db.refund_approvals.find_one({"id": approval_id}, {"_id": 0})
    if not ap:
        raise HTTPException(404, "Approval not found.")
    if ap.get("status") != "pending":
        raise HTTPException(409, f"Approval is {ap['status']}, not pending.")
    await db.refund_approvals.update_one(
        {"id": approval_id},
        {"$set": {"status": "denied", "denied_by": claims["email"],
                  "denied_at": now_iso()}},
    )
    await db.audit_log.insert_one({
        "kind": "refund_approval_denied",
        "actor": claims["email"], "approval_id": approval_id,
        "session_id": ap.get("session_id"),
        "created_at": now_iso(),
    })
    return {"ok": True, "approval_id": approval_id, "status": "denied"}


@router.post("/admin/orders/{session_id}/refire-emails")
async def admin_refire_order_emails(
    session_id: str, claims: dict = Depends(current_admin),
):
    """Re-send the buyer receipt + maker order notification + ops alert for an
    existing paid order. Useful when a customer says "I never got the email"
    or a maker missed the new-order ping. Idempotent — does not double-charge
    or double-fulfill anything; only fires emails."""
    from email_service import (
        send_buyer_receipt, send_maker_new_order, send_ops_new_order,
    )
    tx = await db.transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Order not found.")
    sent: list[str] = []
    failed: list[dict] = []

    # Reconstruct order summary for the buyer receipt
    items = tx.get("items") or []
    summary_lines = [
        f"{(it.get('title') or 'Item')} × {it.get('quantity', 1)} — ${float(it.get('price', 0)):.2f}"
        for it in items
    ]
    summary = "\n".join(summary_lines) or "Your order"
    total = float(tx.get("amount", 0))

    # 1) Buyer receipt
    try:
        await send_buyer_receipt(
            buyer_email=tx.get("buyer_email") or "",
            summary=summary, total=total, items=items,
        )
        sent.append("buyer_receipt")
    except Exception as e:
        failed.append({"kind": "buyer_receipt", "error": str(e)})

    # 2) Maker per-line notifications
    by_maker: dict[str, list[dict]] = {}
    for it in items:
        ms = it.get("maker_slug")
        if ms:
            by_maker.setdefault(ms, []).append(it)
    for ms, lines in by_maker.items():
        maker = await db.makers.find_one({"slug": ms}, {"_id": 0})
        if not maker or not maker.get("email"):
            continue
        try:
            subtotal = sum(float(it.get("price", 0)) * int(it.get("quantity", 1)) for it in lines)
            await send_maker_new_order(
                maker_email=maker["email"],
                maker_name=maker.get("name") or ms,
                items=lines, subtotal=subtotal,
                buyer_email=tx.get("buyer_email"),
            )
            sent.append(f"maker:{ms}")
        except Exception as e:
            failed.append({"kind": f"maker:{ms}", "error": str(e)})

    # 3) Ops alert
    try:
        await send_ops_new_order(
            summary=summary, total=total, items=items,
            buyer_email=tx.get("buyer_email"),
        )
        sent.append("ops")
    except Exception as e:
        failed.append({"kind": "ops", "error": str(e)})

    logger.info(
        "[admin_refire_order_emails] %s by=%s sent=%s failed=%s",
        session_id, claims["email"], sent, failed,
    )
    return {"session_id": session_id, "sent": sent, "failed": failed}


@router.post("/admin/listings/expire-due")
async def admin_expire_due_listings(_: dict = Depends(current_admin)):
    """Run the listing-expiry sweep: any published listing past its
    expires_at flips to draft. Run on a daily cron (or manually here)."""
    from revenue import expire_due_listings
    return await expire_due_listings()


@router.post("/admin/r2/sweep")
async def admin_r2_sweep(apply: bool = False, _: dict = Depends(current_admin)):
    """Find (and optionally delete) orphaned R2 objects under products/ and
    models/ that are no longer referenced by any product row. Pass `?apply=true`
    to actually delete; default is dry-run for safety.
    """
    from scripts.sweep_r2_orphans import sweep
    return await sweep(apply=apply)


@router.post("/admin/digests/plus-roi")
async def admin_run_plus_roi_digest(apply: bool = False, _: dict = Depends(current_admin)):
    """Run the monthly Crafters Plus ROI digest job. Default `apply=false`
    is a dry-run that returns the list of candidates + projected savings;
    `?apply=true` actually sends the emails via MailerSend and stamps each
    maker so they're not re-emailed within the cooldown window.
    """
    from digests import run_plus_roi_digest
    return await run_plus_roi_digest(apply=apply)


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

    sign_in_link = ""
    if body.approved:
        # Auto-create the maker doc + mint a magic-link so the welcome packet
        # has a frictionless 1-click portal entry.
        from models import Maker
        import re

        existing = await db.makers.find_one({"email": appn["email"]}, {"_id": 0})
        if not existing:
            base_slug = re.sub(r"[^a-z0-9]+", "-",
                               (appn.get("studio_name") or appn.get("name") or "maker").lower()).strip("-")
            slug = base_slug or f"maker-{app_id[:6]}"
            i = 2
            while await db.makers.find_one({"slug": slug}, {"_id": 0, "slug": 1}):
                slug = f"{base_slug}-{i}"
                i += 1
            initials = "".join(w[0] for w in (appn.get("studio_name") or appn.get("name", "M")).split()[:2]).upper()[:3] or "M"
            # Founding Seller Beta auto-provision — if the applicant came
            # through /beta, stamp the maker as beta with a 90-day window
            # so the admin countdown starts the moment we approve them.
            is_beta = bool(appn.get("is_beta"))
            beta_approved_at = None
            beta_expires_at = None
            if is_beta:
                now_dt = datetime.now(timezone.utc)
                beta_approved_at = now_dt.isoformat()
                beta_expires_at = (now_dt + timedelta(days=90)).isoformat()
            new_maker = Maker(
                slug=slug,
                name=appn.get("studio_name") or appn["name"],
                initials=initials,
                location=appn.get("location") or "",
                bio=appn.get("about") or "",
                techniques=[],
                portrait="",
                cover="",
                email=appn["email"],
                is_beta=is_beta,
                beta_approved_at=beta_approved_at,
                beta_expires_at=beta_expires_at,
            )
            await db.makers.insert_one(new_maker.model_dump())
            logger.info("auto-created maker on approval: slug=%s email=%s beta=%s",
                        slug, appn["email"], is_beta)
        elif appn.get("is_beta") and not existing.get("is_beta"):
            # Maker already exists (they previously applied as a non-beta
            # maker and now re-applied through /beta) — stamp the beta
            # flags onto their existing doc instead of creating a new one.
            now_dt = datetime.now(timezone.utc)
            await db.makers.update_one(
                {"slug": existing["slug"]},
                {"$set": {
                    "is_beta": True,
                    "beta_approved_at": now_dt.isoformat(),
                    "beta_expires_at": (now_dt + timedelta(days=90)).isoformat(),
                }},
            )
            logger.info("upgraded existing maker to beta: slug=%s", existing["slug"])

        # Mint a magic-link for the maker portal
        from maker_auth import issue_magic_token
        site = os.environ.get("FRONTEND_URL") or "https://craftersmarket.org"
        token = issue_magic_token(appn["email"])
        sign_in_link = f"{site.rstrip('/')}/maker/verify?token={token}"

    bg.add_task(
        send_application_decision,
        appn["email"], appn["name"], appn["studio_name"], body.approved, body.note or "",
        sign_in_link,
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
def _weekly_gmv(paid_txs: list[dict], maker_filter: dict | None = None,
                weeks: int = 12) -> list[dict]:
    """Return last N weeks of GMV (Mon-anchored buckets, oldest first).

    If maker_filter is provided ({slug -> [valid_product_keys]}), only count
    line-items that belong to that maker.
    """
    now = datetime.now(timezone.utc)
    # Anchor to most recent Monday 00:00 UTC.
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    anchor = today - timedelta(days=today.weekday())          # Monday this week
    buckets = []
    for i in range(weeks - 1, -1, -1):
        start = anchor - timedelta(days=7 * i)
        buckets.append({"week_start": start.isoformat(), "total": 0.0})
    cutoff_iso = (anchor - timedelta(days=7 * (weeks - 1))).isoformat()
    for tx in paid_txs:
        ts = tx.get("created_at", "")
        if ts < cutoff_iso:
            continue
        try:
            tx_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue
        # Map to bucket
        delta_days = (tx_dt - anchor).days
        bucket_idx = (weeks - 1) + (delta_days // 7)
        if bucket_idx < 0 or bucket_idx >= weeks:
            continue
        if maker_filter is None:
            buckets[bucket_idx]["total"] += float(tx.get("amount", 0))
        else:
            # Sum only this maker's lines (by product price * qty)
            for line in maker_filter.get(tx["session_id"], []):
                buckets[bucket_idx]["total"] += line
    for b in buckets:
        b["total"] = round(b["total"], 2)
    return buckets


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
        "weekly_gmv": _weekly_gmv(paid),
    }


# ===================== COHORT RETENTION =====================
def _iso_to_week_key(iso: str) -> Optional[str]:
    """Returns ISO-week string YYYY-Www so cohorts align across years."""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        y, w, _ = dt.isocalendar()
        return f"{y}-W{w:02d}"
    except Exception:
        return None


def _week_diff(start_key: str, target_key: str) -> Optional[int]:
    """Number of ISO weeks between two YYYY-Www keys (0+ if target is later,
    negative skipped). Cheap approximation — good enough for a 12-week heatmap."""
    try:
        sy, sw = start_key.split("-W"); ty, tw = target_key.split("-W")
        return (int(ty) - int(sy)) * 52 + (int(tw) - int(sw))
    except Exception:
        return None


@router.get("/admin/analytics/cohorts")
async def admin_cohorts(weeks: int = 12, _: dict = Depends(current_admin)):
    """Buyer cohort retention. For every weekly cohort (anchored to the
    buyer's first paid order), how many of those buyers came back in week
    +1, +2, … +N? Returns a heatmap-friendly row-per-cohort structure."""
    weeks = max(4, min(weeks, 26))
    paid = await db.payment_transactions.find(
        {"payment_status": "paid", "customer_email": {"$ne": None, "$ne": ""}},
        {"_id": 0, "customer_email": 1, "created_at": 1, "amount": 1},
    ).sort("created_at", 1).to_list(20000)

    # Group orders by buyer
    by_buyer: dict[str, list[dict]] = {}
    for tx in paid:
        e = (tx.get("customer_email") or "").lower().strip()
        if not e or not tx.get("created_at"):
            continue
        by_buyer.setdefault(e, []).append(tx)

    # First-purchase week → cohort membership
    cohort_members: dict[str, set[str]] = {}     # week_key → emails
    cohort_first_amount: dict[str, float] = {}   # week_key → first-order GMV
    for email, txs in by_buyer.items():
        first = txs[0]
        wk = _iso_to_week_key(first["created_at"])
        if not wk:
            continue
        cohort_members.setdefault(wk, set()).add(email)
        cohort_first_amount[wk] = (
            cohort_first_amount.get(wk, 0.0) + float(first.get("amount", 0))
        )

    # Retention matrix — rows = cohort weeks (most recent N), cols = +0..+weeks
    cohort_keys = sorted(cohort_members.keys())[-weeks:]
    rows = []
    for ck in cohort_keys:
        members = cohort_members[ck]
        size = len(members)
        # For each cohort member, count which weeks past `ck` had any paid order
        retention_by_week: dict[int, set[str]] = {}
        for email in members:
            for tx in by_buyer[email]:
                wk = _iso_to_week_key(tx["created_at"])
                if not wk:
                    continue
                d = _week_diff(ck, wk)
                if d is None or d < 0 or d > weeks:
                    continue
                retention_by_week.setdefault(d, set()).add(email)
        cells = []
        for w in range(weeks + 1):
            count = len(retention_by_week.get(w, set()))
            pct = round(100.0 * count / size, 1) if size else 0.0
            cells.append({"week_offset": w, "count": count, "pct": pct})
        rows.append({
            "cohort": ck,
            "size": size,
            "first_order_gmv": round(cohort_first_amount.get(ck, 0.0), 2),
            "cells": cells,
        })

    return {
        "weeks": weeks,
        "total_buyers": len(by_buyer),
        "total_repeat_buyers": sum(1 for txs in by_buyer.values() if len(txs) >= 2),
        "rows": rows,
    }


# ===================== USERS =====================
@router.get("/admin/community-users")
async def admin_community_users(_: dict = Depends(current_admin)):
    return await db.community_users.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)


# ===================== PER-MAKER ANALYTICS =====================
@router.get("/admin/maker-analytics/{slug}")
async def admin_maker_analytics(slug: str, _: dict = Depends(current_admin)):
    """Drill-in analytics for a single maker:
       revenue (gross + payout share), order count, top products,
       Stripe Connect status, payout history summary."""
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found")

    # Catalog summary
    products = await db.products.find({"maker_slug": slug}, {"_id": 0}).to_list(500)
    by_id = {p["id"]: p for p in products}
    by_slug = {p["slug"]: p for p in products}

    # Walk paid txs and tally lines belonging to this maker
    paid = await db.payment_transactions.find(
        {"payment_status": "paid"}, {"_id": 0}
    ).to_list(2000)

    cutoff_30 = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    cutoff_7 = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    gross = 0.0
    gross_30 = 0.0
    gross_7 = 0.0
    units_per_product: dict[str, int] = {}
    revenue_per_product: dict[str, float] = {}
    paid_order_ids: set[str] = set()
    refunded_order_ids: set[str] = set()
    refunded_amount = 0.0
    # Per-session subtotal map for the weekly GMV bucketer below.
    session_subtotals: dict[str, list[float]] = {}

    for tx in paid:
        my_lines = []
        for ci in tx.get("items", []):
            pid = ci.get("product_id", "")
            p = by_id.get(pid) or by_slug.get(pid)
            if not p:
                continue
            qty = int(ci.get("quantity", 1))
            line_rev = float(p["price"]) * qty
            my_lines.append((p["slug"], qty, line_rev))
        if not my_lines:
            continue
        sid = tx.get("session_id")
        paid_order_ids.add(sid)
        line_subtotal = sum(r for _, _, r in my_lines)
        gross += line_subtotal
        if tx.get("created_at", "") >= cutoff_30:
            gross_30 += line_subtotal
        if tx.get("created_at", "") >= cutoff_7:
            gross_7 += line_subtotal
        if tx.get("refund_status") == "refunded":
            refunded_order_ids.add(sid)
            refunded_amount += line_subtotal
        for pslug, qty, line_rev in my_lines:
            units_per_product[pslug] = units_per_product.get(pslug, 0) + qty
            revenue_per_product[pslug] = revenue_per_product.get(pslug, 0.0) + line_rev
        session_subtotals.setdefault(sid, []).append(line_subtotal)

    top_products = []
    for pslug, n in sorted(units_per_product.items(), key=lambda x: -x[1])[:5]:
        p = by_slug.get(pslug)
        if not p:
            continue
        top_products.append({
            "slug": pslug,
            "title": p["title"],
            "units": n,
            "revenue": round(revenue_per_product.get(pslug, 0.0), 2),
        })

    # Payouts summary
    payouts = await db.maker_payouts.find(
        {"maker_slug": slug}, {"_id": 0}
    ).sort("updated_at", -1).to_list(500)
    payout_totals = {
        "succeeded": 0.0,
        "deferred": 0.0,
        "reversed": 0.0,
        "error": 0.0,
        "cancelled": 0.0,
    }
    for p in payouts:
        amt = float(p.get("amount_cents", 0)) / 100.0
        st = p.get("status", "")
        if st in payout_totals:
            payout_totals[st] += amt

    # Net to maker after refunds (gross share retained on succeeded transfers)
    platform_fee_bps = 1000      # mirrors stripe_connect.PLATFORM_FEE_BPS default
    maker_share_gross = round(gross * (10000 - platform_fee_bps) / 10000, 2)
    maker_share_after_refunds = round(
        max(0.0, gross - refunded_amount) * (10000 - platform_fee_bps) / 10000, 2
    )

    # Weekly GMV (per maker — sum of their lines per session, bucketed)
    paid_by_sid = {tx["session_id"]: tx for tx in paid}
    maker_weekly = []
    for week in _weekly_gmv([tx for tx in paid if tx["session_id"] in session_subtotals]):
        # _weekly_gmv used the FULL tx amount; we need to override with our
        # session_subtotals for accurate maker-only revenue. Re-compute here.
        maker_weekly.append({"week_start": week["week_start"], "total": 0.0})
    # Reverse: bucket using only this maker's subtotals
    from datetime import datetime as _dt
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    anchor = today - timedelta(days=today.weekday())
    weeks = 12
    maker_weekly = []
    for i in range(weeks - 1, -1, -1):
        maker_weekly.append({
            "week_start": (anchor - timedelta(days=7 * i)).isoformat(),
            "total": 0.0,
        })
    cutoff_iso = (anchor - timedelta(days=7 * (weeks - 1))).isoformat()
    for sid, subtotals in session_subtotals.items():
        tx = paid_by_sid.get(sid)
        if not tx:
            continue
        ts = tx.get("created_at", "")
        if ts < cutoff_iso:
            continue
        try:
            tx_dt = _dt.fromisoformat(ts.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue
        delta_days = (tx_dt - anchor).days
        bucket_idx = (weeks - 1) + (delta_days // 7)
        if 0 <= bucket_idx < weeks:
            maker_weekly[bucket_idx]["total"] += sum(subtotals)
    for b in maker_weekly:
        b["total"] = round(b["total"], 2)

    return {
        "maker": {
            "slug": maker["slug"],
            "name": maker["name"],
            "email": maker.get("email"),
            "location": maker.get("location"),
            "stripe_account_id": maker.get("stripe_account_id"),
            "stripe_charges_enabled": bool(maker.get("stripe_charges_enabled")),
            "stripe_payouts_enabled": bool(maker.get("stripe_payouts_enabled")),
            "stripe_details_submitted": bool(maker.get("stripe_details_submitted")),
        },
        "products_count": len(products),
        "paid_orders_count": len(paid_order_ids),
        "refunded_orders_count": len(refunded_order_ids),
        "refunded_amount": round(refunded_amount, 2),
        "gross_revenue": round(gross, 2),
        "gross_revenue_30d": round(gross_30, 2),
        "gross_revenue_7d": round(gross_7, 2),
        "platform_fee_bps": platform_fee_bps,
        "maker_share_gross": maker_share_gross,
        "maker_share_after_refunds": maker_share_after_refunds,
        "top_products": top_products,
        "payout_totals": {k: round(v, 2) for k, v in payout_totals.items()},
        "recent_payouts": payouts[:10],
        "weekly_gmv": maker_weekly,
    }


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


# ===================== USER MODERATION =====================
class UserModerationAction(BaseModel):
    """Apply a moderation status to a community user.

    statuses:
      - "active": revert prior action, restore access
      - "frozen": temporarily suspended (can be re-activated)
      - "banned": permanently disallowed from sign-in/post/reply/chat
    """
    status: str
    reason: str = ""


@router.get("/admin/users")
async def admin_list_users(
    q: Optional[str] = None, status: Optional[str] = None, limit: int = 100,
    _: dict = Depends(current_admin),
):
    """Paginated user list with post-count rollups for the moderation panel."""
    flt: dict = {}
    if q:
        rx = {"$regex": q, "$options": "i"}
        flt["$or"] = [{"email": rx}, {"name": rx}, {"user_id": rx}]
    if status in ("active", "frozen", "banned"):
        if status == "active":
            flt["moderation_status"] = {"$in": [None, "active"]}
        else:
            flt["moderation_status"] = status
    users = await db.community_users.find(
        flt, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)

    # Aggregate post counts in 2 batched queries (cheaper than per-user lookups).
    user_ids = [u["user_id"] for u in users]
    if user_ids:
        thread_counts: dict = {}
        reply_counts: dict = {}
        async for r in db.forum_threads.aggregate([
            {"$match": {"user_id": {"$in": user_ids}}},
            {"$group": {"_id": "$user_id", "n": {"$sum": 1}}},
        ]):
            thread_counts[r["_id"]] = r["n"]
        async for r in db.forum_replies.aggregate([
            {"$match": {"user_id": {"$in": user_ids}}},
            {"$group": {"_id": "$user_id", "n": {"$sum": 1}}},
        ]):
            reply_counts[r["_id"]] = r["n"]
        for u in users:
            u["thread_count"] = thread_counts.get(u["user_id"], 0)
            u["reply_count"] = reply_counts.get(u["user_id"], 0)
    return {"users": users, "count": len(users)}


@router.post("/admin/users/{user_id}/moderate")
async def admin_moderate_user(
    user_id: str, body: UserModerationAction,
    claims: dict = Depends(current_admin),
):
    """Set a user's moderation status. Banning hides all their existing
    forum posts (replaced with `[removed by moderators]`)."""
    if body.status not in ("active", "frozen", "banned"):
        raise HTTPException(400, "status must be 'active', 'frozen', or 'banned'.")
    user = await db.community_users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")

    audit = {
        "by": claims["email"], "at": now_iso(),
        "from": user.get("moderation_status") or "active",
        "to": body.status, "reason": body.reason or "",
    }
    set_fields: dict = {
        "moderation_status": body.status if body.status != "active" else None,
        "moderation_updated_at": now_iso(),
    }
    if body.status != "active":
        set_fields["moderation_reason"] = body.reason or ""

    await db.community_users.update_one(
        {"user_id": user_id},
        {
            "$set": set_fields,
            "$push": {"moderation_history": audit},
        },
    )
    # Banned: veil their forum content. Frozen: leave it visible (it's just a timeout).
    if body.status == "banned":
        await db.forum_threads.update_many(
            {"user_id": user_id},
            {"$set": {"removed_by_mod": True, "removed_reason": body.reason or "User banned"}},
        )
        await db.forum_replies.update_many(
            {"user_id": user_id},
            {"$set": {"removed_by_mod": True, "removed_reason": body.reason or "User banned"}},
        )
    elif body.status == "active":
        # Restore previously-veiled content if we're un-banning.
        await db.forum_threads.update_many(
            {"user_id": user_id, "removed_by_mod": True},
            {"$set": {"removed_by_mod": False}, "$unset": {"removed_reason": ""}},
        )
        await db.forum_replies.update_many(
            {"user_id": user_id, "removed_by_mod": True},
            {"$set": {"removed_by_mod": False}, "$unset": {"removed_reason": ""}},
        )

    logger.info("[mod] user=%s %s→%s by=%s reason=%s",
                user_id, audit["from"], audit["to"], claims["email"], audit["reason"])
    return {"user_id": user_id, "status": body.status, "audit": audit}


@router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, claims: dict = Depends(current_admin)):
    """Hard-delete a community user record + scrub their forum/chat content.
    Use when a user requests account deletion or for severe abuse cases.
    Audit-logged."""
    user = await db.community_users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    await db.community_users.delete_one({"user_id": user_id})
    # Scrub posts + replies
    await db.forum_threads.delete_many({"user_id": user_id})
    await db.forum_replies.delete_many({"user_id": user_id})
    await db.chat_messages.delete_many({"user_id": user_id})
    logger.warning("[mod] HARD-DELETED user=%s email=%s by=%s",
                   user_id, user.get("email"), claims["email"])
    return {"deleted": True, "user_id": user_id}


# ───────────────────── admin password tools (per-user) ─────────────────────
class _AdminResetIn(BaseModel):
    role: str  # 'buyer' | 'maker' | 'admin'
    user_id: str | None = None
    email: EmailStr | None = None
    origin_url: str
    return_link: bool = False


@router.post("/admin/users/send-password-reset")
async def admin_send_password_reset(
    payload: _AdminResetIn, bg: BackgroundTasks, claims: dict = Depends(current_admin)
):
    """Trigger a password reset email for any user. Admin never sees or sets
    the password — they only kick off the same flow as the public 'forgot
    password' endpoint. If `return_link=true` the reset URL is returned to
    the admin so they can deliver it through another channel (text, call)
    when the user's email pipeline is broken — covers the real-world
    'support call from locked-out user with broken email' case."""
    from maker_auth import issue_password_reset_token
    from passwords import new_reset_nonce
    from email_service import _send, _shell
    from routers.auth_password import _find_user_by_email, _build_reset_email, _flag_for, _update_user

    role = payload.role.lower().strip()
    if role not in ("buyer", "maker", "admin"):
        raise HTTPException(400, "role must be one of: buyer, maker, admin")
    if not _flag_for(role):
        raise HTTPException(403, f"Password sign-in is disabled for role={role}.")

    # Look up user — accept either user_id or email
    user = None
    if payload.email:
        user = await _find_user_by_email(role, payload.email)
    elif payload.user_id and role == "buyer":
        user = await db.community_users.find_one({"user_id": payload.user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found.")

    email = user["email"]
    nonce = new_reset_nonce()
    await _update_user(role, email, {"password_reset_nonce": nonce})
    token = issue_password_reset_token(email, role, used_at="")
    link = f"{payload.origin_url.rstrip('/')}/reset-password?token={token}&n={nonce}"
    html = _build_reset_email(role, link)
    bg.add_task(_send, email, "Reset your Crafters Market password", html)

    await db.audit_log.insert_one({
        "kind": "admin_password_reset_sent",
        "by": claims["email"],
        "role": role,
        "email": email,
        "created_at": now_iso(),
    })
    logger.info("[admin] password reset triggered for %s=%s by=%s", role, email, claims["email"])
    out: dict = {"sent": True, "email": email}
    if payload.return_link:
        out["link"] = link
        out["expires_in_minutes"] = 30
    return out


class _ForceSignoutIn(BaseModel):
    role: str
    user_id: str | None = None
    email: EmailStr | None = None


@router.post("/admin/users/force-signout")
async def admin_force_signout(payload: _ForceSignoutIn, claims: dict = Depends(current_admin)):
    """Bumps the user's session_version, instantly invalidating every active
    JWT they have outstanding. Used after suspected account compromise or
    when a device is lost. Self-lockout protection: admins can't force-
    signout their own account through this endpoint."""
    role = payload.role.lower().strip()
    if role not in ("buyer", "maker", "admin"):
        raise HTTPException(400, "role must be one of: buyer, maker, admin")

    coll = {"buyer": db.community_users, "maker": db.makers, "admin": db.admin_users}[role]
    query = {}
    if payload.email:
        query["email"] = payload.email.lower().strip()
    elif payload.user_id and role == "buyer":
        query["user_id"] = payload.user_id
    else:
        raise HTTPException(400, "Provide email (any role) or user_id (buyer only).")

    # Self-lockout protection FIRST — check email match against calling admin
    # before doing the user lookup (admin records are lazy-upserted so the
    # admin themselves often won't have a row yet, but still must not be
    # locked out of their own account).
    target_email = query.get("email", "").lower().strip()
    if target_email and target_email == claims["email"].lower().strip():
        raise HTTPException(403, "You cannot force-signout your own account.")

    user = await coll.find_one(query, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found.")

    if role == "admin":
        await coll.update_one(query, {"$inc": {"session_version": 1},
                                       "$set": {"force_signout_at": now_iso()}}, upsert=True)
    else:
        await coll.update_one(query, {"$inc": {"session_version": 1},
                                       "$set": {"force_signout_at": now_iso()}})

    await db.audit_log.insert_one({
        "kind": "admin_force_signout",
        "by": claims["email"],
        "role": role,
        "email": user["email"],
        "created_at": now_iso(),
    })
    logger.warning("[admin] force-signout · role=%s · email=%s · by=%s",
                   role, user["email"], claims["email"])
    return {"signed_out": True, "email": user["email"]}


@router.delete("/admin/forum/threads/{thread_id}")
async def admin_delete_thread(thread_id: str, claims: dict = Depends(current_admin)):
    """Hard-delete a forum thread + its replies."""
    r = await db.forum_threads.delete_one({"id": thread_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Thread not found")
    await db.forum_replies.delete_many({"thread_id": thread_id})
    logger.info("[mod] thread deleted: %s by=%s", thread_id, claims["email"])
    return {"deleted": True}


@router.delete("/admin/forum/replies/{reply_id}")
async def admin_delete_reply(reply_id: str, claims: dict = Depends(current_admin)):
    reply = await db.forum_replies.find_one({"id": reply_id}, {"_id": 0, "thread_id": 1})
    if not reply:
        raise HTTPException(404, "Reply not found")
    await db.forum_replies.delete_one({"id": reply_id})
    await db.forum_threads.update_one(
        {"id": reply["thread_id"]},
        {"$inc": {"reply_count": -1}},
    )
    logger.info("[mod] reply deleted: %s by=%s", reply_id, claims["email"])
    return {"deleted": True}


@router.get("/admin/audit-log")
async def admin_audit_log(limit: int = 200, _: dict = Depends(current_admin)):
    """Flatten every entry in `community_users.moderation_history` across all
    users into a single reverse-chronological feed for the audit tab."""
    cursor = db.community_users.find(
        {"moderation_history": {"$exists": True, "$ne": []}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "moderation_history": 1},
    )
    rows: list[dict] = []
    async for u in cursor:
        for h in (u.get("moderation_history") or []):
            rows.append({
                "user_id": u["user_id"],
                "user_email": u.get("email"),
                "user_name": u.get("name"),
                "by": h.get("by"),
                "at": h.get("at"),
                "from": h.get("from"),
                "to": h.get("to"),
                "reason": h.get("reason") or "",
            })
    rows.sort(key=lambda r: r.get("at") or "", reverse=True)
    return {"items": rows[:limit], "count": len(rows)}


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
