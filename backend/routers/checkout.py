"""Stripe checkout: cart quote, session creation, status polling, webhook handler."""
import hashlib
import math
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from emergentintegrations.payments.stripe.checkout import StripeCheckout
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from core import (
    STRIPE_API_KEY, custom_options_summary, db, effective_variant_price,
    logger, now_iso, public_host,
)
from email_service import (
    send_buyer_receipt, send_maker_low_stock,
    send_maker_new_order, send_ops_new_order,
)
from models import ActivityEvent, CheckoutRequest

router = APIRouter()

LOW_STOCK_THRESHOLD = int(os.environ.get("LOW_STOCK_THRESHOLD", "3"))


async def _decrement_stock_and_collect_low(
    items: list, by_maker_slug: dict
) -> dict[str, list[dict]]:
    """Decrement product / variant stock for a paid order. For any listing
    whose remaining stock falls below `LOW_STOCK_THRESHOLD`, append a row to
    the returned dict keyed by maker_slug. Idempotency: callers should run this
    only once per session (gated upstream by `payment_status` transition).
    """
    low_by_maker: dict[str, list[dict]] = {s: [] for s in by_maker_slug.keys()}
    for ci in items:
        pid = ci.get("product_id")
        qty = max(1, int(ci.get("quantity", 1)))
        variant_id = ci.get("variant_id")
        prod = await db.products.find_one({"id": pid}, {"_id": 0}) \
            or await db.products.find_one({"slug": pid}, {"_id": 0})
        if not prod:
            continue
        slug = prod["slug"]
        maker_slug = prod.get("maker_slug")
        if variant_id and prod.get("variants"):
            # Decrement the matching variant's in_stock atomically.
            res = await db.products.update_one(
                {"slug": slug, "variants.id": variant_id},
                {"$inc": {"variants.$.in_stock": -qty}},
            )
            if res.modified_count:
                fresh = await db.products.find_one({"slug": slug}, {"_id": 0})
                v = next((x for x in (fresh.get("variants") or []) if x.get("id") == variant_id), None)
                if v and v.get("in_stock", 0) < LOW_STOCK_THRESHOLD:
                    low_by_maker.setdefault(maker_slug, []).append({
                        "title": f"{prod['title']} — {v.get('label', '')}",
                        "in_stock": max(0, v.get("in_stock", 0)),
                        "slug": slug,
                    })
        else:
            # No variant on the line: decrement product-level stock.
            res = await db.products.update_one(
                {"slug": slug},
                {"$inc": {"in_stock": -qty}},
            )
            if res.modified_count:
                fresh = await db.products.find_one({"slug": slug}, {"_id": 0})
                if fresh and fresh.get("in_stock", 0) < LOW_STOCK_THRESHOLD:
                    low_by_maker.setdefault(maker_slug, []).append({
                        "title": prod["title"],
                        "in_stock": max(0, fresh.get("in_stock", 0)),
                        "slug": slug,
                    })
    return low_by_maker

# ---- Shipping config ----
# Per-category shipping fallback used when a maker hasn't set their own
# shipping_domestic_usd on a listing. Tuned roughly by typical package
# weight — small flat decor (Jewelry, Address Numbers) → $20, mid-size
# wall pieces → $25–35, heavy outdoor / furniture / garden → $55–95.
SHIPPING_BY_CATEGORY = {
    "Wall Art": 25.0,
    "Custom Signs": 35.0,
    "Outdoor Art": 55.0,
    "Home Decor": 25.0,
    "Wedding Gifts": 20.0,
    "Business Signage": 45.0,
    "Address Numbers": 20.0,
    "Lighting & Lamps": 35.0,
    "Garden & Yard Art": 55.0,
    "Memorial & Tribute": 25.0,
    "Furniture": 95.0,
    "Kitchen & Bar": 25.0,
    "Sculpture": 65.0,
    # iter330 — Broadened "Jewelry" → "Jewelry & Wearables". Both keys
    # mapped so existing listings keep their flat $8 ship rate and new
    # wearables (necklaces, patches, t-shirts) inherit the same default
    # — small lightweight items so $8 covers a USPS first-class envelope.
    "Jewelry": 8.0,
    "Jewelry & Wearables": 8.0,
    # iter386 — broader craft taxonomy (user request). Mirrored in the
    # editor's SHIPPING_DEFAULTS (constants.js) — keep both in sync.
    "Pottery & Ceramics": 20.0,
    "Woodworking": 30.0,
    "Leather Goods": 12.0,
    "Fiber & Textiles": 12.0,
    "Holiday & Seasonal": 25.0,
}
DEFAULT_SHIPPING = 30.0
FREE_SHIPPING_THRESHOLD = 250.0


async def _resolve_cart(items: list) -> list[dict]:
    """Resolve cart items to product docs + qty. Raises 400 on invalid items."""
    out = []
    for ci in items:
        pid = ci.product_id if hasattr(ci, "product_id") else ci.get("product_id")
        qty = ci.quantity if hasattr(ci, "quantity") else ci.get("quantity", 1)
        variant_id = (
            ci.variant_id if hasattr(ci, "variant_id")
            else ci.get("variant_id") if isinstance(ci, dict) else None
        )
        prod = await db.products.find_one({"id": pid}, {"_id": 0})
        if not prod:
            prod = await db.products.find_one({"slug": pid}, {"_id": 0})
        if not prod:
            raise HTTPException(400, f"Invalid product: {pid}")
        if prod.get("deleted_at"):
            raise HTTPException(
                410,            # Gone — listing was withdrawn after add-to-cart
                f"This listing is no longer available: {prod.get('title', pid)}",
            )
        if prod.get("status") == "draft":
            raise HTTPException(
                410, f"This listing is not available: {prod.get('title', pid)}"
            )

        # Variant resolution: if the product has variants OR a variant_id was
        # passed, the buyer must select one and the variant determines effective
        # price + stock.
        variant = None
        variants = prod.get("variants") or []
        if variants:
            if not variant_id:
                raise HTTPException(
                    400,
                    f"Please choose an option for {prod.get('title', pid)}.",
                )
            for v in variants:
                if v.get("id") == variant_id:
                    variant = v
                    break
            if not variant:
                raise HTTPException(400, "Selected variant no longer exists.")
            effective_price = effective_variant_price(prod.get("price"), variant)
            prod = {
                **prod,
                "price": round(effective_price, 2),
                "_variant_id": variant["id"],
                "_variant_label": variant.get("label", ""),
                "_base_title": prod.get("title", ""),
                "title": f"{prod.get('title', '')} — {variant.get('label', '')}",
            }
        # iter380 — Customization-only option groups (tracks_inventory=False)
        # never generate combo/SKU rows, so the buyer's picks arrive as
        # `custom_option_ids`. Validate one pick per group, fold their price
        # deltas into the unit price, and append labels to the line title so
        # Stripe line items + receipts show exactly what was chosen.
        custom_ids = (
            ci.custom_option_ids if hasattr(ci, "custom_option_ids")
            else (ci.get("custom_option_ids") if isinstance(ci, dict) else None)
        ) or []
        custom_groups = [
            g for g in (prod.get("variant_groups") or [])
            if g.get("tracks_inventory") is False and (g.get("options") or [])
        ]
        if custom_groups:
            for g in custom_groups:
                if not any(o.get("id") in custom_ids for o in g["options"]):
                    raise HTTPException(
                        400,
                        f"Please choose {g.get('name') or 'an option'} for "
                        f"{prod.get('_base_title') or prod.get('title', pid)}.",
                    )
            c_label, c_delta = custom_options_summary(prod, custom_ids)
            if c_label:
                prod = {
                    **prod,
                    "price": round(float(prod["price"]) + c_delta, 2),
                    "_custom_options_label": c_label,
                    "title": f"{prod.get('title', '')} · {c_label}",
                }
        # Buyer personalization (iter150): text + image_url pass through so
        # the order doc + maker email surface them. We don't validate them
        # here — Pydantic already enforced the length caps on CartItem.
        pers_text = (
            ci.personalization_text if hasattr(ci, "personalization_text")
            else (ci.get("personalization_text") if isinstance(ci, dict) else None)
        )
        pers_img = (
            ci.personalization_image_url if hasattr(ci, "personalization_image_url")
            else (ci.get("personalization_image_url") if isinstance(ci, dict) else None)
        )
        color_choice = (
            ci.color_choice if hasattr(ci, "color_choice")
            else (ci.get("color_choice") if isinstance(ci, dict) else None)
        )
        out.append({
            "product": prod,
            "quantity": max(1, int(qty)),
            "personalization_text": (pers_text or "").strip() or None,
            "personalization_image_url": (pers_img or "").strip() or None,
            "color_choice": (color_choice or "").strip() or None,
        })
    return out


