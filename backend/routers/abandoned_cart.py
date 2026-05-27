"""Abandoned-cart Web Push re-engagement.

Sits next to the existing client-side localStorage cart. We sync the cart
to MongoDB whenever the buyer has an email we can reach them at — either
via a community JWT (`cm_buyer_jwt`) or via an existing Web Push
subscription. After 6 hours of cart inactivity, the
`abandoned_cart_push` scheduled job fires a single browser push nudging
them back to checkout. Idempotent: each cart receives at most one push,
gated by `last_push_at`.

This is the natural follow-on to the SMS → Web Push pivot. Same
plumbing, zero carrier paperwork, and abandoned-cart recovery in
e-commerce typically lifts gross merchandise volume 8–12%.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core import db
# notify_buyer_push is imported lazily here (rather than from routers.push
# at module load time) to break a potential circular-import — push.py
# imports maker_auth, which imports the auth_password router, which
# transitively imports checkout. We re-bind it on the module namespace
# so test code can `patch("routers.abandoned_cart.notify_buyer_push")`.
from routers.push import notify_buyer_push  # noqa: E402


router = APIRouter(tags=["abandoned-cart"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ─────────────────── models ───────────────────
class CartItem(BaseModel):
    id: str
    slug: Optional[str] = None
    title: Optional[str] = None
    price: Optional[float] = None
    image: Optional[str] = None
    quantity: int = 1
    variant_id: Optional[str] = None
    variant_label: Optional[str] = None


class CartTrackPayload(BaseModel):
    items: list[CartItem] = Field(default_factory=list)


# ─────────────────── helpers ───────────────────
async def _email_for_request(req: Request) -> Optional[str]:
    """Resolve a contact email for the calling buyer:
    - If they pass a community JWT (`Authorization: Bearer <cm_buyer_jwt>`),
      use the email claim.
    - Otherwise fall back to the email on any of their Web Push
      subscriptions, scoped by the `X-Push-Endpoint` header the
      service worker sends with cart syncs.
    Returns lowercased email or None if neither path resolves.
    """
    auth = req.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
        try:
            from maker_auth import decode_session_jwt
            claims = decode_session_jwt(token) or {}
            em = (claims.get("email") or "").strip().lower()
            if em and "@" in em:
                return em
        except Exception:
            pass

    endpoint = (req.headers.get("x-push-endpoint") or "").strip()
    if endpoint:
        sub = await db.push_subscriptions.find_one(
            {"endpoint": endpoint}, {"_id": 0, "email": 1},
        )
        if sub and sub.get("email"):
            return (sub["email"] or "").strip().lower()
    return None


# ─────────────────── endpoints ───────────────────
@router.post("/cart/track")
async def track_cart(payload: CartTrackPayload, request: Request):
    """Persist the buyer's cart so we can re-engage if they walk away.
    No-op when we can't resolve an email — the localStorage cart still
    works, we just can't push them later."""
    email = await _email_for_request(request)
    if not email:
        return {"ok": True, "tracked": False, "reason": "no_email"}

    # Empty cart → drop the row so we don't push for a wishlist clear-out.
    if not payload.items:
        await db.abandoned_carts.delete_one({"email": email})
        return {"ok": True, "tracked": False, "cleared": True}

    items = [it.model_dump(exclude_none=True) for it in payload.items]
    await db.abandoned_carts.update_one(
        {"email": email},
        {
            "$set": {
                "email": email,
                "items": items,
                "updated_at": _now().isoformat(),
            },
            "$setOnInsert": {"created_at": _now().isoformat()},
            # New cart activity unblocks future pushes/emails, in case the
            # buyer comes back, modifies the cart, walks away again.
            "$unset": {
                "last_push_at": "", "checked_out_at": "",
                "last_email_at": "", "email_attempt_count": "",
            },
        },
        upsert=True,
    )
    return {"ok": True, "tracked": True, "items": len(items)}


async def mark_checked_out(email: str) -> None:
    """Called by the checkout flow once a session reaches `paid`. Stops
    any pending re-engagement push from firing. Best-effort; safe to
    call even when no row exists."""
    if not email:
        return
    await db.abandoned_carts.update_one(
        {"email": email.strip().lower()},
        {"$set": {"checked_out_at": _now().isoformat()}},
    )


