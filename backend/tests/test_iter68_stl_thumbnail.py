"""Iteration 68 — STL → PNG thumbnail auto-renderer.

POST /api/community/files/{id}/render/stl-thumbnail

Coverage:
- Pure renderer unit: corrupted bytes → ValueError (mapped to 422 by endpoint).
- Happy path: STL-only bundle → 200 {ok, thumbnail_url, size_bytes>0}; PNG url
  resolves to image/png starting with PNG magic bytes (\\x89PNG).
- DB stamps thumbnail_url + thumbnail_auto_generated=true.
- Idempotency: second call returns 409 'already has a thumbnail'.
- DXF-only bundle → 400 'No STL in this bundle to render.'
- Cross-maker → 403 (reuses _is_design_file_owner from iter67 fix).
- Buyer JWT on maker bundle → 403.
- Corrupted STL end-to-end → 422 with friendly copy.
"""
import io
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env", override=True)

from maker_auth import issue_session_jwt, issue_buyer_magic_token  # noqa: E402
from stl_renderer import render_stl_to_png  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
API = f"{BASE_URL}/api"


def _hdr(jwt):
    return {"Authorization": f"Bearer {jwt}"}


@pytest.fixture(scope="session")
def maker_jwt():
    return issue_session_jwt("iron-and-oak", "iron-and-oak@craftersmarket.org", role="maker")


@pytest.fixture(scope="session")
def other_maker_jwt():
    return issue_session_jwt("test-other-iter68", "other-iter68@example.com", role="maker")


