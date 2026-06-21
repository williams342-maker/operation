"""Secrets rotation tracker — admin dashboard for credential hygiene.

We don't actually ROTATE the keys for you (that has to happen on each
provider's website), but we track:
  - Which credentials we use (Stripe, Postmark, Mailgun, R2, OpenAI/Claude, Twilio, Kit, Slack/Discord webhooks)
  - When each was last rotated (operator clicks "Mark rotated" after
    they've actually rotated on the provider side + updated the env)
  - When it should be rotated next (per-provider best-practice cadence)
  - Whether the credential is currently set in env (presence check only,
    we never log the value)

The rotation reminder is the win: most teams forget to rotate webhook
secrets and API keys until they get breached. A monthly admin glance at
this tab tells you what's overdue.

All write operations require super-admin and are audit-logged so you
have a full history of "who marked X as rotated when."
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import require_super_admin
from maker_auth import current_admin as _current_admin

router = APIRouter()


# ---------------- Catalogue of tracked secrets ----------------
# Add / remove rows here as the integration list evolves. The `env_keys`
# list is the env-var names we check for presence (NOT value). Multiple
# keys means "any one of these counts" (e.g. Postmark uses
# POSTMARK_TOKEN OR POSTMARK_SERVER_TOKEN depending on dialect). The
# `cadence_days` is the recommended rotation cadence — what the UI
# warns operators about. Per-row docs explain WHY each cadence.
TRACKED_SECRETS: list[dict] = [
    {
        "id": "stripe_api",
        "label": "Stripe API key",
        "category": "Payments",
        "env_keys": ["STRIPE_API_KEY", "STRIPE_SECRET_KEY"],
        "cadence_days": 180,  # 6 months — Stripe's own recommendation
        "rotation_url": "https://dashboard.stripe.com/apikeys",
        "rotation_notes": (
            "Roll the secret key on Stripe Dashboard → Developers → API "
            "keys. Update STRIPE_API_KEY in production env. "
            "Stripe lets the old key live for ~12 hours during the swap "
            "so deploys overlap cleanly. Never commit the new key."
        ),
    },
    {
        "id": "stripe_webhook",
        "label": "Stripe webhook signing secret",
        "category": "Payments",
        "env_keys": ["STRIPE_WEBHOOK_SECRET"],
        "cadence_days": 180,
        "rotation_url": "https://dashboard.stripe.com/webhooks",
        "rotation_notes": (
            "Each webhook endpoint has its own signing secret (whsec_…). "
            "Click 'Roll signing secret', update STRIPE_WEBHOOK_SECRET, "
            "redeploy. Old signature is valid for 24h after roll so "
            "in-flight events still verify. Critical to rotate after "
            "any vendor turnover."
        ),
    },
    {
        "id": "r2",
        "label": "Cloudflare R2 access key",
        "category": "Storage",
        "env_keys": ["R2_SECRET_ACCESS_KEY"],
        "cadence_days": 180,
        "rotation_url": "https://dash.cloudflare.com/?to=/:account/r2/api-tokens",
        "rotation_notes": (
            "Cloudflare → R2 → Manage R2 API Tokens. Create a new token, "
            "test in staging, then update R2_ACCESS_KEY_ID + "
            "R2_SECRET_ACCESS_KEY in prod env, redeploy, revoke the old "
            "token only AFTER you've verified the new one is live."
        ),
    },
    {
        "id": "postmark",
        "label": "Postmark server token",
        "category": "Email",
        "env_keys": ["POSTMARK_TOKEN", "POSTMARK_SERVER_TOKEN"],
        "cadence_days": 365,
        "rotation_url": "https://account.postmarkapp.com/servers",
        "rotation_notes": (
            "Postmark → Server → API Tokens → Create New, then update "
            "POSTMARK_TOKEN. Revoke the old token only after verifying "
            "production mail is flowing through the new one."
        ),
    },
    {
        "id": "mailgun",
        "label": "Mailgun API key",
        "category": "Email",
        "env_keys": ["MAILGUN_API_KEY"],
        "cadence_days": 365,
        "rotation_url": "https://app.mailgun.com/settings/api_security",
        "rotation_notes": (
            "Used as the Postmark fallback. Mailgun → Account → API "
            "Security → Reset → update MAILGUN_API_KEY. Same as "
            "Postmark — rotate when staff turnover happens."
        ),
    },
    {
        "id": "twilio",
        "label": "Twilio auth token",
        "category": "SMS",
        "env_keys": ["TWILIO_AUTH_TOKEN"],
        "cadence_days": 365,
        "rotation_url": "https://console.twilio.com/",
        "rotation_notes": (
            "Twilio Console → Account → API Credentials. Use the "
            "secondary token slot for zero-downtime rotation: promote "
            "secondary → primary, then regenerate secondary."
        ),
    },
    {
        "id": "openai",
        "label": "OpenAI / Claude (Emergent universal key)",
        "category": "AI",
        "env_keys": ["EMERGENT_LLM_KEY"],
        "cadence_days": 365,
        "rotation_url": "https://app.emergent.sh/profile",
        "rotation_notes": (
            "Managed by Emergent. Rotate from your Emergent profile if "
            "you suspect a leak. Updating just means redeploying with "
            "the new EMERGENT_LLM_KEY value."
        ),
    },
    {
        "id": "kit",
        "label": "Kit.com API key",
        "category": "Marketing",
        "env_keys": ["KIT_API_KEY", "KIT_V4_API_KEY"],
        "cadence_days": 365,
        "rotation_url": "https://app.kit.com/account_settings/developer_settings",
        "rotation_notes": (
            "Kit → Account → Developer settings → Regenerate. "
            "Update KIT_V4_API_KEY in env, redeploy. Used by the "
            "dormant-buyer auto-tagging flow + welcome emails."
        ),
    },
    {
        "id": "slack_webhook",
        "label": "Slack admin webhook",
        "category": "Notifications",
        "env_keys": ["SLACK_ADMIN_WEBHOOK_URL"],
        "cadence_days": 365,
        "rotation_url": "https://api.slack.com/apps",
        "rotation_notes": (
            "Slack app → Incoming Webhooks → revoke + create new. "
            "Used by Beta Feedback / Contact / Prod Outage routing."
        ),
    },
    {
        "id": "discord_webhook",
        "label": "Discord admin webhook",
        "category": "Notifications",
        "env_keys": ["DISCORD_ADMIN_WEBHOOK_URL"],
        "cadence_days": 365,
        "rotation_url": "https://discord.com/developers/applications",
        "rotation_notes": (
            "Discord channel → Edit Channel → Integrations → Webhooks "
            "→ delete + create new. Update env."
        ),
    },
    {
        "id": "shippo",
        "label": "Shippo API token",
        "category": "Shipping",
        "env_keys": ["SHIPPO_API_TOKEN", "SHIPPO_LIVE_TOKEN"],
        "cadence_days": 180,
        "rotation_url": "https://apps.goshippo.com/settings/api",
        "rotation_notes": (
            "Shippo → Settings → API → Generate. Has direct ability "
            "to print labels billable to your account so 6-month "
            "cadence is appropriate."
        ),
    },
]


# ---------------- API ----------------
@router.get("/admin/secrets/status", include_in_schema=False)
async def secrets_status(_claims: dict = Depends(require_super_admin())):
    """Return the rotation tracker payload — what's set, what's overdue,
    when each was last rotated, and the suggested next rotation date.

    We NEVER return the actual secret values — only presence + audit
    metadata. The rotation history (`db.secret_rotations`) records who
    marked each secret as rotated and when, so we can show the operator
    who last touched each row.
    """
    # Pull the latest rotation row per secret. Mongo's $group keeps the
    # max(created_at) per `secret_id`, then we align to TRACKED_SECRETS.
    rows: dict[str, dict] = {}
    async for r in db.secret_rotations.find(
        {}, {"_id": 0}, sort=[("created_at", -1)],
    ):
        sid = r.get("secret_id")
        if sid and sid not in rows:
            rows[sid] = r

    out: list[dict] = []
    today = datetime.now(timezone.utc)
    for spec in TRACKED_SECRETS:
        is_set = any(bool(os.environ.get(k)) for k in spec["env_keys"])
        last = rows.get(spec["id"])
        last_rotated_at = last.get("created_at") if last else None
        last_rotated_by = last.get("admin_email") if last else None

        # Compute next-rotation-due. If we have no record, assume the
        # secret has been around forever (worst-case nudge to rotate).
        if last_rotated_at:
            try:
                rotated_dt = datetime.fromisoformat(last_rotated_at)
            except (ValueError, TypeError):
                rotated_dt = today - timedelta(days=spec["cadence_days"] * 2)
        else:
            rotated_dt = None

        if rotated_dt:
            next_due = rotated_dt + timedelta(days=spec["cadence_days"])
            days_until_due = (next_due - today).days
            overdue = days_until_due < 0
        else:
            next_due = None
            days_until_due = None
            overdue = is_set  # untracked credentials default to overdue

        out.append({
            "id": spec["id"],
            "label": spec["label"],
            "category": spec["category"],
            "env_keys": spec["env_keys"],
            "is_set": is_set,
            "cadence_days": spec["cadence_days"],
            "rotation_url": spec["rotation_url"],
            "rotation_notes": spec["rotation_notes"],
            "last_rotated_at": last_rotated_at,
            "last_rotated_by": last_rotated_by,
            "next_due_at": next_due.isoformat() if next_due else None,
            "days_until_due": days_until_due,
            "overdue": overdue,
            "status": (
                "missing" if not is_set
                else "overdue" if overdue
                else "due_soon" if days_until_due is not None and days_until_due < 30
                else "ok"
            ),
        })

    overdue_count = sum(1 for r in out if r["overdue"] and r["is_set"])
    missing_count = sum(1 for r in out if not r["is_set"])
    return {
        "secrets": out,
        "summary": {
            "total": len(out),
            "configured": sum(1 for r in out if r["is_set"]),
            "overdue": overdue_count,
            "missing": missing_count,
        },
    }


class RotationMark(BaseModel):
    secret_id: str = Field(min_length=1, max_length=80)
    note: Optional[str] = Field(default=None, max_length=500)


@router.post("/admin/secrets/mark-rotated", include_in_schema=False)
async def mark_rotated(payload: RotationMark, claims: dict = Depends(require_super_admin())):
    """Record that a secret was rotated by the operator. We don't take
    the new secret value — operators put that into env directly. This
    just resets the rotation timer + writes an audit row."""
    spec = next((s for s in TRACKED_SECRETS if s["id"] == payload.secret_id), None)
    if not spec:
        raise HTTPException(404, f"Unknown secret id: {payload.secret_id}")
    row = {
        "secret_id": payload.secret_id,
        "label": spec["label"],
        "admin_email": (claims.get("email") or "").lower(),
        "note": (payload.note or "").strip()[:500],
        "created_at": now_iso(),
    }
    await db.secret_rotations.insert_one(row)
    # Mirror to the global admin audit log for unified search.
    try:
        await db.admin_audit_log.insert_one({
            "kind": "secret_rotated",
            **{k: row[k] for k in ("secret_id", "label", "admin_email", "note", "created_at")},
        })
    except Exception as e:
        logger.warning("[secrets] audit mirror failed: %s", e)
    logger.info(
        "[secrets] rotation marked: %s by %s",
        payload.secret_id, row["admin_email"],
    )
    return {"ok": True, "secret_id": payload.secret_id, "rotated_at": row["created_at"]}


@router.get("/admin/secrets/history/{secret_id}", include_in_schema=False)
async def rotation_history(
    secret_id: str, _claims: dict = Depends(require_super_admin()),
):
    """Audit history for a single secret — who rotated it, when, with
    what note. Surfaced under each row as an expandable detail."""
    rows = await db.secret_rotations.find(
        {"secret_id": secret_id}, {"_id": 0},
    ).sort("created_at", -1).limit(50).to_list(50)
    return {"secret_id": secret_id, "history": rows}


# ============================================================
# Stripe Webhook Auto-Rotation
# ============================================================
# The Stripe API doesn't expose a "roll secret" call, BUT it allows
# creating multiple webhook endpoints at the same URL with the same
# event subscriptions. We exploit that to implement real rotation:
#
#   1. /stripe-webhook/rotate
#      - Creates a NEW endpoint with same URL + events.
#      - Returns the new signing secret in the response (one-time;
#        we never store it in a readable form again).
#      - Persists `{new_endpoint_id, new_secret, old_endpoint_id}` to
#        db.secret_overrides for the dual-verification window.
#      - The runtime verifier (stripe_webhook_secrets.py) now accepts
#        BOTH the env secret and the override.
#
#   2. /stripe-webhook/pending
#      - Tells the dashboard whether a rotation is in flight + when
#        it started + a redacted preview of the new secret.
#
#   3. /stripe-webhook/finalize
#      - Admin clicks AFTER they've updated STRIPE_WEBHOOK_SECRET in
#        env and redeployed. We delete the OLD endpoint on Stripe,
#        write a secret_rotations audit row, and clear the override.
#
#   4. /stripe-webhook/cancel
#      - Abort rotation: delete the NEW endpoint on Stripe and clear
#        the override. Used if admin gets cold feet before redeploying.
#
# All four require super-admin. Every action is audit-logged.


def _stripe_sdk():
    """Return the stripe SDK with API key configured. Raises HTTPException
    if no API key is set."""
    api_key = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY")
    if not api_key:
        raise HTTPException(503, "STRIPE_API_KEY not configured")
    import stripe as stripe_sdk
    stripe_sdk.api_key = api_key
    return stripe_sdk


def _stripe_webhook_target_url(kind: str) -> str:
    """Build the public webhook URL that matches the existing route.
    `kind`="main" -> /api/webhook/stripe, "connect" -> /api/webhook/stripe/connect.
    """
    base = (os.environ.get("PUBLIC_BACKEND_URL") or "").rstrip("/")
    if not base:
        raise HTTPException(503, "PUBLIC_BACKEND_URL not configured — needed to register webhooks")
    path = "/api/webhook/stripe" if kind == "main" else "/api/webhook/stripe/connect"
    return f"{base}{path}"


# Event sets we re-subscribe the new endpoint to. Keep these aligned
# with what the handlers actually process (checkout.py + stripe_connect.py).
_STRIPE_MAIN_EVENTS = [
    "checkout.session.completed",
    "checkout.session.expired",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
]
_STRIPE_CONNECT_EVENTS = [
    "account.updated",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_succeeded",
]


def _redact_secret(s: str) -> str:
    """Show first 7 + last 4 chars so admins can sanity-check they pasted
    the right value into env without exposing the rest in logs."""
    if not s or len(s) < 16:
        return "whsec_…"
    return f"{s[:7]}…{s[-4:]}"


class RotateRequest(BaseModel):
    kind: str = Field(default="main", pattern="^(main|connect)$")


@router.post("/admin/secrets/stripe-webhook/rotate", include_in_schema=False)
async def stripe_webhook_rotate(
    payload: RotateRequest, claims: dict = Depends(require_super_admin()),
):
    """Create a NEW Stripe webhook endpoint at the same URL + events and
    return its signing secret. The old endpoint stays live for the dual-
    secret overlap window until the admin clicks "Finalize".

    Returns: `{ok, new_endpoint_id, new_secret, new_secret_preview, rotation_url}`.
    The full `new_secret` is returned ONLY here — store it in your env
    immediately. We persist a copy in `secret_overrides` for runtime
    verification only; the response is the canonical handoff.
    """
    kind = payload.kind
    override_id = "stripe_webhook_pending" if kind == "main" else "stripe_connect_webhook_pending"

    # Refuse to start a second rotation while one is already pending —
    # forces the operator to finalize/cancel first instead of stacking.
    existing = await db.secret_overrides.find_one({"_id": override_id}, {"new_endpoint_id": 1})
    if existing:
        raise HTTPException(409, f"A {kind} webhook rotation is already in flight. Finalize or cancel it first.")

    stripe_sdk = _stripe_sdk()
    target_url = _stripe_webhook_target_url(kind)
    events = _STRIPE_MAIN_EVENTS if kind == "main" else _STRIPE_CONNECT_EVENTS

    # Try to find the current endpoint pointing at this URL so we can
    # delete it during finalize. Stripe returns "secret" only on
    # creation, so we don't know the old endpoint's secret here — but
    # we don't need to: env is the source of truth for the old one.
    old_endpoint_id: Optional[str] = None
    try:
        listing = stripe_sdk.WebhookEndpoint.list(limit=100)
        for ep in listing.get("data", []) or []:
            if (ep.get("url") or "").rstrip("/") == target_url.rstrip("/"):
                old_endpoint_id = ep.get("id")
                break
    except Exception as e:
        logger.warning("[secrets] couldn't list webhooks: %s", e)

    # Create the new endpoint. Stripe returns the secret ONCE here.
    try:
        new_ep = stripe_sdk.WebhookEndpoint.create(
            url=target_url,
            enabled_events=events,
            description=f"Auto-created by Crafters Market secrets rotation on {now_iso()}",
        )
    except Exception as e:
        logger.exception("[secrets] stripe webhook create failed: %s", e)
        raise HTTPException(502, f"Stripe API error creating webhook: {e}")

    new_secret = getattr(new_ep, "secret", None) or new_ep.get("secret")
    new_id = getattr(new_ep, "id", None) or new_ep.get("id")
    if not new_secret or not new_id:
        raise HTTPException(502, "Stripe returned no secret on webhook creation")

    started_at = now_iso()
    await db.secret_overrides.update_one(
        {"_id": override_id},
        {"$set": {
            "kind": kind,
            "target_url": target_url,
            "new_endpoint_id": new_id,
            "new_secret": new_secret,
            "new_secret_preview": _redact_secret(new_secret),
            "old_endpoint_id": old_endpoint_id,
            "started_at": started_at,
            "started_by": (claims.get("email") or "").lower(),
        }},
        upsert=True,
    )

    await db.admin_audit_log.insert_one({
        "kind": "stripe_webhook_rotation_started",
        "webhook_kind": kind,
        "new_endpoint_id": new_id,
        "old_endpoint_id": old_endpoint_id,
        "admin_email": (claims.get("email") or "").lower(),
        "created_at": started_at,
    })
    logger.info(
        "[secrets] stripe webhook rotation started: kind=%s new=%s old=%s by=%s",
        kind, new_id, old_endpoint_id, claims.get("email"),
    )

    return {
        "ok": True,
        "kind": kind,
        "new_endpoint_id": new_id,
        "new_secret": new_secret,          # show ONCE in the UI
        "new_secret_preview": _redact_secret(new_secret),
        "old_endpoint_id": old_endpoint_id,
        "env_var_to_update": "STRIPE_WEBHOOK_SECRET" if kind == "main" else "STRIPE_CONNECT_WEBHOOK_SECRET",
        "next_steps": [
            f"Copy `new_secret` into env var {('STRIPE_WEBHOOK_SECRET' if kind == 'main' else 'STRIPE_CONNECT_WEBHOOK_SECRET')}.",
            "Redeploy the backend.",
            "Send a test event from Stripe (or wait for live traffic) to confirm.",
            "Click 'Finalize rotation' here once everything looks healthy. We'll delete the old endpoint and reset the rotation timer.",
        ],
    }


@router.get("/admin/secrets/stripe-webhook/pending", include_in_schema=False)
async def stripe_webhook_pending(_claims: dict = Depends(require_super_admin())):
    """Return whether a Stripe webhook rotation is currently in flight
    for either kind. Does NOT return the raw new_secret — only the
    preview (first 7 + last 4 chars). Use this to drive the dashboard
    badge and the finalize/cancel buttons.
    """
    out: dict = {}
    for kind, oid in (("main", "stripe_webhook_pending"),
                      ("connect", "stripe_connect_webhook_pending")):
        row = await db.secret_overrides.find_one(
            {"_id": oid},
            {"_id": 0, "kind": 1, "target_url": 1, "new_endpoint_id": 1,
             "new_secret_preview": 1, "old_endpoint_id": 1, "started_at": 1,
             "started_by": 1},
        )
        out[kind] = row
    return {"pending": out}


@router.post("/admin/secrets/stripe-webhook/finalize", include_in_schema=False)
async def stripe_webhook_finalize(
    payload: RotateRequest, claims: dict = Depends(require_super_admin()),
):
    """Finish a pending rotation: delete the OLD Stripe webhook endpoint,
    write a `secret_rotations` row (resets the rotation timer in the
    main tracker), and clear the override.

    Operator must have already updated env + redeployed before calling
    this. The override's runtime acceptance was their grace period.
    """
    kind = payload.kind
    override_id = "stripe_webhook_pending" if kind == "main" else "stripe_connect_webhook_pending"
    secret_id_for_tracker = "stripe_webhook" if kind == "main" else "stripe_webhook"  # both flow under same row

    row = await db.secret_overrides.find_one({"_id": override_id})
    if not row:
        raise HTTPException(404, f"No pending {kind} webhook rotation to finalize")

    stripe_sdk = _stripe_sdk()
    old_id = row.get("old_endpoint_id")
    delete_err: Optional[str] = None
    if old_id:
        try:
            stripe_sdk.WebhookEndpoint.delete(old_id)
            logger.info("[secrets] deleted old stripe webhook endpoint: %s", old_id)
        except Exception as e:
            # If the endpoint was already deleted by hand we still want
            # to clear the override — log + continue.
            delete_err = str(e)
            logger.warning("[secrets] couldn't delete old endpoint %s: %s", old_id, e)

    finalized_at = now_iso()
    admin_email = (claims.get("email") or "").lower()

    # Write a secret_rotations row so the main tracker shows the timer
    # as reset (next_due = today + cadence_days).
    await db.secret_rotations.insert_one({
        "secret_id": secret_id_for_tracker,
        "label": "Stripe webhook signing secret",
        "admin_email": admin_email,
        "note": f"Auto-rotated via API. kind={kind} new_endpoint={row.get('new_endpoint_id')}",
        "created_at": finalized_at,
    })

    await db.secret_overrides.delete_one({"_id": override_id})

    await db.admin_audit_log.insert_one({
        "kind": "stripe_webhook_rotation_finalized",
        "webhook_kind": kind,
        "new_endpoint_id": row.get("new_endpoint_id"),
        "old_endpoint_id": old_id,
        "old_delete_error": delete_err,
        "admin_email": admin_email,
        "created_at": finalized_at,
    })
    return {
        "ok": True,
        "kind": kind,
        "old_endpoint_deleted": bool(old_id) and not delete_err,
        "old_delete_error": delete_err,
        "finalized_at": finalized_at,
    }


@router.post("/admin/secrets/stripe-webhook/cancel", include_in_schema=False)
async def stripe_webhook_cancel(
    payload: RotateRequest, claims: dict = Depends(require_super_admin()),
):
    """Abort a pending rotation: delete the NEW Stripe webhook endpoint
    (the one we just created) and clear the override. Use this if you
    didn't promote the new secret to env yet — we revert cleanly.
    """
    kind = payload.kind
    override_id = "stripe_webhook_pending" if kind == "main" else "stripe_connect_webhook_pending"
    row = await db.secret_overrides.find_one({"_id": override_id})
    if not row:
        raise HTTPException(404, f"No pending {kind} webhook rotation to cancel")

    stripe_sdk = _stripe_sdk()
    new_id = row.get("new_endpoint_id")
    delete_err: Optional[str] = None
    if new_id:
        try:
            stripe_sdk.WebhookEndpoint.delete(new_id)
        except Exception as e:
            delete_err = str(e)
            logger.warning("[secrets] couldn't delete new endpoint %s: %s", new_id, e)

    await db.secret_overrides.delete_one({"_id": override_id})
    cancelled_at = now_iso()
    await db.admin_audit_log.insert_one({
        "kind": "stripe_webhook_rotation_cancelled",
        "webhook_kind": kind,
        "new_endpoint_id": new_id,
        "new_delete_error": delete_err,
        "admin_email": (claims.get("email") or "").lower(),
        "created_at": cancelled_at,
    })
    return {
        "ok": True,
        "kind": kind,
        "new_endpoint_deleted": bool(new_id) and not delete_err,
        "new_delete_error": delete_err,
        "cancelled_at": cancelled_at,
    }


# ─────────────── iter289 — Stripe webhook health widget ───────────────
@router.get("/admin/stripe/webhook-health")
async def stripe_webhook_health(_admin: dict = Depends(_current_admin)):
    """Last-7-days summary of Stripe webhook events (main + connect).

    Pulls from `stripe_webhook_log` (populated by both webhook routes
    via `stripe_webhook_log.record`). Surfaces at-a-glance:
      • last received event timestamp per kind (with how-long-ago)
      • 7d success / failure counts split by main vs. connect
      • most-recent 5 errors so the admin can copy the message into
        Stripe Dashboard support without leaving the page
    Empty / never-hit state returns zeros + a hint string the UI shows
    when no webhooks have fired yet (e.g. fresh deploy, wrong URL).
    """
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    cutoff_7d  = (now - timedelta(days=7)).isoformat()
    cutoff_24h = (now - timedelta(hours=24)).isoformat()

    out = {}
    for kind in ("main", "connect"):
        # Counts in last 7d
        ok_7d = await db.stripe_webhook_log.count_documents(
            {"kind": kind, "ts": {"$gte": cutoff_7d}, "status": "ok"})
        err_7d = await db.stripe_webhook_log.count_documents(
            {"kind": kind, "ts": {"$gte": cutoff_7d}, "status": {"$ne": "ok"}})
        # Last 24h subset (for the "is it still working?" pulse)
        ok_24h = await db.stripe_webhook_log.count_documents(
            {"kind": kind, "ts": {"$gte": cutoff_24h}, "status": "ok"})
        # Most-recent hit of any status — drives the "last seen 4h ago" chip
        last = await db.stripe_webhook_log.find_one(
            {"kind": kind}, {"_id": 0},
            sort=[("ts", -1)],
        )
        # Last 5 NON-ok rows for the inline error preview
        errors_cur = db.stripe_webhook_log.find(
            {"kind": kind, "status": {"$ne": "ok"}},
            {"_id": 0, "ts": 1, "status": 1, "error": 1,
             "event_type": 1, "path": 1},
        ).sort("ts", -1).limit(5)
        errors = [e async for e in errors_cur]
        out[kind] = {
            "ok_7d": ok_7d,
            "err_7d": err_7d,
            "ok_24h": ok_24h,
            "last": last,
            "recent_errors": errors,
        }

    # Configuration sanity — is the secret even loaded?
    out["secrets_configured"] = {
        "main":    bool((os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()),
        "connect": bool((os.environ.get("STRIPE_CONNECT_WEBHOOK_SECRET") or "").strip()
                        or (os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()),
    }
    return out


# iter413bn — Reset the webhook-health counters. Wipes `stripe_webhook_log`
# rows for the requested channel(s) / scope so a stale red "228 ERR / 7D"
# verdict (e.g. from a webhook that has since been fixed in Stripe Dashboard)
# can be cleared without having to wait 7d for the rolling window to roll off.
# Audit-logged. Super-admin only.
class _WebhookHealthResetBody(BaseModel):
    kind: Optional[str] = None         # "main" | "connect" | None=both
    errors_only: bool = False          # if True, keep status=="ok" rows


@router.post("/admin/stripe/webhook-health/reset")
async def stripe_webhook_health_reset(
    body: _WebhookHealthResetBody,
    claims: dict = Depends(require_super_admin()),
):
    """Wipe webhook-log rows so the health card resets to a clean slate.

    Use cases:
      • You fixed a misconfigured endpoint in Stripe Dashboard but the
        228 stale errors are still poisoning the 7-day verdict.
      • You're done debugging and want a clean baseline for the next run.

    Defaults clear ALL rows for ALL channels — pass `kind` to limit to one
    channel, or `errors_only=true` to preserve the success history."""
    q: dict = {}
    if body.kind in ("main", "connect"):
        q["kind"] = body.kind
    if body.errors_only:
        q["status"] = {"$ne": "ok"}

    # Snapshot the count before wipe so the audit row + response have
    # actionable numbers (not just "deleted some").
    before = await db.stripe_webhook_log.count_documents(q)
    res = await db.stripe_webhook_log.delete_many(q)

    import uuid
    await db.admin_audit.insert_one({
        "id": str(uuid.uuid4()),
        "kind": "stripe_webhook_health_reset",
        "email": (claims.get("email") or "").lower(),
        "filter": {"kind": body.kind, "errors_only": body.errors_only},
        "matched": before,
        "deleted": res.deleted_count,
        "ts": now_iso(),
    })
    logger.info("[stripe-webhook-health] reset by %s — deleted %d rows (filter=%s)",
                claims.get("email"), res.deleted_count, q)
    return {
        "ok": True,
        "deleted": res.deleted_count,
        "filter": {"kind": body.kind, "errors_only": body.errors_only},
    }


# ─────────────── iter413ay — Stripe-side webhook endpoint introspection ───────────────
# Reads the live list of webhook endpoints CONFIGURED in Stripe Dashboard
# (via Stripe API) and red-flags any whose URL path doesn't match an actual
# backend route. This is what catches the "Crafters Market endpoint pointing
# at /api/checkout/webhook (which doesn't exist)" class of misconfig.
#
# Why a hardcoded path list rather than introspecting FastAPI? Stripe-side
# config is rare and tiny — keeping the source of truth explicit makes it
# obvious what each path is for, and avoids accidentally validating against
# admin-only or internal routes.
_KNOWN_WEBHOOK_PATHS = {
    "/api/webhook/stripe":         "main · checkout.session.* + payment_intent.*",
    "/api/webhook/stripe/connect": "connect · account.updated + subscriptions",
    "/api/stripe/connect/webhook": "connect (alias) · same as /api/webhook/stripe/connect",
}


def _public_hosts() -> list[str]:
    """Lowercased hosts this deployment recognises as its own (no scheme,
    no path). Anything outside this set is treated as a 'foreign' endpoint
    (e.g. a preview pod, a different project) — not flagged as broken."""
    from urllib.parse import urlparse
    hosts: set[str] = set()
    for var in ("PUBLIC_BACKEND_URL", "PUBLIC_SITE_URL", "PUBLIC_APP_URL"):
        v = (os.environ.get(var) or "").strip()
        if not v:
            continue
        try:
            h = urlparse(v).hostname
        except Exception:
            continue
        if h:
            hosts.add(h.lower())
    if not hosts:
        # Hard fallback — we KNOW this is the prod domain.
        hosts.add("craftersmarket.org")
    return sorted(hosts)


@router.get("/admin/stripe/webhook-endpoints")
async def stripe_webhook_endpoints_list(_admin: dict = Depends(_current_admin)):
    """Pull the live webhook-endpoint registry from Stripe API and
    cross-reference every entry against the backend's known webhook
    paths. The result powers the 'Configured in Stripe' sub-card on the
    admin webhook-health widget.

    Each row's `verdict`:
      • `ok`            — path matches a known backend route AND host
                          matches one of our public hosts. Working setup.
      • `wrong_path`    — host is ours but path is unknown. 404 on every
                          delivery. THIS is the misconfig we're hunting.
      • `disabled`      — endpoint exists in Stripe but is disabled.
      • `foreign_host`  — host is not ours (preview / unrelated project).
                          Not actionable from this deploy — informational.
    """
    from urllib.parse import urlparse
    import asyncio as _asyncio

    api_key = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY")
    if not api_key:
        return {
            "configured": False,
            "error": "STRIPE_API_KEY not configured — cannot list Stripe endpoints.",
            "public_hosts": _public_hosts(),
            "known_paths": _KNOWN_WEBHOOK_PATHS,
            "endpoints": [],
        }

    sdk = _stripe_sdk()
    # Stripe SDK is sync — run in default thread executor so we don't
    # block the event loop on the network round-trip.
    def _list_all() -> list:
        out: list = []
        # `auto_paging_iter` would be cleaner but the test harness mocks
        # `list(...).data`, so respect that contract.
        first = sdk.WebhookEndpoint.list(limit=100)
        out.extend(getattr(first, "data", []) or [])
        return out
    try:
        items = await _asyncio.to_thread(_list_all)
    except Exception as e:
        logger.warning("[webhook-endpoints] stripe list failed: %s", e)
        return {
            "configured": True,
            "error": f"Stripe API call failed: {e}",
            "public_hosts": _public_hosts(),
            "known_paths": _KNOWN_WEBHOOK_PATHS,
            "endpoints": [],
        }

    public_hosts = set(_public_hosts())
    endpoints: list[dict] = []
    for ep in items:
        # Stripe SDK objects support dict-like access; fall back to attrs.
        def _g(k, default=None):
            try:
                return ep[k]
            except Exception:
                return getattr(ep, k, default)
        url = (_g("url") or "").strip()
        status = _g("status") or "enabled"
        try:
            parsed = urlparse(url)
            host = (parsed.hostname or "").lower()
            path = parsed.path or ""
        except Exception:
            host, path = "", ""

        host_matches = host in public_hosts
        path_matches = path in _KNOWN_WEBHOOK_PATHS
        if status != "enabled":
            verdict = "disabled"
            reason  = "Endpoint is disabled in Stripe — no events delivered."
        elif not host_matches:
            verdict = "foreign_host"
            reason  = f"Host {host or '(none)'} doesn't match this deploy ({', '.join(sorted(public_hosts))})."
        elif path_matches:
            verdict = "ok"
            reason  = f"Routes to backend handler: {_KNOWN_WEBHOOK_PATHS[path]}."
        else:
            verdict = "wrong_path"
            expected = " or ".join(_KNOWN_WEBHOOK_PATHS.keys())
            reason  = f"Path '{path}' does not match any backend route. Expected one of: {expected}."

        endpoints.append({
            "id": _g("id"),
            "url": url,
            "host": host,
            "path": path,
            "status": status,
            "enabled_events_count": len(_g("enabled_events", []) or []),
            "enabled_events": list(_g("enabled_events", []) or [])[:8],  # cap noise
            "secret_prefix": _redact_secret(_g("secret") or ""),
            "created": _g("created"),
            "host_matches_public": host_matches,
            "path_matches_known": path_matches,
            "verdict": verdict,
            "reason": reason,
        })

    # Surface broken endpoints first so the admin sees them without scrolling.
    order = {"wrong_path": 0, "disabled": 1, "ok": 2, "foreign_host": 3}
    endpoints.sort(key=lambda r: (order.get(r["verdict"], 99), r["url"]))

    return {
        "configured": True,
        "error": None,
        "public_hosts": sorted(public_hosts),
        "known_paths": _KNOWN_WEBHOOK_PATHS,
        "endpoints": endpoints,
        "summary": {
            "total": len(endpoints),
            "ok": sum(1 for e in endpoints if e["verdict"] == "ok"),
            "wrong_path": sum(1 for e in endpoints if e["verdict"] == "wrong_path"),
            "disabled": sum(1 for e in endpoints if e["verdict"] == "disabled"),
            "foreign_host": sum(1 for e in endpoints if e["verdict"] == "foreign_host"),
        },
    }


@router.post("/admin/stripe/webhook-endpoints/{endpoint_id}/disable",
             include_in_schema=False)
async def stripe_webhook_endpoint_disable(
    endpoint_id: str,
    claims: dict = Depends(require_super_admin()),
):
    """Flip a Stripe webhook endpoint to `disabled` so it stops receiving
    events. We intentionally do NOT delete — disable is reversible from
    the Stripe Dashboard and keeps the audit trail intact.

    Used to neutralise dead endpoints (e.g. one pointing at the wrong URL
    path, generating 100% errors) without leaving the admin console."""
    import asyncio as _asyncio
    if not endpoint_id or not endpoint_id.startswith("we_"):
        raise HTTPException(400, "Invalid endpoint id (expected we_…).")
    sdk = _stripe_sdk()

    def _disable() -> dict:
        ep = sdk.WebhookEndpoint.modify(endpoint_id, disabled=True)
        return {"id": ep["id"], "status": ep.get("status"), "url": ep.get("url")}
    try:
        result = await _asyncio.to_thread(_disable)
    except Exception as e:
        logger.warning("[webhook-endpoints] disable %s failed: %s", endpoint_id, e)
        raise HTTPException(502, f"Stripe API call failed: {e}")

    await db.admin_audit_log.insert_one({
        "kind": "stripe_webhook_endpoint_disabled",
        "endpoint_id": endpoint_id,
        "endpoint_url": result.get("url"),
        "admin_email": (claims.get("email") or "").lower(),
        "created_at": now_iso(),
    })
    return {"ok": True, **result}


# ─────────────── iter292 — Sales channel feeds widget ───────────────
@router.get("/admin/feeds/status")
async def feeds_status(_admin: dict = Depends(_current_admin)):
    """Per-channel summary for the admin "Sales channel feeds" card.

    For each of the 3 catalog feeds we run (Pinterest / Google / Meta),
    returns the most-recent crawler hit + a 7d hit count. The card uses
    this to prove the platform's crawler is actually fetching, and to
    surface "haven't seen a hit in 36h" warnings."""
    from datetime import datetime, timedelta, timezone
    PUBLIC = (os.environ.get("PUBLIC_APP_URL") or "https://craftersmarket.org").rstrip("/")
    now = datetime.now(timezone.utc)
    cutoff_7d = (now - timedelta(days=7)).isoformat()

    channels = [
        {"key": "pinterest", "name": "Pinterest",
         "url": f"{PUBLIC}/api/pinterest/feed.csv",
         "format": "CSV"},
        {"key": "google", "name": "Google Merchant",
         "url": f"{PUBLIC}/api/google-merchant/feed.xml",
         "format": "XML"},
        {"key": "meta", "name": "Meta (FB + IG Shop)",
         "url": f"{PUBLIC}/api/meta/feed.csv",
         "format": "CSV"},
    ]
    for c in channels:
        last = await db.feed_access_log.find_one(
            {"channel": c["key"]}, {"_id": 0},
            sort=[("ts", -1)],
        )
        hits_7d = await db.feed_access_log.count_documents(
            {"channel": c["key"], "ts": {"$gte": cutoff_7d}},
        )
        c["last_hit"] = last
        c["hits_7d"] = hits_7d

    return {"channels": channels}


# ─────────────── iter293 — Pinterest feed credentials view + rotate ───────────────
@router.get("/admin/feeds/{channel}/credentials")
async def feed_credentials_get(channel: str, _admin: dict = Depends(_current_admin)):
    """Return the current Basic-Auth credentials for a catalog feed.
    Currently only `pinterest` is supported (Google + Meta don't require auth)."""
    if channel not in ("pinterest",):
        raise HTTPException(404, "Channel does not require auth.")
    from feed_auth import get as _get
    creds = await _get(channel)
    if not creds:
        # Auto-bootstrap if the doc somehow disappeared.
        from feed_auth import ensure_default
        creds = await ensure_default(channel)
    return creds


@router.post("/admin/feeds/{channel}/rotate-password")
async def feed_credentials_rotate(channel: str, admin: dict = Depends(_current_admin)):
    """Generate a fresh password for this channel. The previous password
    immediately stops working, so the admin needs to paste the new value
    into Pinterest's data-source form before the next crawl."""
    if channel not in ("pinterest",):
        raise HTTPException(404, "Channel does not require auth.")
    from feed_auth import rotate as _rotate
    actor = (admin or {}).get("email") or "admin"
    return await _rotate(channel, actor=actor)