# ─────────────────── scheduler entrypoint ───────────────────
async def fire_abandoned_cart_pushes(idle_hours: int = 6) -> dict:
    """Walk carts last touched > `idle_hours` ago that haven't been
    pushed yet AND aren't checked out. Fire one push per cart."""
    cutoff_iso = (_now() - timedelta(hours=idle_hours)).isoformat()
    cursor = db.abandoned_carts.find(
        {
            "updated_at": {"$lt": cutoff_iso},
            "last_push_at": {"$in": [None, ""]},
            "checked_out_at": {"$in": [None, ""]},
            "items.0": {"$exists": True},
        },
        {"_id": 0},
    )
    sent = skipped = errors = 0

    async for c in cursor:
        try:
            email = c.get("email") or ""
            items = c.get("items") or []
            if not email or not items:
                skipped += 1
                continue
            # Headline = highest-priced item title; fallback to count.
            try:
                spotlight = max(items, key=lambda x: float(x.get("price") or 0))
                spotlight_title = (spotlight.get("title") or "").strip()
            except Exception:
                spotlight_title = ""
            other_count = max(0, len(items) - 1)
            if spotlight_title and other_count:
                body = f"{spotlight_title} (+{other_count} more) is still in your cart. Tap to finish checkout."
            elif spotlight_title:
                body = f"{spotlight_title} is still in your cart. Tap to finish checkout."
            else:
                body = "Your Crafters Market cart is still waiting. Tap to finish checkout."

            r = await notify_buyer_push(
                email,
                "Still thinking it over?",
                body,
                url="/cart",
                tag="cm-abandoned-cart",
            )
            if r.get("sent", 0) > 0:
                sent += 1
            await db.abandoned_carts.update_one(
                {"email": email},
                {"$set": {"last_push_at": _now().isoformat()}},
            )
        except Exception:
            errors += 1
    return {"sent": sent, "skipped": skipped, "errors": errors}


# ─────────────────── admin smoke endpoint ───────────────────
# iter264 — Email abandoned-cart sweep (two-tier nudge ladder).
# Sits alongside `fire_abandoned_cart_pushes` (web push) as a SECOND
# channel. Different idle thresholds because email has higher tolerance
# than push:
#   • Nudge 1 — 2h idle, plain reminder
#   • Nudge 2 — 24h idle, 10% discount code attached
# Idempotent via `email_attempt_count` on the cart row.
async def fire_abandoned_cart_emails(
    first_nudge_hours: int = 2,
    discount_nudge_hours: int = 24,
) -> dict:
    """Two-tier email sweep using Mailgun (via email_service._send)."""
    from email_service import _send

    now = _now()
    sent = skipped = errors = 0

    def _render(email: str, items: list, *, discount_code: Optional[str] = None) -> tuple[str, str]:
        """Return (subject, html_body) for one nudge."""
        if not items:
            return ("", "")
        # spotlight = highest-priced item
        try:
            spotlight = max(items, key=lambda x: float(x.get("price") or 0))
        except Exception:
            spotlight = items[0]
        spot_title = (spotlight.get("title") or "your item")[:80]
        spot_image = spotlight.get("image") or ""
        other_count = max(0, len(items) - 1)

        if discount_code:
            subject = f"Take 10% off — {spot_title} is still in your cart"
            headline = f"Come back for {spot_title} — and grab 10% off"
            cta_label = "Finish checkout (10% off)"
            sub_copy = (
                f"Use code <b style='color:#ff4500'>{discount_code}</b> at checkout "
                "for 10% off. Single use, expires in 7 days."
            )
        else:
            subject = f"{spot_title} is still in your cart"
            headline = f"Did you forget about {spot_title}?"
            cta_label = "Finish checkout"
            sub_copy = (
                "Your cart is right where you left it. Pick up exactly where "
                "you stopped — your items, your sizes, your shipping address."
            )

        # spotlight tile
        spot_tile = (
            "<table cellpadding='0' cellspacing='0' style='width:100%;margin:24px 0;border:1px solid #262626;background:#0a0a0a'>"
            "<tr>"
            + (
                f"<td style='width:120px;padding:14px;vertical-align:top'>"
                f"<img src='{spot_image}' width='100' style='display:block;border:0' alt=''/>"
                f"</td>"
                if spot_image else ""
            )
            + "<td style='padding:14px;vertical-align:top'>"
            f"<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.22em;color:#737373;text-transform:uppercase'>In your cart</div>"
            f"<div style='font-family:Bebas Neue,Arial Black,sans-serif;font-size:22px;color:#fff;line-height:1.2;margin-top:6px'>{spot_title}</div>"
            + (
                f"<div style='font-family:JetBrains Mono,monospace;font-size:11px;color:#a3a3a3;margin-top:8px'>+ {other_count} other item{'s' if other_count != 1 else ''} waiting</div>"
                if other_count else ""
            )
            + "</td></tr></table>"
        )

        html = (
            "<div style='background:#0a0a0a;color:#e5e5e5;padding:32px;font-family:JetBrains Mono,monospace'>"
            "<div style='font-size:10px;letter-spacing:0.32em;color:#ff4500;text-transform:uppercase;margin-bottom:6px'>◆ Cart waiting</div>"
            f"<div style='font-family:Bebas Neue,Arial Black,sans-serif;font-size:32px;line-height:1.1;color:#fff;letter-spacing:0.02em'>{headline}</div>"
            f"<p style='color:#a3a3a3;line-height:1.7;margin-top:14px'>{sub_copy}</p>"
            f"{spot_tile}"
            "<table cellpadding='0' cellspacing='0' style='margin:24px 0'><tr><td style='background:#ff4500;padding:14px 28px'>"
            f"<a href='https://craftersmarket.org/cart' style='color:#000;text-decoration:none;font-family:Bebas Neue,Arial Black,sans-serif;font-size:16px;letter-spacing:0.08em'>{cta_label} →</a>"
            "</td></tr></table>"
            "<div style='margin-top:32px;padding-top:18px;border-top:1px solid #262626;font-family:JetBrains Mono,monospace;font-size:10px;color:#525252;line-height:1.7'>"
            "You're getting this because you started a checkout on Crafters Market. "
            "<a href='https://craftersmarket.org/account/notifications' style='color:#737373'>Manage email preferences</a>"
            "</div></div>"
        )
        return (subject, html)

    # Walk every cart with items + an email + no checkout, sorted oldest
    # first so cron retries process older nudges first.
    cursor = db.abandoned_carts.find(
        {
            "items.0": {"$exists": True},
            "checked_out_at": {"$in": [None, ""]},
            "email": {"$ne": ""},
        },
        {"_id": 0},
    )
    async for cart in cursor:
        try:
            email = cart.get("email") or ""
            items = cart.get("items") or []
            updated_at = cart.get("updated_at")
            if not email or not items or not updated_at:
                skipped += 1
                continue
            try:
                age_hours = (now - datetime.fromisoformat(updated_at.replace("Z", "+00:00"))).total_seconds() / 3600
            except Exception:
                age_hours = 0
            attempts = int(cart.get("email_attempt_count") or 0)

            # First nudge: 2h–24h idle, no prior email sent
            if first_nudge_hours <= age_hours < discount_nudge_hours and attempts == 0:
                subject, html = _render(email, items)
                if not subject:
                    skipped += 1
                    continue
                result = await _send(email, subject, html)
                if result is not None:
                    sent += 1
                    await db.abandoned_carts.update_one(
                        {"email": email},
                        {"$set": {"last_email_at": now.isoformat(),
                                  "email_attempt_count": 1}},
                    )
                else:
                    skipped += 1
            # Discount nudge: 24h+ idle, first nudge already sent
            elif age_hours >= discount_nudge_hours and attempts == 1:
                import hashlib
                code = "BACK" + hashlib.sha1(email.encode()).hexdigest()[:4].upper()
                # iter264 — Insert the code into `marketing_codes` so the
                # checkout discount resolver actually honours it. Single-use,
                # 10% off, expires in 7 days, marketplace-wide.
                expires_at = (now + timedelta(days=7)).isoformat()
                await db.marketing_codes.update_one(
                    {"code": code},
                    {
                        "$set": {
                            "code": code,
                            "active": True,
                            "scope": "marketplace_wide",
                            "discount_pct": 10.0,
                            "max_uses": 1,
                            "expires_at": expires_at,
                            "source": "abandoned_cart_nudge_2",
                            "issued_to_email": email,
                            "updated_at": now.isoformat(),
                        },
                        "$setOnInsert": {
                            "uses_count": 0,
                            "created_at": now.isoformat(),
                        },
                    },
                    upsert=True,
                )
                subject, html = _render(email, items, discount_code=code)
                if not subject:
                    skipped += 1
                    continue
                result = await _send(email, subject, html)
                if result is not None:
                    sent += 1
                    await db.abandoned_carts.update_one(
                        {"email": email},
                        {"$set": {"last_email_at": now.isoformat(),
                                  "email_attempt_count": 2,
                                  "discount_code_issued": code}},
                    )
                else:
                    skipped += 1
            else:
                skipped += 1
        except Exception:
            errors += 1

    return {"sent": sent, "skipped": skipped, "errors": errors}


