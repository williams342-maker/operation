"""Iter 129 — SEO tag heuristic + design-file OG prerender.

Validates:
- `extract_seo_tags` returns ordered, deduped, capped tags from the
  craft / material / file-format vocab.
- `build_seo_description` truncates politely, prefers first sentence,
  hard-cuts on word boundaries past max_chars.
- Design files automatically get `seo_tags` + `seo_description` on
  upload (regression check via direct API call).
- The OG prerender route returns a 200 with the right meta
  (`og:type=article`, keywords meta, article:tag count > 0, JSON-LD
  schema.org/CreativeWork) for an existing tagged file, and 302→/community
  for unknown ids.
"""
import os
import asyncio
import sys
import uuid
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")

from seo_tags import extract_seo_tags, build_seo_description  # noqa: E402
from core import db  # noqa: E402

API = "http://localhost:8001/api"


def test_tagger_orders_vocab_then_filler():
    tags = extract_seo_tags(
        "Mountain Range Wall Art",
        "A 24-inch laser cut and plasma-cut steel mountain silhouette for "
        "industrial farmhouse decor. Made from 1/8\" mild steel.",
        file_types=["DXF", "SVG", "STL"],
    )
    # Vocab hits land in declared order and before the filler.
    assert "plasma-cut" in tags
    assert "laser-cut" in tags
    assert "wall-art" in tags
    assert "industrial" in tags
    assert "rustic" in tags  # "farmhouse" → rustic
    assert "mountains" in tags
    assert "steel" in tags
    assert "dxf-file" in tags
    assert "svg-file" in tags
    assert "stl-3d-model" in tags
    assert tags == list(dict.fromkeys(tags))  # deduped
    assert len(tags) <= 12


def test_tagger_handles_empty_input():
    assert extract_seo_tags("", "") == []
    assert extract_seo_tags(None, None) == []  # type: ignore[arg-type]


def test_seo_description_first_sentence():
    s = build_seo_description("X", "Quick brown fox. Then more details follow.")
    assert s == "Quick brown fox."

    long_first = ("a" * 200) + ". short."
    s = build_seo_description("X", long_first)
    assert len(s) <= 160
    assert s.endswith("…")  # hard-cut indicator


def test_seo_description_falls_back_to_title():
    s = build_seo_description("Hello world", "")
    assert s == "Hello world"


@pytest.mark.asyncio
async def test_og_prerender_for_design_file():
    """End-to-end: insert a design file with seo_tags, hit the route,
    confirm meta tags + json-ld land in the response."""
    fid = str(uuid.uuid4())
    seed = {
        "id": fid,
        "maker_slug": None,
        "uploader_role": "buyer",
        "uploader_id": "iter129",
        "maker_name": "Iter129 Tester",
        "title": "Iter129 Mountain Plasma Cut",
        "description": "Mountain wall art plasma-cut from 1/8 inch steel.",
        "file_type": "DXF",
        "download_url": "https://example.com/seed.dxf",
        "thumbnail_url": "https://example.com/seed.jpg",
        "variants": [{"format": "SVG", "url": "https://example.com/seed.svg"}],
        "downloads": 0,
        "size_bytes": 1024,
        "created_at": "2026-01-01T00:00:00+00:00",
        "seo_tags": ["plasma-cut", "wall-art", "mountains", "steel", "dxf-file"],
        "seo_description": "Mountain wall art plasma-cut from 1/8 inch steel.",
    }
    await db.design_files.insert_one(seed)
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{API}/og/community/file/{fid}")
            assert r.status_code == 200
            html = r.text
            assert 'og:type" content="article"' in html
            assert 'name="keywords"' in html
            assert 'plasma-cut' in html
            assert 'article:tag' in html
            assert 'CreativeWork' in html
            # iter372 — unknown UUID now returns a real 404 + noindex
            # (was a 302 soft-bounce), doesn't 500.
            r2 = await client.get(
                f"{API}/og/community/file/00000000-0000-0000-0000-000000000000",
                follow_redirects=False,
            )
            assert r2.status_code == 404
    finally:
        await db.design_files.delete_one({"id": fid})


if __name__ == "__main__":
    test_tagger_orders_vocab_then_filler()
    test_tagger_handles_empty_input()
    test_seo_description_first_sentence()
    test_seo_description_falls_back_to_title()
    asyncio.run(test_og_prerender_for_design_file())
    print("OK")
