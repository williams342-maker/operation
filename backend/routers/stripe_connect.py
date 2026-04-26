"""Stripe Connect (Express) — multi-vendor maker payouts.

Flow:
  1. Maker hits POST /api/maker/stripe/connect/onboard.
     - If maker has no stripe_account_id, we create an Express account.
     - We always return a fresh Account Link URL — Stripe links expire fast.
  2. Maker completes Stripe-hosted onboarding, redirects back to /maker/stripe/return.
  3. Maker dashboard polls GET /api/maker/stripe/connect/status to refresh
     charges_enabled / payouts_enabled / details_submitted.
  4. POST /api/maker/stripe/connect/dashboard-link returns an Express dashboard
     login link so the maker can manage their account, payouts, taxes, etc.

Multi-maker carts: handled in checkout.py — after a checkout.session is paid,
we look up every maker in the order and create one Transfer per maker to their
connected account, retaining a platform fee on the platform balance.
"""
import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import stripe as stripe_sdk

from core import STRIPE_API_KEY, db, logger, now_iso
from maker_auth import current_maker_slug

router = APIRouter()


class OnboardRequest(BaseModel):
    origin_url: str    # frontend origin — Stripe redirects back here.


def _stripe():
    stripe_sdk.api_key = STRIPE_API_KEY
    return stripe_sdk


async def _refresh_status(slug: str, account_id: str) -> dict:
    """Pull latest status from Stripe and persist to the maker record."""
    s = _stripe()
    acct = s.Account.retrieve(account_id)
    update = {
        "stripe_account_id": account_id,
        "stripe_charges_enabled": bool(getattr(acct, "charges_enabled", False)),
        "stripe_payouts_enabled": bool(getattr(acct, "payouts_enabled", False)),
        "stripe_details_submitted": bool(getattr(acct, "details_submitted", False)),
        "stripe_updated_at": now_iso(),
    }
    await db.makers.update_one({"slug": slug}, {"$set": update})
    return update


@router.post("/maker/stripe/connect/onboard")
async def connect_onboard(payload: OnboardRequest, slug: str = Depends(current_maker_slug)):
    if not STRIPE_API_KEY:
        raise HTTPException(503, "Stripe is not configured.")
    s = _stripe()
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found")

    account_id = maker.get("stripe_account_id")
    if not account_id:
        try:
            acct = s.Account.create(
                type="express",
                email=maker.get("email"),
                business_type="individual",
                capabilities={
                    "card_payments": {"requested": True},
                    "transfers": {"requested": True},
                },
                business_profile={
                    "name": maker.get("name"),
                    "product_description": "Handcrafted CNC art (plasma-cut metal, "
                                           "laser-engraved wood, custom signs).",
                },
                metadata={"maker_slug": slug},
            )
            account_id = acct.id
            await db.makers.update_one(
                {"slug": slug},
                {"$set": {"stripe_account_id": account_id,
                          "stripe_created_at": now_iso()}},
            )
        except Exception as e:
            logger.exception("Stripe account.create failed for maker=%s: %s", slug, e)
            raise HTTPException(502, "Could not create Stripe Connect account.")

    refresh = payload.origin_url.rstrip("/") + "/maker/stripe/return?refresh=1"
    ret = payload.origin_url.rstrip("/") + "/maker/stripe/return"
    try:
        link = s.AccountLink.create(
            account=account_id,
            refresh_url=refresh,
            return_url=ret,
            type="account_onboarding",
        )
    except Exception as e:
        logger.exception("Stripe AccountLink.create failed: %s", e)
        raise HTTPException(502, "Could not start onboarding.")

    return {"url": link.url, "account_id": account_id, "expires_at": link.expires_at}