def _eta_window(resolved: list[dict]):
    """iter385 — Estimated delivery window for a physical cart.

    Per item: parse the maker's `shipping_est_delivery` copy (e.g.
    "3-5 business days") for up to two day-counts; business days are
    stretched to calendar days (×7/5). Unparseable/missing → platform
    default 4–8 days. +1/+2 handling padding, then the cart window is the
    max across items (one box, slowest item gates it). Returns
    (start_iso_date, end_iso_date) or (None, None) for empty/digital carts.
    """
    lo_best = hi_best = 0
    for r in resolved:
        p = r["product"]
        if p.get("listing_type") == "digital":
            continue
        txt = (p.get("shipping_est_delivery") or "").strip()
        nums = [int(n) for n in re.findall(r"\d+", txt)[:2] if 0 < int(n) < 60]
        if len(nums) >= 2:
            lo, hi = nums[0], nums[1]
        elif len(nums) == 1:
            lo = hi = nums[0]
        else:
            lo, hi = 4, 8
        if "business" in txt.lower():
            lo, hi = math.ceil(lo * 7 / 5), math.ceil(hi * 7 / 5)
        lo_best, hi_best = max(lo_best, lo + 1), max(hi_best, hi + 2)
    if not hi_best:
        return None, None
    today = datetime.now(timezone.utc).date()
    return (
        (today + timedelta(days=lo_best)).isoformat(),
        (today + timedelta(days=hi_best)).isoformat(),
    )


def _quote_for(resolved: list[dict]) -> dict:
    """Compute subtotal + shipping for a resolved cart.

    Shipping precedence (per product):
      1. `free_shipping=True` on the listing  → that item contributes 0
      2. `shipping_domestic_usd` set by maker → that item contributes the
         maker-set rate
      3. Category fallback from SHIPPING_BY_CATEGORY → contributes the
         table rate
      4. DEFAULT_SHIPPING → final fallback

    Order-level rules:
      • Charge a single shipping fee per order = max() of the per-item
        contributions (one box, ships at the rate of the most expensive
        item to ship).
      • If EVERY item in the cart has `free_shipping=True`, shipping = 0
        regardless of subtotal — honors the maker's intent even on
        small carts that wouldn't otherwise hit the free-shipping
        threshold.
      • If subtotal >= FREE_SHIPPING_THRESHOLD, shipping is also 0
        (existing platform-wide promo).

    Previously this function ignored both the per-product `free_shipping`
    flag and the maker-set `shipping_domestic_usd` rate — it only checked
    the cart-wide threshold and the category default. That caused
    listings marked "free shipping" to still get charged shipping at
    checkout, which is the bug the user reported.
    """
    subtotal = round(sum(r["product"]["price"] * r["quantity"] for r in resolved), 2)

    # iter328 — Pure-digital carts skip shipping entirely. Hybrid (
    # `listing_type=="both"`) products still ship the physical part so
    # they participate in the regular shipping calc below.
    if resolved and all(
        (r["product"].get("listing_type") == "digital") for r in resolved
    ):
        return {
            "subtotal": subtotal,
            "shipping": 0.0,
            "free_shipping_threshold": FREE_SHIPPING_THRESHOLD,
            "free_shipping_eligible": True,
            "total_before_tax": subtotal,
            "digital_only": True,
            "eta_start": None,
            "eta_end": None,
        }

    # Subtotal-threshold platform promo wins over everything else.
    if subtotal >= FREE_SHIPPING_THRESHOLD:
        shipping = 0.0
    elif resolved and all(r["product"].get("free_shipping") for r in resolved):
        # Every item ships free — honor the makers' intent.
        shipping = 0.0
    else:
        per_item_rates = []
        for r in resolved:
            p = r["product"]
            if p.get("free_shipping"):
                per_item_rates.append(0.0)
                continue
            override = p.get("shipping_domestic_usd")
            if override is not None and override >= 0:
                per_item_rates.append(float(override))
                continue
            per_item_rates.append(
                SHIPPING_BY_CATEGORY.get(p.get("category"), DEFAULT_SHIPPING)
            )
        shipping = max(per_item_rates, default=DEFAULT_SHIPPING)
    shipping = round(shipping, 2)
    eta_start, eta_end = _eta_window(resolved)
    return {
        "subtotal": subtotal,
        "shipping": shipping,
        "free_shipping_threshold": FREE_SHIPPING_THRESHOLD,
        "free_shipping_eligible": subtotal >= FREE_SHIPPING_THRESHOLD,
        "total_before_tax": round(subtotal + shipping, 2),
        # iter328 — Always present so the frontend has one stable key
        # to check. False on the regular path; only the early-return
        # above sets it to True.
        "digital_only": False,
        # iter385 — estimated delivery window ("Arrives Jun 19 – 23").
        "eta_start": eta_start,
        "eta_end": eta_end,
    }


@router.post("/cart/quote")
async def cart_quote(req: CheckoutRequest):
    if not req.items:
        return {"subtotal": 0.0, "shipping": 0.0,
                "free_shipping_threshold": FREE_SHIPPING_THRESHOLD,
                "free_shipping_eligible": False, "total_before_tax": 0.0,
                "discount": 0.0, "discount_code": None, "discount_error": None}
    resolved = await _resolve_cart(req.items)
    quote = _quote_for(resolved)
    # Apply discount if a code was provided. Failure modes return the quote
    # untouched plus a `discount_error` string so the UI can show "code expired"
    # without blocking checkout.
    discount_amount = 0.0
    discount_error = None
    code_doc = None
    if (req.discount_code or "").strip():
        code_doc, discount_amount, discount_error = await _resolve_discount(
            req.discount_code, resolved, quote,
        )
    quote["discount"] = round(discount_amount, 2)
    quote["discount_code"] = (code_doc or {}).get("code") if code_doc else None
    quote["discount_kind"] = (code_doc or {}).get("kind") if code_doc else None
    quote["discount_error"] = discount_error
    quote["total_before_tax"] = round(max(0.0, quote["total_before_tax"] - discount_amount), 2)
    return quote


async def _resolve_discount(code_raw: str, resolved: list[dict], quote: dict):
    """Return (code_doc | None, dollar_discount, error_str | None).
    Per-shop codes apply only to that shop's subtotal in the cart.
    Free-shipping codes zero the shipping line. Fixed/percent codes reduce
    the relevant shop's items subtotal. Multiple shops in one cart means
    the code only discounts items belonging to its shop.

    Also supports marketplace-wide retention codes from `marketing_codes`
    (issued by the dormant-buyer reengage flow). Those codes are
    single-use, percent-only, and apply to the FULL items subtotal."""
    code = "".join(ch.upper() for ch in (code_raw or "") if ch.isalnum() or ch in "-_")
    if not code:
        return None, 0.0, "Invalid code."

    # Try marketplace-wide retention codes first (cheaper read path).
    mkt = await db.marketing_codes.find_one(
        {"code": code, "active": True, "scope": "marketplace_wide"}, {"_id": 0},
    )
    if mkt:
        if mkt.get("expires_at"):
            from datetime import datetime, timezone
            try:
                exp = datetime.fromisoformat(mkt["expires_at"].replace("Z", "+00:00"))
                if datetime.now(timezone.utc) > exp:
                    return mkt, 0.0, "Code has expired."
            except (ValueError, TypeError):
                pass
        if mkt.get("max_uses") and int(mkt.get("uses_count", 0)) >= int(mkt["max_uses"]):
            return mkt, 0.0, "Code has already been used."
        items_subtotal = sum(float(r["product"]["price"]) * r["quantity"] for r in resolved)
        pct = max(0.0, min(100.0, float(mkt.get("discount_pct", 0) or 0)))
        return mkt, round(items_subtotal * pct / 100, 2), None

    doc = await db.discount_codes.find_one({"code": code, "active": True}, {"_id": 0})
    if not doc:
        return None, 0.0, "Code not found or inactive."
    # Expiry check
    if doc.get("expires_at"):
        from datetime import datetime, timezone
        try:
            exp = datetime.fromisoformat(doc["expires_at"].replace("Z", "+00:00"))
        except (ValueError, TypeError):
            exp = None
        if exp and datetime.now(timezone.utc) > exp:
            return doc, 0.0, "Code has expired."
    # Max uses check
    if doc.get("max_uses") and int(doc.get("uses_count", 0)) >= int(doc["max_uses"]):
        return doc, 0.0, "Code has reached its usage limit."

    maker_slug = doc["maker_slug"]
    shop_lines = [r for r in resolved if r["product"].get("maker_slug") == maker_slug]
    if not shop_lines:
        return doc, 0.0, "This code is for a different shop's items."
    shop_subtotal = sum(float(r["product"]["price"]) * r["quantity"] for r in shop_lines)
    min_total = float(doc.get("min_order_total", 0) or 0)
    if shop_subtotal < min_total:
        return doc, 0.0, f"Order must total ${min_total:.0f} from this shop to use {code}."

    kind = doc.get("kind")
    if kind == "free_shipping":
        return doc, float(quote.get("shipping", 0) or 0), None
    if kind == "fixed":
        return doc, min(float(doc.get("amount", 0) or 0), shop_subtotal), None
    if kind == "percent":
        pct = max(0.0, min(100.0, float(doc.get("amount", 0) or 0)))
        return doc, round(shop_subtotal * pct / 100, 2), None
    return doc, 0.0, "Unsupported code type."


