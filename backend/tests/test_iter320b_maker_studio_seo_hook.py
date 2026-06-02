"""iter320b — Verify maker_studio.publish wires auto-SEO fire-and-forget.

Scope:
  • Source-level check: both `schedule_seo_for_design_file` and
    `schedule_seo_for_showcase` are imported and called inside the publish
    handler, immediately after the matching `insert_one` calls.
  • Behaviour-level check: the schedule helpers in `auto_seo_inline` skip
    rows that already carry a complete SEO bundle (no LLM round-trip).
  • Behaviour-level check: when a row is missing SEO fields, the helper
    awaits the (monkey-patched) generator and writes the bundle back.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("EMERGENT_LLM_KEY", "sk-test-stub")


# ── Source-level check: hooks wired into publish handler ───────────────
def test_maker_studio_publish_wires_design_file_hook():
    src = Path("/app/backend/routers/maker_studio.py").read_text()
    # Hook fires after the canonical design_files insert.
    assert "await db.design_files.insert_one(doc)" in src
    assert "schedule_seo_for_design_file(doc.get(\"id\"))" in src
    # Order check — the design-file hook must appear AFTER the insert.
    idx_insert = src.index("await db.design_files.insert_one(doc)")
    idx_hook = src.index("schedule_seo_for_design_file(doc.get(\"id\"))")
    assert idx_hook > idx_insert


def test_maker_studio_publish_wires_showcase_hook():
    src = Path("/app/backend/routers/maker_studio.py").read_text()
    assert "await db.showcase_posts.insert_one({" in src
    assert "schedule_seo_for_showcase(showcase_post_id)" in src
    idx_insert = src.index("await db.showcase_posts.insert_one({")
    idx_hook = src.index("schedule_seo_for_showcase(showcase_post_id)")
    assert idx_hook > idx_insert


# ── Behaviour: auto_seo_inline helpers no-op on already-tagged rows ────
@pytest.mark.asyncio
async def test_run_design_file_skips_when_already_tagged(monkeypatch):
    from auto_seo_inline import _run_design_file
    from core import db

    file_id = f"test-{uuid.uuid4().hex[:8]}"
    await db.design_files.insert_one({
        "id": file_id,
        "title": "Pre-tagged",
        "description": "x",
        "file_type": "svg",
        "seo_title": "already set",
        "seo_tags": ["a", "b"],
        "alt_text": "alt set",
    })

    calls = {"n": 0}

    async def fake_gen(doc):
        calls["n"] += 1
        return {}

    monkeypatch.setattr("auto_seo_inline.generate_for_design_file", fake_gen)
    try:
        await _run_design_file(file_id)
        assert calls["n"] == 0, "LLM should not run when row is already tagged"
    finally:
        await db.design_files.delete_one({"id": file_id})


@pytest.mark.asyncio
async def test_run_design_file_writes_bundle_when_missing(monkeypatch):
    from auto_seo_inline import _run_design_file
    from core import db

    file_id = f"test-{uuid.uuid4().hex[:8]}"
    await db.design_files.insert_one({
        "id": file_id,
        "title": "Untagged",
        "description": "raw description",
        "file_type": "svg",
    })

    bundle = {
        "seo_title": "Walnut Cutting Board",
        "seo_description": "Hand-carved walnut · ships in 3 days.",
        "seo_tags": ["walnut", "cutting board", "cnc"],
        "alt_text": "Walnut cutting board",
    }

    async def fake_gen(doc):
        return bundle

    monkeypatch.setattr("auto_seo_inline.generate_for_design_file", fake_gen)

    try:
        await _run_design_file(file_id)
        row = await db.design_files.find_one({"id": file_id}, {"_id": 0})
        assert row["seo_title"] == bundle["seo_title"]
        assert row["seo_description"] == bundle["seo_description"]
        assert row["seo_tags"] == bundle["seo_tags"]
        assert row["alt_text"] == bundle["alt_text"]
        assert row.get("seo_auto_source") == "on_upload"
        assert row.get("seo_auto_generated_at")
    finally:
        await db.design_files.delete_one({"id": file_id})


@pytest.mark.asyncio
async def test_run_showcase_writes_bundle_when_missing(monkeypatch):
    from auto_seo_inline import _run_showcase
    from core import db

    post_id = f"test-{uuid.uuid4().hex[:8]}"
    await db.showcase_posts.insert_one({
        "id": post_id,
        "title": "Studio piece",
        "caption": "AI generated",
    })

    bundle = {
        "seo_title": "Studio Family Sign",
        "seo_description": "Maker Studio AI design · download SVG + DXF.",
        "seo_tags": ["family sign", "studio", "ai design"],
        "alt_text": "Family sign",
    }

    async def fake_gen(doc):
        return bundle

    monkeypatch.setattr("auto_seo_inline.generate_for_showcase_post", fake_gen)

    try:
        await _run_showcase(post_id)
        row = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0})
        assert row["seo_title"] == bundle["seo_title"]
        assert row["seo_tags"] == bundle["seo_tags"]
        assert row.get("seo_auto_source") == "on_upload"
    finally:
        await db.showcase_posts.delete_one({"id": post_id})


# ── schedule_* fire-and-forget contract — returns immediately ──────────
@pytest.mark.asyncio
async def test_schedule_seo_for_design_file_is_non_blocking(monkeypatch):
    import auto_seo_inline as mod

    started = asyncio.Event()
    finished = asyncio.Event()

    async def slow_runner(file_id):
        started.set()
        await asyncio.sleep(0.05)
        finished.set()

    monkeypatch.setattr(mod, "_run_design_file", slow_runner)

    mod.schedule_seo_for_design_file("xyz")
    # Helper must return synchronously; the task should still be running.
    assert not finished.is_set()
    # And the task must actually have been scheduled.
    await asyncio.wait_for(started.wait(), timeout=1.0)
    await asyncio.wait_for(finished.wait(), timeout=1.0)
