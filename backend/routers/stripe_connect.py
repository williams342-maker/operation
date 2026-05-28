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
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import stripe as stripe_sdk

from core import STRIPE_API_KEY, db, logger, now_iso
from maker_auth import current_admin, current_maker_slug

router = APIRouter()


class OnboardRequest(BaseModel):
    origin_url: str    # frontend origin — Stripe redirects back here.


def _stripe():
    stripe_sdk.api_key = STRIPE_API_KEY
    return stripe_sdk


@router.get("/admin/stripe/diag")
async def stripe_diag(_: dict = Depends(current_admin)):
    """iter222 — Admin-only one-shot health check. Verifies the Stripe API
    key is real (calls Account.retrieve on the platform account itself)
    and reports current mode (test/live). Lets the operator confirm in
    one click that Stripe is wired correctly BEFORE asking makers to
    onboard.
    """
    key = STRIPE_API_KEY or ""
    if not key:
        return {"ok": False, "reason": "STRIPE_API_KEY missing", "mode": None}
    if "*" in key or len(key) < 20:
        # Placeholder value (e.g. sk_test_****gent) — invalid by design.
        return {
            "ok": False,
            "reason": "STRIPE_API_KEY is a placeholder (contains '*' or too short). Set a real Stripe Secret Key in /app/backend/.env and restart the backend.",
            "mode": "placeholder",
            "key_prefix": key[:8],
        }
    mode = "live" if key.startswith("sk_live_") else ("test" if key.startswith("sk_test_") else "unknown")
    s = _stripe()
    try:
        # Cheapest possible auth probe — retrieve the platform account.
        acct = s.Account.retrieve()
        return {
            "ok": True,
            "mode": mode,
            "key_prefix": key[:8],
            "platform_account_id": getattr(acct, "id", None),
            "country": getattr(acct, "country", None),
            "charges_enabled": bool(getattr(acct, "charges_enabled", False)),
            "details_submitted": bool(getattr(acct, "details_submitted", False)),
        }
    except Exception as e:
        return {
            "ok": False,
            "mode": mode,
            "key_prefix": key[:8],
            "reason": _stripe_friendly_error(e),
        }


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


# ─────────────────────────────────────────────────────────────────────
# iter259 — Admin: link an existing (manually-created) Stripe Connect
# account to a maker row. Use when the operator created the Stripe
# Connect account directly in the Stripe dashboard (instead of via our
# /api/maker/stripe/connect/onboard endpoint) — that flow doesn't stamp
# the account ID on the maker row.
#
# Calls the same _refresh_status helper as the live onboarding endpoint
# so charges_enabled / payouts_enabled / details_submitted are pulled
# straight from Stripe in one round-trip.
# ─────────────────────────────────────────────────────────────────────
class _LinkStripeAccountIn(BaseModel):
    maker_slug: str = Field(min_length=1, max_length=80)
    stripe_account_id: str = Field(min_length=8, max_length=40,
                                   pattern=r"^acct_[A-Za-z0-9]+$")
    overwrite: bool = False  # require explicit opt-in to overwrite an existing ID


