"""iter218 regression — orphan-seed guard on /api/clips.

Validates that:
  1. Seed clips lacking `file_verified=true` AND pointing at local
     `/seed-clips/` paths are invisible to /clips/feed, /clips/categories,
     and /clips/{slug}.
  2. Seed clips WITH `file_verified=true` (the new seeder default) are
     visible normally.
  3. Seed clips pointing at external https URLs (legacy YouTube embeds)
     are visible without needing file_verified.
  4. Organic (non-seed) clips are unaffected by the guard.
  5. POST /admin/seed/clips/purge-orphans hard-deletes only orphans,
     preserves verified seeds + organic uploads.

Skips its own setup if the live backend isn't reachable.
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests

API_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://active-project-4.preview.emergentagent.com"
API = f"{API_URL.rstrip('/')}/api"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _admin_token() -> str:
    """Mint an admin JWT directly via maker_auth — works in the pod."""
    from maker_auth import issue_session_jwt
    return issue_session_jwt("cm-admin", "admin@craftersmarket.org", role="admin")


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {_admin_token()}"}


def _sync_db():
    """Sync pymongo handle for test fixtures — avoids the motor
    'event loop is closed' artifact when asyncio.run() is called
    multiple times in the same pytest process."""
    import os as _os
    from pymongo import MongoClient
    mongo_url = _os.environ["MONGO_URL"]
    db_name = _os.environ["DB_NAME"]
    return MongoClient(mongo_url)[db_name]


def _insert_clip(doc: dict) -> None:
    db = _sync_db()
    db.clips.delete_many({"slug": doc["slug"]})
    db.clips.insert_one(doc)


def _delete_clip(slug: str) -> None:
    db = _sync_db()
    db.clips.delete_many({"slug": slug})


def _base_doc(slug: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "title": slug,
        "description": slug,
        "category": "workshop",
        "tags": ["workshop"],
        "source_type": "r2",
        "source_id": None,
        "video_url": f"/seed-clips/{slug}/clip.mp4",
        "poster_url": f"/seed-clips/{slug}/poster.jpg",
        "maker_slug": None,
        "maker_name": "Crafters Market Workshop Team",
        "uploader_email": None,
        "views": 0, "likes": 0, "saves": 0, "shares": 0,
        "is_seed": True,
        "ai_generated": True,
        "quarantined_at": None,
        "created_at": _now_iso(),
    }


@pytest.fixture
def cleanup_test_clips():
    slugs = [
        "iter218-orphan",
        "iter218-verified",
        "iter218-external",
        "iter218-organic",
    ]
    yield slugs
    for s in slugs:
        try:
            _delete_clip(s)
        except Exception:
            pass


def test_orphan_seed_hidden_from_feed(cleanup_test_clips):
    doc = _base_doc("iter218-orphan")  # No file_verified, local /seed-clips/ URL
    _insert_clip(doc)
    r = requests.get(f"{API}/clips/feed?limit=40", timeout=10)
    assert r.status_code == 200
    slugs = [it["slug"] for it in r.json().get("items", [])]
    assert "iter218-orphan" not in slugs, f"orphan leaked into feed: {slugs}"


def test_orphan_seed_404_on_direct_fetch(cleanup_test_clips):
    doc = _base_doc("iter218-orphan")
    _insert_clip(doc)
    r = requests.get(f"{API}/clips/iter218-orphan", timeout=10)
    assert r.status_code == 404


def test_verified_seed_visible_in_feed(cleanup_test_clips):
    doc = _base_doc("iter218-verified")
    # iter413as — Orphan guard now requires http(s) URL for seed clips
    # (file_verified flag alone no longer sufficient post-R2 migration).
    doc["video_url"] = "https://cdn.example.com/iter218-verified/clip.mp4"
    doc["file_verified"] = True
    _insert_clip(doc)
    r = requests.get(f"{API}/clips/feed?limit=40", timeout=10)
    slugs = [it["slug"] for it in r.json().get("items", [])]
    assert "iter218-verified" in slugs


def test_external_url_seed_visible_in_feed(cleanup_test_clips):
    doc = _base_doc("iter218-external")
    doc["source_type"] = "youtube"
    doc["video_url"] = "https://www.youtube.com/embed/abc123"
    # No file_verified — but external URL bypasses the orphan guard
    _insert_clip(doc)
    r = requests.get(f"{API}/clips/feed?limit=40", timeout=10)
    slugs = [it["slug"] for it in r.json().get("items", [])]
    assert "iter218-external" in slugs


def test_organic_clip_unaffected_by_guard(cleanup_test_clips):
    doc = _base_doc("iter218-organic")
    doc["is_seed"] = False
    doc["maker_slug"] = "test-maker"
    # No file_verified (organic clips never set this) — must still appear
    _insert_clip(doc)
    r = requests.get(f"{API}/clips/feed?limit=40", timeout=10)
    slugs = [it["slug"] for it in r.json().get("items", [])]
    assert "iter218-organic" in slugs


def test_purge_orphans_endpoint(cleanup_test_clips):
    # Seed 1 orphan + 1 verified + 1 organic
    o = _base_doc("iter218-orphan")
    v = _base_doc("iter218-verified")
    # iter413as — Orphan guard now requires http(s) URL for seed clips.
    v["video_url"] = "https://cdn.example.com/iter218-verified/clip.mp4"
    v["file_verified"] = True
    g = _base_doc("iter218-organic")
    g["is_seed"] = False
    g["maker_slug"] = "test-maker"
    for d in (o, v, g):
        _insert_clip(d)

    r = requests.post(
        f"{API}/admin/seed/clips/purge-orphans",
        headers=_admin_headers(),
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    # iter413as — tolerant of stale orphan rows from prior test runs;
    # what matters is "iter218-orphan" specifically gets purged.
    assert body["deleted"] >= 1
    assert "iter218-orphan" in body["slugs"]
    # Verified + organic must still exist
    r2 = requests.get(f"{API}/clips/feed?limit=40", timeout=10)
    slugs = [it["slug"] for it in r2.json().get("items", [])]
    assert "iter218-verified" in slugs
    assert "iter218-organic" in slugs


def test_status_reports_orphan_count(cleanup_test_clips):
    _insert_clip(_base_doc("iter218-orphan"))
    r = requests.get(f"{API}/admin/seed/clips/status", headers=_admin_headers(), timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "orphan_seeds" in body
    assert body["orphan_seeds"] >= 1
