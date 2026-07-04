"""iter421 — Maker Health Score contract tests."""
from __future__ import annotations

import os, sys, pytest
from datetime import datetime, timezone, timedelta

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db  # noqa: E402
from maker_auth import issue_admin_magic_token  # noqa: E402
from routers.admin_founders_review import _compute_health_score  # noqa: E402


pytestmark = pytest.mark.asyncio


def _iso_days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)) \
        .replace(microsecond=0).isoformat().replace("+00:00", "Z")


async def _jwt(c):
    magic = issue_admin_magic_token(os.environ.get("OPS_EMAIL"))
    r = await c.post("/api/admin/auth/verify", json={"token": magic})
    return r.json()["token"]


async def _c():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ---- Unit tests for the pure score function ----
def test_perfect_maker_scores_5_stars():
    maker = {
        "shop_title": "The Great Studio",
        "bio": "A" * 60,
        "cover": "https://cdn/cover.jpg",
        "portrait": "https://cdn/p.jpg",
        "techniques": ["ROUTER"],
        "location": "Austin, TX",
        "social_instagram": "https://ig.com/x",
        "website_url": "https://x.com",
        "machinery": ["Shopbot"],
        "shop_announcement": "Sale!",
        "response_time_hours": 4,
    }
    h = _compute_health_score(
        maker=maker,
        last_login=_iso_days_ago(1),        # 20
        published_products=15,                # 20
        last_product_update=_iso_days_ago(2), # 10
        sales_count=25,
        sales_30d=8,                          # 15
        views_7d=200,                         # 10
    )
    assert h["stars"] == 5
    assert h["verdict"] == "Excellent"
    assert h["score"] == 100
    assert h["completeness_pct"] == 100


def test_dormant_maker_scores_1_star():
    maker = {"shop_title": "", "bio": "", "cover": None, "portrait": None,
             "techniques": [], "location": "", "website_url": "",
             "machinery": [], "shop_announcement": ""}
    h = _compute_health_score(
        maker=maker,
        last_login=None,
        published_products=0,
        last_product_update=None,
        sales_count=0,
        sales_30d=0,
        views_7d=0,
    )
    assert h["stars"] == 1
    assert h["verdict"] == "Dormant"
    assert h["score"] < 40


def test_needs_attention_band():
    """A maker with only listings and half the profile scores 25 —> 1 star."""
    maker = {"shop_title": "X", "bio": "A" * 40, "cover": "u", "portrait": None,
             "techniques": ["ROUTER"], "location": "TX"}
    h = _compute_health_score(
        maker=maker,
        last_login=_iso_days_ago(45),   # 10
        published_products=3,             # 10
        last_product_update=None,
        sales_count=0, sales_30d=0, views_7d=0,
    )
    # 10 + 10 + 0 + 0 + 0 + 2+2+2+0+1+1+0+0+0+0=8 completeness + 0 rt = 28
    assert 20 <= h["score"] <= 40
    assert h["stars"] == 1
    assert h["breakdown"]["login"] == 10
    assert h["breakdown"]["listings"] == 10


def test_completeness_breakdown_records_missing_fields():
    maker = {"shop_title": "X", "bio": "A" * 40, "cover": None, "portrait": "u",
             "techniques": ["R"], "location": "TX",
             "social_facebook": "https://fb.com/x",
             "website_url": "https://x.com", "machinery": ["M"],
             "shop_announcement": ""}
    h = _compute_health_score(
        maker=maker, last_login=None, published_products=0,
        last_product_update=None, sales_count=0, sales_30d=0, views_7d=0,
    )
    d = h["completeness_detail"]
    assert d["cover_image"] is False
    assert d["shop_announcement"] is False
    assert d["portrait_image"] is True
    assert d["website_url"] is True


# ---- Integration: verify review endpoint returns health ----
async def test_review_endpoint_includes_health():
    async with await _c() as c:
        jwt = await _jwt(c)
        r = await c.get(
            "/api/admin/founders/review",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert rows, "no founders present in preview to test against"
        for row in rows[:3]:
            assert "health" in row
            h = row["health"]
            assert set(h.keys()) >= {"score", "stars", "verdict", "breakdown", "completeness_pct"}
            assert 1 <= h["stars"] <= 5
            assert 0 <= h["score"] <= 100