@pytest.fixture(scope="session")
def buyer_jwt():
    # Mint a magic token then verify to get a buyer JWT.
    email = "buyer-iter68@example.com"
    tok = issue_buyer_magic_token(email)
    r = requests.post(
        f"{API}/community/auth/magic/verify",
        json={"token": tok, "accept_eua": True, "eua_version": "2026-04"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _stl_bytes():
    """iter413at — Auto-generate a tiny synthetic STL on disk if missing
    so the test doesn't FileNotFoundError on fresh CI envs."""
    stl_path = "/tmp/test.stl"
    if not os.path.exists(stl_path):
        # 80-byte header + 4-byte triangle count + 50-byte triangle = minimal valid STL.
        import struct
        header = b"iter413at synthetic STL" + b" " * (80 - len("iter413at synthetic STL"))
        body = struct.pack("<I", 1)  # 1 triangle
        # normal + 3 vertices + attribute byte count (all zeros)
        triangle = struct.pack("<12fH", 0,0,1, 0,0,0, 1,0,0, 0,1,0, 0)
        with open(stl_path, "wb") as f:
            f.write(header + body + triangle)
    with open(stl_path, "rb") as f:
        return f.read()


def _dxf_bytes():
    import ezdxf
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_line((0, 0), (10, 10))
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


def _upload_bundle(jwt, files, title="TEST_iter68"):
    r = requests.post(
        f"{API}/community/files/upload",
        files=files,
        data={"title": title, "description": "iter68 test"},
        headers=_hdr(jwt),
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


# -------- Pure renderer unit tests --------
class TestRendererUnit:
    def test_corrupted_stl_raises_value_error(self):
        with pytest.raises(ValueError):
            render_stl_to_png(b"NOT AN STL")

    def test_empty_stl_raises_value_error(self):
        with pytest.raises(ValueError):
            render_stl_to_png(b"")

    def test_real_stl_renders_png(self):
        png = render_stl_to_png(_stl_bytes())
        assert isinstance(png, bytes)
        assert len(png) > 0
        assert png[:8].startswith(b"\x89PNG\r\n\x1a\n"), png[:8]


# -------- Endpoint tests --------
class TestRenderEndpoint:
    state = {}

    def test_01_upload_stl_only_bundle(self, maker_jwt):
        stl = _stl_bytes()
        files = [("files", ("iter68.stl", io.BytesIO(stl), "application/octet-stream"))]
        d = _upload_bundle(maker_jwt, files, title="TEST_iter68_stl_only")
        assert d["file_type"] == "STL"
        assert not d.get("thumbnail_url")
        TestRenderEndpoint.state["file_id"] = d["id"]

    def test_02_anonymous_401(self):
        fid = TestRenderEndpoint.state["file_id"]
        r = requests.post(f"{API}/community/files/{fid}/render/stl-thumbnail", timeout=30)
        assert r.status_code == 401, r.text

    def test_03_cross_maker_forbidden(self, maker_jwt, other_maker_jwt):
        stl = _stl_bytes()
        files = [("files", ("iter68_x.stl", io.BytesIO(stl), "application/octet-stream"))]
        d = _upload_bundle(maker_jwt, files, title="TEST_iter68_crossuser")
        fid = d["id"]
        r = requests.post(
            f"{API}/community/files/{fid}/render/stl-thumbnail",
            headers=_hdr(other_maker_jwt),
            timeout=60,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_04_buyer_forbidden(self, maker_jwt, buyer_jwt):
        fid = TestRenderEndpoint.state["file_id"]
        r = requests.post(
            f"{API}/community/files/{fid}/render/stl-thumbnail",
            headers=_hdr(buyer_jwt),
            timeout=30,
        )
        # Buyer does not own a maker-uploaded bundle → 403 (or 401/403-ish).
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"

    def test_05_happy_path(self, maker_jwt):
        fid = TestRenderEndpoint.state["file_id"]
        r = requests.post(
            f"{API}/community/files/{fid}/render/stl-thumbnail",
            headers=_hdr(maker_jwt),
            timeout=120,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("thumbnail_url", "").startswith("http")
        assert body.get("size_bytes", 0) > 0
        TestRenderEndpoint.state["thumb_url"] = body["thumbnail_url"]

    def test_06_png_url_valid(self):
        url = TestRenderEndpoint.state["thumb_url"]
        r = requests.get(url, timeout=30)
        assert r.status_code == 200
        ct = r.headers.get("Content-Type", "")
        assert "image/png" in ct.lower() or ct.lower().endswith("png"), ct
        assert r.content[:8].startswith(b"\x89PNG\r\n\x1a\n"), r.content[:8]

    def test_07_db_fields_persisted(self, maker_jwt):
        fid = TestRenderEndpoint.state["file_id"]
        # Public GET to verify.
        r = requests.get(f"{API}/community/files?limit=200", timeout=30)
        assert r.status_code == 200
        data = r.json()
        items = data.get("items") if isinstance(data, dict) else data
        match = next((f for f in (items or []) if f.get("id") == fid), None)
        assert match, "uploaded file not in list"
        assert match.get("thumbnail_url"), "thumbnail_url missing on listing"
        assert match.get("thumbnail_auto_generated") is True, (
            f"thumbnail_auto_generated not set: {match.get('thumbnail_auto_generated')!r}"
        )

    def test_08_idempotent_conflict(self, maker_jwt):
        fid = TestRenderEndpoint.state["file_id"]
        r = requests.post(
            f"{API}/community/files/{fid}/render/stl-thumbnail",
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 409, r.text
        assert "thumbnail" in r.text.lower()

    def test_09_no_stl_bundle_400(self, maker_jwt):
        # DXF-only bundle → 400 'No STL in this bundle to render.'
        files = [("files", ("iter68.dxf", io.BytesIO(_dxf_bytes()), "application/octet-stream"))]
        d = _upload_bundle(maker_jwt, files, title="TEST_iter68_dxf_only")
        fid = d["id"]
        r = requests.post(
            f"{API}/community/files/{fid}/render/stl-thumbnail",
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 400, r.text
        assert "stl" in r.text.lower()

    def test_10_unknown_file_404(self, maker_jwt):
        r = requests.post(
            f"{API}/community/files/does-not-exist-iter68/render/stl-thumbnail",
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 404, r.text

    def test_11_corrupted_stl_422(self, maker_jwt):
        # Upload a bundle whose STL is garbage bytes — endpoint should map
        # ValueError('Couldn't parse STL: ...') → 422 with friendly copy.
        files = [("files", ("bad.stl", io.BytesIO(b"NOT AN STL REALLY NOT"),
                            "application/octet-stream"))]
        d = _upload_bundle(maker_jwt, files, title="TEST_iter68_bad_stl")
        fid = d["id"]
        r = requests.post(
            f"{API}/community/files/{fid}/render/stl-thumbnail",
            headers=_hdr(maker_jwt),
            timeout=60,
        )
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"
        body_lower = r.text.lower()
        assert "corrupted" in body_lower or "unreadable" in body_lower or "slicer" in body_lower, r.text