@router.post("/checkout/session")
async def create_checkout(req: CheckoutRequest, http_request: Request):
    if not req.items:
        raise HTTPException(400, "Cart is empty")
    if not req.policy_accepted:
        raise HTTPException(400, "You must accept the Site Policies to checkout.")
    resolved = await _resolve_cart(req.items)
    quote = _quote_for(resolved)
    if quote["total_before_tax"] <= 0:
        raise HTTPException(400, "Invalid total")
    # Stripe's hard minimum for a USD Checkout Session is $0.50. Catch it
    # here with a friendly message instead of a generic 500 from Stripe.
    if quote["total_before_tax"] < 0.50:
        raise HTTPException(
            400,
            "Order total must be at least $0.50 — please add another item "
            "or pick a listing with a higher price.",
        )

    # Resolve discount BEFORE building Stripe line items so we can pass a
    # deterministic discount line (Stripe Coupon) instead of mutating prices.
    discount_doc = None
    discount_amount = 0.0
    if (req.discount_code or "").strip():
        discount_doc, discount_amount, derr = await _resolve_discount(
            req.discount_code, resolved, quote,
        )
        if derr or not discount_doc:
            raise HTTPException(400, f"Discount code rejected: {derr or 'unknown error'}")

    success_url = f"{req.origin_url}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{req.origin_url}/cart"

    import stripe as stripe_sdk
    stripe_sdk.api_key = STRIPE_API_KEY

    line_items = []
    for r in resolved:
        p = r["product"]
        # Stripe Checkout requires absolute HTTPS URLs for product images.
        # Filter out relative paths (e.g. `/seed-images/...`) which would
        # otherwise trigger Stripe's `url_invalid` error and reject the
        # entire session. Better to render no image than to fail checkout.
        raw_images = p.get("images") or []
        valid_images = [
            u for u in raw_images
            if isinstance(u, str) and u.startswith(("http://", "https://"))
        ][:1]
        product_data = {
            "name": p["title"],
            "description": (p.get("description") or "")[:300],
        }
        if valid_images:
            product_data["images"] = valid_images
        line_items.append({
            "price_data": {
                "currency": "usd",
                "product_data": product_data,
                "unit_amount": int(round(float(p["price"]) * 100)),
            },
            "quantity": r["quantity"],
        })

    # iter340 — Three shipping tiers on the Stripe-hosted checkout.
    # Stripe renders these as a radio group and includes the chosen rate
    # in the final total. Standard uses whatever the cart quote computed
    # (which may already be $0 via free-shipping promo or `free_shipping`
    # on every item); Expedited and Overnight are tiered upgrades that
    # apply on TOP of the standard rate so the buyer pays for the
    # carrier upgrade even when the standard rate was free. Per-carrier
    # selection isn't needed: Stripe presents this as "speed of delivery"
    # which is what buyers actually care about; the maker picks the
    # carrier when buying the label.
    base = float(quote["shipping"])
    expedited_addon = 9.99   # 2-3 business days (Priority Mail / UPS Ground+)
    overnight_addon = 24.99  # 1 business day (Express / UPS Next Day Saver)
    shipping_options = [
        {
            "shipping_rate_data": {
                "display_name": "Standard" if base > 0 else "Standard · Free",
                "type": "fixed_amount",
                "fixed_amount": {
                    "amount": int(round(base * 100)),
                    "currency": "usd",
                },
                "delivery_estimate": {
                    "minimum": {"unit": "business_day", "value": 5},
                    "maximum": {"unit": "business_day", "value": 10},
                },
            },
        },
        {
            "shipping_rate_data": {
                "display_name": "Expedited · 2-3 business days",
                "type": "fixed_amount",
                "fixed_amount": {
                    "amount": int(round((base + expedited_addon) * 100)),
                    "currency": "usd",
                },
                "delivery_estimate": {
                    "minimum": {"unit": "business_day", "value": 2},
                    "maximum": {"unit": "business_day", "value": 3},
                },
            },
        },
        {
            "shipping_rate_data": {
                "display_name": "Overnight · 1 business day",
                "type": "fixed_amount",
                "fixed_amount": {
                    "amount": int(round((base + overnight_addon) * 100)),
                    "currency": "usd",
                },
                "delivery_estimate": {
                    "minimum": {"unit": "business_day", "value": 1},
                    "maximum": {"unit": "business_day", "value": 1},
                },
            },
        },
    ]

    line_summary = " | ".join(f"{r['product']['title']} × {r['quantity']}" for r in resolved)

    # transfer_group ties the charge to later Transfer.create() calls per-maker.
    # We use a deterministic pre-id (we don't know the session id yet) — Stripe
    # accepts any string. Replace with the real session.id after we have it.
    pre_transfer_group = f"order_{uuid.uuid4().hex}"

    # iter328 — Skip shipping options + address collection entirely when
    # the cart is 100% digital. Stripe interprets `shipping_options=[]`
    # as "no shipping" (so no $0 line is rendered) and dropping the
    # `shipping_address_collection` key keeps the checkout form
    # streamlined to just card + email.
    is_digital_only = bool(quote.get("digital_only"))

    # iter383 — Shipping address collected on OUR cart page. When present
    # we (1) attach it to the PaymentIntent so Stripe's dashboard + Radar
    # see the real ship-to, and (2) drop Stripe's own
    # `shipping_address_collection` so the buyer never types it twice.
    # Legacy clients that omit it keep Stripe-side collection as before.
    ship = req.shipping_address if not is_digital_only else None
    ship_details = None
    if ship:
        ship_details = {
            "name": ship.name.strip(),
            "phone": (ship.phone or "").strip() or None,
            "address": {
                "line1": ship.line1.strip(),
                "line2": (ship.line2 or "").strip() or None,
                "city": ship.city.strip(),
                "state": ship.state.strip(),
                "postal_code": ship.postal_code.strip(),
                "country": (ship.country or "US").strip().upper(),
            },
        }

    session_kwargs = {
        "mode": "payment",
        "payment_method_types": ["card"],
        "line_items": line_items,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "payment_intent_data": {
            "transfer_group": pre_transfer_group,
            "metadata": {"transfer_group": pre_transfer_group},
        },
        "metadata": {
            "summary": line_summary[:480],
            "customer_email": req.customer_email or "",
            "gift_note": (req.gift_note or "")[:480],
            "transfer_group": pre_transfer_group,
            "discount_code": (discount_doc or {}).get("code", "") if discount_doc else "",
            "discount_amount": f"{discount_amount:.2f}" if discount_amount else "",
            "discount_maker_slug": (discount_doc or {}).get("maker_slug", "") if discount_doc else "",
            "digital_only": "1" if is_digital_only else "",
        },
    }
    if ship_details:
        # Prune Nones — Stripe rejects null sub-fields on PaymentIntent shipping.
        pi_ship = {
            "name": ship_details["name"],
            "address": {k: v for k, v in ship_details["address"].items() if v},
        }
        if ship_details["phone"]:
            pi_ship["phone"] = ship_details["phone"]
        session_kwargs["payment_intent_data"]["shipping"] = pi_ship
    if not is_digital_only:
        session_kwargs["shipping_options"] = shipping_options
        if not ship_details:
            session_kwargs["shipping_address_collection"] = {"allowed_countries": ["US"]}

    # Apply discount as a one-shot Stripe Coupon. This way Stripe handles the
    # math + the buyer sees the discount line on Stripe's checkout page itself.
    if discount_doc and discount_amount > 0:
        try:
            coupon = stripe_sdk.Coupon.create(
                amount_off=int(round(discount_amount * 100)),
                currency="usd",
                duration="once",
                name=f"Code: {discount_doc['code']}",
                max_redemptions=1,
            )
            session_kwargs["discounts"] = [{"coupon": coupon.id}]
        except Exception as e:
            logger.warning("Stripe coupon create failed, applying discount as line-item math: %s", e)
            # Fallback: discount the largest matching line by the discount amount.
            # Doesn't show as a separate line on Stripe but the buyer pays the
            # correct total. Acceptable degraded mode.
            target = next(
                (i for i, r in enumerate(resolved)
                 if r["product"].get("maker_slug") == discount_doc["maker_slug"]),
                None,
            )
            if target is not None:
                old_amt = line_items[target]["price_data"]["unit_amount"]
                qty = line_items[target]["quantity"]
                reduce_per_unit = int(round(discount_amount * 100)) // max(1, qty)
                line_items[target]["price_data"]["unit_amount"] = max(50, old_amt - reduce_per_unit)
            session_kwargs["line_items"] = line_items
    try_with_tax = os.environ.get("STRIPE_AUTOMATIC_TAX", "true").lower() == "true"
    session = None
    # First attempt — with automatic_tax enabled if configured. Tax-related
    # Stripe errors (e.g. missing head office address in test mode) should
    # silently fall back to a tax-less session. Anything else (amount too
    # low, bad line item, invalid currency) is caller-visible.
    if try_with_tax:
        try:
            kwargs_tax = {**session_kwargs, "automatic_tax": {"enabled": True}}
            if req.customer_email:
                kwargs_tax["customer_email"] = req.customer_email
            session = stripe_sdk.checkout.Session.create(**kwargs_tax)
        except stripe_sdk.error.InvalidRequestError as e:
            msg = (getattr(e, "user_message", None) or str(e)).lower()
            # Tax config problems → fall through to the tax-less retry.
            # Everything else → propagate as a friendly 400.
            if "tax" not in msg and "origin" not in msg:
                logger.warning("Stripe invalid checkout request: %s", e)
                raise HTTPException(
                    400,
                    f"Checkout was rejected: {getattr(e, 'user_message', None) or str(e)}",
                )
            logger.warning("automatic_tax rejected by Stripe, retrying without it: %s", e)
        except Exception as e:  # pragma: no cover
            logger.warning("automatic_tax not available, retrying without it: %s", e)

    # Fallback: no automatic_tax.
    if session is None:
        try:
            if req.customer_email:
                session_kwargs["customer_email"] = req.customer_email
            session = stripe_sdk.checkout.Session.create(**session_kwargs)
        except stripe_sdk.error.InvalidRequestError as e:
            logger.warning("Stripe invalid checkout request (no-tax retry): %s", e)
            raise HTTPException(
                400,
                f"Checkout was rejected: {getattr(e, 'user_message', None) or str(e)}",
            )

    total = quote["total_before_tax"]
    # Attribution: anything other than "internal"/empty is treated as off-site
    # for the 12% surcharge in stripe_connect transfers.
    attr_source = (req.attribution_source or "").strip()[:50] or None
    is_external = bool(attr_source) and attr_source.lower() not in ("internal", "direct", "self")
    from core import POLICY_VERSION
    # iter265 — Stamp SMS phone + per-channel consents onto the tx so
    # the shipping notifier + receipt notifier can read them without
    # joining back to the buyer record.
    from sms_service import e164_normalize as _e164
    sms_phone = _e164(req.customer_phone) if req.customer_phone else None
    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": session.id,
        "amount": total,
        "subtotal": quote["subtotal"],
        "shipping": quote["shipping"],
        "currency": "usd",
        "items": [ci.model_dump() for ci in req.items],
        "summary": line_summary,
        "customer_email": req.customer_email,
        "customer_phone": sms_phone,
        "sms_consent_receipts_at": req.sms_consent_receipts_at if sms_phone else None,
        "sms_consent_shipping_at": req.sms_consent_shipping_at if sms_phone else None,
        # iter268 — Cart-recovery attribution. Whitelisted to known values.
        "recovery_medium": (
            req.recovery_medium
            if (req.recovery_medium or "").lower() in ("email", "sms") else None
        ),
        "gift_note": req.gift_note,
        # iter383 — locally-collected ship-to (same shape the maker order
        # detail expects). Visible to the maker the moment the order lands —
        # no Stripe webhook round-trip needed.
        "shipping_details": ship_details,
        "transfer_group": pre_transfer_group,
        "attribution_source": attr_source,
        "external_attribution": is_external,
        # iter334l — Microsoft Click ID for Bing Ads attribution.
        # Validated by Pydantic (max 100 chars), then sanity-clean here
        # to drop anything that doesn't look like a Bing ID (32-48 hex/
        # alphanumeric chars typically).
        "msclkid": ((req.msclkid or "").strip()[:100] or None),
        # iter334u — Google Click ID for Google Ads attribution.
        "gclid": ((req.gclid or "").strip()[:200] or None),
        # iter334x — Facebook Click ID for Meta Ads attribution.
        "fbclid": ((req.fbclid or "").strip()[:300] or None),
        "payment_status": "initiated",
        "status": "open",
        # Policy audit trail — proves which version the buyer agreed to and
        # exactly when (server time). Survives chargebacks, refund disputes,
        # and any "I didn't agree to that" claim.
        "policy_version": POLICY_VERSION,
        "policy_accepted_at": now_iso(),
        "created_at": now_iso(),
    })
    return {"url": session.url, "session_id": session.id, "amount": total,
            "subtotal": quote["subtotal"], "shipping": quote["shipping"]}


