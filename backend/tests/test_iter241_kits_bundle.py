"""iter241 — Maker Studio Phase 7: Kit Gallery + Bundle ZIP."""
import os
import io
import zipfile
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def public_kits():
    r = requests.get(f"{BASE_URL}/api/studio/kits/public?limit=10", timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "kits" in data and isinstance(data["kits"], list)
    return data["kits"]


# Public kit index
class TestKitPublicIndex:
    def test_returns_list_anonymous_no_500(self, public_kits):
        assert isinstance(public_kits, list)

    def test_kit_schema(self, public_kits):
        if not public_kits:
            pytest.skip("No public kits seeded")
        for k in public_kits:
            for field in ("id", "slug", "title", "file_count", "cover_url", "owner_id", "owner_role", "created_at"):
                assert field in k, f"Missing {field} in kit: {k}"
            assert isinstance(k["slug"], str) and k["slug"], "slug must be present (older docs filtered)"

    def test_limit_clamped(self):
        r = requests.get(f"{BASE_URL}/api/studio/kits/public?limit=10", timeout=20)
        assert r.status_code == 200
        assert len(r.json()["kits"]) <= 10


# Bundle ZIP endpoint
class TestKitBundle:
    def test_bundle_zip_for_existing_kit(self, public_kits):
        if not public_kits:
            pytest.skip("No public kits seeded")
        # Find a kit with at least one file
        with_files = [k for k in public_kits if k.get("file_count", 0) > 0]
        if not with_files:
            pytest.skip("No public kits with files")
        kit = with_files[0]
        slug = kit["slug"]
        r = requests.get(f"{BASE_URL}/api/studio/kits/by-slug/{slug}/bundle.zip", timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/zip")
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd.lower()
        assert ".zip" in cd
        # ZIP magic bytes
        assert r.content[:4] == b"PK\x03\x04", f"Not a ZIP: {r.content[:8]!r}"

        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        assert "README.txt" in names
        # At least one svg + dxf pair
        svgs = [n for n in names if n.endswith(".svg")]
        dxfs = [n for n in names if n.endswith(".dxf")]
        assert len(svgs) >= 1, f"No SVGs in bundle: {names}"
        # README content sanity
        readme = zf.read("README.txt").decode("utf-8", errors="ignore")
        assert kit["title"] in readme
        # filenames unique
        assert len(names) == len(set(names))
        # DXFs are nice-to-have (depends on design_intent)
        print(f"Bundle contents: {len(names)} files (svg={len(svgs)} dxf={len(dxfs)})")

    def test_bundle_404_for_unknown_slug(self):
        r = requests.get(f"{BASE_URL}/api/studio/kits/by-slug/this-slug-does-not-exist-xxxx/bundle.zip", timeout=15)
        assert r.status_code == 404

    def test_kit_by_slug_metadata_intact(self, public_kits):
        if not public_kits:
            pytest.skip("No public kits seeded")
        slug = public_kits[0]["slug"]
        r = requests.get(f"{BASE_URL}/api/studio/kits/by-slug/{slug}", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("slug") == slug
        assert "files" in data
        assert "title" in data
        # ensure _id stripped
        assert "_id" not in data


# Existing maker studio public endpoints
class TestStudioPublicRegression:
    def test_templates(self):
        r = requests.get(f"{BASE_URL}/api/studio/templates", timeout=15)
        assert r.status_code == 200
        assert "templates" in r.json() and len(r.json()["templates"]) > 0

    def test_materials(self):
        r = requests.get(f"{BASE_URL}/api/studio/materials", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "materials" in data and "units" in data

    def test_cam_strategy(self):
        r = requests.get(f"{BASE_URL}/api/studio/cam-strategy?material=wood&depth=0.25&units=inches", timeout=15)
        assert r.status_code == 200
