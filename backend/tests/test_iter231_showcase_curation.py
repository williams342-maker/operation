"""iter231 regression — admin showcase curation (pin / hide / reorder / shuffle).

Locks the public-feed ordering contract + the 4 admin curation
endpoints. If a future refactor breaks the pin-first-then-sort-order
sort or drops the admin_hidden filter, the public showcase silently
reverts to created_at-only sorting (i.e. iter231 disappears).
"""
import asyncio
import os

import pytest
import requests


API_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://active-project-4.preview.emergentagent.com"
API = f"{API_URL.rstrip('/')}/api"


def _admin_headers():
    from maker_auth import issue_session_jwt
    return {"Authorization": f"Bearer {issue_session_jwt('cm-admin', 'admin@craftersmarket.org', role='admin')}"}


@pytest.fixture(scope="module", autouse=True)
def _ensure_seed_post():
    """iter413ap — Ensure at least one showcase post exists before
    iter231 runs. The iter116_recent_showcase test's _wipe() clears
    the showcase_posts collection (necessary for its own tier
    assertions), so when iter231 runs after iter116 in the smoke
    suite the admin_list comes back empty and every test below
    skips/fails. We upsert a single minimal post here; it doesn't
    affect iter116 because iter116 wipes first."""
    import asyncio
    import sys
    sys.path.insert(0, "/app/backend")
    from core import db
    from datetime import datetime, timezone

    async def _seed():
        count = await db.showcase_posts.count_documents({})
        if count == 0:
            await db.showcase_posts.insert_one({
                "id": "iter231-seed",
                "title": "Curation Smoke Seed",
                "body": "Seed post for iter231 curation tests.",
                "kind": "sitewide",
                "admin_pinned": False,
                "admin_hidden": False,
                "admin_sort_order": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

    try:
        asyncio.run(_seed())
    except Exception:
        pass
    yield


@pytest.fixture(scope="module")
def admin_list():
    """Pull the current admin showcase list once."""
    r = requests.get(f"{API}/admin/showcase", headers=_admin_headers(), timeout=15)
    assert r.status_code == 200, r.text
    return r.json().get("items") or []


def test_admin_list_returns_items_with_required_fields(admin_list):
    assert len(admin_list) > 0, "no showcase posts exist — seed failed?"
    required = {"id", "title", "admin_pinned", "admin_hidden", "admin_sort_order"}
    for item in admin_list:
        missing = required - set(item.keys())
        assert not missing, f"item {item.get('id')!r} missing fields: {missing}"


def test_admin_endpoints_require_admin_auth():
    """All 5 admin endpoints (list + 4 actions) must reject unauth callers."""
    paths = [
        ("GET",  "/admin/showcase"),
        ("POST", "/admin/showcase/dummy/pin"),
        ("POST", "/admin/showcase/dummy/hide"),
        ("POST", "/admin/showcase/dummy/move-up"),
        ("POST", "/admin/showcase/dummy/move-down"),
        ("POST", "/admin/showcase/shuffle"),
    ]
    for method, path in paths:
        r = requests.request(method, f"{API}{path}", timeout=10)
        assert r.status_code in (401, 403), (
            f"{method} {path}: expected auth required, got {r.status_code}"
        )


def test_pin_toggle_flips_state(admin_list):
    if not admin_list:
        pytest.skip("no showcase posts")
    target = admin_list[-1]   # use the last one to avoid disturbing the visible top of the feed
    before = bool(target["admin_pinned"])
    # Toggle
    r = requests.post(
        f"{API}/admin/showcase/{target['id']}/pin",
        headers=_admin_headers(), timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["admin_pinned"] != before, "pin endpoint didn't flip the state"
    # Restore
    r2 = requests.post(
        f"{API}/admin/showcase/{target['id']}/pin",
        headers=_admin_headers(), timeout=10,
    )
    assert r2.status_code == 200
    assert r2.json()["admin_pinned"] == before


def test_hide_toggle_flips_state(admin_list):
    if not admin_list:
        pytest.skip("no showcase posts")
    target = admin_list[-1]
    before = bool(target["admin_hidden"])
    r = requests.post(
        f"{API}/admin/showcase/{target['id']}/hide",
        headers=_admin_headers(), timeout=10,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["admin_hidden"] != before
    # Restore
    r2 = requests.post(
        f"{API}/admin/showcase/{target['id']}/hide",
        headers=_admin_headers(), timeout=10,
    )
    assert r2.status_code == 200
    assert r2.json()["admin_hidden"] == before


def test_shuffle_assigns_sort_orders():
    """After a shuffle, every non-pinned non-hidden post must carry an
    admin_sort_order. Tests the side-effect that lets move-up/down work."""
    r = requests.post(f"{API}/admin/showcase/shuffle", headers=_admin_headers(), timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["shuffled"] >= 1
    # Verify
    r2 = requests.get(f"{API}/admin/showcase", headers=_admin_headers(), timeout=10)
    items = r2.json()["items"]
    for it in items:
        if not it["admin_pinned"] and not it["admin_hidden"]:
            assert it["admin_sort_order"] is not None, (
                f"item {it['id']!r} has no sort_order after shuffle"
            )


def test_pinned_posts_appear_before_unpinned_in_public_feed():
    """Public feed must respect the pin ordering, not just created_at."""
    # Pin the LAST item in created_at order, then check it floats to top.
    r = requests.get(f"{API}/admin/showcase", headers=_admin_headers(), timeout=10)
    items = r.json()["items"]
    if len(items) < 2:
        pytest.skip("need at least 2 items to verify ordering")
    # Find an unpinned, unhidden candidate
    candidates = [i for i in items if not i["admin_pinned"] and not i["admin_hidden"]]
    if not candidates:
        pytest.skip("nothing unpinned to test with")
    target = candidates[-1]   # the *last* (oldest by default) — most visible test
    # Pin it
    requests.post(
        f"{API}/admin/showcase/{target['id']}/pin",
        headers=_admin_headers(), timeout=10,
    )
    try:
        # Public feed
        pub = requests.get(f"{API}/community/showcase?limit=50", timeout=10).json()
        assert pub, "public feed is empty"
        # Our pinned post must be at position 0 (since it's the only pinned one)
        assert pub[0]["id"] == target["id"], (
            f"pinned post should be first in public feed but pos[0]="
            f"{pub[0].get('id')!r} (expected {target['id']!r})"
        )
    finally:
        # Unpin to leave the world as we found it
        requests.post(
            f"{API}/admin/showcase/{target['id']}/pin",
            headers=_admin_headers(), timeout=10,
        )


def test_hidden_posts_excluded_from_public_feed():
    r = requests.get(f"{API}/admin/showcase", headers=_admin_headers(), timeout=10)
    items = r.json()["items"]
    candidates = [i for i in items if not i["admin_hidden"] and not i["admin_pinned"]]
    if not candidates:
        pytest.skip("nothing unhidden to test with")
    target = candidates[0]
    # Hide
    requests.post(
        f"{API}/admin/showcase/{target['id']}/hide",
        headers=_admin_headers(), timeout=10,
    )
    try:
        pub = requests.get(f"{API}/community/showcase?limit=100", timeout=10).json()
        ids = [p["id"] for p in pub]
        assert target["id"] not in ids, (
            f"hidden post {target['id']!r} leaked into public feed"
        )
    finally:
        # Restore
        requests.post(
            f"{API}/admin/showcase/{target['id']}/hide",
            headers=_admin_headers(), timeout=10,
        )


def test_move_up_swaps_with_previous():
    r = requests.get(f"{API}/admin/showcase", headers=_admin_headers(), timeout=10)
    items = r.json()["items"]
    rotation = [i for i in items if not i["admin_pinned"] and not i["admin_hidden"]]
    if len(rotation) < 2:
        pytest.skip("need ≥ 2 rotation items")
    # Move the second one up
    target = rotation[1]
    before_so = target["admin_sort_order"]
    prev_so = rotation[0]["admin_sort_order"]
    res = requests.post(
        f"{API}/admin/showcase/{target['id']}/move-up",
        headers=_admin_headers(), timeout=10,
    )
    assert res.status_code == 200, res.text
    # Re-fetch and verify positions swapped
    items2 = requests.get(f"{API}/admin/showcase", headers=_admin_headers(), timeout=10).json()["items"]
    rotation2 = [i for i in items2 if not i["admin_pinned"] and not i["admin_hidden"]]
    # Target should be at index 0 now
    assert rotation2[0]["id"] == target["id"], (
        f"after move-up, target {target['id']!r} should be at index 0 "
        f"but got {rotation2[0]['id']!r}"
    )
    # Cleanup — undo by moving back down
    requests.post(
        f"{API}/admin/showcase/{target['id']}/move-down",
        headers=_admin_headers(), timeout=10,
    )