# ── iter413aj — Branded PDF order receipt ───────────────────────────────
# Public endpoint guarded only by the Stripe session_id (unguessable
# random token, same security model Stripe uses for hosted_invoice_url).
# Returns a Crafters-Market-branded PDF assembled from the
# `payment_transactions` row + per-product title/variant lookup. Linked
# from the CheckoutSuccess page and the order-receipt transactional
# email so customers can grab a polished branded receipt at any time
# without an account.
@router.get("/checkout/{session_id}/receipt.pdf")
async def checkout_receipt_pdf(session_id: str):
    from fastapi.responses import Response
    from pdf_receipt import render_receipt_pdf

    tx = await db.payment_transactions.find_one(
        {"session_id": session_id}, {"_id": 0}
    )
    if not tx:
        raise HTTPException(404, "Order not found.")
    if tx.get("payment_status") != "paid":
        # Receipts only exist for paid orders — surfacing one for an
        # unpaid session would mislead the buyer.
        raise HTTPException(409, "Receipt unavailable until payment is captured.")

    # Resolve line items from the products collection. Same join the
    # maker_order_detail uses (by_id / by_slug) so titles + variant
    # labels + maker names all show up correctly.
    raw_items = tx.get("items") or []
    product_ids = {ci.get("product_id") for ci in raw_items if ci.get("product_id")}
    products = await db.products.find(
        {"$or": [{"id": {"$in": list(product_ids)}}, {"slug": {"$in": list(product_ids)}}]},
        {"_id": 0},
    ).to_list(500) if product_ids else []
    by_id = {p["id"]: p for p in products if p.get("id")}
    by_slug = {p["slug"]: p for p in products if p.get("slug")}

    # Resolve maker names — same shape every transactional email uses.
    maker_slugs = {p.get("maker_slug") for p in products if p.get("maker_slug")}
    makers = await db.makers.find(
        {"slug": {"$in": list(maker_slugs)}}, {"_id": 0, "slug": 1, "name": 1},
    ).to_list(200) if maker_slugs else []
    maker_name_by_slug = {m["slug"]: m.get("name") for m in makers}

    items = []
    for ci in raw_items:
        pid = ci.get("product_id")
        p = by_id.get(pid) or by_slug.get(pid) or {}
        qty = int(ci.get("quantity") or 1)
        unit_price = float(p.get("price") or 0)
        variant_label = None
        if ci.get("variant_id"):
            for v in (p.get("variants") or []):
                if v.get("id") == ci["variant_id"]:
                    from core import effective_variant_price
                    unit_price = effective_variant_price(p.get("price"), v)
                    variant_label = v.get("label")
                    break
        # Custom option deltas (iter380)
        try:
            from core import custom_options_summary
            c_label, c_delta = custom_options_summary(p, ci.get("custom_option_ids") or [])
            if c_label:
                unit_price = round(unit_price + float(c_delta), 2)
                variant_label = (variant_label + "  ·  " + c_label) if variant_label else c_label
        except Exception:
            pass
        items.append({
            "title": p.get("title") or ci.get("title") or "Item",
            "quantity": qty,
            "unit_price": unit_price,
            "line_total": round(unit_price * qty, 2),
            "variant_label": variant_label,
            "maker_name": maker_name_by_slug.get(p.get("maker_slug")),
        })

    # Discount amount may be in tx top-level OR nested. Prefer top-level.
    discount_amount = float(tx.get("discount_amount") or 0)

    pdf_bytes = render_receipt_pdf(
        session_id=session_id,
        amount_dollars=float(tx.get("amount") or 0),
        subtotal=float(tx["subtotal"]) if tx.get("subtotal") is not None else None,
        shipping_cost=float(tx["shipping"]) if tx.get("shipping") is not None else None,
        discount_amount=discount_amount or None,
        currency=(tx.get("currency") or "USD").upper(),
        customer_email=tx.get("customer_email"),
        items=items,
        shipping_details=tx.get("shipping_details") or None,
        gift_note=tx.get("gift_note"),
        created_at=tx.get("created_at"),
    )

    # Filename uses the same short order id we show on screen + in the
    # email, so the downloaded file is greppable from the customer's
    # Downloads folder.
    order_short = session_id[-10:].upper()
    filename = f"crafters-market-receipt-{order_short}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.get("/checkout/status/{session_id}")
