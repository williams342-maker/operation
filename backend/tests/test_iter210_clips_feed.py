"""
iter210 — Backend tests for the Clips feed (TikTok-style short-form).

Covers:
- GET /api/clips/categories (6 canonical + counts)
- GET /api/clips/feed (paging + invalid category 400)
- POST /api/clips/{id}/view, /share (anonymous counter bumps)
- POST /api/clips/{id}/like, /save (JWT-required toggles)
- GET /api/clips/me/saved (JWT)
- POST /api/maker/clips (maker JWT, dedupe + invalid category)
- GET /api/maker/clips/mine, DELETE /api/maker/clips/{id}
- GET /api/admin/seed/clips/status, POST /api/admin/seed/clips/purge

DOES NOT call POST /api/admin/seed/clips/generate-one (paid Sora 2).
"""
import os
import sys
import requests

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# ---------------------------------------------------------------------------
# Fixtures (token minting)
# ---------------------------------------------------------------------------
def _mint(kind: str, email: str) -> str:
    """Mint a magic-link token then exchange for a JWT."""
    from dotenv import load_dotenv; load_dotenv("/app/backend/.env")
    if kind == "admin":
        from maker_auth import issue_admin_magic_token
        tok = issue_admin_magic_token(email)
        r = requests.post(f"{API}/admin/auth/verify", json={"token": tok}, timeout=15)
    elif kind == "maker":
        from maker_auth import issue_magic_token
        tok = issue_magic_token(email)
        r = requests.post(f"{API}/maker/auth/verify", json={"token": tok}, timeout=15)
    else:
        from maker_auth import issue_buyer_magic_token
        tok = issue_buyer_magic_token(email)
        r = requests.post(
            f"{API}/community/auth/magic/verify",
            json={"token": tok, "accept_eua": True, "eua_version": "v1"},
            timeout=15,
        )
        if r.status_code == 400:
            # Try resolving the EUA version via /community/eua
            ev = requests.get(f"{API}/community/eua", timeout=10).json().get("version", "v1")
            r = requests.post(
                f"{API}/community/auth/magic/verify",
                json={"token": tok, "accept_eua": True, "eua_version": ev},
                timeout=15,
            )
    r.raise_for_status()
    return r.json()["token"]


ADMIN_JWT = _mint("admin", "team@craftersmarket.org")
MAKER_JWT = _mint("maker", "iron-and-oak@craftersmarket.org")
BUYER_JWT = _mint("buyer", "clip-iter210@example.com")

