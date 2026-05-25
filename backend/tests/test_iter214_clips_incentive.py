"""iter214 — Founding-50 Featured Clip incentive backend tests.

Covers /api/clips/incentive-status, featured flag auto-attached to
the first 50 organic clips (URL path), and the cap behavior.
"""
import os, sys, uuid
import asyncio
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

from maker_auth import issue_session_jwt
from core import db


def _mk_jwt(slug="iron-and-oak", email="iron-and-oak@craftersmarket.org"):
    return issue_session_jwt(slug, email, role="maker")


@pytest.fixture
def maker_headers():
    return {"Authorization": f"Bearer {_mk_jwt()}"}


@pytest.fixture
def loop():
    return asyncio.get_event_loop_policy().get_event_loop()


# ─── /api/clips/incentive-status structure ────────────────────────────────
def test_incentive_status_shape():
    r = requests.get(f"{API}/clips/incentive-status", timeout=10)
    assert r.status_code == 200
    d = r.json()
    for k in ("slots_total", "slots_used", "slots_remaining", "organic_clips_total", "claimed"):
        assert k in d, f"missing key {k}"
    assert d["slots_total"] == 50
    assert d["slots_remaining"] == max(0, 50 - d["slots_used"])
    assert isinstance(d["claimed"], bool)


def test_incentive_status_public_no_auth():
    # No Authorization header — should still 200
    r = requests.get(f"{API}/clips/incentive-status", timeout=10)
    assert r.status_code == 200


# ─── First organic clip earns featured=true ────────────────────────────────
def test_first_organic_clip_gets_featured(maker_headers, loop):
    pre = requests.get(f"{API}/clips/incentive-status").json()
    if pre["claimed"]:
        pytest.skip("All 50 slots claimed; skip url path featured-true test")

    # Use a unique YouTube URL to avoid dedupe collision.
    vid = "dQw4w9Wg" + uuid.uuid4().hex[:3]  # 11-char fake
    payload = {
        "url": f"https://www.youtube.com/watch?v={vid}",
        "title": f"TEST_iter214_{uuid.uuid4().hex[:6]}",
        "description": "TEST_iter214 featured slot",
        "category": "workshop",
        "tags": ["test"],
    }
    r = requests.post(f"{API}/maker/clips", json=payload, headers=maker_headers, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["featured"] is True
    assert data["clip"]["featured"] is True
    assert data["clip"]["is_seed"] is False
    clip_id = data["clip"]["id"]

    # Verify persistence via direct DB read
    doc = loop.run_until_complete(db.clips.find_one({"id": clip_id}, {"_id": 0}))
    assert doc["featured"] is True
    assert doc["is_seed"] is False

    # Verify status flipped (slots_used incremented)
    post = requests.get(f"{API}/clips/incentive-status").json()
    assert post["slots_used"] == pre["slots_used"] + 1
    assert post["slots_remaining"] == pre["slots_remaining"] - 1

    # Cleanup
    delr = requests.delete(f"{API}/maker/clips/{clip_id}", headers=maker_headers)
    assert delr.status_code == 200


# ─── Seeded clips don't count + don't auto-get featured ────────────────────
def test_seeded_clips_excluded_from_cap(loop):
    """Insert a fake seeded clip with is_seed:true. Verify
    incentive-status doesn't budge."""
    pre = requests.get(f"{API}/clips/incentive-status").json()
    seed_id = f"TEST_seed_{uuid.uuid4().hex[:8]}"
    doc = {
        "id": seed_id,
        "slug": seed_id,
        "is_seed": True,
        "featured": False,
        "quarantined_at": None,
        "category": "workshop",
        "created_at": "2026-01-01T00:00:00Z",
        "video_url": "https://example.com/x.mp4",
        "source_type": "r2",
        "maker_name": "TEST",
        "title": "TEST seed",
        "description": "",
        "views": 0, "likes": 0, "saves": 0, "shares": 0,
    }
    try:
        loop.run_until_complete(db.clips.insert_one(doc))
        post = requests.get(f"{API}/clips/incentive-status").json()
        # organic count unchanged (seed excluded)
        assert post["organic_clips_total"] == pre["organic_clips_total"]
        assert post["slots_used"] == pre["slots_used"]
    finally:
        loop.run_until_complete(db.clips.delete_one({"id": seed_id}))


# ─── 51st organic upload returns featured=false ─────────────────────────────
def test_cap_at_50_then_51st_gets_false(maker_headers, loop):
    """Pad organic featured count up to 50 with synthetic rows, then
    submit one more via the URL path. Expected: featured=false +
    claimed=true on status."""
    pre = requests.get(f"{API}/clips/incentive-status").json()
    deficit = max(0, 50 - pre["slots_used"])
    pad_ids = []

    try:
        if deficit > 0:
            pad_docs = []
            for _ in range(deficit):
                pid = f"TEST_pad_{uuid.uuid4().hex[:10]}"
                pad_ids.append(pid)
                pad_docs.append({
                    "id": pid,
                    "slug": pid,
                    "is_seed": False,
                    "featured": True,
                    "quarantined_at": None,
                    "category": "workshop",
                    "created_at": "2026-01-01T00:00:00Z",
                    "video_url": "https://example.com/x.mp4",
                    "source_type": "r2",
                    "maker_name": "TEST",
                    "title": "TEST pad",
                    "description": "",
                    "views": 0, "likes": 0, "saves": 0, "shares": 0,
                })
            loop.run_until_complete(db.clips.insert_many(pad_docs))

        status = requests.get(f"{API}/clips/incentive-status").json()
        assert status["claimed"] is True, status
        assert status["slots_remaining"] == 0

        # Now the 51st upload should NOT get featured.
        vid = uuid.uuid4().hex[:11]
        payload = {
            "url": f"https://www.youtube.com/watch?v={vid}",
            "title": f"TEST_iter214_51st_{uuid.uuid4().hex[:6]}",
            "category": "workshop",
        }
        r = requests.post(f"{API}/maker/clips", json=payload, headers=maker_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["featured"] is False, data
        assert data["clip"]["featured"] is False
        clip_id = data["clip"]["id"]

        doc = loop.run_until_complete(db.clips.find_one({"id": clip_id}, {"_id": 0}))
        assert doc["featured"] is False

        requests.delete(f"{API}/maker/clips/{clip_id}", headers=maker_headers)
    finally:
        if pad_ids:
            loop.run_until_complete(db.clips.delete_many({"id": {"$in": pad_ids}}))


# ─── Regression: feed chronological + pagination still works ───────────────
def test_feed_still_chronological():
    r = requests.get(f"{API}/clips/feed?limit=5", timeout=10)
    assert r.status_code == 200
    items = r.json().get("items", [])
    # sorted by created_at DESC
    for i in range(len(items) - 1):
        assert items[i]["created_at"] >= items[i + 1]["created_at"]


def test_categories_endpoint_still_works():
    r = requests.get(f"{API}/clips/categories", timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert "categories" in d
    assert len(d["categories"]) == 6