async def checkout_status(session_id: str, http_request: Request, bg: BackgroundTasks):
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    fallback_amount = int(round(float(tx["amount"]) * 100)) if tx and tx.get("amount") else 0

    # iter334j — Hash the buyer email server-side for Microsoft Ads
    # Enhanced Conversions (a.k.a. Customer Match). Microsoft expects a
    # lower-cased + trimmed email passed through SHA-256 — the standard
    # PII-hashing recipe shared by Google Ads, Meta, and Bing. Hashing
    # happens server-side so the raw email never traverses an additional
    # client→server hop, and the hash is included only when the
    # transaction is actually paid (no email leakage on abandoned
    # checkouts). Frontend reads `email_sha256` from the response and
    # passes it as `pid.em` in the UET purchase event payload.
    def _hash_email(raw: str | None) -> str | None:
        if not raw:
            return None
        normalized = raw.strip().lower()
        if not normalized:
            return None
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    # If our webhook already recorded this as paid, trust the DB — it's the
    # authoritative record of payment. Stripe sessions can expire/return stale
    # status long after the webhook fires.
    if tx and tx.get("payment_status") == "paid":
        return {
            "status": tx.get("status", "complete"),
            "payment_status": "paid",
            "amount_total": fallback_amount,
            "currency": tx.get("currency", "usd"),
            # iter328 — Surface the per-file download manifest so the
            # success page can render direct download links. Each entry:
            # {file_id, filename, size_bytes, ext, product_slug,
            #  product_title, token, expires_at_unix, downloads}. We
            # send the `token` so the frontend can build the URL itself
            # without a second auth round-trip.
            "digital_downloads": tx.get("digital_downloads") or [],
            "email_sha256": _hash_email(tx.get("customer_email")),
        }

    try:
        import stripe as stripe_sdk
        stripe_sdk.api_key = STRIPE_API_KEY
        sess = stripe_sdk.checkout.Session.retrieve(session_id)
        result = {
            "status": getattr(sess, "status", None) or "open",
            "payment_status": getattr(sess, "payment_status", None) or "unpaid",
            "amount_total": getattr(sess, "amount_total", None) or 0,
            "currency": getattr(sess, "currency", None) or "usd",
        }
    except Exception as e:
        logger.warning("status retrieve failed (%s) — using local fallback", e)
        if not tx:
            return {"status": "open", "payment_status": "unpaid", "amount_total": 0, "currency": "usd"}
        result = {
            "status": tx.get("status", "open"),
            "payment_status": tx.get("payment_status", "unpaid"),
            "amount_total": fallback_amount,
            "currency": tx.get("currency", "usd"),
        }

    if tx and tx.get("payment_status") != result["payment_status"]:
        # Never downgrade an already-paid record (webhook is authoritative);
        # only persist transitions that move *toward* paid.
        if tx.get("payment_status") == "paid" and result["payment_status"] != "paid":
            return {
                "status": tx.get("status", "complete"),
                "payment_status": "paid",
                "amount_total": fallback_amount,
                "currency": tx.get("currency", "usd"),
                "digital_downloads": tx.get("digital_downloads") or [],
                "email_sha256": _hash_email(tx.get("customer_email")),
            }
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": result["payment_status"],
                      "status": result["status"],
                      "updated_at": now_iso()}}
        )
        if result["payment_status"] == "paid" and tx.get("payment_status") != "paid":
            summary = tx.get("summary", "Order")
            # Increment the discount code's uses_count if one was used.
            # This runs at most once per session because we only enter this
            # branch on the payment_status transition unpaid → paid.
            try:
                # In newer Stripe SDKs, sess.metadata is a StripeObject that
                # doesn't expose .get() / .items() like a plain dict. Coerce
                # to a real dict first so the rest of the block can use the
                # normal dict API. Falls back to empty dict if metadata is
                # missing or unreadable.
                raw_meta = (sess.metadata if sess else None) or {}
                try:
                    meta = dict(raw_meta)
                except Exception:
                    meta = {k: getattr(raw_meta, k, None) for k in (
                        "discount_code", "discount_amount", "discount_maker_slug"
                    )}
                used_code = (meta.get("discount_code") or "").strip()
                used_amount = float(meta.get("discount_amount") or 0)
                used_maker = (meta.get("discount_maker_slug") or "").strip()
                if used_code:
                    # First try as per-shop discount code (most common).
                    discount_update = await db.discount_codes.update_one(
                        {"code": used_code, "maker_slug": used_maker},
                        {"$inc": {"uses_count": 1},
                         "$set": {"last_used_at": now_iso()}},
                    )
                    # If we didn't match a per-shop code, this is a marketplace-wide
                    # retention code from `marketing_codes`. Increment there too.
                    is_marketplace_code = False
                    if discount_update.modified_count == 0:
                        mc_update = await db.marketing_codes.update_one(
                            {"code": used_code},
                            {"$inc": {"uses_count": 1},
                             "$set": {"last_used_at": now_iso(), "active": False}},
                        )
                        is_marketplace_code = mc_update.modified_count > 0
                    await db.transactions.update_one(
                        {"session_id": session_id},
                        {"$set": {
                            "discount_code": used_code,
                            "discount_amount": used_amount,
                            "discount_maker_slug": used_maker,
                        }},
                    )
                    # iter268 — Conversion attribution ledger. One row
                    # per redeemed marketplace-wide code (these are the
                    # ones our cart-recovery flow issues; per-shop codes
                    # come from makers and aren't attribution-tracked).
                    # `recovery_medium` was stamped at checkout-session
                    # creation from the localStorage flag the CartPage
                    # set on landing from email/SMS CTAs.
                    if is_marketplace_code:
                        try:
                            recovery_medium = (tx.get("recovery_medium") or "").lower()
                            if recovery_medium not in ("email", "sms"):
                                recovery_medium = "direct"
                            await db.discount_attributions.insert_one({
                                "id": str(uuid.uuid4()),
                                "code": used_code,
                                "medium": recovery_medium,  # email | sms | direct
                                "amount_off": used_amount,
                                "order_total": float(tx.get("amount") or 0),
                                "session_id": session_id,
                                "buyer_email": (tx.get("customer_email") or "").lower(),
                                "redeemed_at": now_iso(),
                                "source": "abandoned_cart",
                            })
                        except Exception as att_err:
                            logger.warning("[attribution] insert failed: %s", att_err)
                    logger.info("[discount] code %s used on session %s for $%.2f",
                                used_code, session_id, used_amount)
            except Exception as e:
                logger.exception("[discount] usage recording failed: %s", e)

            # iter335.8 — Fire server-side conversions uploads to Meta
            # CAPI / Google Enhanced Conversions / Microsoft UET Offline
            # Conversions. Best-effort, fully isolated — failures here
            # never block the rest of the post-paid flow. Each platform
            # is idempotent on session_id, so re-fired webhooks are
            # safe.
            try:
                from services.conversions_uploader import fire_conversions
                await fire_conversions({
                    "session_id": session_id,
                    "customer_email": tx.get("customer_email"),
                    "amount_total": tx.get("amount") or 0,
                    "currency": tx.get("currency") or "usd",
                    "gclid": tx.get("gclid"),
                    "fbclid": tx.get("fbclid"),
                    "msclkid": tx.get("msclkid"),
                })
            except Exception as e:
                logger.exception("[conversions] post-paid upload failed: %s", e)

            # Enrich the public ticker event with buyer first-name + city when
            # the Stripe session exposes them. Falls back to the generic copy.
            buyer_first = ""
            buyer_city = "Crafters Market"
            try:
                cd = getattr(sess, "customer_details", None) if sess else None
                if cd:
                    full_name = (cd.get("name") if isinstance(cd, dict) else getattr(cd, "name", "")) or ""
                    buyer_first = full_name.strip().split()[0] if full_name else ""
                sd = (getattr(sess, "shipping_details", None) or getattr(sess, "shipping", None)) if sess else None
                # iter383 — when WE collected the address pre-Stripe, the
                # session has no shipping; read the tx doc copy instead.
                if not sd:
                    sd = tx.get("shipping_details")
                if sd:
                    addr = sd.get("address") if isinstance(sd, dict) else getattr(sd, "address", None)
                    if addr:
                        city = (addr.get("city") if isinstance(addr, dict) else getattr(addr, "city", "")) or ""
                        state = (addr.get("state") if isinstance(addr, dict) else getattr(addr, "state", "")) or ""
                        if city and state:
                            buyer_city = f"{city}, {state}"
                        elif city:
                            buyer_city = city
            except Exception:
                pass
            sold_text = (
                f"{buyer_first} just bought {summary}" if buyer_first
                else f"{summary} sold to a buyer"
            )
            await db.activity_events.insert_one(
                {
                    **ActivityEvent(kind="sold", text=sold_text, location=buyer_city).model_dump(),
                    # Admin-only enrichment: gross amount + session id so the
                    # admin "Live order" toast can show the dollar value and
                    # link straight to the Stripe Dashboard receipt. Public
                    # /api/activity strips this back out before serving.
                    "amount": float(tx.get("amount") or 0),
                    "session_id": session_id,
                }
            )
            # Fire-and-forget admin Web Push so operators get a 💰 ping on
            # their phone the moment a real order lands. Wrapped so a push
            # failure can never break the paid-order pipeline.
            try:
                from routers.push import notify_admins_new_order
                amt = float(tx.get("amount") or 0)
                push_title = (
                    f"💰 New order — ${amt:.2f}" if amt > 0 else "💰 New order"
                )
                push_body = (
                    f"{sold_text} · {buyer_city}"
                    if buyer_city and buyer_city != "Crafters Market"
                    else sold_text
                )
                await notify_admins_new_order(push_title, push_body)
            except Exception as e:
                logger.warning("[push] admin new-order notification skipped: %s", e)
            email_items = []
            by_maker: dict[str, list] = {}
            for ci in tx.get("items", []):
                p = await db.products.find_one({"id": ci["product_id"]}, {"_id": 0}) \
                    or await db.products.find_one({"slug": ci["product_id"]}, {"_id": 0})
                if not p:
                    continue
                m_doc = await db.makers.find_one(
                    {"slug": p["maker_slug"]}, {"_id": 0, "name": 1, "slug": 1},
                ) or {}
                # iter380 — Resolve variant + customization-only option labels
                # so receipts / maker emails show exactly what was ordered,
                # priced at the true unit price (not the base listing price).
                line_title = p["title"]
                unit_price = float(p.get("price") or 0)
                vid = ci.get("variant_id")
                if vid:
                    v = next((x for x in (p.get("variants") or []) if x.get("id") == vid), None)
                    if v:
                        unit_price = effective_variant_price(p.get("price"), v)
                        if v.get("label"):
                            line_title = f"{line_title} — {v['label']}"
                c_label, c_delta = custom_options_summary(p, ci.get("custom_option_ids") or [])
                if c_label:
                    line_title = f"{line_title} · {c_label}"
                    unit_price = round(unit_price + c_delta, 2)
                line = {
                    "title": line_title,
                    "price": unit_price,
                    "quantity": ci.get("quantity", 1),
                    "maker_slug": p["maker_slug"],
                    "maker_name": m_doc.get("name") or p["maker_slug"],
                    # iter150 — buyer personalization (text + image URL).
                    # `None` when the buyer didn't add any; the email
                    # template short-circuits on falsy values.
                    "personalization_text": ci.get("personalization_text"),
                    "personalization_image_url": ci.get("personalization_image_url"),
                    "color_choice": ci.get("color_choice"),
                }
                email_items.append(line)
                by_maker.setdefault(p["maker_slug"], []).append(line)
                # iter150 — mark the personalization upload as referenced so
                # the orphan-cleanup cron doesn't delete it after 7 days.
                pim = (ci.get("personalization_image_url") or "").strip()
                if pim:
                    try:
                        await db.personalization_uploads.update_one(
                            {"url": pim}, {"$set": {"referenced": True}},
                        )
                    except Exception as e:
                        logger.warning("[personalization] mark-referenced failed: %s", e)
                # iter364 — same for customer photo uploads: flip referenced
                # + stamp the order so the orphan sweeper never reaps them
                # and the maker zip endpoint can find them.
                up_ids = ci.get("personalization_upload_ids") or []
                if up_ids:
                    try:
                        await db.customer_uploads.update_many(
                            {"id": {"$in": up_ids}},
                            {"$set": {"referenced": True, "order_session_id": session_id}},
                        )
                    except Exception as e:
                        logger.warning("[customer-uploads] mark-referenced failed: %s", e)
            buyer = tx.get("customer_email")
            total_amount = float(tx.get("amount", 0))
            bg.add_task(send_ops_new_order, summary, total_amount, email_items, buyer)
            if buyer:
                bg.add_task(send_buyer_receipt, buyer, summary, total_amount, email_items, session_id)
                # Stop any pending abandoned-cart push from firing for this buyer.
                try:
                    from routers.abandoned_cart import mark_checked_out
                    bg.add_task(mark_checked_out, buyer)
                except Exception:
                    pass
            # iter265 — SMS receipt (opt-in only). Fires alongside the
            # email receipt for buyers who consented at checkout. The
            # send_sms helper is a no-op if Telnyx isn't configured, so
            # this is safe in preview.
            buyer_phone = tx.get("customer_phone")
            if buyer_phone and tx.get("sms_consent_receipts_at"):
                session_id_local = tx.get("session_id")
                async def _send_receipt_sms(p, total, sid):
                    from sms_service import send_sms
                    body = (
                        f"Crafters Market: order confirmed for ${total:.2f}. "
                        "We'll text you again when it ships. Reply STOP to opt out."
                    )
                    await send_sms(
                        to=p, body=body, kind="order_receipt",
                        dedup_key=f"receipt:{sid}",
                    )
                bg.add_task(_send_receipt_sms, buyer_phone, total_amount, session_id_local)
            for maker_slug, lines in by_maker.items():
                m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
                if not m or not m.get("email"):
                    continue
                subtotal = sum(float(line["price"]) * int(line["quantity"]) for line in lines)
                bg.add_task(send_maker_new_order,
                            m["email"], m["name"], lines, subtotal, buyer)
            # Decrement stock & queue a low-stock email for any listing that
            # just crossed below LOW_STOCK_THRESHOLD (default 3).
            low_by_maker = await _decrement_stock_and_collect_low(
                tx.get("items", []), by_maker
            )
            for maker_slug, low_lines in low_by_maker.items():
                if not low_lines:
                    continue
                m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
                if not m or not m.get("email"):
                    continue
                bg.add_task(send_maker_low_stock, m["email"], m["name"], low_lines)
            # Stripe Connect: transfer each maker's share to their connected acct
            from routers.stripe_connect import transfer_to_makers_for_session
            bg.add_task(transfer_to_makers_for_session, session_id)

            # iter328 — Digital delivery. For every line item whose
            # product is digital or hybrid, mint a download token per
            # uploaded file and persist a `digital_downloads` manifest
            # on the transaction. The checkout-success page reads this
            # manifest via /api/checkout/status and the buyer email
            # carries the same links inline.
            try:
                from digital_delivery import mint_download_token
                digital_downloads: list[dict] = []
                for ci in tx.get("items", []):
                    p = await db.products.find_one(
                        {"id": ci["product_id"]},
                        {"_id": 0, "slug": 1, "title": 1,
                         "listing_type": 1, "digital_files": 1},
                    ) or await db.products.find_one(
                        {"slug": ci["product_id"]},
                        {"_id": 0, "slug": 1, "title": 1,
                         "listing_type": 1, "digital_files": 1},
                    )
                    if not p or p.get("listing_type") not in ("digital", "both"):
                        continue
                    for f in (p.get("digital_files") or []):
                        token, exp = mint_download_token(session_id, f["id"])
                        digital_downloads.append({
                            "file_id": f["id"],
                            "filename": f.get("filename") or "file",
                            "size_bytes": f.get("size_bytes") or 0,
                            "ext": f.get("ext") or "",
                            "product_slug": p.get("slug") or "",
                            "product_title": p.get("title") or "",
                            "token": token,
                            "expires_at_unix": exp,
                            "downloads": 0,
                        })
                if digital_downloads:
                    await db.transactions.update_one(
                        {"session_id": session_id},
                        {"$set": {"digital_downloads": digital_downloads}},
                    )
                    logger.info(
                        "[digital-delivery] minted %d download tokens for session %s",
                        len(digital_downloads), session_id,
                    )
                    # Optional: queue a dedicated digital-delivery email
                    # if the buyer email is on file. The regular receipt
                    # already includes a link to the order page where
                    # the downloads also live, but a dedicated mail is
                    # the "instant download" experience buyers expect.
                    if buyer:
                        try:
                            from email_service import send_buyer_digital_downloads
                            bg.add_task(
                                send_buyer_digital_downloads,
                                buyer, summary, digital_downloads,
                            )
                        except Exception:
                            # The helper may not be present in older
                            # builds — non-fatal.
                            logger.warning(
                                "[digital-delivery] send_buyer_digital_downloads "
                                "helper missing — buyer can still grab files from "
                                "the order confirmation page."
                            )
            except Exception as e:
                # NEVER let digital-delivery break the paid-order pipeline.
                logger.exception("[digital-delivery] manifest minting failed: %s", e)
    # iter328 — Surface the manifest on the very first /status call
    # that flips this session to paid. Re-fetch the tx because we just
    # wrote `digital_downloads` to it above.
    if result.get("payment_status") == "paid":
        fresh = await db.payment_transactions.find_one(
            {"session_id": session_id},
            {"_id": 0, "digital_downloads": 1, "customer_email": 1},
        )
        if fresh and fresh.get("digital_downloads"):
            result["digital_downloads"] = fresh["digital_downloads"]
        # iter334j — Surface hashed buyer email for Microsoft Ads
        # Enhanced Conversions on the FIRST status hit that flips to
        # paid (not just on subsequent re-hits). Without this, the very
        # success-page poll that does fire `purchase` would miss the
        # email hash and lose Customer Match matching.
        if fresh and fresh.get("customer_email"):
            result["email_sha256"] = _hash_email(fresh["customer_email"])
    return result


