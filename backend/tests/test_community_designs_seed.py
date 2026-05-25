"""Backend tests for the Community Designs seed admin endpoints + public
listing + static asset reachability. Iteration 57."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
# Fallback to the frontend env var if backend env missing
if not BASE_URL or "localhost" in BASE_URL:
    BASE_URL = "https://active-project-4.preview.emergentagent.com"


def _mint_admin_jwt():
    """Mint a fresh admin JWT via the magic-link helper."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    import sys
    sys.path.insert(0, "/app/backend")
    from maker_auth import issue_admin_magic_token
    token = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": token}, timeout=15)
    assert r.status_code == 200, f"admin verify failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_mint_admin_jwt()}", "Content-Type": "application/json"}


# ---- Admin seed endpoints ----------------------------------------------------
class TestCommunityDesignsSeedAdmin:
    def test_status_admin_only(self):
        # No auth → 401/403
        r = requests.get(f"{BASE_URL}/api/admin/seed/community-designs/status", timeout=15)
        assert r.status_code in (401, 403), f"expected auth gate, got {r.status_code}"

    def test_status_counts(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/seed/community-designs/status", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "seeded_designs" in data
        assert "total_designs" in data
        assert isinstance(data["seeded_designs"], int)
        assert isinstance(data["total_designs"], int)
        assert data["total_designs"] >= data["seeded_designs"]

    def test_install_fixture_idempotent_and_preserves_downloads(self, admin_headers):
        # First install
        r1 = requests.post(f"{BASE_URL}/api/admin/seed/community-designs/install-fixture", headers=admin_headers, timeout=30)
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1.get("ok") is True
        assert d1.get("installed") == 10
        assert d1["totals_now"]["seeded_designs"] == 10

        # Re-install → still 10, idempotent
        r2 = requests.post(f"{BASE_URL}/api/admin/seed/community-designs/install-fixture", headers=admin_headers, timeout=30)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["installed"] == 10
        assert d2["totals_now"]["seeded_designs"] == 10


# ---- Public community files listing -----------------------------------------
class TestCommunityFilesPublic:
    def test_list_returns_seeded_designs(self):
        r = requests.get(f"{BASE_URL}/api/community/files", timeout=15)
        assert r.status_code == 200
        data = r.json()
        files = data.get("files", data) if isinstance(data, dict) else data
        assert isinstance(files, list)
        seeded = [f for f in files if f.get("is_seed") is True]
        assert len(seeded) >= 10, f"expected >=10 seeded designs in list, got {len(seeded)}"

        # Verify workshop attribution + SVG/DXF + slug-based URLs on at least one
        sample = seeded[0]
        assert sample["maker_name"] == "Crafters Market Workshop Team"
        assert sample["file_type"] == "svg"
        assert sample["thumbnail_url"].startswith("/seed-designs/")
        assert sample["download_url"].startswith("/seed-designs/")
        # variants contain a DXF
        variants = sample.get("variants", [])
        assert any(v.get("format") == "dxf" for v in variants), "expected dxf variant"


# ---- Static asset reachability ----------------------------------------------
class TestSeedDesignsStaticAssets:
    SLUGS = [
        "mountain-range-silhouette",
        "heart-monogram-blank",
        "welcome-arrow-sign-blank",
        "pine-tree-trio",
        "vertical-address-plaque",
        "8-petal-mandala",
        "classic-snowflake-ornament",
        "topo-contour-circles",
        "8-point-compass-rose",
        "heart-with-vine",
    ]

    @pytest.mark.parametrize("slug", SLUGS)
    def test_preview_jpg_200(self, slug):
        r = requests.get(f"{BASE_URL}/seed-designs/{slug}/preview.jpg", timeout=15)
        assert r.status_code == 200, f"preview.jpg missing for {slug}"

    @pytest.mark.parametrize("slug", SLUGS)
    def test_design_svg_200(self, slug):
        r = requests.get(f"{BASE_URL}/seed-designs/{slug}/design.svg", timeout=15)
        assert r.status_code == 200, f"design.svg missing for {slug}"

    @pytest.mark.parametrize("slug", SLUGS)
    def test_design_dxf_200(self, slug):
        r = requests.get(f"{BASE_URL}/seed-designs/{slug}/design.dxf", timeout=15)
        assert r.status_code == 200, f"design.dxf missing for {slug}"


# ---- Purge / re-install regression ------------------------------------------
class TestPurgeRegression:
    def test_purge_then_reinstall_round_trip(self, admin_headers):
        # Pre-state
        s0 = requests.get(f"{BASE_URL}/api/admin/seed/community-designs/status", headers=admin_headers, timeout=15).json()
        organic_before = s0["total_designs"] - s0["seeded_designs"]

        # Purge
        rp = requests.post(f"{BASE_URL}/api/admin/seed/community-designs/purge", headers=admin_headers, timeout=30)
        assert rp.status_code == 200
        dp = rp.json()
        assert dp.get("ok") is True
        assert dp.get("deleted") == s0["seeded_designs"]

        # Verify organic untouched
        s1 = requests.get(f"{BASE_URL}/api/admin/seed/community-designs/status", headers=admin_headers, timeout=15).json()
        assert s1["seeded_designs"] == 0
        organic_after = s1["total_designs"] - s1["seeded_designs"]
        assert organic_after == organic_before, "purge wrongly affected organic uploads"

        # Re-install to restore
        ri = requests.post(f"{BASE_URL}/api/admin/seed/community-designs/install-fixture", headers=admin_headers, timeout=30)
        assert ri.status_code == 200
        assert ri.json()["totals_now"]["seeded_designs"] == 10


# ---- Regression: featured-content seed endpoints still work -----------------
class TestFeaturedSeedRegression:
    def test_featured_seed_status(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/seed/featured-content/status", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "featured_makers" in d
        assert "featured_products" in d