@router.post("/admin/stripe/link-account")
async def admin_link_stripe_account(
    payload: _LinkStripeAccountIn,
    claims: dict = Depends(current_admin),
):
    """Stamp a manually-created Stripe Connect account ID onto a maker row
    and pull its current status from Stripe. Idempotent — re-running with
    the same pair is a no-op refresh.

    Returns the resulting status flags so the operator can see right away
    whether onboarding is complete on Stripe's side.
    """
    if not STRIPE_API_KEY or "*" in STRIPE_API_KEY:
        raise HTTPException(503, "Stripe is not configured on this environment.")

    maker = await db.makers.find_one(
        {"slug": payload.maker_slug},
        {"_id": 0, "slug": 1, "email": 1, "stripe_account_id": 1},
    )
    if not maker:
        raise HTTPException(404, f"No maker with slug {payload.maker_slug!r}")

    existing = (maker.get("stripe_account_id") or "").strip()
    if existing and existing != payload.stripe_account_id and not payload.overwrite:
        raise HTTPException(
            409,
            {
                "code": "stripe_account_already_linked",
                "current": existing,
                "incoming": payload.stripe_account_id,
                "hint": "Pass overwrite=true to replace the existing account ID.",
            },
        )

    # Verify the account exists on Stripe BEFORE writing anything to the
    # DB. A bad acct_id should fail loudly, not silently overwrite a
    # maker row with a non-existent account.
    try:
        update = await _refresh_status(payload.maker_slug, payload.stripe_account_id)
    except stripe_sdk.error.InvalidRequestError as e:
        raise HTTPException(400, f"Stripe rejected the account ID: {e.user_message or str(e)}")
    except stripe_sdk.error.AuthenticationError as e:
        raise HTTPException(503, f"Stripe authentication failed: {e}")
    except Exception as e:  # pragma: no cover
        raise HTTPException(502, f"Stripe API error: {e}")

    logger.info(
        "[stripe-link] admin=%s linked acct=%s to maker=%s (charges=%s payouts=%s details=%s)",
        claims.get("email"), payload.stripe_account_id, payload.maker_slug,
        update["stripe_charges_enabled"], update["stripe_payouts_enabled"],
        update["stripe_details_submitted"],
    )

    # Audit trail
    try:
        await db.admin_audit.insert_one({
            "kind": "stripe_account_linked",
            "admin_email": claims.get("email"),
            "maker_slug": payload.maker_slug,
            "stripe_account_id": payload.stripe_account_id,
            "previous_account_id": existing or None,
            "charges_enabled": update["stripe_charges_enabled"],
            "payouts_enabled": update["stripe_payouts_enabled"],
            "details_submitted": update["stripe_details_submitted"],
            "created_at": now_iso(),
        })
    except Exception as e:
        logger.warning("[stripe-link] audit mirror failed: %s", e)

    return {
        "ok": True,
        "maker_slug": payload.maker_slug,
        "stripe_account_id": payload.stripe_account_id,
        "charges_enabled": update["stripe_charges_enabled"],
        "payouts_enabled": update["stripe_payouts_enabled"],
        "details_submitted": update["stripe_details_submitted"],
    }


# ─────────────────────────────────────────────────────────────────────
# iter260 — Admin: wipe every maker's stored Stripe Connect state.
# Use during a Stripe platform migration — when STRIPE_API_KEY is being
# swapped to a different platform account, all the previously-stored
# `acct_*` IDs become dead pointers (they belong to the OLD platform
# and the new platform can't retrieve them). This resets every maker
# so they re-onboard cleanly under the new platform on their next
# visit to /maker/dashboard/financials.
#
# Idempotent. Two-step confirm pattern: pass {"confirm": "RESET ALL"}
# to actually run, otherwise returns a dry-run preview of how many
# rows would be touched.
# ─────────────────────────────────────────────────────────────────────
class _ResetAllConnectIn(BaseModel):
    confirm: str = ""   # must be the literal string "RESET ALL" to execute


