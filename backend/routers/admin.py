"""Admin console: magic-link auth, applications/custom-orders/paid-orders dashboards."""
from typing import Optional
import os
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr

from core import ADMIN_CAPABILITIES, ADMIN_CAP_PRESETS, ADMIN_EMAILS, db, logger, now_iso
from email_service import (
    send_admin_broadcast, send_admin_magic_link,
    send_admin_message_to_applicant, send_admin_team_invite,
    send_application_decision, send_custom_order_quote,
    render_application_decision_email,
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


# ─────────────────────────────────────────────────────────────────────────────
# Emergency admin recovery — works ONLY when ADMIN_RECOVERY_SECRET env is set.
# Default state: endpoint silently 404s (acts as if it doesn't exist) so even
# a portscan returns nothing. Designed for the case where outbound email is
# broken and the operator has no shell on prod (e.g. craftersmarket.org while
# Postmark/Mailtrap are still in approval).
#
# Usage: set ADMIN_RECOVERY_SECRET=<long-random-string> in the deploy env,
# redeploy, then visit:
#   https://<domain>/api/admin/auth/recovery?secret=<the-secret>
# The endpoint mints an admin magic token (same code path as the email link)
# and 302-redirects you to /admin/verify?token=… which signs you in.
#
# IMPORTANT: when email is working again, REMOVE the env var (or rotate it).
# Every successful use is logged to admin_audit so you have a paper trail.
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/admin/auth/recovery", include_in_schema=False)
async def admin_auth_recovery(secret: str = "", request_email: Optional[str] = None):
    from fastapi.responses import RedirectResponse
    expected = os.environ.get("ADMIN_RECOVERY_SECRET", "").strip()
    if not expected:
        # Endpoint disabled — pretend it doesn't exist.
        raise HTTPException(404, "Not Found")
    # Constant-time compare so brute-forcers can't time-side-channel.
    if not secrets.compare_digest(secret or "", expected):
        # Don't reveal the env var is set; same 404 as disabled.
        raise HTTPException(404, "Not Found")
    # Default: log in as the configured operator. Allow override via query
    # param ONLY if it matches an existing super-admin or active admin row,
    # so the secret can't be used to mint tokens for arbitrary emails.
    requested = (request_email or "").lower().strip()
    if requested:
        is_admin_row = await db.admin_users.find_one(
            {"email": requested, "is_active": True}, {"_id": 0, "email": 1},
        )
        if requested not in ADMIN_EMAILS and not is_admin_row:
            raise HTTPException(403, "Email is not an authorized admin.")
        target_email = requested
    else:
        target_email = next(iter(ADMIN_EMAILS), None) or os.environ.get("OPS_EMAIL", "")
        if not target_email:
            raise HTTPException(500, "No admin email configured (set OPS_EMAIL).")
    token = issue_admin_magic_token(target_email)
    # Audit trail — every recovery use leaves a row.
    await db.admin_audit.insert_one({
        "kind": "admin_recovery_link_used",
        "email": target_email,
        "created_at": now_iso(),
    })
    logger.warning(
        "ADMIN RECOVERY link issued via /admin/auth/recovery for %s — "
        "remove ADMIN_RECOVERY_SECRET env once email is working.",
        target_email,
    )
    # Redirect to the standard verify page so the existing JS handles sign-in.
    # 302 (Found) — short-lived redirect so the browser doesn't cache it.
    return RedirectResponse(url=f"/admin/verify?token={token}", status_code=302)


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



# ─────────────────────────────────────────────────────────────────────────────
# Member directories — separate "approved makers" / "rejected applicants" /
# "Crafters Plus paid members" lists for the admin console. These split the
# Applications tab into focused queues so the daily review (pending) doesn't
# co-mingle with long-tail historical data.
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/admin/makers/approved")
async def admin_approved_makers(_: dict = Depends(current_admin)):
    """Every approved maker with enriched stats: listings count, lifetime GMV,
    Plus / Beta status. One Mongo round trip + a couple of small aggregations."""
    makers = await db.makers.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    if not makers:
        return []
    slugs = [m["slug"] for m in makers if m.get("slug")]

    # Listings count per maker (live + drafts, excluding soft-deleted).
    listings_pipe = [
        {"$match": {"maker": {"$in": slugs}, "deleted_at": None}},
        {"$group": {"_id": "$maker", "count": {"$sum": 1}}},
    ]
    listings_by_slug = {
        r["_id"]: r["count"] async for r in db.products.aggregate(listings_pipe)
    }

    # Lifetime GMV from settled payouts (most accurate maker-side number).
    payouts_pipe = [
        {"$match": {"maker_slug": {"$in": slugs}, "status": {"$in": ["succeeded", "succeeded-zero"]}}},
        {"$group": {"_id": "$maker_slug", "gross": {"$sum": "$gross_cents"}}},
    ]
    gmv_by_slug = {
        r["_id"]: round((r.get("gross") or 0) / 100, 2)
        async for r in db.maker_payouts.aggregate(payouts_pipe)
    }

    # Resolve original application date by email for the "approved on" column.
    emails = [m.get("email") for m in makers if m.get("email")]
    apps = await db.maker_applications.find(
        {"email": {"$in": emails}, "status": "approved"},
        {"_id": 0, "email": 1, "decided_at": 1, "created_at": 1},
    ).to_list(len(emails))
    approved_by_email = {a["email"]: a.get("decided_at") or a.get("created_at") for a in apps}

    out = []
    for m in makers:
        slug = m.get("slug")
        out.append({
            "slug": slug,
            "name": m.get("name") or m.get("studio_name"),
            "email": m.get("email"),
            "location": m.get("location"),
            "is_beta": bool(m.get("is_beta")),
            "beta_expires_at": m.get("beta_expires_at"),
            "is_veteran_owned": bool(m.get("is_veteran_owned")),
            "subscription_status": m.get("subscription_status") or "free",
            "listings_count": listings_by_slug.get(slug, 0),
            "lifetime_gmv": gmv_by_slug.get(slug, 0.0),
            "created_at": m.get("created_at"),
            "approved_at": approved_by_email.get(m.get("email")),
        })
    return out


@router.get("/admin/makers/rejected")
async def admin_rejected_applications(_: dict = Depends(current_admin)):
    """Rejected maker applications, newest first. Separate list so the
    daily Applications queue stays focused on actionable rows."""
    return await db.maker_applications.find(
        {"status": "rejected"}, {"_id": 0},
    ).sort("decided_at", -1).to_list(500)


@router.get("/admin/makers/plus")
async def admin_plus_members(_: dict = Depends(current_admin)):
    """All Crafters Plus paid subscribers (active or trialing).

    Surfaces Stripe subscription metadata + last-30-days GMV so the admin
    can see ROI + upcoming renewal dates without leaving the dashboard.
    """
    plus_makers = await db.makers.find(
        {"subscription_status": {"$in": ["active", "trialing"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    if not plus_makers:
        return []

    slugs = [m["slug"] for m in plus_makers if m.get("slug")]
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    # 30-day GMV per Plus maker — same source as the maker-side ROI panel.
    gmv_pipe = [
        {"$match": {
            "maker_slug": {"$in": slugs},
            "status": {"$in": ["succeeded", "succeeded-zero"]},
            "created_at": {"$gte": cutoff},
        }},
        {"$group": {"_id": "$maker_slug", "gross": {"$sum": "$gross_cents"}}},
    ]
    gmv30_by_slug = {
        r["_id"]: round((r.get("gross") or 0) / 100, 2)
        async for r in db.maker_payouts.aggregate(gmv_pipe)
    }

    out = []
    for m in plus_makers:
        slug = m.get("slug")
        gmv30 = gmv30_by_slug.get(slug, 0.0)
        # Plus saves 1% commission (4% vs 5%) net of $12/mo cost.
        net_value = round((gmv30 * 0.01) - 12.0, 2)
        out.append({
            "slug": slug,
            "name": m.get("name") or m.get("studio_name"),
            "email": m.get("email"),
            "subscription_status": m.get("subscription_status"),
            "stripe_subscription_id": m.get("stripe_subscription_id"),
            "stripe_customer_id": m.get("stripe_customer_id"),
            "current_period_end": m.get("subscription_current_period_end"),
            "cancel_at_period_end": bool(m.get("subscription_cancel_at_period_end")),
            "is_beta": bool(m.get("is_beta")),
            "is_veteran_owned": bool(m.get("is_veteran_owned")),
            "started_at": m.get("subscription_started_at") or m.get("created_at"),
            "gmv_30d": gmv30,
            "plus_net_value_30d": net_value,
        })
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Admin-to-applicant single message + site-wide broadcast composer.
# ─────────────────────────────────────────────────────────────────────────────

class ApplicantEmailRequest(BaseModel):
    subject: str
    message: str


@router.post("/admin/maker-applications/{app_id}/email")
async def admin_email_applicant(
    app_id: str, body: ApplicantEmailRequest, bg: BackgroundTasks,
    claims: dict = Depends(current_admin),
):
    """Send a one-off email to a specific maker-application applicant.

    The composer in `ApplicationsList.jsx` opens a small modal next to the
    row and posts here. We store an audit row in `admin_audit` so the
    operator can prove the message was sent.
    """
    app = await db.maker_applications.find_one({"id": app_id}, {"_id": 0})
    if not app:
        raise HTTPException(404, "Application not found")
    if not app.get("email"):
        raise HTTPException(400, "Application has no email on file")
    subject = (body.subject or "").strip()
    message = (body.message or "").strip()
    if not subject or not message:
        raise HTTPException(400, "Subject and message are required")
    if len(subject) > 180:
        raise HTTPException(400, "Subject must be 180 characters or less")

    bg.add_task(
        send_admin_message_to_applicant,
        app["email"], app.get("name") or "", subject, message, claims.get("email", ""),
    )
    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": "applicant_email",
        "actor": claims.get("email"),
        "target": app["email"],
        "subject": subject[:200],
        "application_id": app_id,
        "created_at": now_iso(),
    })
    return {"ok": True, "to": app["email"]}


class BroadcastRequest(BaseModel):
    subject: str
    message: str
    audience: str  # "all_makers" | "plus_makers" | "beta_makers" | "buyers" | "applicants_pending" | "everyone"
    headline: Optional[str] = None
    test_email: Optional[EmailStr] = None  # If set, only sends to this address


async def _resolve_broadcast_audience(audience: str) -> list[str]:
    """Return the deduped lower-cased recipient email list for the given cohort."""
    emails: set[str] = set()

    async def _add_from(cursor):
        async for row in cursor:
            e = (row.get("email") or "").strip().lower()
            if e:
                emails.add(e)

    if audience in ("all_makers", "everyone"):
        await _add_from(db.makers.find({}, {"_id": 0, "email": 1}))
    if audience in ("plus_makers", "everyone"):
        await _add_from(db.makers.find(
            {"subscription_status": {"$in": ["active", "trialing"]}}, {"_id": 0, "email": 1},
        ))
    if audience in ("beta_makers", "everyone"):
        await _add_from(db.makers.find({"is_beta": True}, {"_id": 0, "email": 1}))
    if audience in ("buyers", "everyone"):
        # Distinct buyer emails from paid transactions.
        cur = db.payment_transactions.find(
            {"customer_email": {"$nin": [None, ""]}},
            {"_id": 0, "customer_email": 1},
        )
        async for row in cur:
            e = (row.get("customer_email") or "").strip().lower()
            if e:
                emails.add(e)
        # Plus community users with verified emails.
        await _add_from(db.community_users.find({}, {"_id": 0, "email": 1}))
    if audience in ("applicants_pending", "everyone"):
        await _add_from(db.maker_applications.find(
            {"status": {"$in": [None, ""]}}, {"_id": 0, "email": 1},
        ))
    # iter99 — opt-in product-update subscribers (from /updates page).
    # These users explicitly asked to hear from us; they're included in
    # 'everyone' so launch announcements reach them too. They have a
    # one-click unsubscribe baked into every digest, so this is safe.
    if audience in ("update_subscribers", "everyone"):
        await _add_from(db.update_subscribers.find(
            {"unsubscribed_at": None}, {"_id": 0, "email": 1},
        ))
    return sorted(emails)


@router.post("/admin/broadcast/preview")
async def admin_broadcast_preview(
    body: BroadcastRequest, _: dict = Depends(current_admin),
):
    """Returns the audience size + sample of recipient emails so the admin
    can sanity-check the cohort before pulling the trigger."""
    if body.audience not in {
        "all_makers", "plus_makers", "beta_makers", "buyers",
        "applicants_pending", "update_subscribers", "everyone",
    }:
        raise HTTPException(400, "Unknown audience")
    recipients = await _resolve_broadcast_audience(body.audience)
    return {
        "audience": body.audience,
        "count": len(recipients),
        "sample": recipients[:10],
    }


@router.post("/admin/broadcast/send")
async def admin_broadcast_send(
    body: BroadcastRequest, bg: BackgroundTasks,
    claims: dict = Depends(current_admin),
):
    """Site-wide announcement composer — fires one transactional email per
    recipient via the existing fallback chain.

    Safety rails:
      - subject + message required
      - audience must be one of the known cohorts
      - if `test_email` is provided, ONLY that address gets the send (preview)
      - hard cap of 5,000 recipients per call to avoid runaway sends
    """
    subject = (body.subject or "").strip()
    message = (body.message or "").strip()
    if not subject or not message:
        raise HTTPException(400, "Subject and message are required")
    if len(subject) > 180:
        raise HTTPException(400, "Subject must be 180 characters or less")

    headline = (body.headline or "Announcement.")[:120]
    intro = "An update from the Crafters Market team."

    # Test mode — single recipient, doesn't touch the cohort.
    if body.test_email:
        bg.add_task(send_admin_broadcast, str(body.test_email), subject, message, headline, intro)
        await db.admin_audit.insert_one({
            "id": secrets.token_hex(12),
            "kind": "broadcast_test",
            "actor": claims.get("email"),
            "audience": body.audience,
            "subject": subject[:200],
            "recipients_count": 1,
            "created_at": now_iso(),
        })
        return {"ok": True, "mode": "test", "recipients": 1, "to": str(body.test_email)}

    if body.audience not in {
        "all_makers", "plus_makers", "beta_makers", "buyers",
        "applicants_pending", "update_subscribers", "everyone",
    }:
        raise HTTPException(400, "Unknown audience")

    recipients = await _resolve_broadcast_audience(body.audience)
    if not recipients:
        raise HTTPException(400, "No recipients in that audience")
    if len(recipients) > 5000:
        raise HTTPException(400, f"Audience too large ({len(recipients)} > 5000). Refine the cohort.")

    # Schedule sends as background tasks so the API returns instantly even
    # for a few hundred recipients. Each send goes through `_send` which
    # writes its own row to `email_events` for status tracking.
    for addr in recipients:
        bg.add_task(send_admin_broadcast, addr, subject, message, headline, intro)

    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": "broadcast_send",
        "actor": claims.get("email"),
        "audience": body.audience,
        "subject": subject[:200],
        "recipients_count": len(recipients),
        "created_at": now_iso(),
    })
    return {"ok": True, "mode": "live", "audience": body.audience, "recipients": len(recipients)}




@router.get("/admin/custom-orders")
async def admin_custom_orders(
    tracking: str | None = None,
    _: dict = Depends(current_admin),
):
    """List all briefs (newest first) OR look up one by tracking number
    when `?tracking=` is provided."""
    q = {}
    if tracking:
        if not tracking.isdigit() or len(tracking) != 10:
            raise HTTPException(400, "Tracking number must be 10 digits.")
        q["tracking_number"] = tracking
    return await db.custom_orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


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
    or double-fulfill anything; only fires emails.

    When the order has already been fulfilled (tracking number on file), we
    ALSO re-fire the buyer's tracking + receipt email (`send_buyer_shipped`)
    on top of the original receipt — admins normally hit Refire after a
    customer says "I lost my tracking", and this gives them everything in
    one click. Rate-limited via `last_admin_refire_at` (1 fire / 30s) so
    triple-clicks don't spam the buyer's inbox."""
    from email_service import (
        send_buyer_receipt, send_maker_new_order, send_ops_new_order,
        send_buyer_shipped,
    )
    # The paid-orders source-of-truth is `payment_transactions` — the older
    # `transactions` collection is empty in production. Fall back to the
    # legacy collection only if nothing is found in the new one (defensive
    # so we don't break any pre-cutover data).
    tx = await db.payment_transactions.find_one(
        {"session_id": session_id}, {"_id": 0},
    ) or await db.transactions.find_one(
        {"session_id": session_id}, {"_id": 0},
    )
    if not tx:
        raise HTTPException(404, "Order not found.")

    # 30-second cooldown to protect the buyer's inbox from triple-clicks.
    last = tx.get("last_admin_refire_at")
    if last:
        try:
            from datetime import datetime, timezone
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            delta = (datetime.now(timezone.utc) - last_dt).total_seconds()
            if delta < 30:
                raise HTTPException(429, f"Please wait {int(30 - delta)}s before refiring again.")
        except ValueError:
            pass
    sent: list[str] = []
    failed: list[dict] = []

    # Buyer email field migrated from `buyer_email` (legacy) → `customer_email`
    # (current schema). Read both so admin refire works on either era.
    buyer_email = (
        tx.get("customer_email") or tx.get("buyer_email")
        or (tx.get("shipping_details") or {}).get("email")
        or ""
    )
    buyer_name = (
        tx.get("customer_name")
        or (tx.get("shipping_details") or {}).get("name")
    )

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
            buyer_email=buyer_email,
            summary=summary, total=total, items=items,
        )
        sent.append("buyer_receipt")
    except Exception as e:
        failed.append({"kind": "buyer_receipt", "error": str(e)})

    # 1b) If the order is already fulfilled with a tracking number, also
    # re-send the shipping confirmation — this is what most "I lost the
    # email" complaints actually need.
    tracking = tx.get("tracking_number")
    if tracking and buyer_email:
        try:
            await send_buyer_shipped(
                buyer_email=buyer_email,
                buyer_name=buyer_name,
                tracking_number=tracking,
                carrier=tx.get("tracking_carrier") or "",
                items=items,
                total=total or None,
                order_id=tx.get("id") or session_id,
                tracking_url=tx.get("tracking_url_provider"),
            )
            sent.append("buyer_shipped")
        except Exception as e:
            failed.append({"kind": "buyer_shipped", "error": str(e)})

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
                buyer_email=buyer_email,
            )
            sent.append(f"maker:{ms}")
        except Exception as e:
            failed.append({"kind": f"maker:{ms}", "error": str(e)})

    # 3) Ops alert
    try:
        await send_ops_new_order(
            summary=summary, total=total, items=items,
            buyer_email=buyer_email,
        )
        sent.append("ops")
    except Exception as e:
        failed.append({"kind": "ops", "error": str(e)})

    # Stamp the cooldown + bookkeeping
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {
            "last_admin_refire_at": now_iso(),
            "admin_refire_count": (tx.get("admin_refire_count") or 0) + 1,
        }},
    )

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


@router.delete("/admin/maker-applications/{app_id}")
async def admin_delete_application(
    app_id: str, claims: dict = Depends(current_admin),
):
    """Hard-delete an application row.

    Intended primarily for cleaning up rejected applications that are
    cluttering the admin queue. Safe to call on any status (pending,
    approved, rejected) — but for approved applications it does NOT
    delete the linked maker doc; the maker is a separate record. So this
    is fine for "remove the application audit row" without affecting
    anyone who's already shopping under that maker slug.

    Returns 204 on success. 404 if the row doesn't exist (idempotent
    behaviour: deleting twice is fine, second call just returns 404).
    """
    appn = await db.maker_applications.find_one({"id": app_id}, {"_id": 0})
    if not appn:
        raise HTTPException(404, "Application not found")
    await db.maker_applications.delete_one({"id": app_id})
    # Audit trail — we want a paper trail of what got deleted in case of
    # a "wait, why is that maker's application gone?" investigation later.
    await db.admin_audit.insert_one({
        "kind": "application_deleted",
        "email": claims["email"],
        "app_id": app_id,
        "applicant_email": appn.get("email"),
        "studio_name": appn.get("studio_name"),
        "previous_status": appn.get("status") or "pending",
        "created_at": now_iso(),
    })
    return Response(status_code=204)


@router.get("/admin/maker-applications/{app_id}/preview-email")
async def admin_preview_application_email(
    app_id: str, approved: bool = True, note: str = "",
    _: dict = Depends(current_admin),
):
    """Returns the exact `{subject, html, recipient}` that
    `send_application_decision` would dispatch — without sending anything.
    Lets admins preview the welcome packet (or rejection note) before
    clicking Approve/Reject. The `note` query param is rendered live so
    admins see how their inline note appears in the final quote block."""
    appn = await db.maker_applications.find_one({"id": app_id}, {"_id": 0})
    if not appn:
        raise HTTPException(404, "Application not found")
    # Use a non-functional placeholder for the magic link so the admin sees
    # where the CTA lives without us minting a real one (links are minted
    # only at decide-time so they're always fresh).
    rendered = render_application_decision_email(
        appn["name"], appn["studio_name"], approved,
        note=note or "",
        sign_in_link="https://craftersmarket.org/maker/verify?token=preview",
    )
    return {
        "recipient": appn["email"],
        "applicant_name": appn["name"],
        "studio": appn["studio_name"],
        "approved": approved,
        "subject": rendered["subject"],
        "html": rendered["html"],
    }


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
                # Trial referral attribution — captured at application
                # time via `/beta?ref=<code>`, surfaces here so the
                # subscription-start hook can credit the referrer.
                referred_by_code=appn.get("referred_by_code"),
            )
            await db.makers.insert_one(new_maker.model_dump())
            logger.info("auto-created maker on approval: slug=%s email=%s beta=%s",
                        slug, appn["email"], is_beta)
            # Founder tier auto-promotion (iter153): every approved maker is
            # now promoted to the Founders Tier. If we still have Inaugural
            # slots left (cap 100), they get lifetime Inaugural status; once
            # the cap fills, new approvals become regular 12-month Founders.
            # `is_beta_tester` is reserved for the original pre-launch cohort
            # — new applicants don't get that flag even if they applied via
            # /founders. Idempotent: re-running the migration is a no-op for
            # already-promoted makers.
            try:
                from routers.founders import _count_inaugural
                from revenue import FOUNDER_INAUGURAL_CAP, FOUNDER_WINDOW_DAYS, FOUNDER_GRACE_DAYS
                now_dt = datetime.now(timezone.utc)
                inaug_used = await _count_inaugural()
                status = "inaugural" if inaug_used < FOUNDER_INAUGURAL_CAP else "regular"
                expires = (
                    None if status == "inaugural"
                    else (now_dt + timedelta(days=FOUNDER_WINDOW_DAYS)).isoformat()
                )
                grace = (now_dt + timedelta(days=FOUNDER_GRACE_DAYS)).isoformat()
                counter = await db.platform_meta.find_one_and_update(
                    {"key": "founder_counter"},
                    {"$inc": {"value": 1}},
                    upsert=True,
                    return_document=True,
                )
                number = int((counter or {}).get("value") or 1)
                await db.makers.update_one(
                    {"slug": slug},
                    {"$set": {
                        "tier": "founder",
                        "founder_status": status,
                        "founder_started_at": now_dt.isoformat(),
                        "founder_expires_at": expires,
                        "founder_grace_until": grace,
                        "founder_number": number,
                    }},
                )
                # Surface as a public activity event so the live ticker
                # picks it up — same recruiting psychology as the
                # homepage 'just bought X' feed.
                try:
                    await db.activity_events.insert_one({
                        "kind": "founder_joined",
                        "text": f"{appn.get('name') or 'A new maker'} just became Founder #{number:03d}",
                        "location": appn.get("location") or "",
                        "amount": None,
                        "session_id": None,
                        "created_at": now_dt.isoformat(),
                        "id": f"founder-{slug}-{number}",
                    })
                except Exception:
                    pass
                logger.info("auto-promoted to founder: slug=%s number=%s status=%s",
                            slug, number, status)
            except Exception as e:
                # Promotion failure must NOT block the approval — the maker
                # is still successfully created, an admin can manually
                # promote later via the Founders admin endpoint.
                logger.warning("[founders] auto-promotion failed for slug=%s: %s",
                               slug, e)
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

    # Pull the freshly-stamped founder number + status so the welcome
    # email can render the numbered Founder card. Defaults to (None, False)
    # when the maker doc doesn't exist (rejection path, or pre-existing
    # maker who didn't get promoted in this approval cycle).
    founder_number = None
    is_inaugural = False
    if body.approved:
        m_doc = await db.makers.find_one(
            {"email": appn["email"]},
            {"_id": 0, "founder_number": 1, "founder_status": 1},
        )
        if m_doc:
            founder_number = m_doc.get("founder_number")
            is_inaugural = m_doc.get("founder_status") == "inaugural"

    bg.add_task(
        send_application_decision,
        appn["email"], appn["name"], appn["studio_name"], body.approved, body.note or "",
        sign_in_link, founder_number, is_inaugural,
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


# ---------------- Custom-order routing (push to maker → push to Reddit) ----------------
class PushToMakerRequest(BaseModel):
    maker_slug: str
    note: Optional[str] = None        # admin's annotation to the maker
    notify_buyer: bool = False        # email the buyer "we found a maker"


@router.post("/admin/custom-orders/{order_id}/push-to-maker")
async def admin_push_to_maker(
    order_id: str, body: PushToMakerRequest, bg: BackgroundTasks,
    claims: dict = Depends(current_admin),
):
    """Assign a custom-order brief to a maker. Persists assignment fields
    on the custom_order doc and emails the maker. Maker dashboards read
    /api/maker/briefs to see assigned work in their queue."""
    order = await db.custom_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Custom order not found.")
    maker = await db.makers.find_one({"slug": body.maker_slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found.")
    if not maker.get("email"):
        raise HTTPException(400, "Selected maker has no email on file.")

    assigned_at = now_iso()
    update = {
        "assigned_maker_slug": body.maker_slug,
        "assigned_maker_name": maker.get("name") or body.maker_slug,
        "assigned_at": assigned_at,
        "assigned_by": claims["email"],
        "assignment_note": (body.note or "").strip()[:2000] or None,
        # Move the brief out of "open" for admin dashboards.
        "status": order.get("status") if order.get("status") == "quoted" else "assigned",
    }
    await db.custom_orders.update_one({"id": order_id}, {"$set": update})

    # In-app: drop a notification thread for the maker so their inbox shows it.
    # Reuses the existing dm_threads collection but flags `kind=admin_brief`
    # so MakerInbox can render it differently.
    thread_id = secrets.token_hex(12)
    body_text = (
        f"📋 Admin-routed brief: {order.get('project_type', 'Custom request')}\n\n"
        f"From: {order.get('name')} <{order.get('email')}>\n"
        f"Material: {order.get('material', 'n/a')} · Size: {order.get('size') or 'n/a'} "
        f"· Budget: {order.get('budget') or 'n/a'} · Timeline: {order.get('timeline') or 'n/a'}\n\n"
        f"{order.get('description', '')}\n\n"
    )
    if body.note:
        body_text += f"— Admin note —\n{body.note.strip()}\n"
    await db.dm_threads.insert_one({
        "id": thread_id,
        "kind": "admin_brief",
        "maker_slug": body.maker_slug,
        "maker_name": maker.get("name") or body.maker_slug,
        "maker_email": maker["email"],
        "buyer_email": order.get("email"),
        "buyer_name": order.get("name") or "",
        "subject": f"Admin brief · {order.get('project_type', 'Custom request')}",
        "custom_order_id": order_id,
        "last_sender": "admin",
        "last_message_at": assigned_at,
        "unread_for_maker": 1,
        "unread_for_buyer": 0,
        "message_count": 1,
        "created_at": assigned_at,
    })
    await db.dm_messages.insert_one({
        "id": secrets.token_hex(12),
        "thread_id": thread_id,
        "sender_type": "admin",
        "sender_email": claims["email"],
        "sender_name": "Crafters Market admin",
        "body": body_text,
        "created_at": assigned_at,
    })

    # Email maker.
    bg.add_task(
        send_admin_broadcast,
        maker["email"],
        f"New brief routed to your shop · {order.get('project_type', '')}",
        body_text + "\nReply on the dashboard: /maker/dashboard#messages",
        "Crafters Market — admin routing",
        "New brief assigned to your shop",
    )
    if body.notify_buyer and order.get("email"):
        bg.add_task(
            send_admin_broadcast,
            order["email"],
            "We've routed your brief to a maker",
            f"Hi {order.get('name', 'there')},\n\nGreat news — we've sent your "
            f"{order.get('project_type', 'custom request')} to "
            f"{maker.get('name') or body.maker_slug} for review. Expect a reply within "
            f"a few business days.",
            "Crafters Market — your custom request",
            "Brief routed to a maker",
        )

    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": "custom_order_assigned",
        "actor": claims["email"],
        "order_id": order_id,
        "maker_slug": body.maker_slug,
        "thread_id": thread_id,
        "created_at": assigned_at,
    })
    return {"ok": True, "thread_id": thread_id, "assigned_to": body.maker_slug}


@router.get("/admin/custom-orders/{order_id}/maker-suggestions")
async def admin_maker_suggestions(
    order_id: str, _: dict = Depends(current_admin),
):
    """Rank makers for a brief by:
      A. material/category overlap — counts the maker's published products
         whose `materials` array OR `category` text matches the brief's
         material or project_type (case-insensitive substring).
      B. historical win-rate on routed briefs (`won_bid / routed`).
      C. total briefs routed (tie-break, mild boost — proven engagement).
    Skips makers with shop_closed/vacation_mode set or no email on file.
    Returns top 8 with `reason` + `score` so the UI can show why."""
    order = await db.custom_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Custom order not found.")
    material = (order.get("material") or "").strip().lower()
    project_type = (order.get("project_type") or "").strip().lower()
    keywords = {w for w in (material, project_type) if w}

    # 1. Maker history aggregation.
    agg_pipeline = [
        {"$match": {"assigned_maker_slug": {"$ne": None}}},
        {"$group": {
            "_id": "$assigned_maker_slug",
            "routed": {"$sum": 1},
            "won": {"$sum": {"$cond": [{"$eq": ["$maker_response_status", "won_bid"]}, 1, 0]}},
            "completed": {"$sum": {"$cond": [{"$eq": ["$maker_response_status", "completed"]}, 1, 0]}},
            "declined": {"$sum": {"$cond": [{"$eq": ["$maker_response_status", "declined"]}, 1, 0]}},
        }},
    ]
    history_rows = [r async for r in db.custom_orders.aggregate(agg_pipeline)]
    history = {r["_id"]: r for r in history_rows if r.get("_id")}

    # 2. Active makers — exclude closed shops + missing emails.
    cursor = db.makers.find(
        {"shop_closed": {"$ne": True}, "vacation_mode": {"$ne": True},
         "email": {"$exists": True, "$ne": None}},
        {"_id": 0, "slug": 1, "name": 1, "location": 1, "techniques": 1},
    )
    makers = await cursor.to_list(500)

    # 3. Score loop. For every active maker, count their published products
    #    whose materials/category match this brief.
    suggestions = []
    for m in makers:
        slug = m["slug"]
        # Material/category overlap (counted across published products)
        match_q = {
            "maker_slug": slug,
            "status": "published",
        }
        product_count = await db.products.count_documents(match_q)
        if not product_count:
            continue
        if keywords:
            or_clauses = []
            for kw in keywords:
                or_clauses.append({"materials": {"$regex": kw, "$options": "i"}})
                or_clauses.append({"category": {"$regex": kw, "$options": "i"}})
                or_clauses.append({"technique": {"$regex": kw, "$options": "i"}})
            material_match = await db.products.count_documents({**match_q, "$or": or_clauses})
        else:
            material_match = 0

        h = history.get(slug, {"routed": 0, "won": 0, "completed": 0, "declined": 0})
        routed = h["routed"]
        win_rate = (h["won"] / routed) if routed else 0.0
        # Score: material match dominates (each match = +5), then a 100x
        # multiplier on win_rate, plus a mild boost for past engagement.
        score = (material_match * 5) + (win_rate * 100) + min(routed, 5)

        # Build a human-readable "reason" string the UI shows under each suggestion.
        reasons = []
        if material_match:
            reasons.append(f"{material_match} matching listing{'s' if material_match != 1 else ''}")
        if h["won"]:
            reasons.append(f"{int(win_rate * 100)}% win-rate ({h['won']}/{routed})")
        elif routed:
            reasons.append(f"{routed} prior brief{'s' if routed != 1 else ''}")
        if h["declined"] >= 3 and h["declined"] >= routed:
            # Spent flag — many declines, never won → don't highlight.
            score *= 0.5
            reasons.append(f"⚠ {h['declined']} declined")
        if not reasons:
            reasons.append(f"{product_count} active listings")

        suggestions.append({
            "slug": slug,
            "name": m.get("name") or slug,
            "location": m.get("location") or "",
            "score": round(score, 2),
            "material_match": material_match,
            "product_count": product_count,
            "win_rate": win_rate,
            "won": h["won"],
            "routed": routed,
            "reason": " · ".join(reasons),
        })

    suggestions.sort(key=lambda s: s["score"], reverse=True)
    return {"suggestions": suggestions[:8], "keywords": list(keywords)}


@router.get("/admin/custom-orders/funnel")
async def admin_brief_funnel(_: dict = Depends(current_admin)):
    """Conversion-rate analytics for the brief routing pipeline. Counts
    each lifecycle stage and surfaces the win-rate (won_bid / routed)
    so the admin can see which Reddit subs / makers convert best."""
    submitted = await db.custom_orders.count_documents({})
    quoted = await db.custom_orders.count_documents({"status": "quoted"})
    routed = await db.custom_orders.count_documents({"assigned_maker_slug": {"$exists": True, "$ne": None}})
    accepted = await db.custom_orders.count_documents({"maker_response_status": "accepted"})
    in_progress = await db.custom_orders.count_documents({"maker_response_status": "in_progress"})
    completed = await db.custom_orders.count_documents({"maker_response_status": "completed"})
    won = await db.custom_orders.count_documents({"maker_response_status": "won_bid"})
    declined = await db.custom_orders.count_documents({"maker_response_status": "declined"})
    on_reddit = await db.custom_orders.count_documents({"posted_to_reddit_at": {"$exists": True, "$ne": None}})

    # Per-subreddit conversion (won_bid / posted_to_reddit_at where reddit_subreddit=…)
    sub_pipeline = [
        {"$match": {"posted_to_reddit_at": {"$ne": None}}},
        {"$group": {
            "_id": "$reddit_subreddit",
            "posted": {"$sum": 1},
            "won": {"$sum": {"$cond": [{"$eq": ["$maker_response_status", "won_bid"]}, 1, 0]}},
        }},
        {"$sort": {"posted": -1}},
    ]
    by_sub = [r async for r in db.custom_orders.aggregate(sub_pipeline)]

    # Per-maker conversion
    maker_pipeline = [
        {"$match": {"assigned_maker_slug": {"$ne": None}}},
        {"$group": {
            "_id": "$assigned_maker_slug",
            "routed": {"$sum": 1},
            "won": {"$sum": {"$cond": [{"$eq": ["$maker_response_status", "won_bid"]}, 1, 0]}},
            "declined": {"$sum": {"$cond": [{"$eq": ["$maker_response_status", "declined"]}, 1, 0]}},
        }},
        {"$sort": {"routed": -1}},
        {"$limit": 20},
    ]
    by_maker = [r async for r in db.custom_orders.aggregate(maker_pipeline)]

    return {
        "stages": {
            "submitted": submitted,
            "quoted": quoted,
            "routed": routed,
            "accepted": accepted,
            "in_progress": in_progress,
            "completed": completed,
            "won_bid": won,
            "declined": declined,
            "posted_to_reddit": on_reddit,
        },
        "win_rate": (won / routed) if routed else 0.0,
        "decline_rate": (declined / routed) if routed else 0.0,
        "reddit_post_rate": (on_reddit / routed) if routed else 0.0,
        "by_subreddit": [
            {"subreddit": r["_id"], "posted": r["posted"], "won": r["won"],
             "win_rate": (r["won"] / r["posted"]) if r["posted"] else 0.0}
            for r in by_sub if r.get("_id")
        ],
        "by_maker": [
            {"maker_slug": r["_id"], "routed": r["routed"], "won": r["won"],
             "declined": r["declined"],
             "win_rate": (r["won"] / r["routed"]) if r["routed"] else 0.0}
            for r in by_maker if r.get("_id")
        ],
    }


class PushToRedditRequest(BaseModel):
    subreddit: str
    title: Optional[str] = None
    flair_text: Optional[str] = None
    flair_id: Optional[str] = None


@router.post("/admin/custom-orders/{order_id}/push-to-reddit")
async def admin_push_to_reddit(
    order_id: str, body: PushToRedditRequest,
    claims: dict = Depends(current_admin),
):
    """Re-broadcast an assigned custom-order brief to a configured subreddit
    (default: r/forhire). Workflow expects the brief to already be assigned
    to a maker (i.e. push-to-maker was hit first) — that ensures we don't
    spam a sub with leads that have no fulfilment plan. Override the gate
    with `force=true` only via direct API."""
    order = await db.custom_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Custom order not found.")
    if not order.get("assigned_maker_slug"):
        raise HTTPException(400, "Push to a maker first — Reddit posts should reference a fulfilment plan.")
    if order.get("posted_to_reddit_at"):
        raise HTTPException(400, "This brief has already been posted to Reddit.")

    # Build the Reddit post body. Phone numbers + emails redacted — most
    # subs auto-mod those, and we don't want to leak buyer contacts.
    proj = order.get("project_type", "Custom commission")
    title = (body.title or
             f"[Hiring] {proj} — {order.get('material', '')} "
             f"· budget {order.get('budget') or 'open'}").strip()[:300]
    desc = (order.get("description") or "").strip()
    pieces = [
        f"**Project:** {proj}",
        f"**Material:** {order.get('material', 'open')}",
        f"**Size:** {order.get('size') or 'flexible'}",
        f"**Budget:** {order.get('budget') or 'open'}",
        f"**Timeline:** {order.get('timeline') or 'flexible'}",
        f"**Quantity:** {order.get('quantity') or 1}",
        "",
        "**Brief:**",
        desc,
        "",
        "_Routed via Crafters Market — DM the OP through "
        "https://craftersmarket.org/custom-order or reply here. "
        "A vetted maker has been pre-assigned but additional bids welcome._",
    ]
    text = "\n".join(pieces)

    # Lazy-import so the admin router never depends on reddit_feeds being live.
    from routers.reddit_feeds import submit_text_post
    result = await submit_text_post(
        body.subreddit, title, text,
        flair_id=body.flair_id, flair_text=body.flair_text,
    )

    posted_at = now_iso()
    await db.custom_orders.update_one(
        {"id": order_id},
        {"$set": {
            "reddit_attempt_at": posted_at,
            "reddit_attempt_by": claims["email"],
            "reddit_subreddit": body.subreddit,
            "reddit_post_url": result.get("url"),
            "reddit_post_id": result.get("id"),
            "reddit_error": result.get("error"),
            **({"posted_to_reddit_at": posted_at} if result.get("ok") else {}),
        }},
    )
    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": "custom_order_pushed_to_reddit",
        "actor": claims["email"],
        "order_id": order_id,
        "subreddit": body.subreddit,
        "ok": bool(result.get("ok")),
        "url": result.get("url"),
        "error": result.get("error"),
        "created_at": posted_at,
    })
    if not result.get("ok"):
        # Surface as 502 so the UI can show the actual Reddit error string.
        raise HTTPException(502, result.get("error") or "Reddit submit failed.")

    # Cross-post the live Reddit URL into the maker's existing brief thread
    # (created by push-to-maker) so they can monitor bids without leaving the
    # dashboard. Best-effort: if no thread exists yet (admin skipped the
    # standard flow), we silently no-op.
    reddit_url = result.get("url") or ""
    thread = await db.dm_threads.find_one(
        {"custom_order_id": order_id, "kind": "admin_brief"},
        {"_id": 0, "id": 1, "maker_slug": 1},
    )
    if thread and reddit_url:
        update_msg = (
            f"📢 Brief is now live on r/{body.subreddit}: {reddit_url}\n\n"
            "Bids and comments will land on the Reddit thread — feel free to "
            "engage there directly. Mark this brief as 'Won the bid' from your "
            "Briefs tab once a Reddit lead converts."
        )
        await db.dm_messages.insert_one({
            "id": secrets.token_hex(12),
            "thread_id": thread["id"],
            "sender_type": "admin",
            "sender_email": claims["email"],
            "sender_name": "Crafters Market admin",
            "body": update_msg,
            "created_at": posted_at,
        })
        await db.dm_threads.update_one(
            {"id": thread["id"]},
            {"$set": {
                "last_sender": "admin",
                "last_message_at": posted_at,
            }, "$inc": {"unread_for_maker": 1, "message_count": 1}},
        )

    return {"ok": True, "url": reddit_url, "subreddit": body.subreddit}



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


# ─────────────── iter295 — Soft-delete & zombie product cleanup ───────────────
class SoftDeleteBody(BaseModel):
    """Free-form audit reason — surfaced in admin lists + Stripe Dashboard."""
    reason: str = "incomplete_metadata"


@router.post("/admin/products/{slug}/soft-delete")
async def admin_soft_delete_product(
    slug: str,
    body: SoftDeleteBody | None = None,
    admin: dict = Depends(current_admin),
):
    """Soft-delete a product. Stamps `deleted_at` (so it's excluded from
    every public surface that respects that flag — catalog feeds, search,
    maker profile, etc.) but leaves the document intact for audit + undo.

    Differs from `DELETE /admin/products/{slug}` (hard delete) which is
    irreversible. Use this for zombie listings, accidental seed rows,
    or makers who deactivated mid-publish — preserves the row in case
    the maker comes back."""
    reason = (body.reason if body else "incomplete_metadata").strip() or "incomplete_metadata"
    r = await db.products.update_one(
        {"slug": slug},
        {"$set": {
            "deleted_at":     now_iso(),
            "deleted_reason": reason,
            "deleted_by":     (admin or {}).get("email") or "admin",
            "status":         "deleted",  # hides from any code path that filters by status="published"
        }},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Product not found")
    logger.info("[admin] soft-deleted product=%s reason=%s by=%s",
                slug, reason, (admin or {}).get("email") or "admin")
    return {"ok": True, "slug": slug, "reason": reason}


@router.post("/admin/products/{slug}/restore")
async def admin_restore_product(slug: str, admin: dict = Depends(current_admin)):
    """Undo a soft-delete. Clears the audit fields and flips status back
    to `draft` (maker must re-review + republish, never auto-relive)."""
    r = await db.products.update_one(
        {"slug": slug, "deleted_at": {"$nin": [None, ""]}},
        {"$set": {
            "deleted_at":     None,
            "deleted_reason": None,
            "deleted_by":     None,
            "status":         "draft",
        }},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Soft-deleted product not found.")
    logger.info("[admin] restored product=%s by=%s",
                slug, (admin or {}).get("email") or "admin")
    return {"ok": True, "slug": slug, "status": "draft"}


@router.get("/admin/products/incomplete")
async def admin_list_incomplete_products(_: dict = Depends(current_admin)):
    """Surface zombie / incomplete products so the admin can soft-delete
    them in one click. A product is "incomplete" when it would fail the
    Pinterest/Google/Meta catalog feed validation:
      • title missing/empty
      • description missing/empty
      • price <= 0 or unparseable
      • no images (and no image_url fallback)

    Excludes already-soft-deleted rows (only "live" zombies)."""
    cursor = db.products.find(
        {"deleted_at": {"$in": [None, ""]}},
        {"_id": 0, "slug": 1, "title": 1, "description": 1, "price": 1,
         "images": 1, "image_url": 1, "status": 1, "maker_slug": 1,
         "created_at": 1},
    ).limit(2000)
    items: list[dict] = []
    async for p in cursor:
        issues: list[str] = []
        if not (p.get("title") or "").strip():
            issues.append("no_title")
        if not (p.get("description") or "").strip():
            issues.append("no_description")
        try:
            price_val = float(p.get("price") or 0)
            if price_val <= 0:
                issues.append("zero_price")
        except (TypeError, ValueError):
            issues.append("invalid_price")
        imgs = [i for i in (p.get("images") or []) if i]
        if not imgs and not (p.get("image_url") or "").strip():
            issues.append("no_images")
        if issues:
            items.append({
                "slug":        p.get("slug"),
                "title":       p.get("title") or "(no title)",
                "status":      p.get("status"),
                "maker_slug":  p.get("maker_slug"),
                "price":       p.get("price"),
                "created_at":  p.get("created_at"),
                "issues":      issues,
            })
    # Sort by most issues first — admin's eyes go to the worst offenders
    items.sort(key=lambda x: (-len(x["issues"]), x.get("slug") or ""))
    return {"items": items, "count": len(items)}


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



# ─────────────────────────────────────────────────────────────────────────────
# Design-file moderation queue — triaged reports from /community/files/:id/report.
# Admin can resolve a report with "quarantine" (hide the file platform-wide)
# or "dismiss" (mark clean, no action).
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/admin/design-files/reports")
async def admin_design_file_reports(
    status: str = "open",
    _: dict = Depends(current_admin),
):
    """Moderation queue — reports from the design-file library.

    Default shows `open` reports. Pass `?status=resolved` or `?status=dismissed`
    to view historical actions. `?status=all` returns everything.
    """
    q: dict = {} if status == "all" else {"status": status}
    rows = await db.design_file_reports.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    if not rows:
        return []
    file_ids = list({r["file_id"] for r in rows})
    files = await db.design_files.find(
        {"id": {"$in": file_ids}},
        {"_id": 0, "id": 1, "title": 1, "file_type": 1, "download_url": 1,
         "thumbnail_url": 1, "maker_name": 1, "maker_slug": 1, "uploader_id": 1,
         "uploader_role": 1, "created_at": 1, "quarantined_at": 1,
         "open_reports": 1, "size_bytes": 1},
    ).to_list(len(file_ids))
    files_by_id = {f["id"]: f for f in files}
    for r in rows:
        r["file"] = files_by_id.get(r["file_id"])
    return rows


class FileReportResolution(BaseModel):
    action: str              # "quarantine" | "dismiss"
    note: Optional[str] = ""


@router.post("/admin/design-files/reports/{report_id}/resolve")
async def admin_resolve_file_report(
    report_id: str,
    body: FileReportResolution,
    claims: dict = Depends(current_admin),
):
    """Close out an open report by either quarantining the file or
    dismissing the report. Quarantine soft-deletes the file from the
    public list AND marks ALL open reports for that file as resolved."""
    action = (body.action or "").strip().lower()
    if action not in ("quarantine", "dismiss"):
        raise HTTPException(400, "action must be 'quarantine' or 'dismiss'")

    report = await db.design_file_reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(404, "Report not found")
    if report.get("status") != "open":
        raise HTTPException(400, f"Report is already {report['status']}")

    now = now_iso()
    note = (body.note or "")[:500]

    if action == "quarantine":
        # Hide the file AND roll up every open report on that file to
        # 'resolved' — no point forcing the admin to click 5 times for
        # 5 redundant reports on the same bad asset.
        await db.design_files.update_one(
            {"id": report["file_id"]},
            {"$set": {"quarantined_at": now, "quarantined_by": claims.get("email"), "open_reports": 0}},
        )
        await db.design_file_reports.update_many(
            {"file_id": report["file_id"], "status": "open"},
            {"$set": {
                "status": "resolved", "resolved_at": now,
                "resolver": claims.get("email"), "resolver_note": note or "Quarantined",
                "resolution_action": "quarantine",
            }},
        )
    else:  # dismiss
        await db.design_file_reports.update_one(
            {"id": report_id},
            {"$set": {
                "status": "dismissed", "resolved_at": now,
                "resolver": claims.get("email"), "resolver_note": note or "Dismissed",
                "resolution_action": "dismiss",
            }},
        )
        await db.design_files.update_one(
            {"id": report["file_id"], "open_reports": {"$gt": 0}},
            {"$inc": {"open_reports": -1}},
        )

    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": f"design_file_report_{action}",
        "actor": claims.get("email"),
        "file_id": report["file_id"],
        "report_id": report_id,
        "note": note,
        "created_at": now,
    })
    return {"ok": True, "action": action, "file_id": report["file_id"]}


@router.post("/admin/design-files/{file_id}/unquarantine")
async def admin_unquarantine_file(
    file_id: str, claims: dict = Depends(current_admin),
):
    """Restore a previously-quarantined file (mis-moderation safety net)."""
    r = await db.design_files.update_one(
        {"id": file_id},
        {"$set": {"quarantined_at": None, "quarantined_by": None}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "File not found")
    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": "design_file_unquarantine",
        "actor": claims.get("email"),
        "file_id": file_id,
        "created_at": now_iso(),
    })
    return {"ok": True}


@router.get("/admin/design-files")
async def admin_list_design_files(
    limit: int = 100,
    quarantined: Optional[bool] = None,
    q: Optional[str] = None,
    sort: str = "created_at",  # "created_at" | "downloads"
    _: dict = Depends(current_admin),
):
    """Full design-file index for admin moderation. Defaults to all files
    sorted newest-first. Filters: quarantined=true|false, q=substring on
    title/maker_name/uploader. Sort by `downloads` to surface the most
    popular files."""
    flt: dict = {}
    if quarantined is True:
        flt["quarantined_at"] = {"$ne": None}
    elif quarantined is False:
        flt["quarantined_at"] = None
    if q:
        rgx = {"$regex": q, "$options": "i"}
        flt["$or"] = [{"title": rgx}, {"maker_name": rgx}, {"uploader_name": rgx}]
    sort_field = "downloads" if sort == "downloads" else "created_at"
    rows = await db.design_files.find(
        flt,
        {
            "_id": 0, "id": 1, "title": 1, "file_type": 1, "download_url": 1,
            "thumbnail_url": 1, "maker_name": 1, "maker_slug": 1, "uploader_id": 1,
            "uploader_name": 1, "uploader_role": 1, "created_at": 1,
            "quarantined_at": 1, "open_reports": 1, "size_bytes": 1,
            "downloads": 1,
        },
    ).sort(sort_field, -1).to_list(max(1, min(limit, 500)))
    # Also include a marketplace-wide aggregate so the admin UI can show
    # "{count} files · {sum} total downloads" at a glance without a
    # separate round-trip.
    total_downloads_doc = await db.design_files.aggregate([
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$downloads", 0]}}}},
    ]).to_list(1)
    total_downloads = int((total_downloads_doc or [{}])[0].get("total") or 0)
    return {"items": rows, "count": len(rows), "total_downloads": total_downloads}


@router.delete("/admin/design-files/{file_id}")
async def admin_delete_design_file(
    file_id: str, claims: dict = Depends(current_admin),
):
    """Hard-delete a design file: removes the R2 object (best-effort) AND
    every related row (the file itself, all reports tied to it, all
    download records). Quarantine is the safer first step — only use this
    when the file is unsafe, infringes, or is permanently spam. Action is
    irreversible.
    """
    f = await db.design_files.find_one({"id": file_id}, {"_id": 0})
    if not f:
        raise HTTPException(404, "File not found")

    # Best-effort R2 cleanup. We don't fail the delete if R2 is offline —
    # the DB rows still get removed so the file disappears from the UI.
    r2_keys: list[str] = []
    try:
        from r2_storage import is_configured as _r2_ok, key_from_public_url, delete_key
        if _r2_ok():
            for url in (f.get("download_url"), f.get("thumbnail_url")):
                if not url:
                    continue
                k = key_from_public_url(url)
                if k:
                    r2_keys.append(k)
                    try:
                        delete_key(k)
                    except Exception as e:  # noqa: BLE001
                        logger.warning("R2 delete failed for %s: %s", k, e)
    except Exception as e:  # noqa: BLE001
        logger.warning("R2 cleanup error during file %s delete: %s", file_id, e)

    # Drop every related DB row in one transaction-equivalent sweep.
    res_files = await db.design_files.delete_one({"id": file_id})
    res_reports = await db.design_file_reports.delete_many({"file_id": file_id})
    res_downloads = await db.design_file_downloads.delete_many({"file_id": file_id})

    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": "design_file_hard_delete",
        "actor": claims.get("email"),
        "file_id": file_id,
        "title": (f.get("title") or "")[:160],
        "uploader": f.get("uploader_name") or f.get("maker_name") or f.get("uploader_id"),
        "r2_keys_purged": r2_keys,
        "reports_purged": res_reports.deleted_count,
        "download_rows_purged": res_downloads.deleted_count,
        "created_at": now_iso(),
    })
    return {
        "ok": True,
        "deleted": res_files.deleted_count == 1,
        "r2_keys_purged": len(r2_keys),
        "reports_purged": res_reports.deleted_count,
        "downloads_purged": res_downloads.deleted_count,
    }



@router.post("/admin/forum/seed-starters", tags=["admin/forum"])
async def admin_seed_forum_starters(claims: dict = Depends(current_admin)):
    """Insert ~20 starter forum threads across all 6 categories.

    Idempotent — re-running does not duplicate threads. Useful when:
      - Spinning up a fresh environment
      - Forum looks empty and you want a kickstart
      - After category restructuring (manually backfill missing seed_keys)
    """
    from forum_seeds import seed_forum_threads
    summary = await seed_forum_threads()
    summary["actor"] = claims.get("email")
    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": "forum_seed_starters",
        "actor": claims.get("email"),
        "summary": summary,
        "created_at": now_iso(),
    })
    return {"ok": True, **summary}


@router.post("/admin/forum/seed-replies", tags=["admin/forum"])
async def admin_seed_forum_replies(claims: dict = Depends(current_admin)):
    """Insert ~88 expert replies across the 22 starter threads.

    Each starter gets 4 replies from 5 synthetic veteran-maker personas
    (Marcus, Karen, Tony, Sam, Jess). Replies are technical, sometimes
    disagree, and reference real tools and numbers. Idempotent — re-runs
    insert only what's missing.

    Run AFTER seed-starters; if a starter is missing the replies for
    that key are silently skipped.
    """
    from forum_reply_seeds import seed_forum_replies
    summary = await seed_forum_replies()
    summary["actor"] = claims.get("email")
    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": "forum_seed_replies",
        "actor": claims.get("email"),
        "summary": summary,
        "created_at": now_iso(),
    })
    return {"ok": True, **summary}




@router.post("/admin/showcase/seed", tags=["admin/showcase"])
async def admin_seed_showcase(
    wipe_test_rows: bool = True,
    claims: dict = Depends(current_admin),
):
    """Wipe placeholder/test showcase rows and insert ~14 real seeded
    posts using verified Unsplash CNC/woodworking photos.

    Idempotent — re-runs skip already-seeded rows by `seed_key`. Set
    `wipe_test_rows=false` to skip the cleanup step.
    """
    from showcase_seeds import seed_showcase
    summary = await seed_showcase(wipe_test_rows=wipe_test_rows)
    summary["actor"] = claims.get("email")
    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": "showcase_seed",
        "actor": claims.get("email"),
        "summary": summary,
        "created_at": now_iso(),
    })
    return {"ok": True, **summary}


@router.post("/admin/products/seed-featured-images", tags=["admin/products"])
async def admin_seed_featured_product_images(claims: dict = Depends(current_admin)):
    """Re-point the 4 Editor's Pick products at content-verified hero
    images served from `/seed-images/product-*.jpg`. Idempotent —
    safe to re-run; won't touch products outside the known mapping."""
    from product_image_seeds import seed_featured_product_images
    summary = await seed_featured_product_images()
    summary["actor"] = claims.get("email")
    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": "product_image_seed",
        "actor": claims.get("email"),
        "summary": summary,
        "created_at": now_iso(),
    })
    return {"ok": True, **summary}



# ---------------------------------------------------------------------------
# Live-orders feed — admin dopamine ticker
# ---------------------------------------------------------------------------
# Polled every 30s by the admin dashboard. Returns "sold" activity events
# created after `since` (ISO 8601 timestamp). The frontend pops a sonner
# toast for each new event so admins get a real-time confirmation when
# money lands. Limited to 25 events per poll so a long page reload never
# floods the UI with stale orders.
# ---------------------------------------------------------------------------
@router.get("/admin/live-orders/recent")
async def live_orders_recent(
    since: Optional[str] = None,
    claims=Depends(current_admin),
):
    query = {"kind": "sold"}
    if since:
        query["created_at"] = {"$gt": since}
    events = await db.activity_events.find(
        query, {"_id": 0}
    ).sort("created_at", -1).to_list(25)
    return {
        "events": events,
        "server_time": now_iso(),
    }