ADMIN_H = {"Authorization": f"Bearer {ADMIN_JWT}"}
MAKER_H = {"Authorization": f"Bearer {MAKER_JWT}"}
BUYER_H = {"Authorization": f"Bearer {BUYER_JWT}"}


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------
def test_categories_list_has_six_canonical():
    r = requests.get(f"{API}/clips/categories", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "categories" in data and "total" in data
    ids = [c["id"] for c in data["categories"]]
    # iter413as — clip categories expanded to 16 (added textiles, jewelry,
    # leather, pottery, glass, paper, candles, soap, etc.). Just verify
    # the six canonical ones still lead.
    canonical = ["workshop", "cuts", "welding", "powder-coat", "engraving", "before-after"]
    for cat in canonical:
        assert cat in ids, f"canonical category {cat} missing"
    for c in data["categories"]:
        assert "count" in c and isinstance(c["count"], int)
        assert "label" in c and "emoji" in c


# ---------------------------------------------------------------------------
# Feed paging + filtering
# ---------------------------------------------------------------------------
def test_feed_default_paginated():
    r = requests.get(f"{API}/clips/feed?limit=12", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data
    assert isinstance(data["items"], list)
    assert "next_cursor" in data


def test_feed_invalid_category_returns_400():
    r = requests.get(f"{API}/clips/feed?category=notarealthing", timeout=10)
    assert r.status_code == 400, r.text


def test_feed_valid_category_returns_200():
    for cat in ["workshop", "cuts", "welding", "powder-coat", "engraving", "before-after"]:
        r = requests.get(f"{API}/clips/feed?category={cat}", timeout=10)
        assert r.status_code == 200, f"{cat}: {r.text}"


# ---------------------------------------------------------------------------
# Maker creates a clip from URL (also seeds data for engagement tests)
# ---------------------------------------------------------------------------
_created_clip = {}

def test_maker_create_clip_from_youtube_url():
    payload = {
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "title": "TEST iter210 Clip Title",
        "description": "Auto-test clip",
        "category": "workshop",
        "tags": ["test", "iter210"],
    }
    r = requests.post(f"{API}/maker/clips", json=payload, headers=MAKER_H, timeout=15)
    # If dedupe says "already added" — clean up and retry
    if r.status_code == 409:
        # Delete existing clip with this slug then retry
        mine = requests.get(f"{API}/maker/clips/mine", headers=MAKER_H, timeout=10).json()
        for c in mine.get("items", []):
            if c.get("source_id") == "dQw4w9WgXcQ":
                requests.delete(f"{API}/maker/clips/{c['id']}", headers=MAKER_H, timeout=10)
        r = requests.post(f"{API}/maker/clips", json=payload, headers=MAKER_H, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    clip = body["clip"]
    assert clip["source_type"] == "youtube"
    assert clip["source_id"] == "dQw4w9WgXcQ"
    assert clip["category"] == "workshop"
    assert clip["maker_slug"] == "iron-and-oak"
    assert clip["likes"] == 0 and clip["saves"] == 0 and clip["views"] == 0
    assert "_id" not in clip
    _created_clip.update(clip)


def test_maker_create_clip_dedupe_409():
    payload = {
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "title": "Duplicate attempt",
        "category": "workshop",
    }
    r = requests.post(f"{API}/maker/clips", json=payload, headers=MAKER_H, timeout=15)
    assert r.status_code == 409, r.text


def test_maker_create_clip_invalid_category_422():
    payload = {
        "url": "https://www.youtube.com/watch?v=oHg5SJYRHA0",
        "title": "Bad cat",
        "category": "not-a-category",
    }
    r = requests.post(f"{API}/maker/clips", json=payload, headers=MAKER_H, timeout=15)
    assert r.status_code == 422, r.text


def test_maker_create_clip_invalid_url_422():
    payload = {
        "url": "https://example.com/not-a-video",
        "title": "Bad url",
        "category": "workshop",
    }
    r = requests.post(f"{API}/maker/clips", json=payload, headers=MAKER_H, timeout=15)
    assert r.status_code == 422, r.text


def test_maker_list_mine_includes_created():
    r = requests.get(f"{API}/maker/clips/mine", headers=MAKER_H, timeout=10)
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()["items"]]
    assert _created_clip["id"] in ids


# ---------------------------------------------------------------------------
# Engagement
# ---------------------------------------------------------------------------
def test_view_counter_anonymous():
    cid = _created_clip["id"]
    r = requests.post(f"{API}/clips/{cid}/view", timeout=10)
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_share_counter_anonymous():
    cid = _created_clip["id"]
    r = requests.post(f"{API}/clips/{cid}/share", timeout=10)
    assert r.status_code == 200


def test_view_invalid_clip_404():
    r = requests.post(f"{API}/clips/does-not-exist/view", timeout=10)
    assert r.status_code == 404


def test_like_requires_auth():
    cid = _created_clip["id"]
    r = requests.post(f"{API}/clips/{cid}/like", timeout=10)
    assert r.status_code in (401, 403)


def test_like_toggle_on_then_off():
    cid = _created_clip["id"]
    r1 = requests.post(f"{API}/clips/{cid}/like", headers=BUYER_H, timeout=10)
    assert r1.status_code == 200, r1.text
    b1 = r1.json()
    assert b1["ok"] is True and b1["on"] is True
    assert b1["count"] >= 1

    r2 = requests.post(f"{API}/clips/{cid}/like", headers=BUYER_H, timeout=10)
    b2 = r2.json()
    assert b2["on"] is False
    assert b2["count"] == b1["count"] - 1


def test_save_toggle_and_my_saved_list():
    cid = _created_clip["id"]
    r = requests.post(f"{API}/clips/{cid}/save", headers=BUYER_H, timeout=10)
    assert r.status_code == 200
    assert r.json()["on"] is True

    saved = requests.get(f"{API}/clips/me/saved", headers=BUYER_H, timeout=10)
    assert saved.status_code == 200
    ids = [c["id"] for c in saved.json()["items"]]
    assert cid in ids

    # Toggle off
    r2 = requests.post(f"{API}/clips/{cid}/save", headers=BUYER_H, timeout=10)
    assert r2.json()["on"] is False


def test_saved_requires_auth():
    r = requests.get(f"{API}/clips/me/saved", timeout=10)
    assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Admin seed status + purge
# ---------------------------------------------------------------------------
def test_admin_seed_status():
    r = requests.get(f"{API}/admin/seed/clips/status", headers=ADMIN_H, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    for key in ("seeded_clips", "ai_clips", "total_clips"):
        assert key in data
        assert isinstance(data[key], int)


def test_admin_seed_status_requires_admin():
    r = requests.get(f"{API}/admin/seed/clips/status", timeout=10)
    assert r.status_code in (401, 403)


def test_admin_seed_purge_only_purges_seeds():
    # Run purge — should NOT delete our maker-created clip (is_seed:false)
    r = requests.post(f"{API}/admin/seed/clips/purge", headers=ADMIN_H, timeout=15)
    assert r.status_code == 200, r.text
    # Our clip should still exist
    r2 = requests.get(f"{API}/maker/clips/mine", headers=MAKER_H, timeout=10)
    ids = [c["id"] for c in r2.json()["items"]]
    assert _created_clip["id"] in ids


# ---------------------------------------------------------------------------
# Cleanup: delete the test clip
# ---------------------------------------------------------------------------
def test_zz_maker_delete_clip():
    cid = _created_clip["id"]
    r = requests.delete(f"{API}/maker/clips/{cid}", headers=MAKER_H, timeout=10)
    assert r.status_code == 200
    # Verify removal
    r2 = requests.get(f"{API}/clips/{_created_clip['slug']}", timeout=10)
    assert r2.status_code == 404


def test_zz_maker_delete_not_yours_returns_404():
    r = requests.delete(f"{API}/maker/clips/does-not-exist", headers=MAKER_H, timeout=10)
    assert r.status_code == 404
