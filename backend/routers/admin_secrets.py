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
