"""Iteration 66 — multi-format community design-file bundles.

Tests cover:
- Multi-file upload (primary + variants).
- 0 / 11 / duplicate-format guards.
- New format acceptance (dwg/jpg/png/webp/gcode/nc/tap) + old regression.
- POST /variants (add more formats) — success + 409 duplicate + 403 cross-user.
- DELETE /variants/{fmt} — success + 400 cannot remove primary + 404 unknown.
- Auto-thumbnail: jpg in bundle promotes to thumbnail_url.
"""
import os
import sys
import io
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env", override=True)
from maker_auth import issue_session_jwt  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://active-project-4.preview.emergentagent.com"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def maker_jwt():
    return issue_session_jwt("iron-and-oak", "iron-and-oak@craftersmarket.org", role="maker")


@pytest.fixture(scope="session")
def other_maker_jwt():
    return issue_session_jwt("metalart-pro", "metalart-pro@craftersmarket.org", role="maker")


@pytest.fixture(scope="session")
def buyer_jwt():
    # Buyers are frictionless — any email works.
    return issue_session_jwt("user_testiter66buyer", "iter66buyer@craftersmarket.org", role="buyer")


def _hdr(jwt):
    return {"Authorization": f"Bearer {jwt}"}


def _mk(name, content=b"binary-data-x", ct="application/octet-stream"):
    return ("files", (name, io.BytesIO(content), ct))