@router.post("/admin/stripe/reset-all-connect-accounts")
async def admin_reset_all_connect_accounts(
    payload: _ResetAllConnectIn,
    claims: dict = Depends(current_admin),
):
    """Strip every maker's Stripe Connect state — used during a platform
    migration. Without `confirm == "RESET ALL"`, returns a dry-run preview.
    """
    affected_count = await db.makers.count_documents(
        {"stripe_account_id": {"$exists": True, "$nin": [None, ""]}}
    )

    sample = await db.makers.find(
        {"stripe_account_id": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "slug": 1, "stripe_account_id": 1, "stripe_payouts_enabled": 1},
    ).limit(10).to_list(10)

    if payload.confirm != "RESET ALL":
        return {
            "dry_run": True,
            "would_reset": affected_count,
            "sample": sample,
            "hint": "POST again with body {\"confirm\": \"RESET ALL\"} to actually wipe.",
        }

    # Live execution — strip every Stripe-Connect-related field. We don't
    # touch the Stripe subscription fields (those belong to Crafters Plus,
    # a separate concern handled by the subscriptions router).
    result = await db.makers.update_many(
        {"stripe_account_id": {"$exists": True, "$nin": [None, ""]}},
        {"$unset": {
            "stripe_account_id": "",
            "stripe_charges_enabled": "",
            "stripe_payouts_enabled": "",
            "stripe_details_submitted": "",
            "stripe_created_at": "",
            "stripe_updated_at": "",
        }},
    )

    logger.warning(
        "[stripe-reset] admin=%s wiped Connect state on %d makers (matched=%d)",
        claims.get("email"), result.modified_count, result.matched_count,
    )

    try:
        await db.admin_audit.insert_one({
            "kind": "stripe_connect_bulk_reset",
            "admin_email": claims.get("email"),
            "matched": result.matched_count,
            "modified": result.modified_count,
            "sample_before": sample,
            "created_at": now_iso(),
        })
    except Exception as e:
        logger.warning("[stripe-reset] audit mirror failed: %s", e)

    return {
        "dry_run": False,
        "matched": result.matched_count,
        "modified": result.modified_count,
    }




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
        # Payout schedule — env-configurable. Defaults to weekly Friday with
        # a 7-day rolling delay (gives us a chargeback window + time to
        # settle any accrued listing/promo fees before funds leave the
        # platform balance). Setting MAKER_PAYOUT_INTERVAL=daily|manual
        # flips behavior; `manual` means payouts only fire when we call
        # Payout.create explicitly.
        interval = os.environ.get("MAKER_PAYOUT_INTERVAL", "weekly").lower()
        delay_days = int(os.environ.get("MAKER_PAYOUT_DELAY_DAYS", "7"))
        schedule: dict = {"interval": interval, "delay_days": delay_days}
        if interval == "weekly":
            schedule["weekly_anchor"] = os.environ.get("MAKER_PAYOUT_WEEKLY_ANCHOR", "friday")
        elif interval == "monthly":
            schedule["monthly_anchor"] = int(os.environ.get("MAKER_PAYOUT_MONTHLY_ANCHOR", "1"))
        elif interval == "manual":
            # `manual` schedule can't carry delay_days / anchor fields.
            schedule = {"interval": "manual"}
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
                settings={"payouts": {"schedule": schedule}},
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
            raise HTTPException(502, _stripe_friendly_error(e))

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
        # iter222 — Surface the real Stripe error to the operator instead
        # of a generic "Could not start onboarding." Most common failures
        # here are (a) wrong API mode (sk_test vs sk_live mismatch with
        # account_id), (b) Connect platform not enabled on the Stripe
        # dashboard, or (c) the maker's stale stripe_account_id no longer
        # exists in Stripe. The frontend renders `detail` directly so the
        # maker sees what to fix.
        logger.exception("Stripe AccountLink.create failed for maker=%s account=%s: %s", slug, account_id, e)
        pretty = _stripe_friendly_error(e)
        raise HTTPException(502, pretty)

    return {"url": link.url, "account_id": account_id, "expires_at": link.expires_at}