# ─────────────────── admin smoke endpoint ───────────────────
@router.post("/admin/abandoned-cart/run")
async def admin_run_abandoned_cart(idle_hours: int = 6):
    """Manual trigger for the abandoned-cart sweep. Used by ops to
    smoke-test the flow without waiting for the hourly cron. NOTE: no
    auth gate — the route is mounted under /api so it's externally
    reachable; gate via the load-balancer if you don't want public
    triggers (current deployments have it ACL'd to the admin bastion)."""
    if idle_hours < 0 or idle_hours > 168:
        raise HTTPException(400, "idle_hours must be 0–168")
    return await fire_abandoned_cart_pushes(idle_hours=idle_hours)


@router.post("/admin/abandoned-cart/run-emails")
async def admin_run_abandoned_cart_emails(
    first_nudge_hours: int = 2,
    discount_nudge_hours: int = 24,
):
    """iter264 — Manual trigger for the email sweep. Same auth-bypass
    pattern as the push sweep above (ACL'd at the load-balancer)."""
    if first_nudge_hours < 0 or discount_nudge_hours > 720:
        raise HTTPException(400, "Invalid window")
    return await fire_abandoned_cart_emails(
        first_nudge_hours=first_nudge_hours,
        discount_nudge_hours=discount_nudge_hours,
    )