@router.get("/maker/stripe/connect/status")
async def connect_status(slug: str = Depends(current_maker_slug)):
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found")
    account_id = maker.get("stripe_account_id")
    if not account_id:
        return {
            "connected": False,
            "stripe_account_id": None,
            "charges_enabled": False,
            "payouts_enabled": False,
            "details_submitted": False,
        }
    if not STRIPE_API_KEY:
        # Return last-known DB state if Stripe is not configured.
        return {
            "connected": True,
            "stripe_account_id": account_id,
            "charges_enabled": bool(maker.get("stripe_charges_enabled")),
            "payouts_enabled": bool(maker.get("stripe_payouts_enabled")),
            "details_submitted": bool(maker.get("stripe_details_submitted")),
        }
    try:
        u = await _refresh_status(slug, account_id)
    except Exception as e:
        logger.warning("Stripe Account.retrieve failed for %s: %s", account_id, e)
        return {
            "connected": True,
            "stripe_account_id": account_id,
            "charges_enabled": bool(maker.get("stripe_charges_enabled")),
            "payouts_enabled": bool(maker.get("stripe_payouts_enabled")),
            "details_submitted": bool(maker.get("stripe_details_submitted")),
            "error": "stripe-unreachable",
        }
    return {
        "connected": True,
        "stripe_account_id": account_id,
        "charges_enabled": u["stripe_charges_enabled"],
        "payouts_enabled": u["stripe_payouts_enabled"],
        "details_submitted": u["stripe_details_submitted"],
    }


@router.post("/maker/stripe/connect/dashboard-link")
async def connect_dashboard_link(slug: str = Depends(current_maker_slug)):
    if not STRIPE_API_KEY:
        raise HTTPException(503, "Stripe is not configured.")
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not maker or not maker.get("stripe_account_id"):
        raise HTTPException(400, "Connect your Stripe account first.")
    s = _stripe()
    try:
        link = s.Account.create_login_link(maker["stripe_account_id"])
    except Exception as e:
        logger.exception("Stripe LoginLink.create failed: %s", e)
        raise HTTPException(502, "Could not open Stripe dashboard.")
    return {"url": link.url}


# ---------------- Payout helpers (called from checkout webhook) ---------------

PLATFORM_FEE_BPS = int(os.environ.get("PLATFORM_FEE_BPS", "1000"))   # 10% default


def maker_share_cents(maker_subtotal_dollars: float) -> int:
    """Return the cents the maker keeps after platform fee on their subtotal."""
    gross_cents = int(round(maker_subtotal_dollars * 100))
    fee_cents = int(round(gross_cents * PLATFORM_FEE_BPS / 10000))
    return max(0, gross_cents - fee_cents)


