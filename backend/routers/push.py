"""Web Push notifications via VAPID.

Public endpoints let any visitor (anon, buyer, or maker) subscribe their
browser. Admin endpoints fan-out to selected audiences using `pywebpush`.
Audience taxonomy mirrors the existing email broadcaster:
  - all            : every active subscription
  - buyers         : subs whose role == 'buyer' OR email matches a known buyer
  - makers         : subs whose role == 'maker' OR email matches a known maker
  - anon           : subs with no email on file
"""
from __future__ import annotations

import os
import json
import secrets
from typing import Optional, Literal
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, Field, EmailStr

from core import db, logger, now_iso
from maker_auth import current_admin, decode_session_jwt

try:
    from pywebpush import webpush, WebPushException  # type: ignore
except Exception as e:  # pragma: no cover
    webpush = None
    WebPushException = Exception
    logger.warning("pywebpush not available: %s", e)


router = APIRouter()

VAPID_PUBLIC = (os.environ.get("VAPID_PUBLIC_KEY") or "").strip()
VAPID_PRIVATE_PEM = (os.environ.get("VAPID_PRIVATE_KEY_PEM") or "").replace("\\n", "\n").strip()
VAPID_SUBJECT = (os.environ.get("VAPID_SUBJECT") or "mailto:ops@craftersmarket.org").strip()


# ───────────── Schemas ─────────────
class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscription(BaseModel):
    endpoint: str
    keys: PushKeys
    expirationTime: Optional[float] = None  # browser supplies, kept for parity


class RegisterRequest(BaseModel):
    subscription: PushSubscription
    user_agent: Optional[str] = None
    # Optional — frontend can supply an explicit role/email for tagging.
    # Otherwise the bearer token (if present) is decoded.
    role: Optional[Literal["buyer", "maker", "admin", "anon"]] = None
    email: Optional[EmailStr] = None


class UnregisterRequest(BaseModel):
    endpoint: str


class BroadcastRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    body: str = Field(..., min_length=1, max_length=400)
    url: Optional[str] = "/"
    audience: Literal["all", "buyers", "makers", "anon"] = "all"
    icon: Optional[str] = "/downloads/cnc-garage-builders.png"


# ───────────── Helpers ─────────────
def _decode_optional_token(authorization: Optional[str]) -> dict:
    """Return JWT claims if a valid bearer token is present, else {}."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return {}
    try:
        return decode_session_jwt(authorization.split(" ", 1)[1].strip()) or {}
    except Exception:
        return {}


async def _audience_filter(audience: str) -> dict:
    if audience == "all":
        return {}
    if audience == "buyers":
        return {"role": "buyer"}
    if audience == "makers":
        return {"role": "maker"}
    if audience == "anon":
        return {"$or": [{"role": "anon"}, {"role": None}, {"role": {"$exists": False}}]}
    raise HTTPException(400, f"Unknown audience: {audience}")


# ───────────── Public: VAPID public key ─────────────
@router.get("/push/vapid-public-key")
async def get_vapid_public_key():
    if not VAPID_PUBLIC:
        raise HTTPException(500, "VAPID_PUBLIC_KEY not configured.")
    return {"public_key": VAPID_PUBLIC}


# ───────────── Public: register / unregister ─────────────
@router.post("/push/register")
async def push_register(
    body: RegisterRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Persist a push subscription. Idempotent: same endpoint replaces prior row."""
    sub = body.subscription
    claims = _decode_optional_token(authorization)
    role = body.role or claims.get("role") or "anon"
    if role == "admin":
        # Admins normally subscribe AS themselves — fine, but tag separately.
        role = "admin"
    email = (body.email or claims.get("email") or "").strip().lower() or None

    doc = {
        "endpoint": sub.endpoint,
        "p256dh": sub.keys.p256dh,
        "auth": sub.keys.auth,
        "role": role,
        "email": email,
        "user_agent": (body.user_agent or request.headers.get("user-agent") or "")[:300],
        "ip": (request.client.host if request.client else None),
        "updated_at": now_iso(),
    }
    existing = await db.push_subscriptions.find_one({"endpoint": sub.endpoint}, {"_id": 0, "id": 1})
    if existing:
        await db.push_subscriptions.update_one(
            {"endpoint": sub.endpoint}, {"$set": doc},
        )
        return {"ok": True, "id": existing["id"], "updated": True}
    sid = secrets.token_hex(12)
    doc["id"] = sid
    doc["created_at"] = now_iso()
    await db.push_subscriptions.insert_one(doc)
    return {"ok": True, "id": sid, "created": True}


