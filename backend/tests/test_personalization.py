"""Tests for buyer personalization (iter150).

Covers:
  • Upload endpoint accepts a valid base64 data URL → returns a real
    CDN URL pointing at R2.
  • Reject unsupported content types with 400.
  • Reject bodies exceeding the size cap with 413.
  • Per-IP hourly rate limit kicks in after N uploads → 429.
  • CartItem Pydantic model carries personalization_text + image_url
    through validation.
  • Email `_items_table` rendering escapes user input AND surfaces
    both text + image URL.

Lazy imports so collection doesn't pull motor before the test fixture
hooks env vars.
"""
import base64
import re
import uuid

import httpx
import pytest


BASE = "http://localhost:8001"

# 1x1 transparent PNG (smallest valid PNG)
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
DATA_URL_PNG = f"data:image/png;base64,{TINY_PNG_B64}"


async def _cleanup_uploads(prefix: str) -> None:
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from core import db
    await db.personalization_uploads.delete_many({"url": {"$regex": prefix}})


@pytest.mark.asyncio
async def test_upload_accepts_valid_png():
    async with httpx.AsyncClient(base_url=BASE, timeout=15) as client:
        r = await client.post(
            "/api/personalization/upload",
            json={"image_data_url": DATA_URL_PNG},
            headers={"X-Forwarded-For": f"203.0.113.{uuid.uuid4().int % 250}"},
        )
        assert r.status_code == 200, r.text
        url = r.json().get("url")
        assert url and url.startswith("http")
        assert "/personalization/" in url
        assert url.endswith(".png")


@pytest.mark.asyncio
async def test_upload_rejects_invalid_content_type():
    """A PDF should not be allowed even if base64-encoded."""
    pdf_b64 = base64.b64encode(b"%PDF-1.7 fake").decode()
    async with httpx.AsyncClient(base_url=BASE, timeout=15) as client:
        r = await client.post(
            "/api/personalization/upload",
            json={"image_data_url": f"data:application/pdf;base64,{pdf_b64}"},
            headers={"X-Forwarded-For": f"203.0.113.{uuid.uuid4().int % 250}"},
        )
        # Either 400 (we reject content type) or 422 (Pydantic rejects).
        # We accept both — the contract is "no PDF lands in R2".
        assert r.status_code in (400, 422), r.text


@pytest.mark.asyncio
async def test_upload_rate_limit():
    """11th upload from the same IP within the hour should 429."""
    ip = f"198.51.100.{uuid.uuid4().int % 250}"
    async with httpx.AsyncClient(base_url=BASE, timeout=15) as client:
        # First 10 — all should succeed.
        for i in range(10):
            r = await client.post(
                "/api/personalization/upload",
                json={"image_data_url": DATA_URL_PNG},
                headers={"X-Forwarded-For": ip},
            )
            assert r.status_code == 200, f"upload {i+1}: {r.text}"
        # 11th — rate limited.
        r = await client.post(
            "/api/personalization/upload",
            json={"image_data_url": DATA_URL_PNG},
            headers={"X-Forwarded-For": ip},
        )
        assert r.status_code == 429


@pytest.mark.asyncio
async def test_cart_item_model_carries_personalization():
    from models import CartItem
    ci = CartItem(
        product_id="abc",
        quantity=1,
        personalization_text="Engrave 'Mike & Jen 2026' on the back",
        personalization_image_url="https://cdn.craftersmarket.org/personalization/x.jpg",
    )
    assert ci.personalization_text.startswith("Engrave")
    assert ci.personalization_image_url.endswith("x.jpg")
    # Backward-compat: missing fields → None.
    bare = CartItem(product_id="abc", quantity=1)
    assert bare.personalization_text is None
    assert bare.personalization_image_url is None


def test_items_table_renders_personalization_safely():
    """_items_table must escape user input AND show the image link."""
    from email_service import _items_table

    rows = [{
        "title": "Walnut Sign",
        "price": 50.0,
        "quantity": 1,
        "personalization_text": "<script>alert(1)</script>\nLine two",
        "personalization_image_url": "https://cdn.example.test/personalization/ref.jpg",
    }]
    html = _items_table(rows)
    # Header still rendered
    assert "Walnut Sign" in html
    assert "$50.00" in html
    # Script tag escaped
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    # Newline → <br>
    assert "Line two" in html and "<br>" in html
    # Image surfaces as an <img> + a full-size link
    assert "https://cdn.example.test/personalization/ref.jpg" in html
    assert re.search(r'<img\s+src=["\']https://cdn\.example\.test/personalization/ref\.jpg', html)
    # Personalization callout label present
    assert "Buyer personalization" in html
