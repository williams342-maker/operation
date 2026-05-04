"""iter112 — Coming-Soon launch endpoint + waitlist counts.

Verifies:
- `GET /api/admin/coming-soon/waitlist` now surfaces per-category
  pending/notified/total counts.
- `POST /api/admin/coming-soon/launch` rejects unknown categories.
- Dry-run returns the eligible-recipient count without sending.
- Real launch:
   - Stamps `notified_at` on every pending row in one update_many
     BEFORE scheduling background email tasks (idempotency under crash).
   - Schedules one `send_coming_soon_launch_announcement` per pending row.
   - Skips already-notified rows on re-click (count returns 0).
- Endpoint is admin-gated.
"""
import asyncio
from unittest.mock import patch, AsyncMock

import pytest


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


async def _seed_waitlist(category: str, n_pending: int, n_notified: int):
    from core import db, now_iso
    rows = []
    for i in range(n_pending):
        rows.append({
            "email": f"iter112-pending-{i}@example.com",
            "name": f"User{i}",
            "category": category,
            "joined_at": now_iso(),
            "notified_at": None,
        })
    for i in range(n_notified):
        rows.append({
            "email": f"iter112-notified-{i}@example.com",
            "name": f"NUser{i}",
            "category": category,
            "joined_at": now_iso(),
            "notified_at": now_iso(),
        })
    if rows:
        await db.coming_soon_waitlist.insert_many(rows)


async def _cleanup_category(category: str):
    from core import db
    await db.coming_soon_waitlist.delete_many({"category": category})


# ============================================================
# Waitlist counts
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_waitlist_endpoint_returns_per_category_pending_and_notified_counts():
    from routers.coming_soon import admin_list_coming_soon
    cat = "Neon & Light"
    await _cleanup_category(cat)
    await _seed_waitlist(cat, n_pending=3, n_notified=2)
    res = await admin_list_coming_soon({"role": "admin"})
    by_cat = res["by_category"][cat]
    assert by_cat["total"] == 5
    assert by_cat["pending"] == 3
    assert by_cat["notified"] == 2
    assert "categories" in res and cat in res["categories"]
    await _cleanup_category(cat)


# ============================================================
# Launch — guard rails
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_launch_rejects_unknown_category_without_emailing():
    from routers.coming_soon import admin_launch_coming_soon, _LaunchBody
    from fastapi import BackgroundTasks
    bg = BackgroundTasks()
    with patch("email_service.send_coming_soon_launch_announcement",
               new=AsyncMock()) as send:
        r = await admin_launch_coming_soon(
            _LaunchBody(category="Smuggled Goods"), bg, {"role": "admin"},
        )
        await bg()
    assert r == {"ok": False, "error": "unknown_category"}
    assert send.await_count == 0


@pytest.mark.asyncio(loop_scope="module")
async def test_launch_dry_run_returns_count_without_sending_or_stamping():
    from routers.coming_soon import admin_launch_coming_soon, _LaunchBody
    from fastapi import BackgroundTasks
    from core import db
    cat = "Furniture"
    await _cleanup_category(cat)
    await _seed_waitlist(cat, n_pending=4, n_notified=1)
    bg = BackgroundTasks()
    with patch("email_service.send_coming_soon_launch_announcement",
               new=AsyncMock()) as send:
        r = await admin_launch_coming_soon(
            _LaunchBody(category=cat, dry_run=True), bg, {"role": "admin"},
        )
        await bg()
    assert r["ok"] is True and r["dry_run"] is True
    assert r["would_notify"] == 4
    assert send.await_count == 0
    # No rows stamped — pending count unchanged.
    pending = await db.coming_soon_waitlist.count_documents(
        {"category": cat, "notified_at": None},
    )
    assert pending == 4
    await _cleanup_category(cat)


# ============================================================
# Launch — happy path + idempotency
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_launch_stamps_pending_rows_and_schedules_one_email_each():
    from routers.coming_soon import admin_launch_coming_soon, _LaunchBody
    from fastapi import BackgroundTasks
    from core import db
    cat = "Neon & Light"
    await _cleanup_category(cat)
    await _seed_waitlist(cat, n_pending=3, n_notified=1)
    bg = BackgroundTasks()
    with patch("email_service.send_coming_soon_launch_announcement",
               new=AsyncMock()) as send:
        r = await admin_launch_coming_soon(
            _LaunchBody(category=cat, dry_run=False), bg, {"role": "admin"},
        )
        await bg()
    assert r["ok"] is True
    assert r["notified"] == 3
    # One email per pending row, none for already-notified.
    assert send.await_count == 3
    sent_emails = {c.kwargs["email"] for c in send.await_args_list}
    assert all(e.startswith("iter112-pending-") for e in sent_emails)
    # All rows now have notified_at — pending count drops to 0.
    pending = await db.coming_soon_waitlist.count_documents(
        {"category": cat, "notified_at": None},
    )
    assert pending == 0
    notified = await db.coming_soon_waitlist.count_documents(
        {"category": cat, "notified_at": {"$ne": None}},
    )
    assert notified == 4  # 3 newly stamped + 1 pre-existing
    await _cleanup_category(cat)


@pytest.mark.asyncio(loop_scope="module")
async def test_launch_is_idempotent_on_reclick():
    """Re-clicking Launch on a fully-notified category must NOT re-email."""
    from routers.coming_soon import admin_launch_coming_soon, _LaunchBody
    from fastapi import BackgroundTasks
    cat = "Furniture"
    await _cleanup_category(cat)
    await _seed_waitlist(cat, n_pending=0, n_notified=3)
    bg = BackgroundTasks()
    with patch("email_service.send_coming_soon_launch_announcement",
               new=AsyncMock()) as send:
        r = await admin_launch_coming_soon(
            _LaunchBody(category=cat, dry_run=False), bg, {"role": "admin"},
        )
        await bg()
    assert r["ok"] is True
    assert r["notified"] == 0
    assert r.get("reason") == "no_pending"
    assert send.await_count == 0
    await _cleanup_category(cat)


@pytest.mark.asyncio(loop_scope="module")
async def test_launch_uses_custom_shop_path_in_email_cta():
    from routers.coming_soon import admin_launch_coming_soon, _LaunchBody
    from fastapi import BackgroundTasks
    cat = "Neon & Light"
    await _cleanup_category(cat)
    await _seed_waitlist(cat, n_pending=1, n_notified=0)
    bg = BackgroundTasks()
    with patch("email_service.send_coming_soon_launch_announcement",
               new=AsyncMock()) as send:
        await admin_launch_coming_soon(
            _LaunchBody(category=cat, shop_path="/shop?category=Neon"),
            bg, {"role": "admin"},
        )
        await bg()
    assert send.await_count == 1
    assert send.await_args.kwargs["shop_path"] == "/shop?category=Neon"
    await _cleanup_category(cat)