async def transfer_to_makers_for_session(session_id: str) -> dict:
    """Idempotently transfer each maker's share of a paid order.

    Looks at db.payment_transactions[session_id], groups items by maker_slug,
    and for each maker with a ready Stripe account creates a Transfer with
    `transfer_group=session_id`. Skips makers without a connected account
    (their share remains on the platform balance for manual payout).

    Idempotency: stores `payouts.<session_id>.<maker_slug>` records and skips
    any (session, maker) pair already transferred.
    """
    if not STRIPE_API_KEY:
        return {"skipped": True, "reason": "stripe-not-configured"}
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx or tx.get("payment_status") != "paid":
        return {"skipped": True, "reason": "tx-not-paid"}

    s = _stripe()
    # Match the transfer_group we set on the PaymentIntent at session creation.
    # If a tx is missing it (older row), fall back to session_id.
    transfer_group = tx.get("transfer_group") or session_id
    by_maker: dict[str, float] = {}
    for ci in tx.get("items", []):
        pid = ci.get("product_id")
        p = await db.products.find_one({"id": pid}, {"_id": 0}) \
            or await db.products.find_one({"slug": pid}, {"_id": 0})
        if not p:
            continue
        qty = max(1, int(ci.get("quantity", 1)))
        by_maker.setdefault(p["maker_slug"], 0.0)
        by_maker[p["maker_slug"]] += float(p["price"]) * qty

    results = []
    for maker_slug, subtotal in by_maker.items():
        existing = await db.maker_payouts.find_one(
            {"session_id": session_id, "maker_slug": maker_slug}, {"_id": 0}
        )
        if existing and existing.get("status") in ("succeeded", "pending"):
            results.append({"maker": maker_slug, "skipped": "already-transferred"})
            continue
        m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
        if not m or not m.get("stripe_account_id"):
            await db.maker_payouts.update_one(
                {"session_id": session_id, "maker_slug": maker_slug},
                {"$set": {
                    "session_id": session_id, "maker_slug": maker_slug,
                    "amount": round(subtotal, 2),
                    "amount_cents": maker_share_cents(subtotal),
                    "platform_fee_bps": PLATFORM_FEE_BPS,
                    "status": "deferred",
                    "reason": "no-stripe-account",
                    "updated_at": now_iso(),
                }}, upsert=True,
            )
            results.append({"maker": maker_slug, "skipped": "no-stripe-account"})
            continue
        if not m.get("stripe_payouts_enabled"):
            # Refresh once before giving up — onboarding may have just completed.
            try:
                await _refresh_status(maker_slug, m["stripe_account_id"])
                m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
            except Exception:
                pass
        if not m.get("stripe_payouts_enabled"):
            await db.maker_payouts.update_one(
                {"session_id": session_id, "maker_slug": maker_slug},
                {"$set": {
                    "session_id": session_id, "maker_slug": maker_slug,
                    "amount": round(subtotal, 2),
                    "amount_cents": maker_share_cents(subtotal),
                    "platform_fee_bps": PLATFORM_FEE_BPS,
                    "status": "deferred",
                    "reason": "payouts-not-enabled",
                    "updated_at": now_iso(),
                }}, upsert=True,
            )
            results.append({"maker": maker_slug, "skipped": "payouts-not-enabled"})
            continue

        amount_cents = maker_share_cents(subtotal)
        try:
            transfer = s.Transfer.create(
                amount=amount_cents,
                currency="usd",
                destination=m["stripe_account_id"],
                transfer_group=transfer_group,
                description=f"Crafters Market order {session_id} — {maker_slug}",
                metadata={
                    "session_id": session_id,
                    "maker_slug": maker_slug,
                    "platform_fee_bps": str(PLATFORM_FEE_BPS),
                },
                idempotency_key=f"{session_id}:{maker_slug}",
            )
            await db.maker_payouts.update_one(
                {"session_id": session_id, "maker_slug": maker_slug},
                {"$set": {
                    "session_id": session_id, "maker_slug": maker_slug,
                    "amount": round(subtotal, 2),
                    "amount_cents": amount_cents,
                    "platform_fee_bps": PLATFORM_FEE_BPS,
                    "transfer_id": transfer.id,
                    "destination": m["stripe_account_id"],
                    "status": "succeeded",
                    "updated_at": now_iso(),
                }}, upsert=True,
            )
            results.append({"maker": maker_slug, "transfer_id": transfer.id, "amount_cents": amount_cents})
        except Exception as e:
            logger.exception("Transfer failed maker=%s session=%s: %s",
                             maker_slug, session_id, e)
            await db.maker_payouts.update_one(
                {"session_id": session_id, "maker_slug": maker_slug},
                {"$set": {
                    "session_id": session_id, "maker_slug": maker_slug,
                    "amount": round(subtotal, 2),
                    "amount_cents": amount_cents,
                    "platform_fee_bps": PLATFORM_FEE_BPS,
                    "status": "error",
                    "error": str(e)[:500],
                    "updated_at": now_iso(),
                }}, upsert=True,
            )
            results.append({"maker": maker_slug, "error": str(e)[:200]})

    return {"results": results, "platform_fee_bps": PLATFORM_FEE_BPS}


# ---------------- Maker-facing payout history ---------------------------------

@router.get("/maker/payouts")
async def maker_payouts(slug: str = Depends(current_maker_slug)):
    rows = await db.maker_payouts.find(
        {"maker_slug": slug}, {"_id": 0}
    ).sort("updated_at", -1).to_list(200)
    return rows
