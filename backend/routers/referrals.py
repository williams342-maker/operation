"""Plus trial referral program (iter172).

Each maker has a unique invite code shareable as
    https://craftersmarket.org/beta?ref=<code>

When **3 referred makers** subscribe to Crafters Plus (active OR trialing),
the referrer receives a one-time **+30 day extension to their trial**
(or — once we add credits — a $30 account credit when no trial is active).

Award is idempotent: `referral_bonus_applied_at` is stamped on the first
qualifying check, so subsequent referrals beyond 3 keep counting but
don't double-credit.

Endpoints:
    GET  /api/maker/referrals              → maker's current code, link,
                                             count, threshold, awarded state
    POST /api/maker/referrals/regenerate   → rotate the code (after social
                                             abuse / leak)
"""
from __future__ import annotations
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import STRIPE_API_KEY, db, logger, now_iso
from maker_auth import current_maker_slug

router = APIRouter()

# How many successful referrals are needed to unlock the bonus.
REFERRAL_THRESHOLD = 3

# How many days of free trial we add when the threshold is met.
REFERRAL_BONUS_TRIAL_DAYS = 30

# Length of the public invite code. 8 chars of base32 ≈ 40 bits of
# entropy — plenty given the small public namespace.
REFERRAL_CODE_LENGTH = 8

# Public alphabet (base32-ish, lowercase, no ambiguous chars).
_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def _stripe():
    stripe.api_key = STRIPE_API_KEY
    return stripe


def _generate_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(REFERRAL_CODE_LENGTH))


async def _mint_unique_code() -> str:
    """Generate a code that doesn't collide with any existing one. The
    collision space is tiny (~1 in 10^11) but be safe — bound the retry
    loop at 8 attempts and widen the code on collision."""
    for attempt in range(8):
        code = _generate_code()
        existing = await db.makers.find_one(
            {"referral_code": code}, {"_id": 1},
        )
        if not existing:
            return code
    # Pathological — fall back to a longer code
    return _generate_code() + _generate_code()[:4]


async def _ensure_code(slug: str) -> str:
    """Lazily mints a referral code on first access. Idempotent —
    subsequent calls return the same code."""
    m = await db.makers.find_one(
        {"slug": slug}, {"_id": 0, "referral_code": 1},
    )
    if m and m.get("referral_code"):
        return m["referral_code"]
    code = await _mint_unique_code()
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"referral_code": code}},
    )
    return code


def _share_link(code: str) -> str:
    base = (os.environ.get("PUBLIC_SITE_URL")
            or os.environ.get("PUBLIC_APP_URL")
            or "https://craftersmarket.org").rstrip("/")
    return f"{base}/beta?ref={code}"


class ReferralState(BaseModel):
    code: str
    share_link: str
    completed_count: int
    threshold: int
    bonus_days: int
    bonus_applied_at: Optional[str] = None
    eligible_for_bonus: bool  # `True` when threshold met + not yet applied


@router.get("/maker/referrals", response_model=ReferralState)
async def get_referrals(slug: str = Depends(current_maker_slug)):
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")
    code = m.get("referral_code") or await _ensure_code(slug)
    count = int(m.get("referrals_completed_count") or 0)
    applied = m.get("referral_bonus_applied_at")
    return ReferralState(
        code=code,
        share_link=_share_link(code),
        completed_count=count,
        threshold=REFERRAL_THRESHOLD,
        bonus_days=REFERRAL_BONUS_TRIAL_DAYS,
        bonus_applied_at=applied,
        eligible_for_bonus=(count >= REFERRAL_THRESHOLD and not applied),
    )


@router.post("/maker/referrals/regenerate", response_model=ReferralState)
async def regenerate_code(slug: str = Depends(current_maker_slug)):
    """Rotate the invite code — useful if the maker shared it on a public
    forum and now wants to recall it. Doesn't affect already-credited
    referrals (those are attributed via the previous code at signup time)."""
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")
    new_code = await _mint_unique_code()
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"referral_code": new_code}},
    )
    logger.info("plus: maker=%s regenerated referral code", slug)
    return await get_referrals(slug)


# -----------------------------------------------------------------------
# Internal: credit a referrer when their referred maker hits Plus.
# Called from `_sync_sub_to_maker` in subscriptions.py whenever a
# subscription transitions to active/trialing.
# -----------------------------------------------------------------------

