"""iter319c — Auto-thumbnail generator regression tests."""
from __future__ import annotations

import io
import os

import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

from server import app  # noqa: E402
from core import db, ADMIN_EMAILS  # noqa: E402
from maker_auth import issue_admin_magic_token  # noqa: E402

pytestmark = pytest.mark.asyncio


# Minimal valid SVG
_SAMPLE_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    b'<rect width="100" height="100" fill="#ff4500"/></svg>'
)


def test_svg_renderer_produces_png_bytes():
    from auto_thumbnail import _render_svg
    out = _render_svg(_SAMPLE_SVG)
    assert out and len(out) > 100
    # PNG magic number
    assert out[:8] == b"\x89PNG\r\n\x1a\n"


def test_dxf_renderer_produces_png_bytes():
    from auto_thumbnail import _render_dxf
    dxf = (
        b"0\nSECTION\n2\nENTITIES\n"
        b"0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n100.0\n31\n0.0\n"
        b"0\nENDSEC\n0\nEOF\n"
    )
    out = _render_dxf(dxf)
    assert out and len(out) > 100
    assert out[:8] == b"\x89PNG\r\n\x1a\n"


def test_raster_renderer_pads_to_canvas():
    """JPG/PNG/WebP sources should be resized + padded to CANVAS_SIZE."""
    from auto_thumbnail import _render_raster, CANVAS_SIZE
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (200, 100), (255, 50, 0)).save(buf, format="PNG")
    out = _render_raster(buf.getvalue(), "PNG")
    assert out and out[:8] == b"\x89PNG\r\n\x1a\n"
    # Decode and verify canvas dims.
    im = Image.open(io.BytesIO(out))
    assert im.size == CANVAS_SIZE


def test_pick_renderable_source_prefers_vector():
    from auto_thumbnail import _pick_renderable_source
    doc = {
        "file_type": "JPG",
        "primary_url": "https://cdn/x.jpg",
        "variants": [
            {"format": "SVG", "url": "https://cdn/x.svg"},
            {"format": "PNG", "url": "https://cdn/x.png"},
        ],
    }
    fmt, url = _pick_renderable_source(doc)
    assert fmt == "SVG"
    assert url == "https://cdn/x.svg"


def test_pick_renderable_source_returns_none_for_empty():
    from auto_thumbnail import _pick_renderable_source
    assert _pick_renderable_source({"variants": []}) is None
    assert _pick_renderable_source({"primary_url": None, "variants": []}) is None


# ────────────────────────────────────────────────────────────────────
# Admin endpoint end-to-end
# ────────────────────────────────────────────────────────────────────

async def _admin_jwt() -> str:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        email = next(iter(ADMIN_EMAILS))
        magic = issue_admin_magic_token(email)
        r = await ac.post("/api/admin/auth/verify", json={"token": magic})
        return r.json()["token"]


async def test_admin_endpoint_renders_and_writes_thumbnail(monkeypatch):
    """End-to-end with a stub upload — patches the R2 uploader so we
    don't actually hit the bucket, and confirms a row that gets a
    rendered PNG ends up with `thumbnail_url` written back."""
    # Seed a row with an inline-fetchable SVG via a stub fetcher.
    await db.design_files.delete_many({"id": {"$regex": "^iter319c-"}})
    await db.design_files.insert_one({
        "id": "iter319c-svg-test",
        "title": "iter319c SVG test",
        "file_type": "SVG",
        "primary_url": "https://stub-svg.example/test.svg",
        "thumbnail_url": None,
        "quarantined_at": None,
    })

    async def _stub_fetch(url):
        return _SAMPLE_SVG
    monkeypatch.setattr("auto_thumbnail._fetch", _stub_fetch)

    def _stub_upload(png_bytes, key_prefix, filename, content_type):
        return ("https://cdn.example/auto-thumb.png", ".png")
    monkeypatch.setattr("r2_storage.upload_design_file_bytes", _stub_upload)

    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/admin/feeds/design-files/auto-thumbnail?limit=5",
            headers={"Authorization": f"Bearer {jwt}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    # At least our seed row should succeed.
    assert body["succeeded"] >= 1
    row = await db.design_files.find_one({"id": "iter319c-svg-test"})
    assert row["thumbnail_url"] == "https://cdn.example/auto-thumb.png"
    assert row.get("thumbnail_auto_generated") is True

    # Cleanup
    await db.design_files.delete_many({"id": {"$regex": "^iter319c-"}})


async def test_admin_endpoint_skips_rows_with_no_renderable_source(monkeypatch):
    """A row with no primary_url AND no variants should be reported
    as failed with reason `no_renderable_source` — never crashes."""
    await db.design_files.delete_many({"id": "iter319c-no-source"})
    await db.design_files.insert_one({
        "id": "iter319c-no-source",
        "title": "iter319c no source",
        "primary_url": None,
        "variants": [],
        "thumbnail_url": None,
        "quarantined_at": None,
    })
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/admin/feeds/design-files/auto-thumbnail?limit=5",
            headers={"Authorization": f"Bearer {jwt}"},
        )
    assert r.status_code == 200
    body = r.json()
    # Our row appears in results with ok=False.
    ours = next((x for x in body["results"] if x["id"] == "iter319c-no-source"), None)
    assert ours is not None, body
    assert ours["ok"] is False
    assert ours["reason"] == "no_renderable_source"
    # DB row unchanged.
    row = await db.design_files.find_one({"id": "iter319c-no-source"})
    assert row.get("thumbnail_url") in (None, "")
    await db.design_files.delete_one({"id": "iter319c-no-source"})
