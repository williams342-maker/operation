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


# ============================================================
#  Per-maker tags — buyers "save a drop" → tagged in Kit
#  → next high-value drop from that maker only goes to those tags.
# ============================================================
async def _ensure_tag(name: str) -> Optional[str]:
    """Idempotent — find-or-create a Kit tag by name. Returns tag id."""
    if not _enabled():
        return None
    name = name.strip().lower()
    try:
        # Kit V4 supports filtering tags by exact name
        result = await _kit("GET", f"/v4/tags?per_page=200")
        tags = (result or {}).get("tags") or []
        for t in tags:
            if (t.get("name") or "").lower() == name:
                return str(t.get("id"))
        # Not found — create it
        created = await _kit("POST", "/v4/tags", {"name": name})
        tag = (created or {}).get("tag") or created
        return str(tag.get("id")) if tag.get("id") else None
    except Exception as e:
        logger.warning("[kit] _ensure_tag(%s) failed: %s", name, e)
        return None


async def save_drop(
    *, email: str, maker_slug: str, product_slug: Optional[str] = None,
    first_name: Optional[str] = None,
) -> dict:
    """Buyer hits ♡ Save this drop. We:
      1. Upsert the email into Kit (subscribe call, idempotent)
      2. Find-or-create a tag `interested-in-{maker_slug}`
      3. Apply the tag to the subscriber
      4. Persist a row in db.drop_saves for the admin's records
    Idempotent — repeat hits are cheap (existing tag, existing sub).
    """
    if not _enabled():
        # Persist locally even when Kit isn't configured so the admin still
        # sees the buyer's interest signal.
        await db.drop_saves.update_one(
            {"email": email.lower(), "maker_slug": maker_slug},
            {"$set": {
                "email": email.lower(), "maker_slug": maker_slug,
                "product_slug": product_slug, "synced": False,
                "updated_at": now_iso(),
            }, "$setOnInsert": {"created_at": now_iso()}},
            upsert=True,
        )
        return {"saved": True, "synced": False, "reason": "kit_not_configured"}

    # 1. subscribe (idempotent on Kit's side)
    sub_result = await subscribe(email, first_name=first_name, source=f"save-drop:{maker_slug}")
    subscriber_id = sub_result.get("subscriber_id")

    # 2. tag
    tag_name = f"interested-in-{maker_slug}"
    tag_id = await _ensure_tag(tag_name)

    # 3. apply tag → subscriber
    if subscriber_id and tag_id:
        try:
            await _kit("POST", f"/v4/tags/{tag_id}/subscribers/{subscriber_id}", {})
        except Exception as e:
            logger.warning("[kit] tag-apply failed: %s", e)

    # 4. local audit
    await db.drop_saves.update_one(
        {"email": email.lower(), "maker_slug": maker_slug},
        {"$set": {
            "email": email.lower(), "maker_slug": maker_slug,
            "product_slug": product_slug,
            "subscriber_id": subscriber_id, "tag_id": tag_id, "tag_name": tag_name,
            "synced": True, "updated_at": now_iso(),
        }, "$setOnInsert": {"created_at": now_iso()}},
        upsert=True,
    )
    return {
        "saved": True, "synced": True,
        "subscriber_id": subscriber_id, "tag_id": tag_id, "tag_name": tag_name,
    }


async def list_drop_saves(maker_slug: Optional[str] = None, limit: int = 200) -> list[dict]:
    q = {"maker_slug": maker_slug} if maker_slug else {}
    return await db.drop_saves.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)


# Updated drop broadcast — now optionally targets only the maker's "saved
# drop" tag. Falls back to "send to all" when the tag doesn't exist yet.
async def create_drop_broadcast_targeted(
    *, listing_title: str, listing_slug: str, listing_url: str,
    maker_name: str, maker_slug: str, listing_price: float,
    listing_image: Optional[str] = None,
) -> Optional[str]:
    """Like create_drop_broadcast but tags the broadcast with the maker's
    `interested-in-{slug}` audience. ALWAYS sends — if the tag has no
    subscribers Kit will silently skip the send."""
    if not _enabled():
        return None
    tag_name = f"interested-in-{maker_slug}"
    tag_id = await _ensure_tag(tag_name)

    subject = f"NEW DROP — {maker_name}: {listing_title}"
    img_html = (
        f'<p><img src="{listing_image}" alt="{listing_title}" '
        f'style="max-width:100%; border-radius:4px;"/></p>'
        if listing_image else ""
    )
    content = f"""
    <div style="font-family:Helvetica,Arial,sans-serif; color:#0a0a0a;">
      <p style="font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:#ff4500;">◆ Drop You Saved</p>
      <h1 style="font-size:32px; line-height:1.05; margin:8px 0 16px;">{listing_title}</h1>
      <p style="font-size:14px; color:#525252;">By {maker_name} · ${listing_price:.0f}</p>
      {img_html}
      <p style="margin-top:24px;">
        <a href="{listing_url}" style="display:inline-block; padding:14px 24px; background:#ff4500; color:#fff; text-decoration:none; font-weight:bold; letter-spacing:0.1em; text-transform:uppercase;">Shop the drop →</a>
      </p>
      <p style="font-size:12px; color:#a3a3a3; margin-top:32px;">
        You're getting this because you saved a drop from {maker_name}.
      </p>
    </div>
    """.strip()
    payload: dict = {
        "subject": subject,
        "content": content,
        "description": f"Saved-drop: {listing_slug}",
        "public": False,
        "send_at": None,
    }
    # Target only saved-drop subscribers when the tag exists.
    # Kit V4 schema (verified 2026-04 via 422 errors): subscriber_filter is
    # an array of OR-rules, each rule being `{any: [...]}` of clauses.
    # Tag clause shape is `{type: 'tag', ids: [<tag_id>, ...]}`. Other
    # docs/SDKs show `tag_id` (singular) — that one returns 422 with
    # `"ids required for tag filter"`.
    if tag_id:
        payload["subscriber_filter"] = [{
            "any": [{"type": "tag", "ids": [int(tag_id)]}],
        }]

    try:
        result = await _kit("POST", "/v4/broadcasts", payload)
        broadcast = (result or {}).get("broadcast") or result
        bid = broadcast.get("id")
        return str(bid) if bid else None
    except Exception as e:
        logger.warning("[kit] targeted drop broadcast failed: %s", e)
        return None
