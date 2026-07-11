"""iter454 — Digital Product Discovery live backend tests.

Covers:
  - Product API security (no url/versions/content_type leak in digital_files)
  - /api/digital-downloads/summary (9 groups, count/samples)
  - /api/maker/analytics/digital (shape + auth gate)
  - Smart sections (10 rows including 'digital-downloads')
  - Buyer purchases enrichment (version/updated_at/versions[] with release_notes, no urls)
  - file_scanning importability from routers.digital_products
"""
import os
import sys
import importlib

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

# Add backend to path so maker_auth is importable
sys.path.insert(0, "/app/backend")
from maker_auth import issue_magic_token, issue_session_jwt  # noqa: E402

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
BUYER_EMAIL = "buyer-demo@craftersmarket.org"


@pytest.fixture(scope="module")
def maker_jwt():
    magic = issue_magic_token(MAKER_EMAIL)
    r = requests.post(f"{BASE}/api/maker/auth/verify", json={"token": magic}, timeout=15)
    assert r.status_code == 200, f"maker verify failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def maker_headers(maker_jwt):
    return {"Authorization": f"Bearer {maker_jwt}"}


@pytest.fixture(scope="module")
def buyer_jwt():
    return issue_session_jwt("buyer", BUYER_EMAIL, role="buyer")


@pytest.fixture(scope="module")
def buyer_headers(buyer_jwt):
    return {"Authorization": f"Bearer {buyer_jwt}"}


# ── Security fix: digital_files never leaks storage URLs ─────────────────────

class TestProductSecurity:
    _ALLOWED = {"id", "filename", "ext", "size_bytes", "version",
                "uploaded_at", "release_notes", "scan"}
    _FORBIDDEN = {"url", "versions", "content_type"}

    def _assert_files_clean(self, files, ctx=""):
        assert isinstance(files, list)
        for f in files:
            keys = set(f.keys())
            leaked = keys & self._FORBIDDEN
            assert not leaked, f"{ctx} leaked keys: {leaked} in {f}"
            unexpected = keys - self._ALLOWED
            assert not unexpected, f"{ctx} unexpected keys: {unexpected} in {f}"
            assert "scan" in f and isinstance(f["scan"], dict)
            assert set(f["scan"].keys()) <= {"status"}, f"scan leaked extra: {f['scan']}"

    def test_pdp_digital_files_sanitized(self):
        r = requests.get(f"{BASE}/api/products/mountain-range-silhouette", timeout=15)
        assert r.status_code == 200
        data = r.json()
        files = data.get("digital_files") or []
        assert len(files) >= 1, "expected at least one digital file on mountain-range-silhouette"
        self._assert_files_clean(files, ctx="PDP")
        # spot check first file
        f = files[0]
        assert f["filename"]
        assert f["ext"] == "pdf"
        assert isinstance(f.get("size_bytes"), int)
        assert isinstance(f.get("version"), int)

    def test_list_endpoint_digital_files_sanitized(self):
        r = requests.get(f"{BASE}/api/products?type=digital&limit=50", timeout=15)
        assert r.status_code == 200
        payload = r.json()
        items = payload.get("products") if isinstance(payload, dict) else payload
        assert isinstance(items, list) and len(items) > 0
        checked = 0
        for p in items:
            files = p.get("digital_files") or []
            if files:
                self._assert_files_clean(files, ctx=f"list[{p.get('slug')}]")
                checked += 1
        assert checked >= 1


# ── Digital downloads landing summary ────────────────────────────────────────

