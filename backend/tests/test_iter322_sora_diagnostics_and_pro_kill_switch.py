"""iter322 — Sora-2 video generation hardening.

Covers:
  • POST /api/admin/seed/clips/generate-one rejects sora-2-pro when the
    SORA_DISABLE_PRO env flag is set (default).
  • Same endpoint still accepts sora-2 (base).
  • Job record persists `attempts` list from clip_seeder.generate_one_clip.
  • clip_seeder records both primary + fallback attempts when the
    primary fails with a "no video after" timeout error.
"""
from __future__ import annotations

import os
import uuid

import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("EMERGENT_LLM_KEY", "sk-test-stub")
os.environ.setdefault("SORA_DISABLE_PRO", "true")


pytestmark = pytest.mark.asyncio


async def _admin_jwt():
    from maker_auth import issue_admin_magic_token
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        from core import ADMIN_EMAILS
        emails = list(ADMIN_EMAILS) if ADMIN_EMAILS else []
        email = emails[0] if emails else "team@craftersmarket.org"
        tok = issue_admin_magic_token(email)
        v = await c.post("/api/admin/auth/verify", json={"token": tok})
        assert v.status_code == 200, v.text
        return v.json()["token"]


async def test_generate_one_rejects_sora_pro_when_disabled():
    from server import app
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post(
            "/api/admin/seed/clips/generate-one?model=sora-2-pro",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 422, r.text
        assert "sora-2-pro is temporarily disabled" in r.text.lower() or "pro" in r.text.lower()


async def test_generate_one_accepts_sora_base_and_starts_job():
    from server import app
    from core import db
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post(
            "/api/admin/seed/clips/generate-one?model=sora-2",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("job_id")
        assert body.get("status") == "queued"
        # Record exists in mongo with model=sora-2.
        row = await db.clip_seed_jobs.find_one({"job_id": body["job_id"]}, {"_id": 0})
        assert row and row["model"] == "sora-2"
        # Clean up the queued job so the runner doesn't hammer Sora.
        await db.clip_seed_jobs.delete_one({"job_id": body["job_id"]})


async def test_clip_seeder_records_primary_and_fallback_attempts(monkeypatch):
    """Simulate a pro timeout followed by a base-sora failure — both
    attempts must be present in the returned dict's `attempts` field."""
    import clip_seeder

    calls = []

    def fake_blocking(prompt, out_path, model):
        calls.append(model)
        if model == "sora-2-pro":
            return False, "Sora returned no video after 900s (model=sora-2-pro, size=1024x1792)."
        # Fallback to base also fails — keeps the test fast.
        return False, "Sora returned no video after 600s (model=sora-2, size=1280x720)."

    async def fake_to_thread(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(clip_seeder, "_generate_video_blocking", fake_blocking)
    monkeypatch.setattr(clip_seeder.asyncio, "to_thread", fake_to_thread)

    # Patch _pick_next so we don't depend on real prompts. Returns a
    # plausible shape that clip_seeder consumes downstream.
    async def fake_pick_next():
        return {
            "category": "test",
            "prompt_index": 0,
            "prompt": {"title": f"Test Clip {uuid.uuid4().hex[:6]}", "prompt": "test prompt"},
        }

    monkeypatch.setattr(clip_seeder, "_pick_next", fake_pick_next)

    # Patch _unique_slug to return immediately without hitting Mongo.
    async def fake_slug(_):
        return f"test-{uuid.uuid4().hex[:6]}"
    monkeypatch.setattr(clip_seeder, "_unique_slug", fake_slug)

    result = await clip_seeder.generate_one_clip(model="sora-2-pro")
    assert result["status"] == "error"
    attempts = result.get("attempts") or []
    assert len(attempts) == 2, f"expected 2 attempts (primary + fallback), got {attempts}"
    assert attempts[0]["model"] == "sora-2-pro"
    assert attempts[0]["ok"] is False
    assert attempts[0].get("is_fallback") is None or attempts[0].get("is_fallback") is False
    assert attempts[1]["model"] == "sora-2"
    assert attempts[1]["ok"] is False
    assert attempts[1].get("is_fallback") is True
    assert calls == ["sora-2-pro", "sora-2"], f"unexpected call order: {calls}"


async def test_clip_seeder_skips_fallback_on_non_timeout_error(monkeypatch):
    """Auth/budget errors shouldn't trigger the fallback — that would
    just burn another quota slot. Only timeout-class failures retry."""
    import clip_seeder

    def fake_blocking(prompt, out_path, model):
        return False, "Sora auth failed — check EMERGENT_LLM_KEY. Raw: 401 Unauthorized"

    async def fake_to_thread(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(clip_seeder, "_generate_video_blocking", fake_blocking)
    monkeypatch.setattr(clip_seeder.asyncio, "to_thread", fake_to_thread)

    async def fake_pick_next():
        return {
            "category": "test", "prompt_index": 0,
            "prompt": {"title": "T", "prompt": "p"},
        }
    monkeypatch.setattr(clip_seeder, "_pick_next", fake_pick_next)

    async def fake_slug(_):
        return f"test-{uuid.uuid4().hex[:6]}"
    monkeypatch.setattr(clip_seeder, "_unique_slug", fake_slug)

    result = await clip_seeder.generate_one_clip(model="sora-2-pro")
    assert result["status"] == "error"
    attempts = result.get("attempts") or []
    # Only 1 attempt — fallback should NOT have fired for an auth error.
    assert len(attempts) == 1
    assert attempts[0]["model"] == "sora-2-pro"
    assert "auth failed" in attempts[0]["error"].lower()