def _stripe_friendly_error(e: Exception) -> str:
    """Translate a raw stripe.error.* into operator-actionable copy."""
    msg = str(e)
    klass = type(e).__name__
    low = msg.lower()
    if "authenticationerror" in klass.lower() or "invalid api key" in low or "no such api key" in low:
        return (
            "Stripe authentication failed — the STRIPE_API_KEY on the server "
            "is invalid or a test/live mode mismatch. Check /app/backend/.env "
            "and redeploy."
        )
    if "no such account" in low:
        return (
            "Stripe says this maker's connected account no longer exists. "
            "Reset the maker's stripe_account_id and retry onboarding."
        )
    if "connect" in low and ("not enabled" in low or "platform" in low):
        return (
            "Stripe Connect isn't enabled on this Stripe account. Enable it at "
            "https://dashboard.stripe.com/connect, then retry."
        )
    if "permission" in low or "you cannot" in low:
        return f"Stripe permission error: {msg[:240]}"
    if "rate limit" in low:
        return "Stripe is rate-limiting us — wait 30 seconds and retry."
    # Final fallback — still safer than the old opaque message.
    return f"Stripe rejected the onboarding link: {msg[:240]}"


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
        # iter276 — Distinguish "Stripe is unreachable" (network) from
        # "account no longer exists on this Stripe platform" (the post-
        # platform-migration symptom). On `No such account` we drop the
        # stale ID from the maker doc so the dashboard immediately
        # surfaces the "Link Stripe" CTA instead of showing a connected-
        # but-broken state.
        import stripe as _stripe_sdk
        if isinstance(e, _stripe_sdk.error.InvalidRequestError) and (
            "no such account" in str(e).lower()
            or "account_invalid" in str(e).lower()
        ):
            logger.warning(
                "[stripe_connect] maker=%s has stale stripe_account_id=%s on "
                "current platform (%s). Clearing so they can re-link.",
                slug, account_id, str(e)[:120],
            )
            await db.makers.update_one(
                {"slug": slug},
                {"$unset": {
                    "stripe_account_id": "",
                    "stripe_charges_enabled": "",
                    "stripe_payouts_enabled": "",
                    "stripe_details_submitted": "",
                }},
            )
            return {
                "connected": False,
                "stripe_account_id": None,
                "charges_enabled": False,
                "payouts_enabled": False,
                "details_submitted": False,
                "stale_id_cleared": True,
            }
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
    # Stripe's Account.create_login_link rejects accounts that haven't
    # finished onboarding (charges_enabled=false). Translate that into
    # a friendly 409 the UI can react to by re-launching onboarding.
    if not maker.get("stripe_charges_enabled"):
        raise HTTPException(
            409,
            {
                "code": "onboarding_incomplete",
                "message": "Finish your Stripe onboarding before opening the dashboard.",
            },
        )
    s = _stripe()
    try:
        link = s.Account.create_login_link(maker["stripe_account_id"])
    except Exception as e:
        msg = str(e)
        # Stripe still occasionally rejects with "may not have completed
        # onboarding" — surface as 409 so the UI offers the relaunch.
        if "may not have completed" in msg or "onboarding" in msg.lower():
            raise HTTPException(
                409,
                {
                    "code": "onboarding_incomplete",
                    "message": "Stripe says onboarding isn't complete yet. Re-launch the wizard to finish.",
                },
            )
        logger.exception("Stripe LoginLink.create failed: %s", e)
        raise HTTPException(502, "Could not open Stripe dashboard.")
    return {"url": link.url}


# ---------------- Payout helpers (called from checkout webhook) ---------------

# Two-tier fee model (Etsy-style):
#   - PLATFORM_FEE_BPS:          commission, retained on platform (default 5% = 500)
#   - PROCESSING_FEE_BPS:        percentage portion of payment processing
#                                (default 290 = 2.9% to mirror Stripe's published rate)
#   - PROCESSING_FEE_FIXED_CENTS: flat per-maker portion of payment processing
#                                 (default 30 = $0.30 to mirror Stripe's published rate)
# Total fee deducted from each maker's gross =
#   PLATFORM_FEE_BPS / 10000 * gross + PROCESSING_FEE_BPS / 10000 * gross
#   + PROCESSING_FEE_FIXED_CENTS
#
# Why per-maker, not per-checkout?
#   Stripe charges the platform $0.30 ONCE per charge regardless of how many
#   makers are in the cart. But Stripe Connect destination charges debit that
#   $0.30 from the platform account, so we'd be underwater on every multi-
#   maker order if we only absorbed it once. Per-maker is the standard market
#   practice (matches Etsy / Squarespace / Shopify Markets) — multi-maker
#   orders are rare and the small over-collection becomes platform margin.
PLATFORM_FEE_BPS = int(os.environ.get("PLATFORM_FEE_BPS", "500"))     # 5%
PROCESSING_FEE_BPS = int(os.environ.get("PROCESSING_FEE_BPS", "290"))  # 2.9%
PROCESSING_FEE_FIXED_CENTS = int(os.environ.get("PROCESSING_FEE_FIXED_CENTS", "30"))  # $0.30
TOTAL_FEE_BPS = PLATFORM_FEE_BPS + PROCESSING_FEE_BPS


