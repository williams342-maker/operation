"""Kit.com (formerly ConvertKit) newsletter integration.

Used for marketing email captures only — NOT for transactional sends.
The "Subscribe for new drops" widget on the homepage adds buyers to the
shared Crafters Market Kit account, where we can blast newsletters from
the Kit dashboard.

V4 API: https://developers.kit.com/v4
Auth header: X-Kit-Api-Key
"""
from __future__ import annotations

import os
from typing import Optional

import httpx

from core import db, logger, now_iso

KIT_API_KEY = os.environ.get("KIT_API_KEY", "")
KIT_BASE_URL = os.environ.get("KIT_BASE_URL", "https://api.kit.com")
KIT_TAG_NAME = os.environ.get("KIT_TAG_NAME", "homepage-newsletter")


def _enabled() -> bool:
    return bool(KIT_API_KEY)


async def _kit(method: str, path: str, json: Optional[dict] = None) -> dict:
    """Single async call to Kit. Raises RuntimeError on >=400. Returns
    parsed JSON body (empty dict on 204)."""
    if not _enabled():
        raise RuntimeError("Kit is not configured (KIT_API_KEY missing).")
    headers = {
        "X-Kit-Api-Key": KIT_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.request(method, f"{KIT_BASE_URL}{path}", headers=headers, json=json)
    if r.status_code >= 400:
        raise RuntimeError(f"kit {method} {path} → {r.status_code}: {r.text[:300]}")
    return r.json() if r.content else {}


async def subscribe(
    email: str, *, first_name: Optional[str] = None, source: str = "homepage",
) -> dict:
    """Upsert a subscriber into the shared Crafters Market Kit account.

    Idempotent — Kit treats repeat email_address calls as updates. We also
    persist a row to db.newsletter_subscribers so the admin can see the
    history without leaving the dashboard.
    """
    payload = {"email_address": email}
    if first_name:
        payload["first_name"] = first_name

    error: Optional[str] = None
    subscriber_id: Optional[str] = None
    try:
        result = await _kit("POST", "/v4/subscribers", payload)
        subscriber = (result or {}).get("subscriber") or result
        subscriber_id = str(subscriber.get("id") or "") or None
    except Exception as e:
        error = str(e)[:300]
        logger.warning("[kit] subscribe failed for %s: %s", email, error)

    row = {
        "email": email.strip().lower(),
        "first_name": first_name or "",
        "source": source,
        "subscriber_id": subscriber_id,
        "status": "synced" if subscriber_id else "failed",
        "error": error,
        "created_at": now_iso(),
    }
    try:
        await db.newsletter_subscribers.update_one(
            {"email": row["email"]},
            {"$set": row, "$setOnInsert": {"first_seen": now_iso()}},
            upsert=True,
        )
    except Exception as e:
        logger.warning("[kit] persist failed: %s", e)

    if error:
        raise RuntimeError(error)
    return {"subscribed": True, "email": row["email"], "subscriber_id": subscriber_id}


async def create_drop_broadcast(
    *, listing_title: str, listing_slug: str, listing_url: str,
    maker_name: str, listing_price: float, listing_image: Optional[str] = None,
) -> Optional[str]:
    """Create + immediately publish a Kit broadcast announcing a high-value
    listing drop. Returns the broadcast id on success, None when Kit is
    unconfigured. Best-effort — never raises into caller."""
    if not _enabled():
        return None
    subject = f"NEW DROP — {maker_name}: {listing_title}"
    img_html = (
        f'<p><img src="{listing_image}" alt="{listing_title}" '
        f'style="max-width:100%; border-radius:4px;"/></p>'
        if listing_image else ""
    )
    content = f"""
    <div style="font-family:Helvetica,Arial,sans-serif; color:#0a0a0a;">
      <p style="font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:#ff4500;">◆ Fresh Drop</p>
      <h1 style="font-size:32px; line-height:1.05; margin:8px 0 16px;">{listing_title}</h1>
      <p style="font-size:14px; color:#525252;">By {maker_name} · ${listing_price:.0f}</p>
      {img_html}
      <p style="margin-top:24px;">
        <a href="{listing_url}" style="display:inline-block; padding:14px 24px; background:#ff4500; color:#fff; text-decoration:none; font-weight:bold; letter-spacing:0.1em; text-transform:uppercase;">Shop the drop →</a>
      </p>
      <p style="font-size:12px; color:#a3a3a3; margin-top:32px;">
        You're getting this because you subscribed to Crafters Market drops.
        Forward this to a friend who'd love it. We never share your email.
      </p>
    </div>
    """.strip()
    payload = {
        "subject": subject,
        "content": content,
        "description": f"Auto-drop: {listing_slug}",
        "public": False,
        "send_at": None,  # send now
    }
    try:
        result = await _kit("POST", "/v4/broadcasts", payload)
        broadcast = (result or {}).get("broadcast") or result
        bid = broadcast.get("id")
        # Fire it. Kit lets you create a draft + send-now in two calls.
        if bid:
            try:
                await _kit("POST", f"/v4/broadcasts/{bid}/send", None)
            except Exception as e:
                # Many Kit accounts auto-send on create when send_at=None;
                # if /send 404s that's fine. Log only.
                logger.info("[kit] /broadcasts/%s/send: %s", bid, e)
        return str(bid) if bid else None
    except Exception as e:
        logger.warning("[kit] drop broadcast failed: %s", e)
        return None


async def list_subscribers(limit: int = 50) -> list[dict]:
    return await db.newsletter_subscribers.find(
        {}, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
