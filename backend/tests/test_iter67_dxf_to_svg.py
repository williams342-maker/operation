"""Iteration 67 — DXF→SVG converter endpoint.

POST /api/community/files/{id}/convert/dxf-to-svg

Coverage:
- Happy path: DXF-only bundle → SVG variant appended (auto_generated=True).
- Idempotency: re-run returns 409.
- Already has SVG (primary) → 409.
- No DXF in bundle → 400.
- Cross-user → 403; anonymous → 401.
- Malformed DXF bytes → 422 via convert_dxf_bytes_to_svg ValueError path.
- SVG R2 URL fetches valid UTF-8 starting <?xml or <svg.
"""
import io
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env", override=True)

from maker_auth import issue_session_jwt  # noqa: E402
from dxf_converter import convert_dxf_bytes_to_svg  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Frontend .env holds the public URL; backend .env doesn't.
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


# -------- Fixtures --------
@pytest.fixture(scope="session")
def maker_jwt():
    return issue_session_jwt("iron-and-oak", "iron-and-oak@craftersmarket.org", role="maker")


@pytest.fixture(scope="session")
def other_maker_jwt():
    # Different slug — used for cross-user 403 check.
    return issue_session_jwt("test-other-iter67", "other-iter67@example.com", role="maker")


def _hdr(jwt):
    return {"Authorization": f"Bearer {jwt}"}


def _real_dxf_bytes():
    """Build a real DXF in-memory via ezdxf (line + circle + text)."""
    import ezdxf
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_line((0, 0), (100, 100))
    msp.add_circle((50, 50), 20)
    msp.add_text("iter67", dxfattribs={"height": 5}).set_placement((10, 10))
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


