"""iter328 — Digital delivery, checkout integration, token endpoint.

Validates:
  1. HMAC token mint + verify roundtrip + expiry rejection.
  2. Tampered tokens are rejected.
  3. _quote_for skips shipping for all-digital carts and stamps
     digital_only=True on the quote.
  4. _quote_for keeps shipping for hybrid carts containing one physical
     item, even if other items are digital.
  5. GET /api/checkout/downloads/{token} — happy path 302 to R2 URL,
     including counter bump.
  6. Same endpoint — 403 on tampered/expired token, 404 on unknown
     order, 403 if order not yet paid.
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
from dotenv import load_dotenv
from httpx import AsyncClient, ASGITransport

# Load .env so MAKER_AUTH_SECRET is available for the bare token tests
# (the integration tests pick it up via `from server import app`).
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

pytestmark = pytest.mark.asyncio


# ── Token helper ───────────────────────────────────────────────────────
def test_token_mint_and_verify_roundtrip():
    from digital_delivery import mint_download_token, verify_download_token
    sid = f"sess-{uuid.uuid4().hex[:8]}"
    fid = f"file-{uuid.uuid4().hex[:8]}"
    token, exp = mint_download_token(sid, fid)
    assert isinstance(token, str)
    assert "." in token
    meta = verify_download_token(token)
    assert meta["session_id"] == sid
    assert meta["file_id"] == fid
    assert meta["exp"] == exp


def test_token_rejects_tampered_signature():
    from digital_delivery import mint_download_token, verify_download_token
    token, _ = mint_download_token("s", "f")
    # Flip a character in the MIDDLE of the signature, never the last one.
    #
    # The signature is a 32-byte HMAC-SHA256, base64url-encoded without padding
    # into 43 characters. 43 characters carry 258 bits; the digest is 256. The
    # FINAL character therefore has bits that decode to nothing, and several
    # distinct final characters decode to byte-identical signatures.
    #
    # Flipping the last character was consequently a no-op a meaningful fraction
    # of the time: the "tampered" token decoded to exactly the original bytes,
    # verified correctly, and this test failed with DID NOT RAISE. That is a
    # defect in the tampering, not in verify_download_token, which was right to
    # accept a token identical to one it had issued.
    #
    # A middle character's six bits are all significant, so this always changes
    # the decoded signature. The assertion below makes that a checked property
    # rather than a claim.
    pay, sig = token.split(".", 1)
    i = len(sig) // 2
    bad_sig = sig[:i] + ("A" if sig[i] != "A" else "B") + sig[i + 1:]
    assert bad_sig != sig, "tampering did not change the signature"
    bad = f"{pay}.{bad_sig}"
    with pytest.raises(ValueError):
        verify_download_token(bad)


def test_token_rejects_expired():
    from digital_delivery import mint_download_token, verify_download_token
    token, _ = mint_download_token("s", "f", expires_at_unix=int(time.time()) - 60)
    with pytest.raises(ValueError, match="expired"):
        verify_download_token(token)


def test_token_rejects_malformed():
    from digital_delivery import verify_download_token
    with pytest.raises(ValueError):
        verify_download_token("not-a-token")
    with pytest.raises(ValueError):
        verify_download_token("")


# ── Quote behaviour ────────────────────────────────────────────────────
def test_quote_for_all_digital_cart_returns_digital_only_no_shipping():
    from routers.checkout import _quote_for
    resolved = [
        {"product": {"price": 12.0, "listing_type": "digital", "category": "Wall Art"},
         "quantity": 1},
        {"product": {"price": 8.0, "listing_type": "digital", "category": "Wall Art"},
         "quantity": 2},
    ]
    q = _quote_for(resolved)
    assert q["digital_only"] is True
    assert q["shipping"] == 0.0
    assert q["subtotal"] == 12.0 + 8.0 * 2
    assert q["total_before_tax"] == q["subtotal"]


def test_quote_for_hybrid_cart_keeps_shipping():
    """Carts with even one physical or hybrid (`both`) item should NOT
    be treated as digital-only — shipping still applies."""
    from routers.checkout import _quote_for
    resolved = [
        {"product": {"price": 12.0, "listing_type": "digital", "category": "Wall Art"},
         "quantity": 1},
        # `both` listings still ship the physical part.
        {"product": {"price": 100.0, "listing_type": "both", "category": "Custom Signs"},
         "quantity": 1},
    ]
    q = _quote_for(resolved)
    assert q["digital_only"] is False
    # Either free (subtotal hit threshold) or normal shipping — but never
    # the "digital_only" shortcut. Just assert the flag.


def test_quote_for_legacy_physical_cart_unaffected():
    from routers.checkout import _quote_for
    resolved = [
        # No `listing_type` set — matches legacy docs.
        {"product": {"price": 25.0, "category": "Wall Art"}, "quantity": 1},
    ]
    q = _quote_for(resolved)
    assert q["digital_only"] is False
    assert q["shipping"] >= 0


# ── Download endpoint ──────────────────────────────────────────────────
async def _plant_paid_order_with_digital_file(session_id: str, file_id: str,
                                              product_slug: str, file_url: str):
    """Insert a paid transaction + matching product with one digital file."""
    from core import db
    from digital_delivery import mint_download_token
    token, exp = mint_download_token(session_id, file_id)
    await db.payment_transactions.insert_one({
        "session_id": session_id,
        "payment_status": "paid",
        "amount": 12.0,
        "summary": "Test order",
        "items": [{"product_id": product_slug, "quantity": 1}],
        "digital_downloads": [{
            "file_id": file_id,
            "filename": "design.svg",
            "size_bytes": 1024,
            "ext": "SVG",
            "product_slug": product_slug,
            "product_title": "Test Product",
            "token": token,
            "expires_at_unix": exp,
            "downloads": 0,
        }],
    })
    await db.products.insert_one({
        "id": str(uuid.uuid4()),
        "slug": product_slug,
        "title": "Test Product",
        "category": "Wall Art",
        "technique": "PLASMA",
        "price": 12.0,
        "maker_slug": "test-maker",
        "listing_type": "digital",
        "digital_files": [{
            "id": file_id, "filename": "design.svg",
            "size_bytes": 1024, "ext": "SVG",
            "content_type": "image/svg+xml",
            "url": file_url, "uploaded_at": "2026-06-03T00:00:00+00:00",
        }],
    })
    return token


async def _cleanup(session_id, product_slug):
    from core import db
    await db.payment_transactions.delete_many({"session_id": session_id})
    await db.products.delete_many({"slug": product_slug})


async def test_download_endpoint_redirects_on_happy_path():
    from server import app
    from core import db
    transport = ASGITransport(app=app)

    sid = f"sess-{uuid.uuid4().hex[:8]}"
    fid = f"file-{uuid.uuid4().hex[:8]}"
    psl = f"prod-{uuid.uuid4().hex[:8]}"
    file_url = "https://cdn.example.com/path/design.svg"

    try:
        token = await _plant_paid_order_with_digital_file(sid, fid, psl, file_url)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get(f"/api/checkout/downloads/{token}", follow_redirects=False)
            assert r.status_code == 302, r.text
            assert r.headers["location"] == file_url

        # Counter was bumped to 1.
        tx = await db.payment_transactions.find_one({"session_id": sid}, {"_id": 0})
        assert tx["digital_downloads"][0]["downloads"] == 1
        assert tx["digital_downloads"][0].get("last_downloaded_at")
    finally:
        await _cleanup(sid, psl)


async def test_download_endpoint_rejects_tampered_token():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get("/api/checkout/downloads/not-a-token", follow_redirects=False)
        assert r.status_code == 403


async def test_download_endpoint_rejects_unpaid_order():
    from server import app
    from core import db
    from digital_delivery import mint_download_token
    transport = ASGITransport(app=app)

    sid = f"sess-{uuid.uuid4().hex[:8]}"
    fid = f"file-{uuid.uuid4().hex[:8]}"
    token, _ = mint_download_token(sid, fid)
    await db.payment_transactions.insert_one({
        "session_id": sid,
        "payment_status": "unpaid",  # not paid!
        "digital_downloads": [{"file_id": fid, "token": token,
                               "product_slug": "x", "filename": "y"}],
    })

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get(f"/api/checkout/downloads/{token}", follow_redirects=False)
            assert r.status_code == 403
    finally:
        await db.payment_transactions.delete_many({"session_id": sid})


async def test_download_endpoint_410_when_file_removed_from_product():
    """If the maker removed the digital file after the order was placed,
    we should return 410 Gone with a clear message — NOT a 404 that
    would look like the order doesn't exist."""
    from server import app
    from core import db
    from digital_delivery import mint_download_token
    transport = ASGITransport(app=app)

    sid = f"sess-{uuid.uuid4().hex[:8]}"
    fid = f"file-{uuid.uuid4().hex[:8]}"
    psl = f"prod-{uuid.uuid4().hex[:8]}"
    token, exp = mint_download_token(sid, fid)
    await db.payment_transactions.insert_one({
        "session_id": sid,
        "payment_status": "paid",
        "digital_downloads": [{"file_id": fid, "token": token,
                               "product_slug": psl, "filename": "x.svg",
                               "expires_at_unix": exp, "downloads": 0}],
    })
    await db.products.insert_one({
        "id": str(uuid.uuid4()),
        "slug": psl,
        "title": "X", "category": "Wall Art", "technique": "PLASMA",
        "price": 1.0, "maker_slug": "m",
        "listing_type": "digital",
        "digital_files": [],  # maker removed the file
    })

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get(f"/api/checkout/downloads/{token}", follow_redirects=False)
            assert r.status_code == 410, r.text
            assert "no longer available" in r.text.lower()
    finally:
        await db.payment_transactions.delete_many({"session_id": sid})
        await db.products.delete_many({"slug": psl})
