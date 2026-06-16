"""iter320 — Auto-SEO tag generator + showcase prerender tests.

Heavily mocks the LLM so the test suite stays offline-friendly and
deterministic. Validates the full pipeline:

  • coercion (truncation + tag normalization)
  • bulk_tag_design_files / bulk_tag_showcase_posts write back the
    four-field SEO bundle and skip rows that already have all four
  • admin endpoints honor limit + force flags
  • showcase prerender HTML consumes the new SEO fields verbatim
  • showcase prerender handles missing/admin-hidden rows gracefully
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("EMERGENT_LLM_KEY", "sk-test-stub")

from server import app  # noqa: E402
from core import db, ADMIN_EMAILS  # noqa: E402
from maker_auth import issue_admin_magic_token  # noqa: E402

pytestmark = pytest.mark.asyncio


# ────────────────────────────────────────────────────────────────────
# Pure unit tests — no LLM
# ────────────────────────────────────────────────────────────────────


def test_coerce_truncates_and_normalizes_tags():
    from auto_seo_tags import _coerce
    raw = {
        "seo_title": "A" * 200,
        "seo_description": "B" * 500,
        "seo_tags": ["UPPER", "uppER", "  spaced  ", "with!punct@", "#hashy",
                     "ok", "ok", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
        "alt_text": "C" * 300,
    }
    out = _coerce(raw)
    assert len(out["seo_title"]) <= 60
    assert len(out["seo_description"]) <= 160
    assert len(out["alt_text"]) <= 120
    # Tags: lowercased, deduped, max 10, stripped of weird chars
    assert all(t == t.lower() for t in out["seo_tags"])
    assert len(out["seo_tags"]) <= 10
    assert out["seo_tags"][0] == "upper"
    assert "hashy" in out["seo_tags"]  # hash stripped


def test_strip_code_fences():
    from auto_seo_tags import _strip_code_fences
    assert _strip_code_fences("```json\n{\"a\":1}\n```") == '{"a":1}'
    assert _strip_code_fences("```{\"a\":1}```") == '{"a":1}'
    assert _strip_code_fences('{"a":1}') == '{"a":1}'


# ────────────────────────────────────────────────────────────────────
# Bulk runners — patch the LLM to return a known payload
# ────────────────────────────────────────────────────────────────────


_FAKE_SEO = {
    "seo_title": "Walnut Family Sign — Crafters Market",
    "seo_description": "Hand-V-carved 22\" walnut family-name sign. Made-to-order. Browse the shop.",
    "seo_tags": ["walnut", "v-carve", "family name sign", "wood signage"],
    "alt_text": "Walnut sign with carved last name, sanded flush.",
}


async def _fake_llm(_system, _user_prompt):
    return _FAKE_SEO


async def test_bulk_tag_design_files_writes_seo_fields(monkeypatch):
    monkeypatch.setattr("auto_seo_tags._llm_generate", _fake_llm)
    rid = "iter320-df-" + uuid.uuid4().hex[:8]
    await db.design_files.delete_many({"id": rid})
    await db.design_files.insert_one({
        "id": rid,
        "title": "iter320 test file",
        "description": "test",
        "file_type": "SVG",
        "primary_url": "https://cdn.example/x.svg",
        "thumbnail_url": "https://cdn.example/x.jpg",
        "quarantined_at": None,
        # No seo_* fields → should be picked up
    })
    from auto_seo_tags import bulk_tag_design_files
    # iter413as — Larger limit so this row is processed even when other
    # test files leave untagged design_files rows above it in the queue.
    r = await bulk_tag_design_files(db, limit=200)
    # Our row should be in the results.
    assert any(row["id"] == rid for row in r["results"])
    row = await db.design_files.find_one({"id": rid})
    assert row["seo_title"] == _FAKE_SEO["seo_title"]
    assert row["seo_description"] == _FAKE_SEO["seo_description"]
    assert row["seo_tags"] == _FAKE_SEO["seo_tags"]
    assert row["alt_text"] == _FAKE_SEO["alt_text"]
    assert row.get("seo_auto_generated_at")
    # Cleanup
    await db.design_files.delete_one({"id": rid})


async def test_bulk_tag_design_files_skips_rows_with_existing_seo(monkeypatch):
    """Default (`force=False`) should leave fully-tagged rows alone."""
    monkeypatch.setattr("auto_seo_tags._llm_generate", _fake_llm)
    rid = "iter320-df-skip-" + uuid.uuid4().hex[:8]
    await db.design_files.delete_many({"id": rid})
    await db.design_files.insert_one({
        "id": rid,
        "title": "already tagged",
        "primary_url": "https://cdn.example/x.svg",
        "thumbnail_url": "https://cdn.example/x.jpg",
        "quarantined_at": None,
        "seo_title": "Pre-existing title",
        "seo_description": "Pre-existing description.",
        "seo_tags": ["pre", "existing"],
        "alt_text": "pre-existing alt",
    })
    from auto_seo_tags import bulk_tag_design_files
    r = await bulk_tag_design_files(db, limit=5)
    # Our row must NOT be in the results when force is False.
    assert all(row["id"] != rid for row in r["results"]), r["results"]
    row = await db.design_files.find_one({"id": rid})
    assert row["seo_title"] == "Pre-existing title"  # unchanged

    # With force=True, it should now get re-tagged.
    r2 = await bulk_tag_design_files(db, limit=50, force=True)
    rerun_row = await db.design_files.find_one({"id": rid})
    if any(x["id"] == rid for x in r2["results"]):
        assert rerun_row["seo_title"] == _FAKE_SEO["seo_title"]
    await db.design_files.delete_one({"id": rid})


async def test_bulk_tag_showcase_posts_skips_admin_hidden(monkeypatch):
    """`admin_hidden=true` rows must never be auto-tagged — they're
    moderation-suppressed and shouldn't get SEO."""
    monkeypatch.setattr("auto_seo_tags._llm_generate", _fake_llm)
    hid = "iter320-sc-hidden-" + uuid.uuid4().hex[:8]
    await db.showcase_posts.delete_many({"id": hid})
    await db.showcase_posts.insert_one({
        "id": hid,
        "title": "hidden post",
        "admin_hidden": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    from auto_seo_tags import bulk_tag_showcase_posts
    r = await bulk_tag_showcase_posts(db, limit=50)
    assert all(row["id"] != hid for row in r["results"])
    row = await db.showcase_posts.find_one({"id": hid})
    assert row.get("seo_title") is None
    await db.showcase_posts.delete_one({"id": hid})


# ────────────────────────────────────────────────────────────────────
# Admin endpoint contract
# ────────────────────────────────────────────────────────────────────


async def _admin_jwt() -> str:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        email = next(iter(ADMIN_EMAILS))
        magic = issue_admin_magic_token(email)
        r = await ac.post("/api/admin/auth/verify", json={"token": magic})
        return r.json()["token"]


async def test_admin_endpoints_respect_limit_bounds():
    """Both endpoints reject out-of-range limits (must be 1-50)."""
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        for url in (
            "/api/admin/seo/auto-tag/design-files?limit=0",
            "/api/admin/seo/auto-tag/design-files?limit=999",
            "/api/admin/seo/auto-tag/showcase?limit=0",
        ):
            r = await ac.post(url, headers={"Authorization": f"Bearer {jwt}"})
            assert r.status_code == 400, f"{url}: {r.status_code}"


# ────────────────────────────────────────────────────────────────────
# Showcase prerender
# ────────────────────────────────────────────────────────────────────


async def test_showcase_prerender_consumes_seo_fields():
    """When a showcase post has seo_* fields populated, the prerender
    HTML must use them verbatim in <title>, meta description, and
    JSON-LD keywords."""
    sid = str(uuid.uuid4())
    await db.showcase_posts.delete_many({"id": sid})
    await db.showcase_posts.insert_one({
        "id": sid,
        "title": "Test showcase post",
        "description": "long description goes here",
        "image_url": "https://cdn.example/test.jpg",
        "admin_hidden": False,
        "seo_title": "Curated SEO Title",
        "seo_description": "Curated SEO description with a CTA.",
        "seo_tags": ["plasma", "steel", "wall art"],
        "alt_text": "Curated alt text.",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(f"/api/og/showcase/{sid}")
    assert r.status_code == 200, r.text
    html = r.text
    title = re.search(r"<title>([^<]+)</title>", html).group(1)
    assert title == "Curated SEO Title"
    assert "Curated SEO description" in html
    assert "Curated alt text" in html
    # JSON-LD keywords list
    assert "plasma, steel, wall art" in html
    await db.showcase_posts.delete_one({"id": sid})


async def test_showcase_prerender_redirects_for_missing_or_hidden():
    """Unknown UUID or admin-hidden post → 302 redirect to /community."""
    bad = str(uuid.uuid4())
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(f"/api/og/showcase/{bad}", follow_redirects=False)
    assert r.status_code in (302, 307)
    assert "/community" in r.headers["location"]


async def test_showcase_prerender_rejects_invalid_uuid():
    """Non-UUID path should redirect, never 500."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/og/showcase/not-a-uuid-at-all", follow_redirects=False)
    assert r.status_code in (302, 307)
