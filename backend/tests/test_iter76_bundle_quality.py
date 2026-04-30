"""Iter76 — Bundle Quality Score for community design files."""
from __future__ import annotations
import pytest


def test_score_full_bundle_hits_excellent():
    from routers.community import _compute_quality_score
    doc = {
        "title": "Forge & Fern · Mountain Laser Pack",
        "description": "Laser-cut mountain silhouettes — A4 sheet, 4 sizes. Includes step-files for engraving depth control.",
        "thumbnail_url": "https://r2.../m.png",
        "file_type": "DXF",
        "variants": [
            {"format": "SVG"},
            {"format": "STL"},
        ],
    }
    r = _compute_quality_score(doc)
    assert r["score"] == 100
    assert r["tier"] == "excellent"
    # All 5 dimensions earned
    assert all(b["earned"] for b in r["breakdown"])


def test_score_minimal_upload_is_incomplete():
    """A bare upload (no thumb, no description, single PNG) — should
    show as incomplete to nudge the uploader to flesh it out."""
    from routers.community import _compute_quality_score
    doc = {"title": "x", "description": "", "thumbnail_url": "", "file_type": "PNG", "variants": []}
    r = _compute_quality_score(doc)
    assert r["score"] < 40
    assert r["tier"] == "incomplete"


def test_score_breakdown_includes_actionable_hints_for_missed_dimensions():
    """Hints power the tooltip — uploaders see exactly what to add."""
    from routers.community import _compute_quality_score
    doc = {"description": "", "thumbnail_url": "", "file_type": "PNG", "variants": []}
    r = _compute_quality_score(doc)
    missed = [b for b in r["breakdown"] if not b["earned"]]
    assert all(b.get("hint") for b in missed)


def test_score_thumbnail_alone_doesnt_pass_basic():
    """A thumbnail (25 pts) without anything else only hits 25 — the
    score should reflect that production-readiness matters more than
    a pretty preview."""
    from routers.community import _compute_quality_score
    doc = {"thumbnail_url": "https://r2.../m.png", "file_type": "PNG", "description": ""}
    r = _compute_quality_score(doc)
    assert r["score"] == 25
    assert r["tier"] == "incomplete"


def test_score_dxf_plus_thumb_plus_desc_lands_good():
    """DXF + thumb + decent description = 25 + 15 + 20 (production-ready) = 60 → good tier."""
    from routers.community import _compute_quality_score
    doc = {
        "thumbnail_url": "https://r2.../m.png",
        "description": "Single-piece laser-cut DXF for a 12-inch trivet. Ready for 1/4 inch baltic birch.",
        "file_type": "DXF",
        "variants": [],
    }
    r = _compute_quality_score(doc)
    assert r["score"] == 60
    assert r["tier"] == "good"


def test_score_2d_plus_3d_unlocks_perfect_score():
    """The +20 coverage bonus is what pushes a polished bundle from
    excellent (80) to a perfect 100. Both tiers are 'excellent' but
    100 is the gold standard reserved for cross-workflow coverage."""
    from routers.community import _compute_quality_score
    only_2d = {
        "thumbnail_url": "x", "description": "x" * 60,
        "file_type": "DXF", "variants": [{"format": "SVG"}],
    }
    full = dict(only_2d, variants=[{"format": "SVG"}, {"format": "STL"}])
    r1 = _compute_quality_score(only_2d)
    r2 = _compute_quality_score(full)
    assert r2["score"] - r1["score"] == 20
    assert r1["score"] == 80
    assert r2["score"] == 100
    # Both still "excellent" — but 100 is the perfect bundle
    assert r1["tier"] == "excellent"
    assert r2["tier"] == "excellent"


def test_compute_handles_missing_keys_gracefully():
    """Old design_files docs may pre-date some fields — never raise."""
    from routers.community import _compute_quality_score
    r = _compute_quality_score({})
    assert "score" in r
    assert "tier" in r
    assert r["score"] >= 0


def test_with_quality_returns_a_copy_not_mutated_doc():
    """Make sure inserting `quality` doesn't bleed into the cached
    Mongo document — the function should return a fresh dict."""
    from routers.community import _with_quality
    src = {"title": "x", "file_type": "DXF"}
    out = _with_quality(src)
    assert "quality" in out
    assert "quality" not in src


@pytest.mark.asyncio
async def test_list_endpoint_includes_quality_field():
    """End-to-end shape — `/api/community/files` rows now ship with
    a `quality` block by default (no opt-in flag needed)."""
    from unittest.mock import AsyncMock, MagicMock, patch
    from routers.community import list_design_files

    fake_db = MagicMock()
    rows = [
        {"id": "1", "title": "T1", "file_type": "DXF",
         "thumbnail_url": "x", "description": "x" * 60,
         "variants": [{"format": "SVG"}]},
    ]
    fake_db.design_files.find = MagicMock(return_value=MagicMock(
        sort=MagicMock(return_value=MagicMock(
            to_list=AsyncMock(return_value=rows),
        )),
    ))
    with patch("routers.community.db", fake_db):
        out = await list_design_files(limit=10)
    assert len(out) == 1
    assert "quality" in out[0]
    assert out[0]["quality"]["score"] == 80  # thumb+desc+multi-format+prod-ready