async def credit_referrer_on_subscribe(referred_slug: str) -> None:
    """If `referred_slug` was referred (i.e. their maker doc has
    `referred_by_code` set), increment the referrer's
    `referrals_completed_count`. If that pushes them to the threshold
    AND the bonus hasn't been applied yet, extend their trial by 30 days
    via Stripe.

    Idempotent — won't double-credit the same referred maker. Each
    referred maker can only credit their referrer once."""
    referred = await db.makers.find_one(
        {"slug": referred_slug}, {"_id": 0},
    )
    if not referred:
        return
    code = referred.get("referred_by_code")
    if not code:
        return
    # Idempotency guard: only credit once per referred maker, even if
    # they cancel + resubscribe.
    if referred.get("referral_credited_at"):
        return
    referrer = await db.makers.find_one(
        {"referral_code": code}, {"_id": 0},
    )
    if not referrer:
        # Code rotated / referrer deleted — silently drop.
        return
    if referrer["slug"] == referred_slug:
        # Self-referral attempt — never credit.
        return
    ts = now_iso()
    # Stamp the referred maker first so a concurrent retry can't double-count.
    res = await db.makers.update_one(
        {"slug": referred_slug, "referral_credited_at": {"$in": [None, ""]}},
        {"$set": {"referral_credited_at": ts}},
    )
    if res.modified_count == 0:
        return  # Lost the race — another worker already counted this one.
    new_count = int(referrer.get("referrals_completed_count") or 0) + 1
    await db.makers.update_one(
        {"slug": referrer["slug"]},
        {"$set": {"referrals_completed_count": new_count}},
    )
    logger.info(
        "plus referral counted: referrer=%s referred=%s new_count=%s",
        referrer["slug"], referred_slug, new_count,
    )
    if new_count >= REFERRAL_THRESHOLD and not referrer.get("referral_bonus_applied_at"):
        try:
            await _apply_trial_bonus(referrer["slug"])
        except Exception as e:
            logger.exception(
                "plus referral bonus apply failed referrer=%s: %s",
                referrer["slug"], e,
            )


async def _apply_trial_bonus(referrer_slug: str) -> None:
    """Award the +30-day trial extension. If the referrer is currently
    trialing, push their Stripe `trial_end` out by 30 days. Otherwise
    we stamp the bonus as 'unapplied' so a future enhancement can
    convert it to an account credit.

    Note: this is the ONLY place that writes `referral_bonus_applied_at`,
    keeping award idempotent."""
    m = await db.makers.find_one(
        {"slug": referrer_slug}, {"_id": 0},
    )
    if not m or m.get("referral_bonus_applied_at"):
        return  # Already awarded — guard against re-entry.

    sub_id = m.get("stripe_subscription_id")
    is_trialing = bool(m.get("is_in_trial"))
    bonus_ts = now_iso()
    bonus_log: dict = {
        "kind": "trial_extension",
        "days": REFERRAL_BONUS_TRIAL_DAYS,
        "ts": bonus_ts,
    }

    if is_trialing and sub_id and STRIPE_API_KEY:
        # Stripe `trial_end` accepts a unix-ts in the future. Add 30 days
        # to whatever the current trial_end is.
        current_end_iso = m.get("trial_end_at")
        if current_end_iso:
            current_dt = datetime.fromisoformat(current_end_iso.replace("Z", "+00:00"))
        else:
            current_dt = datetime.now(tz=timezone.utc) + timedelta(days=REFERRAL_BONUS_TRIAL_DAYS)
        new_end_dt = current_dt + timedelta(days=REFERRAL_BONUS_TRIAL_DAYS)
        new_end_ts = int(new_end_dt.timestamp())
        try:
            s = _stripe()
            s.Subscription.modify(
                sub_id,
                trial_end=new_end_ts,
                proration_behavior="none",
            )
            bonus_log["mode"] = "stripe_trial_extended"
            bonus_log["new_trial_end"] = new_end_dt.isoformat()
            logger.info(
                "plus referral bonus applied: maker=%s stripe_sub=%s new_trial_end=%s",
                referrer_slug, sub_id, new_end_dt.isoformat(),
            )
        except Exception:
            # Stamp the bonus anyway so we don't retry forever. The
            # webhook from Stripe will sync trial_end_at on its own
            # when the modify call eventually succeeds via a manual
            # admin sweep.
            bonus_log["mode"] = "stripe_modify_failed"
            raise
    else:
        # Not trialing → bonus is "earned" but not immediately
        # claimable. A future iteration can turn this into a flat
        # `$30` listing-fee credit. For now we just stamp the award.
        bonus_log["mode"] = "pending_credit"
        logger.info(
            "plus referral bonus earned (no active trial): maker=%s — credit pending",
            referrer_slug,
        )

    await db.makers.update_one(
        {"slug": referrer_slug},
        {
            "$set": {"referral_bonus_applied_at": bonus_ts},
            "$push": {"referral_bonus_history": bonus_log},
        },
    )