@router.post("/push/unregister")
async def push_unregister(body: UnregisterRequest):
    r = await db.push_subscriptions.delete_one({"endpoint": body.endpoint})
    return {"ok": True, "removed": r.deleted_count}


# ───────────── Admin: stats / broadcast / history ─────────────
@router.get("/admin/push/stats")
async def admin_push_stats(_: dict = Depends(current_admin)):
    pipe = [{"$group": {"_id": "$role", "count": {"$sum": 1}}}]
    by_role = {r["_id"] or "anon": r["count"] async for r in db.push_subscriptions.aggregate(pipe)}
    total = await db.push_subscriptions.count_documents({})
    last_broadcast = await db.push_broadcasts.find_one(
        {}, {"_id": 0}, sort=[("created_at", -1)],
    )
    return {
        "total": total,
        "by_role": {
            "all": total,
            "buyers": by_role.get("buyer", 0),
            "makers": by_role.get("maker", 0),
            "admin": by_role.get("admin", 0),
            "anon": by_role.get("anon", 0),
        },
        "vapid_public_key": VAPID_PUBLIC,
        "last_broadcast": last_broadcast,
    }


def _send_one(sub_row: dict, payload: dict) -> tuple[bool, Optional[str]]:
    """Single push send. Returns (ok, error_str). Caller handles dead-row deletion."""
    if not webpush:
        return False, "pywebpush not installed"
    if not VAPID_PRIVATE_PEM:
        return False, "VAPID_PRIVATE_KEY_PEM not configured"
    try:
        webpush(
            subscription_info={
                "endpoint": sub_row["endpoint"],
                "keys": {"p256dh": sub_row["p256dh"], "auth": sub_row["auth"]},
            },
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_PEM,
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=24 * 60 * 60,
        )
        return True, None
    except WebPushException as e:
        # 404/410 → dead subscription, signal caller to prune.
        status = getattr(getattr(e, "response", None), "status_code", None)
        return False, f"WebPushException:{status}:{str(e)[:200]}"
    except Exception as e:  # pragma: no cover
        return False, f"Exception:{type(e).__name__}:{str(e)[:200]}"


@router.post("/admin/push/broadcast")
async def admin_push_broadcast(
    body: BroadcastRequest, claims: dict = Depends(current_admin),
):
    if not VAPID_PRIVATE_PEM:
        raise HTTPException(500, "VAPID keys not configured on backend.")
    flt = await _audience_filter(body.audience)
    subs = await db.push_subscriptions.find(flt, {"_id": 0}).to_list(10000)
    if not subs:
        raise HTTPException(400, f"No subscribers in audience '{body.audience}'.")

    payload = {
        "title": body.title,
        "body": body.body,
        "url": body.url or "/",
        "icon": body.icon or "/downloads/cnc-garage-builders.png",
        "badge": "/downloads/cnc-garage-builders.png",
        "tag": "cm-broadcast",
        "ts": datetime.now(timezone.utc).isoformat(),
    }

    sent, failed, dead_endpoints = 0, 0, []
    failures: list[dict] = []
    for s in subs:
        ok, err = _send_one(s, payload)
        if ok:
            sent += 1
        else:
            failed += 1
            failures.append({"endpoint": s["endpoint"][:80], "error": err})
            # Prune dead subscriptions (Gone/NotFound).
            if err and ("WebPushException:404" in err or "WebPushException:410" in err):
                dead_endpoints.append(s["endpoint"])

    if dead_endpoints:
        await db.push_subscriptions.delete_many({"endpoint": {"$in": dead_endpoints}})
        logger.info("Pruned %d dead push subscriptions.", len(dead_endpoints))

    bid = secrets.token_hex(12)
    record = {
        "id": bid,
        "title": body.title,
        "body": body.body,
        "url": body.url or "/",
        "audience": body.audience,
        "sent": sent,
        "failed": failed,
        "pruned": len(dead_endpoints),
        "actor": claims.get("email"),
        "created_at": now_iso(),
        "failures_sample": failures[:5],
    }
    await db.push_broadcasts.insert_one(record)
    return {"ok": True, **record}


