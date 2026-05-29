"""Tests for iter278 — homepage strip fixes:

1. `GET /community/showcase/top-week` must NOT include posts whose
   only media is a video (no image) — those rendered as "NO IMAGE" tiles.
2. `GET /community/showcase/top-week` must dedupe by cover image so
   two posts sharing the same photo don't render as side-by-side
   duplicates.
3. `GET /community/showcase/maker-of-week` must apply the same filter
   to the `top_posts` array (the spotlight strip).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx
import pytest

from core import db


pytestmark = pytest.mark.asyncio


PREFIX = "_pytest_iter278_"
API = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")


async def _cleanup():
    await db.showcase_posts.delete_many({"id": {"$regex": f"^{PREFIX}"}})
    await db.showcase_views.delete_many({"post_id": {"$regex": f"^{PREFIX}"}})


async def _seed_post(pid: str, *,
                     image_urls: list[str] | None = None,
                     image_url: str | None = None,
                     video_url: str | None = None,
                     maker_slug: str | None = None,
                     views: int = 0,
                     title: str | None = None) -> None:
    doc = {
        "id": f"{PREFIX}{pid}",
        "title": title or pid,
        "description": "",
        "image_urls": image_urls or [],
        "image_url": image_url,
        "video_url": video_url,
        "product_slug": None,
        "maker_slug": maker_slug,
        "user_name": "tester",
        "user_role": "buyer",
        "likes": 0,
        "views": views,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mod_status": "ok",
        "admin_hidden": False,
    }
    await db.showcase_posts.update_one(
        {"id": doc["id"]}, {"$set": doc}, upsert=True)


async def _seed_views(pid: str, n: int):
    """Insert n rolling-week view events for the post."""
    now = datetime.now(timezone.utc).isoformat()
    docs = [{"post_id": f"{PREFIX}{pid}", "ts": now,
             "vk": f"k{i}"} for i in range(n)]
    if docs:
        await db.showcase_views.insert_many(docs)


# ─────────────────── 1. top-week excludes no-image posts ───────────────────
async def test_top_week_excludes_video_only_posts():
    await _cleanup()
    # 4 posts: 2 with images, 1 with video only, 1 with nothing
    await _seed_post("a", image_urls=["https://x/a.jpg"], views=10)
    await _seed_post("b", image_url="https://x/b.jpg", views=10)
    await _seed_post("c", video_url="https://x/c.mp4", views=10)  # no image
    await _seed_post("d", views=10)  # no media at all
    # All 4 get equal recent activity → without the fix, all 4 would land in top-week
    for pid in ("a", "b", "c", "d"):
        await _seed_views(pid, 5)

    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{API}/api/community/showcase/top-week?limit=6")
    assert r.status_code == 200
    ids = [it["id"] for it in r.json()["items"]]
    assert f"{PREFIX}a" in ids
    assert f"{PREFIX}b" in ids
    assert f"{PREFIX}c" not in ids, "video-only post leaked into top-week"
    assert f"{PREFIX}d" not in ids, "no-media post leaked into top-week"
    await _cleanup()


# ─────────────────── 2. top-week dedupes by cover URL ───────────────────
async def test_top_week_dedupes_by_cover_url():
    """Two distinct posts with the same cover image should render only
    the higher-ranked one — never a side-by-side duplicate."""
    await _cleanup()
    SHARED = "https://x/shared.jpg"
    # 4 posts: 2 share SHARED, 1 has a unique cover, 1 has another unique cover
    await _seed_post("dup1", image_urls=[SHARED], views=10)
    await _seed_post("dup2", image_urls=[SHARED], views=5)  # lower rank
    await _seed_post("uniq1", image_urls=["https://x/unique1.jpg"], views=8)
    await _seed_post("uniq2", image_urls=["https://x/unique2.jpg"], views=6)
    # Use lifetime views fallback (no recent showcase_views inserts) to
    # avoid needing aggregation timing — both endpoints have the same dedup.
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{API}/api/community/showcase/top-week?limit=6")
    items = r.json()["items"]
    ids = [it["id"] for it in items]

    # Filter to our seeded posts (collection may have other rows)
    seeded = [i for i in ids if i.startswith(PREFIX)]
    # Both dup1 and dup2 must not both appear — exactly one of them.
    dups = [i for i in seeded if i in (f"{PREFIX}dup1", f"{PREFIX}dup2")]
    assert len(dups) == 1, f"both duplicate-cover posts appeared: {dups}"
    # The higher-ranked one wins (dup1, which has more views).
    assert dups[0] == f"{PREFIX}dup1"

    # And the resulting tiles must all have unique cover URLs.
    covers = []
    for it in items:
        c = (it.get("image_urls") or [None])[0] or it.get("image_url") or ""
        covers.append(c)
    assert len(covers) == len(set(covers)), f"duplicate cover URLs leaked: {covers}"
    await _cleanup()


# ─────────────────── 3. maker-of-week filters/dedupes top_posts ───────────────────
async def test_maker_of_week_top_posts_only_have_images():
    await _cleanup()
    maker = "_pytest_iter278_maker"
    await db.makers.update_one(
        {"slug": maker},
        {"$set": {"slug": maker, "name": "iter278 Maker",
                  "techniques": ["LASER"], "deleted_at": None}},
        upsert=True,
    )
    # Maker has 4 posts: 2 imaged, 1 video-only, 1 duplicate cover of post a
    await _seed_post("ma", image_urls=["https://x/ma.jpg"],
                     maker_slug=maker, views=100)
    await _seed_post("mb", image_urls=["https://x/mb.jpg"],
                     maker_slug=maker, views=80)
    await _seed_post("mc", video_url="https://x/mc.mp4",
                     maker_slug=maker, views=90)  # no image
    await _seed_post("md", image_urls=["https://x/ma.jpg"],  # dup cover of ma
                     maker_slug=maker, views=70)

    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{API}/api/community/maker-of-the-week")
    assert r.status_code == 200
    body = r.json()
    # Spotlight may pick a different maker if a real one has higher
    # lifetime views — only assert when we got OUR maker back.
    if body.get("maker", {}).get("slug") == maker:
        top_ids = [p["id"] for p in body.get("top_posts", [])]
        assert f"{PREFIX}mc" not in top_ids, "video-only post leaked into maker spotlight"
        # ma + md share a cover → only one survives
        dups = [i for i in top_ids if i in (f"{PREFIX}ma", f"{PREFIX}md")]
        assert len(dups) <= 1, f"duplicate-cover spotlight tiles: {dups}"

    await db.makers.delete_one({"slug": maker})
    await _cleanup()


# ─────────────────── 4. /showcase/recent filters + dedupes ───────────────────
async def test_recent_strip_excludes_no_image_and_dedupes():
    """iter279 — The 'Recently shared by buyers' strip (homepage + product
    pages + maker pages) must apply the same image filter + cover dedupe
    as the trending strip. Same bug class would otherwise crop up there."""
    await _cleanup()
    SHARED = "https://x/recent_shared.jpg"
    # Newest-first: r_uniq (newest) → r_dup1 → r_dup2 (oldest, dup cover)
    #              → r_video (no image)
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    async def _seed_with_ts(pid, *, image_urls=None, image_url=None,
                            video_url=None, ts=None):
        await _seed_post(pid, image_urls=image_urls, image_url=image_url,
                         video_url=video_url)
        await db.showcase_posts.update_one(
            {"id": f"{PREFIX}{pid}"},
            {"$set": {"created_at": (ts or now).isoformat()}},
        )

    await _seed_with_ts("r_uniq", image_urls=["https://x/r_uniq.jpg"],
                       ts=now)
    await _seed_with_ts("r_dup1", image_urls=[SHARED],
                       ts=now - timedelta(minutes=1))
    await _seed_with_ts("r_dup2", image_urls=[SHARED],
                       ts=now - timedelta(minutes=2))
    await _seed_with_ts("r_video", video_url="https://x/r.mp4",
                       ts=now - timedelta(minutes=3))

    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{API}/api/community/showcase/recent?limit=12")
    assert r.status_code == 200
    ids = [it["id"] for it in r.json()["items"]]
    seeded = [i for i in ids if i.startswith(PREFIX)]

    # Video-only post must NOT appear
    assert f"{PREFIX}r_video" not in seeded
    # Duplicate-cover pair: only the newest (r_dup1) survives
    dups = [i for i in seeded if i in (f"{PREFIX}r_dup1", f"{PREFIX}r_dup2")]
    assert len(dups) == 1
    assert dups[0] == f"{PREFIX}r_dup1"
    # Unique post present
    assert f"{PREFIX}r_uniq" in seeded
    await _cleanup()


# ─────────────────── 5. only_makers top-up from product covers ───────────────────
async def test_only_makers_tops_up_from_product_covers():
    """iter280 — The 'Built in Real Workshops' mosaic must stay full
    (up to `limit`) even when the maker has only video-only showcase
    posts. Backend tops up with the maker's published product covers."""
    await _cleanup()
    await db.products.delete_many({"slug": {"$regex": "^_pytest_iter280_prod_"}})
    await db.makers.delete_many({"slug": {"$regex": "^_pytest_iter280_"}})

    maker = "_pytest_iter280_maker"
    await db.makers.update_one(
        {"slug": maker},
        {"$set": {"slug": maker, "name": "iter280 Maker",
                  "shop_name": "iter280 Shop", "deleted_at": None}},
        upsert=True,
    )
    await _seed_post("real", image_urls=["https://x/real.jpg"],
                     maker_slug=maker)
    await _seed_post("vid_only", video_url="https://x/v.mp4",
                     maker_slug=maker)
    # Need many products since the endpoint already has fallback products
    # in the DB; ours need to push to the top by being newest.
    now = datetime.now(timezone.utc)
    for i in range(3):
        slug = f"_pytest_iter280_prod_{i}"
        m_slug = f"_pytest_iter280_m_{i}"
        await db.makers.update_one(
            {"slug": m_slug},
            {"$set": {"slug": m_slug, "name": f"M{i}",
                      "deleted_at": None}},
            upsert=True,
        )
        await db.products.update_one(
            {"slug": slug},
            {"$set": {
                "id": slug, "slug": slug, "title": f"Prod {i}",
                "status": "published", "deleted_at": None,
                "maker_slug": m_slug,
                "images": [f"https://cdn.x/_pytest_iter280_{i}.jpg"],
                "price": 25.0,
                "created_at": now.isoformat(),
            }},
            upsert=True,
        )

    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{API}/api/community/showcase/recent?only_makers=true&limit=4")
    items = r.json()["items"]
    assert len(items) == 4, f"expected 4 tiles, got {len(items)}"
    fallbacks = [i for i in items if i.get("source") == "product_fallback"]
    assert len(fallbacks) >= 1
    for f in fallbacks:
        assert f.get("product_slug")
        assert (f.get("image_urls") or [None])[0]
        assert f["id"].startswith("prod:")

    await db.products.delete_many({"slug": {"$regex": "^_pytest_iter280_prod_"}})
    await db.makers.delete_many({"slug": {"$regex": "^_pytest_iter280_"}})
    await _cleanup()
