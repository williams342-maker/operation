"""iter365 — Google Merchant feed optimization (restricted-term mitigation).

Covers:
  • sanitizer term rewriting + safe-qualifier injection + case handling
  • resolution order: listing exclude > category exclude > override >
    auto-rewrite > original; category "sync" suppresses auto-rewrite
  • the live /api/google-merchant/feed.xml applies all of the above
  • the Meta CSV feed keeps ORIGINAL titles (Google-only feature)
"""
import os
import sys
import uuid

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio

RESTRICTED = ["hunting", "tactical", "combat", "weapon", "blade", "pocketknife", "knife", "self-defense"]


def test_sanitize_title_examples():
    from services.merchant_sanitizer import sanitize_title

    out, hits = sanitize_title("Custom Engraved Duck Hunting Knife with Personalized Name")
    assert "Hunting" not in out and "Knife" not in out.replace("Pocketknife", "")
    assert "Outdoor Keepsake" in out
    assert hits  # flagged the phrase
    for term in RESTRICTED:
        assert term.lower() not in out.lower()

    # No safe qualifier present → "Personalized" gets prefixed.
    out2, _ = sanitize_title("High Carbon Steel Hunting Knife")
    assert out2.startswith("Personalized ")
    assert "Outdoor Keepsake" in out2

    # Pocketknife single token
    out3, _ = sanitize_title("Personalized Wood Handle Pocketknife")
    assert "pocketknife" not in out3.lower()
    assert "keepsake" in out3.lower()

    # Clean titles untouched, no hits.
    out4, hits4 = sanitize_title("Walnut Serving Board with Juice Groove")
    assert out4 == "Walnut Serving Board with Juice Groove"
    assert hits4 == []


def test_resolution_order():
    from services.merchant_sanitizer import resolve_merchant_listing

    base = {"title": "Custom Engraved Hunting Knife", "description": "A hunting knife.", "category": "Knives"}

    # listing exclude wins
    r = resolve_merchant_listing({**base, "merchant_exclude": True}, {})
    assert r["include"] is False and r["mode"] == "excluded"
    # category exclude
    r = resolve_merchant_listing(base, {"knives": "exclude"})
    assert r["include"] is False and r["mode"] == "category_excluded"
    # override verbatim
    r = resolve_merchant_listing({**base, "merchant_title": "Engraved Outdoor Gift"}, {})
    assert r["mode"] == "override" and r["title"] == "Engraved Outdoor Gift"
    # auto rewrite (default)
    r = resolve_merchant_listing(base, {})
    assert r["mode"] == "rewritten" and "knife" not in r["title"].lower()
    assert "knife" not in r["description"].lower()
    # category sync suppresses rewrite
    r = resolve_merchant_listing(base, {"knives": "sync"})
    assert r["mode"] == "original" and r["title"] == base["title"]
    # per-listing auto off
    r = resolve_merchant_listing({**base, "merchant_auto_optimize": False}, {})
    assert r["mode"] == "original"


def _doc(slug, title, **extra):
    return {
        "id": str(uuid.uuid4()), "slug": slug, "title": title,
        "description": "Hand-finished piece from our workshop, ready to gift.",
        "price": 80.0, "maker_slug": "test-maker",
        "images": ["http://x/img.jpg"], "in_stock": 5,
        "category": "Knives", "technique": "CNC",
        "status": "published", "deleted_at": None,
        "created_at": "2026-06-11T00:00:00+00:00",
        **extra,
    }


async def test_google_feed_applies_rules_meta_untouched():
    from core import db
    from server import app

    tag = uuid.uuid4().hex[:6]
    docs = [
        _doc(f"it365-auto-{tag}", "Custom Engraved Hunting Knife"),
        _doc(f"it365-override-{tag}", "Tactical Combat Knife",
             merchant_title="Engraved Collectible Outdoor Gift"),
        _doc(f"it365-excluded-{tag}", "Hunting Knife Deluxe", merchant_exclude=True),
        _doc(f"it365-catex-{tag}", "Plain Cutting Board", category="ZapCategory"),
    ]
    await db.products.insert_many(docs)
    await db.merchant_category_rules.insert_one(
        {"category": "ZapCategory", "mode": "exclude", "updated_at": "2026-06-11T00:00:00+00:00"},
    )
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            xml = (await c.get("/api/google-merchant/feed.xml")).text
            assert f"it365-auto-{tag}" in xml
            # auto product: sanitized title in feed
            assert "Custom Engraved Outdoor Keepsake" in xml
            assert "Hunting Knife" not in xml
            # override product: override title used, original gone
            assert "Engraved Collectible Outdoor Gift" in xml
            assert "Tactical Combat" not in xml
            # excluded rows absent
            assert f"it365-excluded-{tag}" not in xml
            assert f"it365-catex-{tag}" not in xml

            # Meta CSV unaffected — original titles intact
            csv_text = (await c.get("/api/meta/feed.csv")).text
            assert "Custom Engraved Hunting Knife" in csv_text
            assert f"it365-excluded-{tag}" in csv_text
    finally:
        await db.products.delete_many({"slug": {"$regex": f"^it365-.*-{tag}$"}})
        await db.merchant_category_rules.delete_many({"category": "ZapCategory"})