@router.get("/checkout/downloads/{token}")
async def checkout_download(token: str):
    """Token-gated digital file download (iter328).

    Verifies the HMAC token, increments a `downloads` counter, and
    302-redirects to the public R2 URL. The redirect is fine because:
      - The token itself is the credential — only someone holding the
        valid token (i.e. the buyer who paid) can mint the request.
      - The R2 URL is public-CDN-fronted but the path is non-guessable
        (UUIDv4 file id + maker slug + product slug + filename), so
        guessing a URL without the token isn't feasible.
      - If a token leaks, rotating MAKER_AUTH_SECRET invalidates every
        outstanding token — same blast radius as for the magic-link
        tokens we already mint.

    Buyer never sees the raw R2 URL — they always click through this
    endpoint, which gives us a per-file download counter we can show
    on the order page later.
    """
    from digital_delivery import verify_download_token
    try:
        meta = verify_download_token(token)
    except ValueError as e:
        raise HTTPException(403, f"Invalid or expired download link: {e}")
    session_id = meta["session_id"]
    file_id = meta["file_id"]

    tx = await db.payment_transactions.find_one(
        {"session_id": session_id},
        {"_id": 0, "payment_status": 1, "digital_downloads": 1},
    )
    if not tx:
        raise HTTPException(404, "Order not found.")
    if tx.get("payment_status") != "paid":
        raise HTTPException(403, "Order not paid yet.")

    # Find the matching manifest row.
    files = tx.get("digital_downloads") or []
    entry = next((f for f in files if f.get("file_id") == file_id), None)
    if not entry:
        raise HTTPException(404, "File not found on this order.")

    # Look up the underlying R2 URL from the product. Doing it this way
    # (instead of caching the URL in the manifest) means the maker can
    # re-upload a fixed file and ALL buyers immediately get the
    # corrected version on next download — no token reminting needed.
    prod = await db.products.find_one(
        {"slug": entry.get("product_slug")},
        {"_id": 0, "digital_files": 1},
    ) or {}
    product_file = next(
        (f for f in (prod.get("digital_files") or []) if f.get("id") == file_id),
        None,
    )
    if not product_file or not product_file.get("url"):
        raise HTTPException(
            410,
            "This file is no longer available from the maker. "
            "Contact them via the order page.",
        )

    # Atomic counter bump.
    await db.payment_transactions.update_one(
        {"session_id": session_id, "digital_downloads.file_id": file_id},
        {"$inc": {"digital_downloads.$.downloads": 1},
         "$set": {"digital_downloads.$.last_downloaded_at": now_iso()}},
    )

    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=product_file["url"], status_code=302)


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    # iter289 — Log every hit for the admin Stripe Webhook Health widget.
    from stripe_webhook_log import record as _log
    path = request.url.path

    body = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    host_url = public_host(request)
    webhook_url = f"{host_url}/api/webhook/stripe"
    # Dual-secret verification (env + pending rotation override). If at
    # least one accepts the signature, we proceed; otherwise reject.
    # The library call below is then safe to invoke without re-checking
    # the signature (we pass the secret that worked).
    from stripe_webhook_secrets import get_active_webhook_secrets, verify_with_secrets
    secrets = await get_active_webhook_secrets("main")
    accepted_secret = None
    if not secrets:
        await _log(kind="main", path=path, status="no_secret")
        return {"received": False, "reason": "no-secret-configured"}
    try:
        verify_with_secrets(body, sig, secrets)
        # Find which one matched (re-try to remember the winner)
        for sec in secrets:
            try:
                import stripe as _sdk
                _sdk.Webhook.construct_event(body, sig, sec)
                accepted_secret = sec
                break
            except Exception:
                continue
    except Exception as e:
        logger.warning("checkout webhook signature failed: %s", e)
        await _log(kind="main", path=path, status="bad_signature", error=str(e))
        return {"received": False, "reason": "bad-signature"}
    stripe = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url,
                            webhook_secret=accepted_secret)
    try:
        evt = await stripe.handle_webhook(body, sig)
    except Exception as e:
        logger.exception("webhook fail: %s", e)
        await _log(kind="main", path=path, status="handler_error", error=str(e))
        return {"received": False}
    # Update local payment_transactions row (regular product purchases)
    await db.payment_transactions.update_one(
        {"session_id": evt.session_id},
        {"$set": {"payment_status": evt.payment_status, "updated_at": now_iso()}}
    )
    # Also activate any download unlocks tied to this session.
    if evt.payment_status == "paid":
        await db.download_unlocks.update_one(
            {"session_id": evt.session_id, "status": "pending"},
            {"$set": {"status": "active", "activated_at": now_iso()}},
        )
        # Stripe Connect: transfer each maker's share for this session.
        try:
            from routers.stripe_connect import transfer_to_makers_for_session
            await transfer_to_makers_for_session(evt.session_id)
        except Exception as e:
            logger.exception("connect transfer failed: %s", e)
        # iter413bl — Server-side Meta Conversions API fire. Uses the
        # Stripe session_id as event_id so it dedupes with the browser
        # pixel that fires on /checkout/success (same id). Survives
        # ad-blockers + iOS tracking restrictions that mute the browser
        # pixel. Best-effort — failures MUST not break the payment flow.
        try:
            from routers.meta_capi import send_meta_event
            tx = await db.payment_transactions.find_one(
                {"session_id": evt.session_id},
                {"_id": 0, "customer_email": 1, "amount_total": 1, "currency": 1},
            ) or {}
            amount_cents = int(tx.get("amount_total") or 0)
            await send_meta_event(
                event_name="Purchase",
                event_id=evt.session_id,
                email=tx.get("customer_email"),
                value=amount_cents / 100.0 if amount_cents else None,
                currency=(tx.get("currency") or "usd").upper(),
            )
        except Exception as e:
            logger.warning("[meta-capi] purchase fire failed: %s", e)
    await _log(kind="main", path=path, status="ok",
               event_type=getattr(evt, "event_type", None) or "checkout.session.*",
               event_id=getattr(evt, "session_id", None))
    # iter335 — Promote wallet hooks (top-ups + subscription renewals).
    # The emergentintegrations wrapper only exposes checkout-session
    # fields, so we re-parse the raw body to inspect metadata + handle
    # `invoice.payment_succeeded` (subscription renewals fire without
    # any checkout session at all).
    try:
        await _dispatch_promote_wallet_events(body, sig, accepted_secret)
    except Exception as e:
        logger.exception("[promote] webhook hook failed: %s", e)
    return {"received": True}