@router.get("/admin/push/history")
async def admin_push_history(_: dict = Depends(current_admin), limit: int = 50):
    limit = max(1, min(limit, 200))
    rows = await db.push_broadcasts.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"history": rows}


@router.post("/admin/push/test")
async def admin_push_test(claims: dict = Depends(current_admin)):
    """Send a test push to the calling admin's own subscriptions (by email)."""
    email = (claims.get("email") or "").lower()
    subs = await db.push_subscriptions.find({"email": email}, {"_id": 0}).to_list(20)
    if not subs:
        raise HTTPException(404, "You have no push subscriptions registered yet. Click 'Enable browser notifications' on the admin page first.")
    payload = {
        "title": "Test push from Crafters Market admin",
        "body": "If you can see this, web push is wired up correctly.",
        "url": "/admin/dashboard",
        "icon": "/downloads/cnc-garage-builders.png",
        "tag": "cm-test",
    }
    sent = 0
    for s in subs:
        ok, _ = _send_one(s, payload)
        sent += int(ok)
    return {"ok": True, "sent": sent, "total": len(subs)}


# ───────────────────────────────────────────────────────────────────────
# Internal helper — fan out a transactional push to a single buyer
# ───────────────────────────────────────────────────────────────────────
# Used by shipping/delivery flows to give buyers a real-time browser
# notification *in addition to* their transactional email. Replaces the
# "SMS nudge" we deferred — Web Push is free, has no carrier paperwork,
# and works on every desktop + Android browser the buyer uses.
#
# Fire-and-forget: every callsite wraps this in try/except so a push
# failure never breaks the underlying business flow (shipped email,
# delivered email, etc.).
# ───────────────────────────────────────────────────────────────────────
async def notify_buyer_push(
    email: str, title: str, body: str, url: str = "/",
    tag: str = "cm-buyer", icon: Optional[str] = None,
) -> dict:
    """Send a transactional push to all subscriptions matching `email`.
    Returns {sent, total, pruned}. Silently no-ops when VAPID isn't
    configured or the buyer has zero subscriptions."""
    if not VAPID_PRIVATE_PEM or not webpush:
        return {"sent": 0, "total": 0, "pruned": 0, "skipped": "vapid_missing"}
    if not email:
        return {"sent": 0, "total": 0, "pruned": 0, "skipped": "no_email"}

    subs = await db.push_subscriptions.find(
        {"email": email.strip().lower()}, {"_id": 0},
    ).to_list(50)
    if not subs:
        return {"sent": 0, "total": 0, "pruned": 0, "skipped": "no_subs"}

    payload = {
        "title": title,
        "body": body,
        "url": url or "/",
        "icon": icon or "/downloads/cnc-garage-builders.png",
        "badge": "/downloads/cnc-garage-builders.png",
        "tag": tag,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    sent, dead = 0, []
    for s in subs:
        ok, err = _send_one(s, payload)
        if ok:
            sent += 1
        elif err and ("WebPushException:404" in err or "WebPushException:410" in err):
            dead.append(s["endpoint"])
    if dead:
        await db.push_subscriptions.delete_many({"endpoint": {"$in": dead}})
    return {"sent": sent, "total": len(subs), "pruned": len(dead)}