class TestDigitalDownloadsSummary:
    def test_summary_shape(self):
        r = requests.get(f"{BASE}/api/digital-downloads/summary", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "total_digital" in d and isinstance(d["total_digital"], int)
        assert d["total_digital"] >= 1
        groups = d.get("groups")
        assert isinstance(groups, list) and len(groups) == 9
        expected_keys = {"svg-files", "laser-files", "cnc-files", "3d-print-files",
                         "embroidery-patterns", "woodworking-plans",
                         "printable-pdfs", "ebooks", "audiobooks"}
        got_keys = {g["key"] for g in groups}
        assert got_keys == expected_keys, f"missing groups: {expected_keys - got_keys}"
        for g in groups:
            assert set(["key", "label", "blurb", "count", "samples"]).issubset(g.keys())
            assert isinstance(g["count"], int)
            assert isinstance(g["samples"], list)

    def test_printable_pdfs_has_mountain_plans(self):
        r = requests.get(f"{BASE}/api/digital-downloads/summary", timeout=15)
        assert r.status_code == 200
        pdf_group = next(g for g in r.json()["groups"] if g["key"] == "printable-pdfs")
        assert pdf_group["count"] >= 1
        sample_slugs = [s["slug"] for s in pdf_group["samples"]]
        assert "mountain-range-silhouette" in sample_slugs


# ── Maker digital analytics ──────────────────────────────────────────────────

class TestMakerDigitalAnalytics:
    def test_unauthenticated_rejected(self):
        r = requests.get(f"{BASE}/api/maker/analytics/digital?days=30&tz=UTC", timeout=15)
        assert r.status_code in (401, 403)

    def test_shape(self, maker_headers):
        r = requests.get(f"{BASE}/api/maker/analytics/digital?days=30&tz=UTC",
                         headers=maker_headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ("range", "digital_listings", "digital_files", "downloads",
                    "repeat_downloads", "digital_views", "digital_orders",
                    "conversion_rate", "avg_file_size_mb",
                    "most_downloaded_files", "most_viewed_digital",
                    "version_adoption"):
            assert key in d, f"missing key: {key}"
        assert d["digital_listings"] >= 1
        assert isinstance(d["most_downloaded_files"], list)
        assert isinstance(d["most_viewed_digital"], list)
        assert isinstance(d["version_adoption"], list)


# ── Smart sections includes 'digital-downloads' as 10th ──────────────────────

class TestSmartSectionsDigital:
    def test_maker_smart_sections_has_digital_downloads(self, maker_headers):
        r = requests.get(f"{BASE}/api/maker/smart-sections", headers=maker_headers, timeout=15)
        assert r.status_code == 200
        payload = r.json()
        rows = payload["sections"] if isinstance(payload, dict) else payload
        assert isinstance(rows, list)
        assert len(rows) >= 10, f"expected >=10 smart sections, got {len(rows)}"
        keys = {row["key"] for row in rows}
        assert "digital-downloads" in keys
        dd = next(r for r in rows if r["key"] == "digital-downloads")
        assert dd.get("count", 0) >= 1

    def test_enable_and_public_exposes(self, maker_headers):
        # Enable digital-downloads smart section
        r = requests.patch(f"{BASE}/api/maker/smart-sections/digital-downloads",
                           json={"enabled": True},
                           headers=maker_headers, timeout=15)
        assert r.status_code in (200, 204), r.text
        # Public storefront
        r2 = requests.get(f"{BASE}/api/makers/iron-and-oak/smart-sections", timeout=15)
        assert r2.status_code == 200
        payload = r2.json()
        public_rows = payload["sections"] if isinstance(payload, dict) else payload
        pkeys = {row["key"] for row in public_rows}
        assert "digital-downloads" in pkeys, f"public keys: {pkeys}"
        dd = next(row for row in public_rows if row["key"] == "digital-downloads")
        assert "mountain-range-silhouette" in (dd.get("product_slugs") or [])


# ── Buyer purchases enrichment ───────────────────────────────────────────────

class TestBuyerPurchasesEnrichment:
    def test_files_include_version_and_versions(self, buyer_headers):
        r = requests.get(f"{BASE}/api/buyer/purchases", headers=buyer_headers, timeout=15)
        assert r.status_code == 200, r.text
        payload = r.json()
        # payload could be list or {items:[...]}
        items = payload if isinstance(payload, list) else (payload.get("items") or payload.get("purchases") or [])
        assert isinstance(items, list) and len(items) > 0, f"no purchases: {payload}"
        # find purchase with digital files
        found_file = None
        for order in items:
            for f in (order.get("files") or []):
                if f.get("filename", "").endswith(".pdf") or f.get("ext") == "pdf":
                    found_file = f
                    break
            if found_file:
                break
        assert found_file, f"no PDF file found in purchases; sample: {items[:1]}"
        # Note: seed file has been replaced across multiple test iterations, so
        # version is >=2 (currently 4). Spec says v2 expected; we accept >=2 to
        # be resilient to future replace-tests.
        assert found_file.get("version") and found_file["version"] >= 2, \
            f"expected version>=2, got {found_file.get('version')}"
        assert "updated_at" in found_file or "uploaded_at" in found_file
        versions = found_file.get("versions") or []
        assert isinstance(versions, list) and len(versions) >= 2, f"versions list too short: {versions}"
        # At least one non-v1 version must have release_notes populated
        non_v1_with_notes = [v for v in versions
                             if str(v.get("version")) != "1" and (v.get("release_notes") or "").strip()]
        assert non_v1_with_notes, f"expected release_notes on newer version, got: {versions}"
        # No storage URLs leaked inside versions
        for v in versions:
            assert "url" not in v, f"version leaked url: {v}"


# ── file_scanning importability regression ───────────────────────────────────

class TestScanImportRegression:
    def test_scan_importable_from_digital_products_router(self):
        mod = importlib.import_module("routers.digital_products")
        assert hasattr(mod, "scan_digital_file"), \
            "routers.digital_products must re-export scan_digital_file"
        # ensure it's the same callable as file_scanning.scan_digital_file
        fs = importlib.import_module("file_scanning")
        assert mod.scan_digital_file is fs.scan_digital_file