async def _dispatch_promote_wallet_events(body: bytes, sig: str, secret: str):
    """Re-parse the verified Stripe webhook and credit the Promote
    wallet on `checkout.session.completed` (one-time top-up) and on
    `invoice.payment_succeeded` (subscription renewal).

    Idempotent: each credit is keyed by either the Stripe session id
    (top-ups) or the Stripe invoice id (subscriptions) so re-fired
    webhooks can't double-credit.
    """
    import stripe as _sdk
    _sdk.api_key = STRIPE_API_KEY
    try:
        event = _sdk.Webhook.construct_event(body, sig, secret)
    except Exception as e:
        logger.warning("[promote] event re-parse failed: %s", e)
        return

    etype = event.get("type") if isinstance(event, dict) else getattr(event, "type", "")
    data = event.get("data", {}).get("object", {}) if isinstance(event, dict) else {}

    from services import promote_wallet as _wallet

    if etype == "checkout.session.completed":
        meta = (data.get("metadata") or {})
        if meta.get("promote_kind") == "topup":
            if data.get("payment_status") == "paid":
                maker_slug = meta.get("maker_slug", "")
                cents = int(meta.get("amount_cents") or 0)
                if maker_slug and cents > 0:
                    await _wallet.credit(
                        maker_slug, cents,
                        kind="topup",
                        ref=data.get("id", ""),
                        idempotency_key=f"topup:{data.get('id', '')}",
                        note=f"Stripe Checkout · ${cents/100:.2f}",
                    )
                    await db.promote_pending_topups.update_one(
                        {"_id": data.get("id")},
                        {"$set": {"status": "paid", "paid_at": now_iso()}},
                    )
                    # iter335.11 — Auto-apply allocator on top-up. If the
                    # maker already has an active campaign, fire the
                    # allocator immediately so boosts land in seconds,
                    # not tomorrow's 04:45 cron. Best-effort — failures
                    # don't block the credit (allocator retries daily).
                    try:
                        camp = await db.campaign_groups.find_one({
                            "maker_slug": maker_slug,
                            "deleted_at": None, "status": "active",
                        })
                        if camp:
                            from services.promote_allocator import apply_allocations
                            r = await apply_allocations(
                                maker_slug, camp["campaign_id"],
                                int(camp.get("budget_cents") or 0),
                                explicit_listing_slugs=camp.get("explicit_listing_slugs") or None,
                            )
                            logger.info("[promote] auto-apply post-topup %s: %s",
                                        maker_slug, {"boosts": r.get("boosts_applied"),
                                                     "spent_cents": r.get("cents_spent")})
                    except Exception as e:
                        logger.exception("[promote] auto-apply failed: %s", e)
        elif meta.get("promote_kind") == "subscription":
            # First-time subscription created. Persist the sub id on the
            # wallet so the maker can cancel later. The actual credit
            # happens via `invoice.payment_succeeded` below.
            maker_slug = meta.get("maker_slug", "")
            sub_id = data.get("subscription")
            if maker_slug and sub_id:
                await _wallet.ensure_wallet(maker_slug)
                await db.promotion_wallets.update_one(
                    {"_id": maker_slug},
                    {"$set": {
                        "subscription": {
                            "stripe_subscription_id": sub_id,
                            "status": "active",
                            "monthly_cents": int(meta.get("monthly_cents") or 0),
                            "started_at": now_iso(),
                        },
                        "updated_at": now_iso(),
                    }},
                )

    elif etype == "invoice.payment_succeeded":
        # Monthly subscription renewal. Stripe attaches the subscription's
        # metadata to the invoice when it was set via subscription_data.
        sub_id = data.get("subscription")
        invoice_id = data.get("id")
        if not (sub_id and invoice_id):
            return
        # Pull metadata from the subscription itself (more reliable than
        # the invoice's metadata copy).
        try:
            sub = _sdk.Subscription.retrieve(sub_id)
        except Exception as e:
            logger.warning("[promote] could not retrieve subscription %s: %s", sub_id, e)
            return
        meta = (sub.get("metadata") or {}) if isinstance(sub, dict) else dict(sub.metadata or {})
        if meta.get("promote_kind") != "subscription":
            return
        maker_slug = meta.get("maker_slug", "")
        cents = int(meta.get("monthly_cents") or data.get("amount_paid") or 0)
        if maker_slug and cents > 0:
            await _wallet.credit(
                maker_slug, cents,
                kind="subscription",
                ref=invoice_id,
                idempotency_key=f"sub_invoice:{invoice_id}",
                note=f"Stripe subscription · ${cents/100:.2f}/mo",
            )
            # iter335.11 — Same auto-apply on monthly renewal so the
            # newly-credited funds boost listings immediately.
            try:
                camp = await db.campaign_groups.find_one({
                    "maker_slug": maker_slug,
                    "deleted_at": None, "status": "active",
                })
                if camp:
                    from services.promote_allocator import apply_allocations
                    await apply_allocations(
                        maker_slug, camp["campaign_id"],
                        int(camp.get("budget_cents") or 0),
                        explicit_listing_slugs=camp.get("explicit_listing_slugs") or None,
                    )
            except Exception as e:
                logger.exception("[promote] auto-apply on renewal failed: %s", e)

    elif etype == "customer.subscription.deleted":
        sub_id = data.get("id")
        meta = (data.get("metadata") or {})
        if meta.get("promote_kind") != "subscription":
            return
        maker_slug = meta.get("maker_slug", "")
        if maker_slug:
            await db.promotion_wallets.update_one(
                {"_id": maker_slug, "subscription.stripe_subscription_id": sub_id},
                {"$set": {
                    "subscription.status": "cancelled",
                    "subscription.cancelled_at": now_iso(),
                    "updated_at": now_iso(),
                }},
            )
