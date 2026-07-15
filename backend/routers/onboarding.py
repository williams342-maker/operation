"""iter249 — Onboarding state machine + welcome flow API.

Endpoints (all anonymous-friendly via session cookie OR community/maker JWT):
  • POST /api/onboarding/start        — create or fetch state, choose user_type
  • POST /api/onboarding/step         — mark a step complete
  • GET  /api/onboarding/me           — current state
  • POST /api/onboarding/skip         — opt-out flag (won't re-show)

Backend checklist mirrors the figma mock:
  steps: user_type_selected → profile_created → first_upload | first_follow
         → first_engagement → tour_completed
"""
from __future__ import annotations
from config import env_get
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from core import db, now_iso
from maker_auth import decode_session_jwt

logger = logging.getLogger("crafters.onboarding")
router = APIRouter()

VALID_USER_TYPES = {"maker", "buyer", "supporter"}
VALID_STEPS = {
    "user_type_selected",
    "profile_created",
    "first_upload",
    "first_follow",
    "first_engagement",
    "tour_completed",
}


async def _identify(authorization: Optional[str]) -> dict:
    """Decode whichever JWT the client sent (admin / maker / community).
    Returns {sub, email, role}. Anonymous-OK — returns empty dict."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return {}
    try:
        claims = decode_session_jwt(authorization.split(None, 1)[1].strip())
    except Exception:
        return {}
    return {
        "sub": claims.get("sub", ""),
        "email": (claims.get("email") or "").lower(),
        "role": claims.get("role", ""),
    }


class StartBody(BaseModel):
    user_type: Optional[str] = None
    # Anonymous browsers send a stable client-side uuid so we can correlate
    # state across page-refreshes before they sign in.
    anon_id: Optional[str] = None


@router.post("/onboarding/start")
async def onboarding_start(
    body: StartBody, authorization: Optional[str] = Header(default=None)
):
    me = await _identify(authorization)
    key = me.get("sub") or body.anon_id
    if not key:
        raise HTTPException(400, "Missing identity — sign in or provide anon_id")

    existing = await db.onboarding_states.find_one({"user_key": key}, {"_id": 0})
    if existing:
        # Allow updating user_type if not yet set
        if body.user_type and body.user_type in VALID_USER_TYPES and not existing.get("user_type"):
            await db.onboarding_states.update_one(
                {"user_key": key},
                {"$set": {
                    "user_type": body.user_type,
                    "steps_completed": list(set(existing.get("steps_completed", []) + ["user_type_selected"])),
                    "last_step_at": now_iso(),
                }},
            )
            existing = await db.onboarding_states.find_one({"user_key": key}, {"_id": 0})
        return existing

    doc = {
        "user_key": key,
        "email": me.get("email") or "",
        "role": me.get("role") or "",
        "user_type": body.user_type if body.user_type in VALID_USER_TYPES else None,
        "steps_completed": ["user_type_selected"] if body.user_type in VALID_USER_TYPES else [],
        "started_at": now_iso(),
        "last_step_at": now_iso(),
        "completed_at": None,
        "skipped_at": None,
        "welcome_email_sent_at": None,
    }
    await db.onboarding_states.insert_one(doc)

    # Fire welcome email if we know who they are
    if doc["email"] and doc["user_type"]:
        try:
            await _send_welcome_email(doc)
            await db.onboarding_states.update_one(
                {"user_key": key},
                {"$set": {"welcome_email_sent_at": now_iso()}},
            )
        except Exception:
            logger.exception("[onboarding] welcome email failed for %s", doc["email"])

    out = dict(doc)
    out.pop("_id", None)
    return out


class StepBody(BaseModel):
    step: str
    anon_id: Optional[str] = None


@router.post("/onboarding/step")
async def onboarding_step(
    body: StepBody, authorization: Optional[str] = Header(default=None)
):
    if body.step not in VALID_STEPS:
        raise HTTPException(400, f"Unknown step '{body.step}'")
    me = await _identify(authorization)
    key = me.get("sub") or body.anon_id
    if not key:
        raise HTTPException(400, "Missing identity")

    state = await db.onboarding_states.find_one({"user_key": key}, {"_id": 0})
    if not state:
        # Auto-create lightweight state so the step is recorded
        state = {
            "user_key": key,
            "email": me.get("email") or "",
            "role": me.get("role") or "",
            "user_type": None,
            "steps_completed": [],
            "started_at": now_iso(),
            "last_step_at": now_iso(),
        }
        await db.onboarding_states.insert_one(state)

    steps = set(state.get("steps_completed", []))
    steps.add(body.step)
    update = {"steps_completed": sorted(steps), "last_step_at": now_iso()}

    # Mark completed when they hit tour_completed or have 3+ steps incl. first_*
    completes_when = {"tour_completed"}
    has_first_action = any(s in steps for s in ("first_upload", "first_follow", "first_engagement"))
    if body.step in completes_when or (has_first_action and len(steps) >= 3):
        update["completed_at"] = now_iso()

    await db.onboarding_states.update_one({"user_key": key}, {"$set": update})
    return await db.onboarding_states.find_one({"user_key": key}, {"_id": 0})


@router.get("/onboarding/me")
async def onboarding_me(
    authorization: Optional[str] = Header(default=None),
    anon_id: Optional[str] = None,
):
    me = await _identify(authorization)
    key = me.get("sub") or anon_id
    if not key:
        return {"state": None}
    state = await db.onboarding_states.find_one({"user_key": key}, {"_id": 0})
    return {"state": state}


@router.post("/onboarding/skip")
async def onboarding_skip(authorization: Optional[str] = Header(default=None)):
    me = await _identify(authorization)
    key = me.get("sub")
    if not key:
        return {"ok": True}
    await db.onboarding_states.update_one(
        {"user_key": key},
        {"$set": {"skipped_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


# ─── Welcome email ────────────────────────────────────────────────────────────
async def _send_welcome_email(state: dict) -> None:
    """Send the iter249 welcome email via the existing mailgun pipeline.

    Uses the exact copy the founder provided in his email-template.txt
    artifact, rendered into the existing dark-aesthetic _shell so it
    matches every other transactional email we send.
    """
    from email_service import _send, _shell
    email = state.get("email")
    if not email:
        return
    user_type = state.get("user_type") or "maker"
    first_name = (email.split("@")[0] or "there").title()

    # Resolve the per-role primary CTA destination
    if user_type == "maker":
        cta_label = "Complete your maker profile"
        cta_path = "/maker/dashboard"
        follow_on = [
            "Upload products & digital designs",
            "Build your storefront",
            "Connect with buyers and creators",
            "Participate in the community feed",
        ]
    elif user_type == "buyer":
        cta_label = "Discover handmade work"
        cta_path = "/shop"
        follow_on = [
            "Follow makers you love",
            "Save items to revisit later",
            "Comment on works-in-progress",
            "Get first dibs on new drops",
        ]
    else:  # supporter
        cta_label = "Join the community"
        cta_path = "/community"
        follow_on = [
            "Cheer on makers shipping new work",
            "Share your own discoveries",
            "Comment on builds-in-progress",
            "Help shape the platform’s direction",
        ]

    import os
    site = (env_get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    cta_url = f"{site}{cta_path}"

    items_html = "".join(
        f"<li style='margin:6px 0;color:#a3a3a3'>{x}</li>" for x in follow_on
    )
    body_html = f"""
      <p style="font-size:14px;line-height:1.6;color:#a3a3a3;margin:0 0 20px">
        We created this platform to help creators showcase their work, connect
        with real supporters, and build community without fighting algorithms.
      </p>
      <p style="font-size:14px;line-height:1.6;color:#e5e5e5;margin:0 0 12px">
        Your next step takes less than 2 minutes:
      </p>
      <p style="margin:24px 0">
        <a href="{cta_url}"
           style="display:inline-block;padding:14px 28px;background:#ff4500;color:#0a0a0a;
                  font-weight:bold;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;
                  text-decoration:none">
          👉 {cta_label}
        </a>
      </p>
      <p style="font-size:13px;color:#a3a3a3;margin:24px 0 8px">Once you’re in, you’ll be able to:</p>
      <ul style="font-size:13px;color:#a3a3a3;padding-left:20px;margin:0">{items_html}</ul>
      <p style="font-size:13px;color:#a3a3a3;margin:24px 0 0">— The Crafters Market Team</p>
    """
    html = _shell(
        title="WELCOME",
        intro=f"Hi {first_name}, you just joined a marketplace built for makers who deserve real visibility.",
        body_html=body_html,
    )
    await _send(email, "Welcome to Crafters Market", html)
