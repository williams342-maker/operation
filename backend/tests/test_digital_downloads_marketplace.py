import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

from routers import digital_landing as dl


@pytest.fixture
def digital_products():
    return [
        {
            "slug": "svg-cut-file",
            "title": "Farmhouse SVG Cut File",
            "description": "Cricut and Silhouette ready",
            "price": 5.0,
            "category": "Wall Art",
            "technique": "LASER",
            "maker_slug": "maker-one",
            "maker_name": "Maker One",
            "status": "published",
            "listing_type": "digital",
            "created_at": "2026-07-14T12:00:00+00:00",
            "images": ["https://example.test/svg.jpg"],
            "seo_tags": ["svg", "cut file"],
            "commercial_use": True,
            "digital_files": [{"id": "f1", "filename": "farmhouse.svg", "ext": "svg", "size_bytes": 1000, "scan": {"status": "clean"}}],
        },
        {
            "slug": "unsafe-pdf",
            "title": "Unsafe PDF",
            "description": "Should not surface",
            "price": 0,
            "category": "Printable PDFs",
            "maker_slug": "maker-one",
            "status": "published",
            "listing_type": "digital",
            "created_at": "2026-07-14T12:00:00+00:00",
            "digital_files": [{"id": "f2", "filename": "bad.pdf", "ext": "pdf", "scan": {"status": "failed"}}],
        },
        {
            "slug": "ebook-guide",
            "title": "Workshop eBook",
            "description": "EPUB guide",
            "price": 0,
            "category": "Books",
            "maker_slug": "maker-two",
            "maker_name": "Maker Two",
            "status": "published",
            "listing_type": "digital",
            "created_at": "2026-07-01T12:00:00+00:00",
            "images": ["https://example.test/book.jpg"],
            "digital_files": [{"id": "f3", "filename": "guide.epub", "ext": "epub", "scan": {"status": "clean"}}],
        },
    ]


@pytest.mark.asyncio
async def test_summary_counts_only_safe_active_digital(monkeypatch, digital_products):
    monkeypatch.setattr(dl, "_eligible_products", lambda limit=5000: _async(digital_products[:1] + digital_products[2:]))
    monkeypatch.setattr(dl, "_maker_names", lambda products: _async({}))

    body = await dl.digital_downloads_summary()

    assert body["total_digital"] == 2
    svg = next(g for g in body["groups"] if g["key"] == "svg-files")
    assert svg["count"] == 1
    assert svg["new_7d"] == 1
    pdf = next(g for g in body["groups"] if g["key"] == "printable-pdfs")
    assert pdf["count"] == 0


@pytest.mark.asyncio
async def test_search_matches_title_maker_and_format(monkeypatch, digital_products):
    monkeypatch.setattr(dl, "_eligible_products", lambda limit=2000: _async(digital_products[:1] + digital_products[2:]))
    monkeypatch.setattr(dl, "_maker_names", lambda products: _async({"maker-one": {"slug": "maker-one", "name": "Maker One"}}))

    by_format = await dl.digital_downloads_search(q="svg")
    by_maker = await dl.digital_downloads_search(q="Maker One")

    assert [r["slug"] for r in by_format["results"]] == ["svg-cut-file"]
    assert [r["slug"] for r in by_maker["results"]] == ["svg-cut-file"]
    assert by_format["results"][0]["file_formats"] == ["SVG"]
    assert "url" in by_format["results"][0]


@pytest.mark.asyncio
async def test_catalog_filters_facets_pagination_and_invalids(monkeypatch, digital_products):
    rows = digital_products[:1] + digital_products[2:]
    monkeypatch.setattr(dl, "_eligible_products", lambda limit=5000: _async(rows))
    monkeypatch.setattr(dl, "_maker_names", lambda products: _async({}))
    monkeypatch.setattr(dl, "_review_map", lambda slugs: _async({"svg-cut-file": {"avg": 5, "count": 2}}))
    monkeypatch.setattr(dl, "_view_counts", lambda slugs, days=30: _async({"svg-cut-file": 3}))

    page = await dl.digital_downloads_catalog(format="svg", sort="rating", page=1, per_page=1)
    assert page["total"] == 1
    assert page["items"][0]["slug"] == "svg-cut-file"
    assert {f["value"] for f in page["facets"]["formats"]} == {"epub", "svg"}

    with pytest.raises(HTTPException):
        await dl.digital_downloads_catalog(category="not-real")
    with pytest.raises(HTTPException):
        await dl.digital_downloads_catalog(format="exe")
    with pytest.raises(HTTPException):
        await dl.digital_downloads_catalog(sort="random")


@pytest.mark.asyncio
async def test_sections_hide_when_no_products(monkeypatch):
    monkeypatch.setattr(dl, "_eligible_products", lambda limit=5000: _async([]))
    monkeypatch.setattr(dl, "_maker_names", lambda products: _async({}))
    monkeypatch.setattr(dl, "_review_map", lambda slugs: _async({}))
    monkeypatch.setattr(dl, "_view_counts", lambda slugs, days=14: _async({}))

    body = await dl.digital_downloads_sections()
    assert all(items == [] for items in body["sections"].values())
    assert {"staff_picks", "free_downloads", "recently_updated", "recommended_for_you", "bundle_highlights", "featured_collections"}.issubset(body["sections"].keys())
    assert body["featured_creator"] is None


async def _async(value):
    return value
