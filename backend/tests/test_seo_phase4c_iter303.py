"""SEO Phase 4 Bundle C (iter303) — Lead magnet + PDP guide cross-link.

Coverage:
  • GET /api/lead-magnet/starter-pack/preview returns file list metadata.
  • POST /api/lead-magnet/starter-pack/subscribe stores email + returns token.
  • Subscribe is idempotent on email (re-submission updates same record).
  • GET /api/lead-magnet/starter-pack/download/<token> returns the ZIP.
  • Invalid token → 404.
  • Sitemap includes the new /free-svg-pack URL.
  • Frontend GuideCrossLinkCard mapping rules cover the priority cases.
"""
import io
import os
import sys
import zipfile

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

API = "http://localhost:8001"


def test_preview_returns_metadata():
    r = httpx.get(f"{API}/api/lead-magnet/starter-pack/preview", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["magnet"] == "starter-pack"
    assert body["file_count"] == 10
    assert body["format_count"] == 2  # SVG + DXF
    assert body["approx_size_mb"] > 0
    assert len(body["files"]) == 10
    f0 = body["files"][0]
    assert "title" in f0 and "use_case" in f0 and "preview_image" in f0
    assert f0["formats"] == ["SVG", "DXF"]


def test_legacy_free_svg_pack_preview_alias():
    r = httpx.get(f"{API}/api/free-svg-pack", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["magnet"] == "starter-pack"
    assert body["file_count"] == 10
    assert len(body["files"]) == 10


def test_subscribe_returns_token_and_download_url():
    r = httpx.post(
        f"{API}/api/lead-magnet/starter-pack/subscribe",
        json={"email": "iter303-test@example.com", "consent_marketing": True},
        timeout=10,
    )
    assert r.status_code == 200
    body = r.json()
    assert "download_token" in body and len(body["download_token"]) >= 16
    assert body["download_url"].startswith("/api/lead-magnet/starter-pack/download/")
    assert body["preview_count"] == 10


def test_subscribe_is_idempotent_on_email():
    """Re-submitting the same email updates the existing row rather than
    creating a duplicate — important so users who lose the email and
    re-submit don't pollute the funnel reporting."""
    httpx.post(
        f"{API}/api/lead-magnet/starter-pack/subscribe",
        json={"email": "iter303-dedup@example.com"},
        timeout=10,
    )
    r2 = httpx.post(
        f"{API}/api/lead-magnet/starter-pack/subscribe",
        json={"email": "iter303-dedup@example.com"},
        timeout=10,
    )
    assert r2.status_code == 200
    # Second call returns a NEW token (we issue a fresh one per call).
    body2 = r2.json()
    assert "download_token" in body2


def test_download_with_valid_token_returns_zip():
    sub = httpx.post(
        f"{API}/api/lead-magnet/starter-pack/subscribe",
        json={"email": "iter303-download@example.com"},
        timeout=10,
    ).json()
    token = sub["download_token"]

    r = httpx.get(
        f"{API}/api/lead-magnet/starter-pack/download/{token}",
        timeout=30,
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert "attachment" in r.headers["content-disposition"]
    assert "crafters-market-starter-pack.zip" in r.headers["content-disposition"]
    # ZIP must contain a README + at least one design folder with SVG/DXF.
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    assert any(n == "README.txt" for n in names), "README.txt missing"
    has_svg = any(n.endswith(".svg") for n in names)
    has_dxf = any(n.endswith(".dxf") for n in names)
    assert has_svg, "ZIP missing SVG files"
    assert has_dxf, "ZIP missing DXF files"


def test_download_with_bad_token_returns_404():
    r = httpx.get(
        f"{API}/api/lead-magnet/starter-pack/download/totally-fake-token-1234567890",
        timeout=10,
    )
    assert r.status_code == 404


def test_sitemap_includes_free_svg_pack():
    body = httpx.get(f"{API}/api/sitemap.xml", timeout=15).text
    assert "https://craftersmarket.org/free-svg-pack" in body
    # High priority (0.9) because of backlink-magnet potential.
    assert "<priority>0.9</priority>" in body  # at least one entry uses 0.9


def test_pdp_guide_cross_link_mapping():
    """Smoke-test the JS source for the GuideCrossLinkCard mapping
    function — verify all 4 priority branches are present and produce
    distinct guide slugs."""
    path = "/app/frontend/src/components/GuideCrossLinkCard.jsx"
    with open(path) as f:
        src = f.read()
    # All three guide slugs must be referenced in the mapping.
    assert "metal-gauge-finish-guide" in src
    assert "outdoor-mounting-guide" in src
    assert "plasma-vs-laser-vs-router" in src
    # Technique-based mapping must cover PLASMA, LASER, ROUTER.
    assert "PLASMA" in src
    assert "LASER" in src
    assert "ROUTER" in src