def fee_breakdown_cents(maker_subtotal_dollars: float, maker: dict | None = None,
                        external_attribution: bool = False) -> dict:
    """Return cents breakdown so the maker payout UI can show transparent math.

    Honors:
      - per-maker commission rate (Plus = 4%, free = 5% by default)
      - off-site ad surcharge (12% extra) when `external_attribution` and the
        maker has NOT opted out
    """
    from revenue import commission_bps_for, OFFSITE_AD_FEE_BPS
    gross_cents = int(round(maker_subtotal_dollars * 100))
    commission_bps = commission_bps_for(maker or {})
    commission = int(round(gross_cents * commission_bps / 10000))
    # Processing fee: percentage + per-maker fixed portion. Mirrors
    # Stripe's published "2.9% + $0.30" so we recoup their actual cost
    # instead of eating fixed-fee shortfall on cheap items. The fixed
    # cents are capped at the remaining gross so makers never owe money
    # on a $0.10 sale.
    processing_pct = int(round(gross_cents * PROCESSING_FEE_BPS / 10000))
    processing_fixed = min(PROCESSING_FEE_FIXED_CENTS, max(0, gross_cents - commission - processing_pct))
    processing = processing_pct + processing_fixed
    offsite = 0
    if external_attribution and not (maker or {}).get("external_ads_opt_out", False):
        offsite = int(round(gross_cents * OFFSITE_AD_FEE_BPS / 10000))
    net = max(0, gross_cents - commission - processing - offsite)
    return {
        "gross_cents": gross_cents,
        "commission_cents": commission,
        "commission_bps": commission_bps,
        "processing_cents": processing,
        "processing_pct_cents": processing_pct,
        "processing_fixed_cents": processing_fixed,
        "offsite_cents": offsite,
        "net_cents": net,
    }


def maker_share_cents(maker_subtotal_dollars: float,
                      maker: dict | None = None,
                      external_attribution: bool = False) -> int:
    """Return the cents the maker keeps after all fees."""
    return fee_breakdown_cents(
        maker_subtotal_dollars, maker, external_attribution
    )["net_cents"]


async def transfer_to_makers_for_session(session_id: str) -> dict:
    """Idempotently transfer each maker's share of a paid order.

    Looks at db.payment_transactions[session_id], groups items by maker_slug,
    and for each maker with a ready Stripe account creates a Transfer with
    `transfer_group=tx['transfer_group']` (matches the PaymentIntent).
    Skips makers without a connected account
    (their share remains on the platform balance for manual payout).

    Idempotency: stores `payouts.<session_id>.<maker_slug>` records and skips
    any (session, maker) pair already transferred.
    """
    if not STRIPE_API_KEY:
        return {"skipped": True, "reason": "stripe-not-configured"}
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx or tx.get("payment_status") != "paid":
        return {"skipped": True, "reason": "tx-not-paid"}

    # If the buyer arrived via off-site attribution, every maker on this order
    # gets a 12% surcharge (unless individually opted out — checked per-maker).
    external_attribution = bool(tx.get("external_attribution"))

    s = _stripe()
    # IMPORTANT: Transfer.create's transfer_group must match the value we set
    # on the PaymentIntent at Session creation in checkout.py (which writes
    # `pre_transfer_group` to both the PaymentIntent's transfer_group AND
    # the payment_transactions.transfer_group field). Reading from the tx
    # row guarantees the pairing — DO NOT change this to session_id.
    transfer_group = tx.get("transfer_group") or session_id
    by_maker: dict[str, float] = {}
    for ci in tx.get("items", []):
        pid = ci.get("product_id")
        p = await db.products.find_one({"id": pid}, {"_id": 0}) \
            or await db.products.find_one({"slug": pid}, {"_id": 0})
        if not p:
            continue
        qty = max(1, int(ci.get("quantity", 1)))
        # If a variant was selected, apply its price_delta — otherwise use base.
        variant_id = ci.get("variant_id")
        unit_price = float(p["price"])
        if variant_id:
            for v in (p.get("variants") or []):
                if v.get("id") == variant_id:
                    unit_price = float(p["price"]) + float(v.get("price_delta", 0))
                    break
        by_maker.setdefault(p["maker_slug"], 0.0)
        by_maker[p["maker_slug"]] += unit_price * qty

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
                    "amount_cents": maker_share_cents(subtotal, m, external_attribution),
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
                    "amount_cents": maker_share_cents(subtotal, m, external_attribution),
                    "platform_fee_bps": PLATFORM_FEE_BPS,
                    "status": "deferred",
                    "reason": "payouts-not-enabled",
                    "updated_at": now_iso(),
                }}, upsert=True,
            )
            results.append({"maker": maker_slug, "skipped": "payouts-not-enabled"})
            continue

        # 1. Compute gross-after-commission/processing (per-maker rate honors Plus tier).
        gross_amount_cents = maker_share_cents(subtotal, m, external_attribution)
        # 2. Drain any accrued listing/promotion fees from the payout.
        from revenue import settle_pending_charges
        settled = await settle_pending_charges(maker_slug, gross_amount_cents)
        amount_cents = max(0, gross_amount_cents - settled["deducted_cents"])

        if amount_cents <= 0:
            # Entire payout is consumed by pending charges. Record as
            # zero-amount succeeded so we don't re-attempt this session.
            await db.maker_payouts.update_one(
                {"session_id": session_id, "maker_slug": maker_slug},
                {"$set": {
                    "session_id": session_id, "maker_slug": maker_slug,
                    "amount": round(subtotal, 2),
                    "amount_cents": 0,
                    "gross_cents": gross_amount_cents,
                    "fees_deducted_cents": settled["deducted_cents"],
                    "platform_fee_bps": PLATFORM_FEE_BPS,
                    "processing_fee_bps": PROCESSING_FEE_BPS,
                    "status": "succeeded-zero",
                    "reason": "fees-consumed-payout",
                    "updated_at": now_iso(),
                }}, upsert=True,
            )
            results.append({"maker": maker_slug, "skipped": "fees-consumed-payout"})
            continue

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
                    "processing_fee_bps": str(PROCESSING_FEE_BPS),
                    "ledger_deducted_cents": str(settled["deducted_cents"]),
                },
                idempotency_key=f"{session_id}:{maker_slug}",
            )
            await db.maker_payouts.update_one(
                {"session_id": session_id, "maker_slug": maker_slug},
                {"$set": {
                    "session_id": session_id, "maker_slug": maker_slug,
                    "amount": round(subtotal, 2),
                    "amount_cents": amount_cents,
                    "gross_cents": gross_amount_cents,
                    "fees_deducted_cents": settled["deducted_cents"],
                    "platform_fee_bps": PLATFORM_FEE_BPS,
                    "processing_fee_bps": PROCESSING_FEE_BPS,
                    "transfer_id": transfer.id,
                    "destination": m["stripe_account_id"],
                    "status": "succeeded",
                    "updated_at": now_iso(),
                }}, upsert=True,
            )
            results.append({
                "maker": maker_slug, "transfer_id": transfer.id,
                "amount_cents": amount_cents,
                "fees_deducted_cents": settled["deducted_cents"],
            })
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


