"""iter453 — LIVE API tests for Digital Products Phase 4 + Maker Agreement.

Runs against the running preview backend via REACT_APP_BACKEND_URL. Complements the
unit tests in test_iter453_digital_phase4.py by exercising the deployed endpoints
end-to-end (including a real R2 upload).
"""
import os
import uuid
import time
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
from maker_auth import issue_session_jwt, issue_magic_token, issue_admin_magic_token  # noqa: E402

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")

# --- Test data anchors from seed --------------------------------------------
LISTING_SLUG = "mountain-range-silhouette"  # iron-and-oak, listing_type=both
SEED_TX = "seed-digital-demo-1"
BUYER_EMAIL = "buyer-demo@craftersmarket.org"
IRON_EMAIL = "iron-and-oak@craftersmarket.org"
METAL_EMAIL = "metalart-pro@craftersmarket.org"
ADMIN_EMAIL = "team@craftersmarket.org"


# --- Fixtures ---------------------------------------------------------------
def _verify_maker(email: str) -> str:
    tok = issue_magic_token(email)
    r = requests.post(f"{BASE}/api/maker/auth/verify", json={"token": tok}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def iron_jwt():
    return _verify_maker(IRON_EMAIL)


@pytest.fixture(scope="module")
def metal_jwt():
    return _verify_maker(METAL_EMAIL)


@pytest.fixture(scope="module")
def buyer_jwt():
    return issue_session_jwt("buyer", BUYER_EMAIL, role="buyer")


@pytest.fixture(scope="module")
def admin_jwt():
    return issue_session_jwt("admin", ADMIN_EMAIL, role="admin")


def _H(jwt):  # auth header helper
    return {"Authorization": f"Bearer {jwt}"}


# --- Agreement status/accept/admin ------------------------------------------
class TestMakerAgreement:
    def test_status_unauth_rejected(self):
        r = requests.get(f"{BASE}/api/maker/agreement/status", timeout=15)
        assert r.status_code in (401, 403)

    def test_status_current_version(self, iron_jwt):
        r = requests.get(f"{BASE}/api/maker/agreement/status", headers=_H(iron_jwt), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["current_version"] == "1.0"
        assert "requires_acceptance" in d

    def test_accept_wrong_version_409(self, metal_jwt):
        r = requests.post(f"{BASE}/api/maker/agreement/accept",
                          json={"version": "0.9"}, headers=_H(metal_jwt), timeout=15)
        assert r.status_code == 409

    def test_accept_records_ip_ua_and_appends(self, metal_jwt):
        """Use metalart-pro (not iron-and-oak) to avoid disturbing dashboard tests."""
        headers = {**_H(metal_jwt), "user-agent": "iter116-test-UA",
                   "x-forwarded-for": "203.0.113.55, 10.0.0.9"}
        r = requests.post(f"{BASE}/api/maker/agreement/accept",
                          json={"version": "1.0"}, headers=headers, timeout=15)
        assert r.status_code == 201, r.text
        acc = r.json()["acceptance"]
        assert acc["version"] == "1.0"
        assert acc["ip"] == "203.0.113.55"
        assert acc["user_agent"] == "iter116-test-UA"

        # Status now reports accepted
        r2 = requests.get(f"{BASE}/api/maker/agreement/status", headers=_H(metal_jwt), timeout=15)
        assert r2.json()["requires_acceptance"] is False
        count_after_1 = r2.json()["acceptance_count"]

        # Append-only: re-accepting bumps count
        r3 = requests.post(f"{BASE}/api/maker/agreement/accept",
                           json={"version": "1.0"}, headers=_H(metal_jwt), timeout=15)
        assert r3.status_code == 201
        r4 = requests.get(f"{BASE}/api/maker/agreement/status", headers=_H(metal_jwt), timeout=15)
        assert r4.json()["acceptance_count"] == count_after_1 + 1

    def test_admin_audit_view_unauth(self):
        r = requests.get(f"{BASE}/api/admin/agreement/acceptances", timeout=15)
        assert r.status_code in (401, 403)

    def test_admin_audit_view(self, admin_jwt):
        r = requests.get(f"{BASE}/api/admin/agreement/acceptances", headers=_H(admin_jwt), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["current_version"] == "1.0"
        assert "acceptances" in d and isinstance(d["acceptances"], list)
        assert "makers_by_version" in d
        assert "pending_current" in d
        # After metal accepted above, should show up
        assert any(a.get("maker_slug") == "metalart-pro" for a in d["acceptances"])


# --- Chunked upload flow ----------------------------------------------------
def _tiny_pdf(marker: str = "iter116") -> bytes:
    return b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n" + marker.encode() + b"\n" + (b"x" * 512)


class TestChunkedUpload:
    def test_init_rejects_bad_extension(self, iron_jwt):
        r = requests.post(
            f"{BASE}/api/maker/listings/{LISTING_SLUG}/digital-uploads/init",
            json={"filename": "virus.exe", "size_bytes": 100, "total_chunks": 1},
            headers=_H(iron_jwt), timeout=15)
        assert r.status_code == 400

    def test_init_forbidden_other_maker(self, metal_jwt):
        r = requests.post(
            f"{BASE}/api/maker/listings/{LISTING_SLUG}/digital-uploads/init",
            json={"filename": "a.pdf", "size_bytes": 100, "total_chunks": 1},
            headers=_H(metal_jwt), timeout=15)
        assert r.status_code == 403

    def test_full_upload_replace_versioning(self, iron_jwt):
        """Upload a tiny PDF as a replacement for the existing seed file, bumping to v2."""
        # Fetch current file id first via listings-list (public shop endpoint fallback)
        r = requests.get(
            f"{BASE}/api/maker/products",
            headers=_H(iron_jwt), timeout=15)
        prods = r.json() if isinstance(r.json(), list) else r.json().get("products", [])
        listing = next((p for p in prods if p.get("slug") == LISTING_SLUG), None)
        assert listing, "Seed listing missing"
        files = listing.get("digital_files") or []
        assert files, "Seed listing must have at least one digital file"
        existing_id = files[0]["id"]

        data = _tiny_pdf("replace-v2")
        payload = {
            "filename": "mountain-plans-replacement.pdf",
            "size_bytes": len(data),
            "total_chunks": 1,
            "replace_file_id": existing_id,
            "release_notes": "iter116 test — replaced with kerf corrections",
        }
        r = requests.post(
            f"{BASE}/api/maker/listings/{LISTING_SLUG}/digital-uploads/init",
            json=payload, headers=_H(iron_jwt), timeout=15)
        assert r.status_code == 200, r.text
        uid = r.json()["upload_id"]

        r = requests.put(
            f"{BASE}/api/maker/listings/{LISTING_SLUG}/digital-uploads/{uid}/chunks/0",
            data=data,
            headers={**_H(iron_jwt), "Content-Type": "application/octet-stream"},
            timeout=30)
        assert r.status_code == 200, r.text

        r = requests.post(
            f"{BASE}/api/maker/listings/{LISTING_SLUG}/digital-uploads/{uid}/complete",
            headers=_H(iron_jwt), timeout=60)  # real R2 PUT
        assert r.status_code == 200, r.text
        entry = r.json()
        assert entry["id"] == existing_id  # same file id
        assert entry["version"] >= 2  # bumped
        assert entry["scan"]["status"] == "clean"
        assert isinstance(entry.get("versions"), list) and len(entry["versions"]) >= 2
        assert any(v.get("release_notes") == "iter116 test — replaced with kerf corrections"
                   for v in entry["versions"])

    def test_blocked_executable_content(self, iron_jwt):
        # init with a .pdf filename but MZ payload → complete should 422
        data = b"MZ\x90\x00" + b"malicious" * 20
        r = requests.post(
            f"{BASE}/api/maker/listings/{LISTING_SLUG}/digital-uploads/init",
            json={"filename": "bad.pdf", "size_bytes": len(data), "total_chunks": 1},
            headers=_H(iron_jwt), timeout=15)
        assert r.status_code == 200, r.text
        uid = r.json()["upload_id"]
        r = requests.put(
            f"{BASE}/api/maker/listings/{LISTING_SLUG}/digital-uploads/{uid}/chunks/0",
            data=data,
            headers={**_H(iron_jwt), "Content-Type": "application/octet-stream"},
            timeout=15)
        assert r.status_code == 200
        r = requests.post(
            f"{BASE}/api/maker/listings/{LISTING_SLUG}/digital-uploads/{uid}/complete",
            headers=_H(iron_jwt), timeout=30)
        assert r.status_code == 422
        assert "security scan" in r.json()["detail"].lower()


# --- Delivery settings roundtrip --------------------------------------------
class TestDeliverySettings:
    def test_patch_and_clear(self, iron_jwt):
        r = requests.patch(
            f"{BASE}/api/maker/listings/{LISTING_SLUG}/digital-settings",
            json={"download_limit": 5, "download_ttl_days": 45},
            headers=_H(iron_jwt), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["download_limit"] == 5
        assert d["download_ttl_days"] == 45

        # Reset via clear_limit
        r = requests.patch(
            f"{BASE}/api/maker/listings/{LISTING_SLUG}/digital-settings",
            json={"clear_limit": True, "download_ttl_days": 30},
            headers=_H(iron_jwt), timeout=15)
        assert r.status_code == 200
        assert r.json()["download_limit"] is None


# --- Buyer purchases + download flow ----------------------------------------
class TestBuyerPurchases:
    def test_unauth_rejected(self):
        r = requests.get(f"{BASE}/api/buyer/purchases", timeout=15)
        assert r.status_code in (401, 403)

    def test_list_includes_seed(self, buyer_jwt):
        r = requests.get(f"{BASE}/api/buyer/purchases", headers=_H(buyer_jwt), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "purchases" in d
        assert any(p.get("session_id") == SEED_TX for p in d["purchases"]), \
            f"seed tx {SEED_TX} missing from buyer purchases"

    def test_mint_download_links(self, buyer_jwt):
        r = requests.post(
            f"{BASE}/api/buyer/purchases/{SEED_TX}/download-links",
            headers=_H(buyer_jwt), timeout=15)
        assert r.status_code == 200, r.text
        links = r.json().get("links", [])
        assert links and links[0].get("token")
        assert links[0].get("expires_at_unix", 0) > time.time() + 24 * 3600

    def test_non_owner_gets_404(self):
        other_jwt = issue_session_jwt("b2", f"iter116-nobody-{uuid.uuid4().hex[:6]}@t.co", role="buyer")
        r = requests.post(
            f"{BASE}/api/buyer/purchases/{SEED_TX}/download-links",
            headers=_H(other_jwt), timeout=15)
        assert r.status_code == 404

    def test_download_history_endpoint(self, buyer_jwt):
        r = requests.get(
            f"{BASE}/api/buyer/purchases/{SEED_TX}/download-history",
            headers=_H(buyer_jwt), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "history" in d and isinstance(d["history"], list)

    def test_download_returns_presigned_302(self, buyer_jwt):
        r = requests.post(
            f"{BASE}/api/buyer/purchases/{SEED_TX}/download-links",
            headers=_H(buyer_jwt), timeout=15)
        token = r.json()["links"][0]["token"]

        # Use requests without redirects
        r2 = requests.get(f"{BASE}/api/checkout/downloads/{token}",
                          allow_redirects=False, timeout=15)
        assert r2.status_code == 302, r2.text
        loc = r2.headers.get("Location", "")
        # Presigned URL contract: must be R2 storage host and have X-Amz-Algorithm
        assert "r2.cloudflarestorage.com" in loc, f"Not a presigned URL: {loc[:200]}"
        assert "X-Amz-Algorithm" in loc, f"Missing presign sig: {loc[:200]}"

    def test_download_history_grows_after_download(self, buyer_jwt):
        r0 = requests.get(f"{BASE}/api/buyer/purchases/{SEED_TX}/download-history",
                          headers=_H(buyer_jwt), timeout=15)
        before = len(r0.json().get("history", []))

        r = requests.post(f"{BASE}/api/buyer/purchases/{SEED_TX}/download-links",
                          headers=_H(buyer_jwt), timeout=15)
        token = r.json()["links"][0]["token"]
        requests.get(f"{BASE}/api/checkout/downloads/{token}",
                     allow_redirects=False, timeout=15)

        r1 = requests.get(f"{BASE}/api/buyer/purchases/{SEED_TX}/download-history",
                          headers=_H(buyer_jwt), timeout=15)
        after = len(r1.json().get("history", []))
        assert after >= before + 1


# --- Regression: physical listing endpoints still respond -------------------
class TestRegression:
    def test_storefront_loads(self):
        r = requests.get(f"{BASE}/api/products?limit=6", timeout=15)
        assert r.status_code == 200
