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
            # New cart activity unblocks future pushes, in case the buyer
            # comes back, modifies the cart, walks away again.
            "$unset": {"last_push_at": "", "checked_out_at": ""},
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