# ===== Primary: 3-file bundle upload =====
class TestMultiUpload:
    def test_three_file_bundle(self, maker_jwt):
        files = [
            _mk("hero.svg", b"<svg></svg>", "image/svg+xml"),
            _mk("cut.dxf", b"0\nSECTION\n"),
            _mk("prog.gcode", b"G0 X0 Y0\n"),
        ]
        r = requests.post(
            f"{API}/community/files/upload",
            files=files,
            data={"title": "TEST_iter66_tri", "description": "triple"},
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["file_type"] == "SVG"
        assert d["download_url"].lower().endswith(".svg")
        variants = d.get("variants") or []
        assert len(variants) == 2
        fmts = {v["format"] for v in variants}
        assert fmts == {"DXF", "GCODE"}
        for v in variants:
            assert "format" in v and "url" in v and "filename" in v
            assert "size_bytes" in v and "uploaded_at" in v
        # Cache id for later
        TestMultiUpload.file_id = d["id"]

    def test_zero_files(self, maker_jwt):
        r = requests.post(
            f"{API}/community/files/upload",
            data={"title": "x", "description": "y"},
            headers=_hdr(maker_jwt),
            timeout=15,
        )
        # FastAPI's List[UploadFile]=File(...) returns 422 when missing, or 400.
        assert r.status_code in (400, 422), r.text

    def test_eleven_files_rejected(self, maker_jwt):
        files = [_mk(f"f{i}.dxf" if i == 0 else f"f{i}.svg", b"x") for i in range(11)]
        # make each extension unique-ish to avoid duplicate-format 400 first
        exts = ["dxf", "svg", "stl", "pdf", "zip", "ai", "eps", "gcode", "nc", "tap", "png"]
        files = [_mk(f"f{i}.{exts[i]}", b"x") for i in range(11)]
        r = requests.post(
            f"{API}/community/files/upload",
            files=files,
            data={"title": "too many", "description": "x"},
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 400
        assert "10" in r.text.lower() or "at most" in r.text.lower()

    def test_duplicate_format_rejected(self, maker_jwt):
        files = [_mk("a.dxf", b"1"), _mk("b.dxf", b"2")]
        r = requests.post(
            f"{API}/community/files/upload",
            files=files,
            data={"title": "dup", "description": "x"},
            headers=_hdr(maker_jwt),
            timeout=15,
        )
        assert r.status_code == 400
        assert "duplicate" in r.text.lower()


# ===== New formats =====
class TestNewFormats:
    @pytest.mark.parametrize("ext,ct", [
        ("dwg", "image/x-dwg"),
        ("jpg", "image/jpeg"),
        ("png", "image/png"),
        ("webp", "image/webp"),
        ("gcode", "text/x-gcode"),
        ("nc", "application/octet-stream"),
        ("tap", "application/octet-stream"),
    ])
    def test_new_format_accepted(self, maker_jwt, ext, ct):
        files = [_mk(f"file.{ext}", b"data", ct)]
        r = requests.post(
            f"{API}/community/files/upload",
            files=files,
            data={"title": f"TEST_iter66_{ext}", "description": "single"},
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 200, f"{ext}: {r.text}"
        d = r.json()
        assert d["file_type"].lower() == ext.lower()

    @pytest.mark.parametrize("ext,ct", [
        ("stl", "model/stl"),
        ("pdf", "application/pdf"),
        ("zip", "application/zip"),
        ("svg", "image/svg+xml"),
    ])
    def test_legacy_formats_still_work(self, maker_jwt, ext, ct):
        files = [_mk(f"legacy.{ext}", b"data", ct)]
        r = requests.post(
            f"{API}/community/files/upload",
            files=files,
            data={"title": f"TEST_iter66_legacy_{ext}", "description": "x"},
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 200, f"{ext}: {r.text}"
        assert r.json()["file_type"].lower() == ext.lower()


# ===== Auto thumbnail =====
class TestAutoThumbnail:
    def test_jpg_auto_promotes_to_thumbnail(self, maker_jwt):
        files = [
            _mk("cut.dxf", b"0\nSECTION\n"),
            _mk("preview.jpg", b"\xff\xd8\xff\xe0JPG", "image/jpeg"),
        ]
        r = requests.post(
            f"{API}/community/files/upload",
            files=files,
            data={"title": "TEST_iter66_thumb", "description": "x"},
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["file_type"] == "DXF"
        assert d.get("thumbnail_url"), "thumbnail_url should be auto-set"
        assert d["thumbnail_url"].lower().endswith(".jpg")

    def test_explicit_thumb_wins_over_auto(self, maker_jwt):
        files = [
            _mk("cut.dxf", b"data"),
            _mk("auto.jpg", b"\xff\xd8\xff\xe0", "image/jpeg"),
        ]
        explicit = "https://example.com/mythumb.png"
        r = requests.post(
            f"{API}/community/files/upload",
            files=files,
            data={"title": "TEST_iter66_thumbwin", "description": "x",
                  "thumbnail_url": explicit},
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["thumbnail_url"] == explicit


# ===== /variants endpoints =====
class TestVariantsEndpoints:
    @pytest.fixture(scope="class")
    def owned_bundle(self, maker_jwt):
        r = requests.post(
            f"{API}/community/files/upload",
            files=[_mk("only.svg", b"<svg/>", "image/svg+xml")],
            data={"title": "TEST_iter66_varbase", "description": "x"},
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_add_fresh_variant(self, maker_jwt, owned_bundle):
        fid = owned_bundle["id"]
        r = requests.post(
            f"{API}/community/files/{fid}/variants",
            files=[_mk("extra.stl", b"solid stl", "model/stl")],
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert len(d["added"]) == 1
        assert d["added"][0]["format"] == "STL"

    def test_add_duplicate_format_409(self, maker_jwt, owned_bundle):
        fid = owned_bundle["id"]
        # SVG is the primary — trying to add another SVG should 409.
        r = requests.post(
            f"{API}/community/files/{fid}/variants",
            files=[_mk("dup.svg", b"<svg/>", "image/svg+xml")],
            headers=_hdr(maker_jwt),
            timeout=15,
        )
        assert r.status_code == 409, r.text

    def test_cross_user_403(self, buyer_jwt):
        # Create a bundle owned by the maker iron-and-oak and try with buyer
        maker_jwt_local = issue_session_jwt("iron-and-oak", "iron-and-oak@craftersmarket.org", role="maker")
        r = requests.post(
            f"{API}/community/files/upload",
            files=[_mk("x.svg", b"<svg/>", "image/svg+xml")],
            data={"title": "TEST_iter66_cross", "description": "x"},
            headers=_hdr(maker_jwt_local),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        fid = r.json()["id"]
        r2 = requests.post(
            f"{API}/community/files/{fid}/variants",
            files=[_mk("more.dxf", b"d")],
            headers=_hdr(buyer_jwt),
            timeout=15,
        )
        assert r2.status_code == 403, r2.text

    def test_delete_variant_success(self, maker_jwt, owned_bundle):
        fid = owned_bundle["id"]
        # STL was added in test_add_fresh_variant — remove it.
        r = requests.delete(
            f"{API}/community/files/{fid}/variants/STL",
            headers=_hdr(maker_jwt),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["removed"] == "STL"
        # Verify persisted in GET
        lst = requests.get(f"{API}/community/files", timeout=15).json()
        this = next((x for x in lst if x["id"] == fid), None)
        assert this is not None
        fmts = {v["format"] for v in (this.get("variants") or [])}
        assert "STL" not in fmts

    def test_delete_primary_400(self, maker_jwt, owned_bundle):
        fid = owned_bundle["id"]
        r = requests.delete(
            f"{API}/community/files/{fid}/variants/SVG",
            headers=_hdr(maker_jwt),
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "primary" in r.text.lower()

    def test_delete_unknown_format_404(self, maker_jwt, owned_bundle):
        fid = owned_bundle["id"]
        r = requests.delete(
            f"{API}/community/files/{fid}/variants/XYZ",
            headers=_hdr(maker_jwt),
            timeout=15,
        )
        assert r.status_code == 404, r.text
