"""iter44 — shipping cap + validate-address + auto-stripe-customer + ledger fields."""
import os, sys, pytest, requests
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_magic_token  # noqa: E402

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE:
    # fallback: read frontend env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE = line.split("=",1)[1].strip().rstrip("/")
SLUG = "iron-and-oak"
EMAIL = f"{SLUG}@craftersmarket.org"


@pytest.fixture(scope="module")
def maker_jwt():
    # mint magic token then verify to get JWT
    tok = issue_magic_token(EMAIL)
    r = requests.post(f"{BASE}/api/maker/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(maker_jwt):
    return {"Authorization": f"Bearer {maker_jwt}", "Content-Type": "application/json"}


# (b) Cap CRUD
class TestCap:
    def test_set_cap_50(self, H):
        r = requests.patch(f"{BASE}/api/maker/shipping/cap", headers=H, json={"monthly_cap_usd": 50})
        assert r.status_code == 200
        assert r.json()["monthly_cap_cents"] == 5000

    def test_negative_400(self, H):
        r = requests.patch(f"{BASE}/api/maker/shipping/cap", headers=H, json={"monthly_cap_usd": -1})
        assert r.status_code == 400

    def test_too_high_400(self, H):
        r = requests.patch(f"{BASE}/api/maker/shipping/cap", headers=H, json={"monthly_cap_usd": 200000})
        assert r.status_code == 400

    def test_ledger_exposes_cap_and_month_spent(self, H):
        requests.patch(f"{BASE}/api/maker/shipping/cap", headers=H, json={"monthly_cap_usd": 50})
        r = requests.get(f"{BASE}/api/maker/shipping/ledger", headers=H)
        assert r.status_code == 200
        d = r.json()
        assert "monthly_cap_cents" in d
        assert "month_spent_cents" in d
        assert d["monthly_cap_cents"] == 5000
        assert isinstance(d["month_spent_cents"], int)

    def test_zero_disables(self, H):
        r = requests.patch(f"{BASE}/api/maker/shipping/cap", headers=H, json={"monthly_cap_usd": 0})
        assert r.status_code == 200
        assert r.json()["monthly_cap_cents"] == 0


# (f) Address validation
class TestValidateAddress:
    def test_valid_sf(self, H):
        r = requests.post(f"{BASE}/api/maker/shipping/validate-address", headers=H, json={
            "name": "Test", "street1": "215 Clayton St", "city": "San Francisco",
            "state": "CA", "zip": "94117", "country": "US",
        })
        # 200 if shippo configured; expected is_valid true for real address
        assert r.status_code in (200, 503), r.text
        if r.status_code == 200:
            d = r.json()
            assert "is_valid" in d
            assert "messages" in d
            assert "suggested" in d

    def test_garbage(self, H):
        r = requests.post(f"{BASE}/api/maker/shipping/validate-address", headers=H, json={
            "name": "X", "street1": "NOT A STREET", "city": "Nowhere",
            "state": "XX", "zip": "99999", "country": "US",
        })
        assert r.status_code in (200, 400, 503)
        if r.status_code == 200:
            d = r.json()
            assert d["is_valid"] is False or len(d.get("messages") or []) > 0

    def test_unauth_rejected(self):
        r = requests.post(f"{BASE}/api/maker/shipping/validate-address", json={
            "street1": "1 Main", "city": "X", "state": "CA", "zip": "94117"
        })
        assert r.status_code in (401, 403)


# (e) memory split sanity
class TestMemorySplit:
    def test_files_exist(self):
        for p in ("/app/memory/PRD.md", "/app/memory/CHANGELOG.md", "/app/memory/ROADMAP.md"):
            assert os.path.exists(p), p

    def test_prd_short(self):
        n = sum(1 for _ in open("/app/memory/PRD.md"))
        assert n < 200, f"PRD should be short, got {n} lines"

    def test_changelog_long(self):
        n = sum(1 for _ in open("/app/memory/CHANGELOG.md"))
        assert n > 500, f"CHANGELOG should have many entries, got {n}"
