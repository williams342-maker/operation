"""Iter20 live integration probes — curl-style against REACT_APP_BACKEND_URL.

Tests:
  1. Banner upload: free-tier 403 (mentions 'Crafters Plus')
  2. Banner upload: bad content-type 400
  3. Banner upload: PNG works once subscription_status=active (verify R2 URL + Mongo)
  4. Customer portal: stripe_customer_id=null → 400 'Subscribe first'
  5. Customer portal: with stripe_customer_id present → returns billing.stripe.com URL
       (lenient: skip on 'configuration not found' if Stripe portal not configured)

Resets iron-and-oak at the end.
"""
import io
import os
import struct
import sys
import zlib

import requests
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
SLUG = "iron-and-oak"
EMAIL = "iron-and-oak@craftersmarket.org"

assert BASE_URL, "REACT_APP_BACKEND_URL must be set"


def make_tiny_png() -> bytes:
    """Minimal 1x1 transparent PNG."""
    sig = b"\x89PNG\r\n\x1a\n"
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    raw = b"\x00" + b"\x00\x00\x00\x00"
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def maker_jwt(email: str) -> str:
    from maker_auth import issue_magic_token
    tok = issue_magic_token(email)
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify", json={"token": tok}, timeout=20)
    r.raise_for_status()
    return r.json()["token"]


async def db_set(updates: dict):
    from core import db
    await db.makers.update_one({"slug": SLUG}, {"$set": updates})


async def db_unset(fields: dict):
    from core import db
    await db.makers.update_one({"slug": SLUG}, {"$unset": fields})


async def db_get():
    from core import db
    return await db.makers.find_one({"slug": SLUG}, {"_id": 0})


def main():
    import asyncio
    loop = asyncio.new_event_loop()

    results = []

    def log(name, ok, detail=""):
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {name} :: {detail}")
        results.append((name, ok, detail))

    # Get baseline state and reset to known starting state
    loop.run_until_complete(db_set({"subscription_status": "free"}))
    loop.run_until_complete(db_unset({"banner_image_url": "", "stripe_customer_id": ""}))

    jwt = maker_jwt(EMAIL)
    H = {"Authorization": f"Bearer {jwt}"}

    png = make_tiny_png()

    # === Test 1: Free-tier banner upload → 403 "Crafters Plus" ===
    r = requests.post(
        f"{BASE_URL}/api/maker/uploads/banner",
        files={"file": ("test.png", io.BytesIO(png), "image/png")},
        headers=H,
        timeout=20,
    )
    detail = f"status={r.status_code} body={r.text[:200]}"
    ok = r.status_code == 403 and "Crafters Plus" in r.text
    log("1. free-tier banner upload → 403 'Crafters Plus'", ok, detail)

    # === Flip to Plus ===
    loop.run_until_complete(db_set({"subscription_status": "active"}))

    # === Test 3 (out-of-order): bad content-type 400 ===
    r = requests.post(
        f"{BASE_URL}/api/maker/uploads/banner",
        files={"file": ("bad.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        headers=H,
        timeout=20,
    )
    detail = f"status={r.status_code} body={r.text[:200]}"
    ok = r.status_code == 400 and ("PNG" in r.text or "JPG" in r.text or "WebP" in r.text)
    log("3. bad content-type (pdf) → 400", ok, detail)

    # === Test 2: Plus tier — PNG upload works ===
    r = requests.post(
        f"{BASE_URL}/api/maker/uploads/banner",
        files={"file": ("ok.png", io.BytesIO(png), "image/png")},
        headers=H,
        timeout=30,
    )
    detail = f"status={r.status_code} body={r.text[:300]}"
    upload_ok = False
    banner_url = None
    if r.status_code == 200:
        body = r.json()
        banner_url = body.get("url")
        size_ok = body.get("size") == len(png)
        prefix_ok = banner_url and "r2.dev/banners/iron-and-oak/" in banner_url and banner_url.endswith(".png")
        # Verify Mongo persisted
        m = loop.run_until_complete(db_get())
        persisted = m.get("banner_image_url") == banner_url
        upload_ok = size_ok and prefix_ok and persisted
        detail += f" | size_ok={size_ok} prefix_ok={prefix_ok} persisted={persisted}"
    log("2. plus-tier PNG upload → 200 + R2 URL + Mongo persisted", upload_ok, detail)

    # === Test 4: Customer portal without stripe_customer_id → 400 ===
    loop.run_until_complete(db_unset({"stripe_customer_id": ""}))
    r = requests.post(f"{BASE_URL}/api/maker/subscription/portal", headers=H, timeout=20)
    detail = f"status={r.status_code} body={r.text[:200]}"
    ok = r.status_code == 400 and "Subscribe first" in r.text
    log("4. portal w/o stripe_customer_id → 400 'Subscribe first'", ok, detail)

    # === Test 5: Customer portal with valid stripe_customer_id ===
    # Create a real test customer via Stripe (cheaper than calling _ensure_stripe_customer
    # over HTTP). Use the live STRIPE_API_KEY from .env (test mode).
    portal_ok = False
    portal_detail = ""
    try:
        import stripe
        stripe.api_key = os.environ.get("STRIPE_API_KEY")
        cust = stripe.Customer.create(
            email=EMAIL, name="iron-and-oak (TEST)",
            metadata={"maker_slug": SLUG, "kind": "iter20_probe"},
        )
        loop.run_until_complete(db_set({"stripe_customer_id": cust.id}))

        r = requests.post(f"{BASE_URL}/api/maker/subscription/portal", headers=H, timeout=30)
        portal_detail = f"status={r.status_code} body={r.text[:300]}"
        if r.status_code == 200:
            url = r.json().get("url", "")
            portal_ok = url.startswith("https://billing.stripe.com/")
            portal_detail += f" | url_prefix_ok={portal_ok}"
            log("5. portal w/ stripe_customer_id → billing.stripe.com URL", portal_ok, portal_detail)
        elif r.status_code in (500, 400) and (
            "configuration" in r.text.lower() or "No configuration" in r.text
        ):
            log("5. portal Stripe portal-configuration not setup (lenient skip)", True, portal_detail)
            portal_ok = True
        else:
            log("5. portal w/ stripe_customer_id", False, portal_detail)

        # Cleanup the stripe customer we made
        try:
            stripe.Customer.delete(cust.id)
        except Exception:
            pass
    except Exception as e:
        log("5. portal stripe customer probe (exception)", False, repr(e))

    # === Cleanup: reset iron-and-oak ===
    loop.run_until_complete(db_set({
        "subscription_status": "free",
    }))
    loop.run_until_complete(db_unset({
        "banner_image_url": "",
        "stripe_customer_id": "",
    }))
    final = loop.run_until_complete(db_get())
    print("\n=== Final iron-and-oak state ===")
    print(f"  subscription_status={final.get('subscription_status')}")
    print(f"  banner_image_url={final.get('banner_image_url')}")
    print(f"  stripe_customer_id={final.get('stripe_customer_id')}")

    # Summary
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n=== {passed}/{total} live probes PASSED ===")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
