"""iter225 regression — clip orphan-guard hardening + R2 storage.

User-reported (2026-05-25 screenshot): the "Bandsaw Through Aluminum"
seed clip rendered as a black box on craftersmarket.org/clips. The DB
row had `file_verified: True` but the local MP4 file
(`/app/frontend/public/seed-clips/<slug>/clip.mp4`) had been wiped
during a pod restart — the static URL 404'd in production, the
`<video>` element fell back to its empty/black state, and the iter218
orphan-guard happily let the row through because `file_verified` was
still true on the now-stale row.

Fix invariants this suite locks:
  1. `_orphan_guard()` in routers/clips.py REQUIRES seed clips to have
     an `http(s)://` video_url. Local `/seed-clips/...` paths are out
     regardless of `file_verified`.
  2. `clip_seeder.generate_one_clip` writes R2 CDN URLs into `video_url`
     (so the file is reachable from any pod, not just the seeder's pod).
  3. `purge-orphans` deletes local-path seed rows even when verified.
"""
import asyncio
import os
import uuid

import pytest
import requests


API_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://active-project-4.preview.emergentagent.com"
API = f"{API_URL.rstrip('/')}/api"


def _admin_headers():
    from maker_auth import issue_session_jwt
    return {"Authorization": f"Bearer {issue_session_jwt('cm-admin', 'admin@craftersmarket.org', role='admin')}"}


# ─────────────────────────────────────────────────────────────────────
# Orphan-guard logic — pure mongo query shape, no I/O.
# ─────────────────────────────────────────────────────────────────────
def test_orphan_guard_rejects_local_path_even_when_verified():
    """The exact bug pattern: file_verified=True + /seed-clips/... URL.
    iter218 lets this through; iter225 must block it."""
    from routers.clips import _orphan_guard
    guard = _orphan_guard()
    # Hand-evaluate the $or — every branch must FAIL for our row to be
    # excluded from the feed.
    row = {
        "is_seed": True,
        "file_verified": True,
        "video_url": "/seed-clips/bandsaw-through-aluminum/clip.mp4",
    }
    matched_branch = None
    for branch in guard["$or"]:
        ok = True
        for k, expected in branch.items():
            val = row.get(k)
            if isinstance(expected, dict):
                if "$ne" in expected:
                    if val == expected["$ne"]:
                        ok = False; break
                elif "$regex" in expected:
                    import re
                    if not (isinstance(val, str) and re.match(expected["$regex"], val)):
                        ok = False; break
            else:
                if val != expected:
                    ok = False; break
        if ok:
            matched_branch = branch
            break
    assert matched_branch is None, (
        f"row matched orphan-guard branch {matched_branch} — should have been excluded. "
        f"Local-path seed clips must never clear the guard, even when file_verified=True."
    )


def test_orphan_guard_accepts_r2_https_seed():
    """The post-iter225 happy path: seed clip with an R2 https URL passes."""
    from routers.clips import _orphan_guard
    guard = _orphan_guard()
    row = {
        "is_seed": True,
        "file_verified": True,
        "video_url": "https://cdn.craftersmarket.org/seed-clips/bandsaw/clip.mp4",
    }
    matched = False
    for branch in guard["$or"]:
        ok = True
        for k, expected in branch.items():
            val = row.get(k)
            if isinstance(expected, dict):
                if "$ne" in expected and val == expected["$ne"]:
                    ok = False; break
                if "$regex" in expected:
                    import re
                    if not (isinstance(val, str) and re.match(expected["$regex"], val)):
                        ok = False; break
            else:
                if val != expected:
                    ok = False; break
        if ok:
            matched = True; break
    assert matched, "R2 https seed must pass the orphan-guard"


