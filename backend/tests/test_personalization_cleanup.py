"""Tests for the personalization orphan-cleanup cron (iter151).

Covers:
  • Unreferenced + old → R2 delete called, DB row removed
  • Referenced → never touched (regardless of age)
  • Unreferenced + young (< 7 days) → kept (grace window honored)
  • External URL (no R2 prefix) → DB row dropped, no R2 call attempted

Monkey-patches `delete_key` so we record calls without hitting R2.
Uses unique URL suffixes per test so parallel runs don't fight.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")


# Track R2 delete-key calls across tests.
_deleted_keys: list[str] = []


@pytest.fixture(autouse=True)
def _reset_capture(monkeypatch):
    _deleted_keys.clear()

    def fake_delete(key: str) -> None:
        _deleted_keys.append(key)

    import personalization_cleanup
    monkeypatch.setattr(personalization_cleanup, "delete_key", fake_delete)
    # Force R2_PUBLIC_URL so key_from_public_url returns a real key.
    monkeypatch.setattr(
        personalization_cleanup, "key_from_public_url",
        lambda url: url.split("/")[-1] if "personalization/" in url else None,
    )
    yield


async def _seed(url: str, days_ago: int, referenced: bool) -> None:
    from core import db
    created = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    await db.personalization_uploads.insert_one({
        "url": url,
        "ip_hash": f"test-{uuid.uuid4().hex[:8]}",
        "created_at": created,
        "referenced": referenced,
    })


async def _row_exists(url: str) -> bool:
    from core import db
    return bool(await db.personalization_uploads.find_one({"url": url}))


async def _cleanup(url: str) -> None:
    from core import db
    await db.personalization_uploads.delete_many({"url": url})


@pytest.mark.asyncio
async def test_orphan_unreferenced_and_old_gets_deleted():
    url = f"https://cdn.craftersmarket.org/personalization/orphan-{uuid.uuid4().hex[:8]}.png"
    await _seed(url, days_ago=10, referenced=False)
    try:
        from personalization_cleanup import run_personalization_orphan_cleanup
        result = await run_personalization_orphan_cleanup()
        assert result["candidates"] >= 1
        assert any(k.endswith(".png") for k in _deleted_keys), \
            f"R2 delete not called. Deleted keys: {_deleted_keys}"
        assert not await _row_exists(url), "DB row should be gone"
    finally:
        await _cleanup(url)


@pytest.mark.asyncio
async def test_referenced_never_touched():
    """Even at 90 days old, a referenced row must not be deleted."""
    url = f"https://cdn.craftersmarket.org/personalization/keep-{uuid.uuid4().hex[:8]}.png"
    await _seed(url, days_ago=90, referenced=True)
    try:
        from personalization_cleanup import run_personalization_orphan_cleanup
        await run_personalization_orphan_cleanup()
        assert not any(url.split("/")[-1] in k for k in _deleted_keys), \
            "Referenced row was wrongly R2-deleted"
        assert await _row_exists(url), "Referenced row should be preserved"
    finally:
        await _cleanup(url)


@pytest.mark.asyncio
async def test_young_orphan_in_grace_window_kept():
    """Unreferenced but only 3 days old → still in grace window."""
    url = f"https://cdn.craftersmarket.org/personalization/young-{uuid.uuid4().hex[:8]}.png"
    await _seed(url, days_ago=3, referenced=False)
    try:
        from personalization_cleanup import run_personalization_orphan_cleanup
        await run_personalization_orphan_cleanup()
        assert not any(url.split("/")[-1] in k for k in _deleted_keys), \
            "Young orphan should be in 7-day grace window"
        assert await _row_exists(url)
    finally:
        await _cleanup(url)


@pytest.mark.asyncio
async def test_external_url_row_still_dropped_without_r2_call():
    """If a row's URL doesn't match R2_PUBLIC_URL, we still drop the DB
    row so it doesn't keep re-listing forever. No R2 call attempted.
    """
    url = f"https://external.example.com/legacy/{uuid.uuid4().hex[:8]}.png"
    await _seed(url, days_ago=10, referenced=False)
    try:
        from personalization_cleanup import run_personalization_orphan_cleanup
        before_count = len(_deleted_keys)
        await run_personalization_orphan_cleanup()
        # No R2 delete attempted (URL didn't match our CDN)
        assert len(_deleted_keys) == before_count
        # But DB row still removed
        assert not await _row_exists(url)
    finally:
        await _cleanup(url)
