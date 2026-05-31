"""
iter313 — Showcase + Design-files external distribution feeds.

Adds two new feed families to the existing EnrichLabs read-only API
so partners can ingest community content the same way they already
ingest the product catalog:

  /api/enrich/v1/showcase/feed.{json,csv}        — finished-piece photos
  /api/enrich/v1/design-files/feed.{json,csv}    — free SVG/DXF designs

Same auth header (X-EnrichLabs-Key), same 3-column shape
(item_name · image_url · permalink) so partner parsers can be reused.
Same admin-proxy variants under /api/admin/integrations/enrichlabs/...
"""
import asyncio
import os
import sys
import uuid

import requests

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


def _enrich_key() -> str:
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    return (os.environ.get("ENRICHLABS_API_KEY") or "").strip()


KEY = _enrich_key()
H = {"X-EnrichLabs-Key": KEY}


def _admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{API}/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


ADMIN_H = {"Authorization": f"Bearer {_admin_jwt()}"}


# ─── /showcase/feed.json ─────────────────────────────────────────────

def test_showcase_feed_returns_array_with_required_shape():
    r = requests.get(f"{API}/enrich/v1/showcase/feed.json?limit=5", headers=H, timeout=10)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list)
    for row in rows:
        assert set(row.keys()) == {"item_name", "image_url", "permalink"}
        assert row["image_url"].startswith("http")
        assert "/community/showcase/" in row["permalink"]


def test_showcase_feed_csv_is_rfc4180_with_header():
    r = requests.get(f"{API}/enrich/v1/showcase/feed.csv?limit=3", headers=H, timeout=10)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers.get("content-disposition", "").lower()
    lines = r.text.strip().splitlines()
    assert lines[0] == "item_name,image_url,permalink"


def test_showcase_feed_requires_api_key():
    r = requests.get(f"{API}/enrich/v1/showcase/feed.json", timeout=10)
    assert r.status_code in (401, 503)


# ─── /design-files/feed.json ─────────────────────────────────────────

def test_design_files_feed_returns_array_with_required_shape():
    r = requests.get(f"{API}/enrich/v1/design-files/feed.json?limit=5", headers=H, timeout=10)
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    for row in rows:
        assert set(row.keys()) == {"item_name", "image_url", "permalink"}
        # Design files all funnel to the lead-magnet landing page
        assert row["permalink"].startswith("https://craftersmarket.org/free-svg-pack")
        # UTM tagging preserved for partner attribution
        assert "utm_source=enrichlabs" in row["permalink"]


def test_design_files_feed_csv_attaches():
    r = requests.get(f"{API}/enrich/v1/design-files/feed.csv?limit=2", headers=H, timeout=10)
    assert r.status_code == 200
    assert "crafters_design_files_feed_" in r.headers.get("content-disposition", "")
    assert r.text.startswith("item_name,image_url,permalink\n")


# ─── opt-out wiring ──────────────────────────────────────────────────

def test_external_ads_opt_out_excludes_maker_from_both_feeds():
    """A maker who sets external_ads_opt_out=True is excluded from
    BOTH the showcase feed and the design-files feed (and also from
    the products feed — the toggle has one consistent meaning)."""
    from core import db, now_iso

    slug = f"optout-iter313-{uuid.uuid4().hex[:8]}"
    showcase_id = f"sc-iter313-{uuid.uuid4().hex[:8]}"
    df_id = f"df-iter313-{uuid.uuid4().hex[:8]}"

    async def setup():
        await db.makers.insert_one({
            "slug": slug, "name": "Opt-out Tester",
            "external_ads_opt_out": True,
            "deleted_at": None, "created_at": now_iso(),
        })
        await db.showcase_posts.insert_one({
            "id": showcase_id, "title": "should-be-hidden",
            "image_url": "https://example.com/hide-me.jpg",
            "maker_slug": slug, "admin_hidden": False,
            "created_at": now_iso(),
        })
        await db.design_files.insert_one({
            "id": df_id, "title": "should-be-hidden",
            "thumbnail_url": "https://example.com/hide-me-df.jpg",
            "maker_slug": slug, "created_at": now_iso(),
        })

    async def teardown():
        await db.makers.delete_one({"slug": slug})
        await db.showcase_posts.delete_one({"id": showcase_id})
        await db.design_files.delete_one({"id": df_id})

    loop = asyncio.get_event_loop()
    loop.run_until_complete(setup())
    try:
        r1 = requests.get(f"{API}/enrich/v1/showcase/feed.json?limit=500", headers=H, timeout=10)
        r2 = requests.get(f"{API}/enrich/v1/design-files/feed.json?limit=500", headers=H, timeout=10)
        assert r1.status_code == 200 and r2.status_code == 200
        # The opted-out maker's items must not surface
        for row in r1.json():
            assert "should-be-hidden" not in row["item_name"]
        for row in r2.json():
            assert "should-be-hidden" not in row["item_name"]
    finally:
        loop.run_until_complete(teardown())


# ─── /schema documents the new endpoints ─────────────────────────────

def test_schema_includes_new_feed_endpoints():
    r = requests.get(f"{API}/enrich/v1/schema", headers=H, timeout=10)
    assert r.status_code == 200
    paths = [e["path"] for e in r.json()["endpoints"]]
    for p in ("/showcase/feed.json", "/showcase/feed.csv",
             "/design-files/feed.json", "/design-files/feed.csv"):
        assert p in paths, f"Schema missing {p}"


# ─── admin-proxy variants (no static key, admin JWT) ────────────────

def test_admin_proxy_showcase_feed():
    r = requests.get(
        f"{API}/admin/integrations/enrichlabs/showcase/feed.json?limit=3",
        headers=ADMIN_H, timeout=10,
    )
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_admin_proxy_design_files_feed_csv():
    r = requests.get(
        f"{API}/admin/integrations/enrichlabs/design-files/feed.csv?limit=3",
        headers=ADMIN_H, timeout=10,
    )
    assert r.status_code == 200
    assert r.text.startswith("item_name,image_url,permalink\n")