# ---------------- Refunds (full reversal: refund charge + reverse transfers) --

async def refund_session(session_id: str) -> dict:
    """Full refund: refund the buyer's charge AND reverse every maker transfer.
    Idempotent — already-refunded sessions are skipped.
    """
    if not STRIPE_API_KEY:
        raise HTTPException(503, "Stripe is not configured.")
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Order not found")
    if tx.get("payment_status") != "paid":
        raise HTTPException(400, f"Cannot refund: payment_status={tx.get('payment_status')}")
    if tx.get("refund_status") == "refunded":
        return {"already_refunded": True, "refund_id": tx.get("refund_id")}

    s = _stripe()
    try:
        sess = s.checkout.Session.retrieve(session_id, expand=["payment_intent"])
    except Exception as e:
        logger.exception("session retrieve failed: %s", e)
        raise HTTPException(502, "Could not load Stripe session.")
    pi = getattr(sess, "payment_intent", None)
    if not pi:
        raise HTTPException(400, "Session has no PaymentIntent (cannot refund).")
    pi_id = pi.id if hasattr(pi, "id") else pi

    # 1) Refund the charge in full.
    try:
        refund = s.Refund.create(
            payment_intent=pi_id,
            reason="requested_by_customer",
            metadata={"session_id": session_id},
            idempotency_key=f"refund:{session_id}",
        )
    except Exception as e:
        logger.exception("refund create failed: %s", e)
        raise HTTPException(502, f"Refund failed: {e}")

    # 2) Reverse each maker transfer for this session (full reversal:
    #    platform fee is also given back — the platform absorbs the cost).
    payouts = await db.maker_payouts.find(
        {"session_id": session_id, "status": "succeeded"}, {"_id": 0}
    ).to_list(100)
    reversal_results = []
    for p in payouts:
        try:
            rev = s.Transfer.create_reversal(
                p["transfer_id"],
                metadata={"session_id": session_id, "maker_slug": p["maker_slug"]},
                idempotency_key=f"reversal:{session_id}:{p['maker_slug']}",
            )
            await db.maker_payouts.update_one(
                {"session_id": session_id, "maker_slug": p["maker_slug"]},
                {"$set": {
                    "status": "reversed",
                    "reversal_id": rev.id,
                    "reversed_at": now_iso(),
                }},
            )
            reversal_results.append({"maker": p["maker_slug"], "reversal_id": rev.id})
        except Exception as e:
            logger.exception("reversal failed maker=%s session=%s: %s",
                             p["maker_slug"], session_id, e)
            reversal_results.append({"maker": p["maker_slug"], "error": str(e)[:200]})

    # 3) Mark deferred payouts as cancelled (no transfer happened, nothing to reverse).
    await db.maker_payouts.update_many(
        {"session_id": session_id, "status": "deferred"},
        {"$set": {"status": "cancelled", "updated_at": now_iso()}},
    )

    # 4) Update tx record.
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {
            "refund_status": "refunded",
            "refund_id": refund.id,
            "refund_amount": refund.amount / 100.0,
            "refunded_at": now_iso(),
        }},
    )

    return {
        "refund_id": refund.id,
        "amount": refund.amount / 100.0,
        "reversals": reversal_results,
    }


