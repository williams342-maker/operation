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


async def list_subscribers(limit: int = 50) -> list[dict]:
    return await db.newsletter_subscribers.find(
        {}, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