def test_orphan_guard_accepts_organic_maker_uploads():
    """Maker uploads (is_seed != True) are never gated regardless of URL."""
    from routers.clips import _orphan_guard
    guard = _orphan_guard()
    # Even a maker upload with a local path passes — they don't go
    # through the seed pipeline and their URLs are R2 by construction.
    row = {"is_seed": False, "video_url": "/whatever"}
    matched = False
    for branch in guard["$or"]:
        ok = True
        for k, expected in branch.items():
            val = row.get(k)
            if isinstance(expected, dict):
                if "$ne" in expected and val == expected["$ne"]:
                    ok = False; break
                if "$regex" in expected:
                    import re
                    if not (isinstance(val, str) and re.match(expected["$regex"], val)):
                        ok = False; break
            else:
                if val != expected:
                    ok = False; break
        if ok:
            matched = True; break
    assert matched


# ─────────────────────────────────────────────────────────────────────
# Live HTTP — orphan row hidden from public feed, purge cleans DB.
# ─────────────────────────────────────────────────────────────────────
def test_feed_excludes_local_path_orphan_after_seeding_one():
    """Insert a fake orphan row directly via Mongo, hit /api/clips/feed,
    confirm it never surfaces, then clean up."""
    from core import db
    fake_id = str(uuid.uuid4())
    fake_slug = f"iter225-test-orphan-{uuid.uuid4().hex[:8]}"
    asyncio.get_event_loop().run_until_complete(
        db.clips.insert_one({
            "id": fake_id,
            "slug": fake_slug,
            "maker_slug": None,
            "maker_name": "test",
            "title": "iter225 test orphan",
            "description": "",
            "category": "cuts",
            "tags": [],
            "video_url": f"/seed-clips/{fake_slug}/clip.mp4",
            "poster_url": None,
            "is_seed": True,
            "file_verified": True,  # the exact stale-flag bug pattern
            "quarantined_at": None,
            "created_at": "2030-01-01T00:00:00+00:00",  # future date so it sorts first
        })
    )
    try:
        r = requests.get(f"{API}/clips/feed?limit=40", timeout=15)
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        slugs = [i["slug"] for i in items]
        assert fake_slug not in slugs, (
            f"orphan row leaked into /clips/feed (slugs={slugs}) — "
            f"hardened _orphan_guard isn't filtering local-path seeds."
        )
    finally:
        asyncio.get_event_loop().run_until_complete(
            db.clips.delete_one({"id": fake_id})
        )


def test_purge_orphans_deletes_local_path_rows_even_verified():
    """The DB cleanup pair: even with file_verified=True, a local-path
    seed row must be purgeable via /admin/seed/clips/purge-orphans."""
    from core import db
    fake_id = str(uuid.uuid4())
    fake_slug = f"iter225-purge-{uuid.uuid4().hex[:8]}"
    asyncio.get_event_loop().run_until_complete(
        db.clips.insert_one({
            "id": fake_id,
            "slug": fake_slug,
            "title": "iter225 purge test",
            "video_url": f"/seed-clips/{fake_slug}/clip.mp4",
            "is_seed": True,
            "file_verified": True,
            "created_at": "2030-01-01T00:00:00+00:00",
        })
    )
    try:
        r = requests.post(
            f"{API}/admin/seed/clips/purge-orphans",
            headers=_admin_headers(),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert fake_slug in (body.get("slugs") or []), (
            f"purge-orphans missed our test row. slugs={body.get('slugs')}"
        )
    finally:
        # Best-effort cleanup if the purge missed it.
        asyncio.get_event_loop().run_until_complete(
            db.clips.delete_one({"id": fake_id})
        )


# ─────────────────────────────────────────────────────────────────────
# Seeder writes R2 URLs (not local paths).
# ─────────────────────────────────────────────────────────────────────
def test_clip_seeder_uses_r2_storage_module():
    """Pin the import + the deterministic R2 key shape so a future
    refactor can't silently revert to writing local paths into the DB."""
    src = open("/app/backend/clip_seeder.py").read()
    assert "import r2_storage" in src or "r2_storage" in src, "seeder must import r2_storage"
    assert "r2_storage.upload_bytes(" in src, "seeder must call upload_bytes"
    assert 'f"seed-clips/{slug}/clip.mp4"' in src, "deterministic R2 key shape changed"
    # The hard guarantee: video_url field is sourced from the upload return.
    assert "video_url\": public_video_url" in src, "video_url must come from R2 upload return"