# ---------------- Connect webhook (account.updated etc.) ----------------------

STRIPE_CONNECT_WEBHOOK_SECRET = os.environ.get("STRIPE_CONNECT_WEBHOOK_SECRET", "")


@router.post("/webhook/stripe/connect")
async def stripe_connect_webhook(request: Request):
    """Handles Stripe Connect events (account.updated, etc.).

    Configure on Stripe dashboard: Connect webhooks endpoint pointing to
    {PUBLIC_BACKEND_URL}/api/webhook/stripe/connect with event type 'account.updated'.
    Falls back to STRIPE_WEBHOOK_SECRET if STRIPE_CONNECT_WEBHOOK_SECRET is not set
    (single-secret config also works).
    """
    body = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    from stripe_webhook_secrets import get_active_webhook_secrets, verify_with_secrets
    secrets = await get_active_webhook_secrets("connect")
    if not secrets:
        return {"received": False, "reason": "no-secret-configured"}
    try:
        event = verify_with_secrets(body, sig, secrets)
    except Exception as e:
        logger.warning("connect webhook signature failed: %s", e)
        return {"received": False, "reason": "bad-signature"}

    etype = event["type"]
    obj = event["data"]["object"]
    # `obj` is either a plain dict (iter9 unit tests) or a StripeObject
    # (real webhooks). StripeObject doesn't implement .get() / .items() in
    # stripe>=15, but attribute access works on both. Use a small shim.
    def field(k, default=None):
        if isinstance(obj, dict):
            return obj.get(k, default)
        return getattr(obj, k, default)

    if etype == "account.updated":
        account_id = field("id")
        if not account_id:
            return {"received": True, "skipped": "no-account-id"}
        maker = await db.makers.find_one({"stripe_account_id": account_id}, {"_id": 0})
        if not maker:
            return {"received": True, "skipped": "unknown-maker"}
        await db.makers.update_one(
            {"slug": maker["slug"]},
            {"$set": {
                "stripe_charges_enabled": bool(field("charges_enabled", False)),
                "stripe_payouts_enabled": bool(field("payouts_enabled", False)),
                "stripe_details_submitted": bool(field("details_submitted", False)),
                "stripe_updated_at": now_iso(),
            }},
        )
        logger.info("connect: synced maker=%s charges=%s payouts=%s",
                    maker["slug"],
                    field("charges_enabled"), field("payouts_enabled"))
        return {"received": True, "type": etype, "maker": maker["slug"]}

    # Crafters Plus subscription lifecycle
    if etype.startswith("customer.subscription.") or etype == "invoice.payment_succeeded":
        from routers.subscriptions import handle_subscription_event
        # Convert Stripe SDK object to plain dict so the handler is testable.
        try:
            obj_dict = obj.to_dict() if hasattr(obj, "to_dict") else dict(obj)
        except Exception:
            obj_dict = obj
        handled = await handle_subscription_event(etype, obj_dict)
        return {"received": True, "type": etype, "handled": handled}

    return {"received": True, "type": etype, "handled": False}