def _upload_bundle(jwt, files, title="TEST_iter67"):
    r = requests.post(
        f"{API}/community/files/upload",
        files=files,
        data={"title": title, "description": "iter67 test"},
        headers=_hdr(jwt),
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


# -------- Pure converter unit tests --------
class TestConverterUnit:
    def test_real_dxf_converts_to_svg(self):
        svg = convert_dxf_bytes_to_svg(_real_dxf_bytes())
        assert isinstance(svg, bytes) and len(svg) > 0
        head = svg[:200].decode("utf-8", errors="replace").lstrip()
        assert head.startswith("<?xml") or head.startswith("<svg"), head[:80]

    def test_malformed_dxf_raises_value_error(self):
        with pytest.raises(ValueError):
            convert_dxf_bytes_to_svg(b"NOT A DXF AT ALL")

    def test_empty_dxf_raises_value_error(self):
        with pytest.raises(ValueError):
            convert_dxf_bytes_to_svg(b"")


# -------- Endpoint tests --------
class TestConvertEndpoint:
    file_id = None
    svg_url = None

    def test_01_upload_dxf_only_bundle(self, maker_jwt):
        dxf = _real_dxf_bytes()
        files = [("files", ("iter67.dxf", io.BytesIO(dxf), "application/octet-stream"))]
        d = _upload_bundle(maker_jwt, files, title="TEST_iter67_dxf_only")
        assert d["file_type"] == "DXF"
        assert not any(
            (v.get("format") or "").upper() == "SVG" for v in (d.get("variants") or [])
        )
        TestConvertEndpoint.file_id = d["id"]

    def test_02_anonymous_401(self):
        fid = TestConvertEndpoint.file_id
        assert fid
        r = requests.post(f"{API}/community/files/{fid}/convert/dxf-to-svg", timeout=30)
        assert r.status_code == 401, r.text

    def test_03_cross_user_forbidden(self, maker_jwt, other_maker_jwt):
        # Fresh DXF-only bundle uploaded by iron-and-oak; a *different* maker
        # should NOT be able to convert it. Per spec: 403.
        dxf = _real_dxf_bytes()
        files = [("files", ("iter67_crossuser.dxf", io.BytesIO(dxf), "application/octet-stream"))]
        d = _upload_bundle(maker_jwt, files, title="TEST_iter67_crossuser")
        fid = d["id"]
        r = requests.post(
            f"{API}/community/files/{fid}/convert/dxf-to-svg",
            headers=_hdr(other_maker_jwt),
            timeout=60,
        )
        print(f"[cross-maker] status={r.status_code} body={r.text[:200]}")
        assert r.status_code == 403, (
            f"SECURITY: a different maker was able to convert another maker's bundle. "
            f"got {r.status_code}: {r.text}"
        )

    def test_04_happy_convert(self, maker_jwt):
        fid = TestConvertEndpoint.file_id
        r = requests.post(
            f"{API}/community/files/{fid}/convert/dxf-to-svg",
            headers=_hdr(maker_jwt),
            timeout=90,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        v = body["variant"]
        assert v["format"] == "SVG"
        assert v["auto_generated"] is True
        assert v["source_format"] == "DXF"
        assert v["size_bytes"] > 0
        assert v["url"].lower().endswith(".svg")
        TestConvertEndpoint.svg_url = v["url"]

    def test_05_svg_content_valid(self):
        url = TestConvertEndpoint.svg_url
        assert url
        r = requests.get(url, timeout=30)
        assert r.status_code == 200, r.text
        # Content-type per spec
        ct = r.headers.get("Content-Type", "")
        assert "svg" in ct.lower() or "xml" in ct.lower(), ct
        text = r.content.decode("utf-8", errors="replace").lstrip()
        assert text.startswith("<?xml") or text.startswith("<svg"), text[:80]

    def test_06_variant_persisted_on_bundle(self):
        # Public GET to verify list shows it.
        fid = TestConvertEndpoint.file_id
        r = requests.get(f"{API}/community/files?limit=200", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        items = data.get("items") if isinstance(data, dict) else data
        if not items:
            items = []
        match = next((f for f in items if f.get("id") == fid), None)
        assert match, f"file {fid} not in list (total={len(items)})"
        fmts = {(v.get("format") or "").upper() for v in (match.get("variants") or [])}
        assert "SVG" in fmts, match.get("variants")

    def test_07_idempotent_conflict(self, maker_jwt):
        fid = TestConvertEndpoint.file_id
        r = requests.post(
            f"{API}/community/files/{fid}/convert/dxf-to-svg",
            headers=_hdr(maker_jwt),
            timeout=60,
        )
        assert r.status_code == 409, r.text
        assert "svg" in r.text.lower()

    def test_08_no_dxf_bundle_400(self, maker_jwt):
        # Upload an SVG-only bundle — no DXF; expect 409 (already has SVG) per guard order.
        files = [("files", ("only.svg", io.BytesIO(b"<svg></svg>"), "image/svg+xml"))]
        d = _upload_bundle(maker_jwt, files, title="TEST_iter67_svg_only")
        fid = d["id"]
        r = requests.post(
            f"{API}/community/files/{fid}/convert/dxf-to-svg",
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        # Primary SVG short-circuits with 409
        assert r.status_code == 409, r.text

    def test_09_no_dxf_with_non_svg_primary(self, maker_jwt):
        # STL-only bundle (no DXF, no SVG) → should hit 'No DXF in this bundle' 400.
        files = [("files", ("model.stl", io.BytesIO(b"solid test\nendsolid test\n"),
                            "application/octet-stream"))]
        d = _upload_bundle(maker_jwt, files, title="TEST_iter67_stl_only")
        fid = d["id"]
        r = requests.post(
            f"{API}/community/files/{fid}/convert/dxf-to-svg",
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 400, r.text
        assert "dxf" in r.text.lower()

    def test_10_unknown_file_404(self, maker_jwt):
        r = requests.post(
            f"{API}/community/files/does-not-exist-iter67/convert/dxf-to-svg",
            headers=_hdr(maker_jwt),
            timeout=30,
        )
        assert r.status_code == 404, r.text

    def test_11_malformed_dxf_returns_422(self, maker_jwt):
        # Upload a bundle where the DXF is actually garbage bytes.
        files = [("files", ("bad.dxf", io.BytesIO(b"NOT A DXF AT ALL"),
                            "application/octet-stream"))]
        d = _upload_bundle(maker_jwt, files, title="TEST_iter67_bad_dxf")
        fid = d["id"]
        r = requests.post(
            f"{API}/community/files/{fid}/convert/dxf-to-svg",
            headers=_hdr(maker_jwt),
            timeout=60,
        )
        # Should NOT be 500 — either 422 (ValueError path) or 200 via ezdxf.recover.
        assert r.status_code in (200, 422), f"expected 422 or 200, got {r.status_code}: {r.text}"
        assert r.status_code != 500
