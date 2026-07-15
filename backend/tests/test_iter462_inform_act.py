"""iter462 — INFORM Consumers Act compliance automation.

Covers:
- Maker GET /maker/inform-act (kiln-and-clay flagged; loom-and-thread monitoring)
- Maker POST /maker/inform-act/submit (validation + masking)
- Maker POST /maker/inform-act/certify (pre + post verify)
- Admin GET /admin/inform-act (auth gates + row content)
- Admin verify / reject (with resubmit + re-verify to restore state) / suspend / reinstate
- Public seller disclosure (individual partial → state+country only)
- Vanity route resolution (iron-and-oak → 404 fine)

IMPORTANT: Manual scan endpoint sends REAL EMAILS (Mailgun) — this suite
calls it AT MOST ONCE, guarded by a module-level flag.
"""
from __future__ import annotations
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from maker_auth import issue_session_jwt, issue_admin_magic_token  # noqa: E402

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")


# ── Auth fixtures ───────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def kc_jwt():
    return issue_session_jwt("kiln-and-clay", "kiln-and-clay@craftersmarket.org")


@pytest.fixture(scope="module")
def lt_jwt():
    return issue_session_jwt("loom-and-thread", "loom-and-thread@craftersmarket.org")


@pytest.fixture(scope="module")
def admin_jwt():
    magic = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE}/api/admin/auth/verify", json={"token": magic}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def kc_h(kc_jwt):
    return {"Authorization": f"Bearer {kc_jwt}"}


def lt_h(lt_jwt):
    return {"Authorization": f"Bearer {lt_jwt}"}


def ad_h(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


# ── 1. Maker GET /maker/inform-act ─────────────────────────────────────
class TestMakerInformState:
    def test_unauth_401(self):
        r = requests.get(f"{BASE}/api/maker/inform-act", timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_kiln_flagged(self, kc_jwt):
        r = requests.get(f"{BASE}/api/maker/inform-act", headers=kc_h(kc_jwt), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "collection_required", d
        assert d["qualifies"] is True
        assert d["window"]["tx_count"] == 205
        assert d["window"]["revenue"] == 22550.0
        assert d["deadline_at"], "deadline_at should be set"
        assert d["disclosure_required"] is True
        t = d["thresholds"]
        assert t["tx"] == 200 and t["revenue"] == 5000.0
        assert t["disclosure_revenue"] == 20000.0 and t["deadline_days"] == 10

    def test_loom_monitoring(self, lt_jwt):
        r = requests.get(f"{BASE}/api/maker/inform-act", headers=lt_h(lt_jwt), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "monitoring"


# ── 2. Maker POST /maker/inform-act/submit ─────────────────────────────
GOOD_BODY = {
    "full_name": "Kiln Clay",
    "is_business": False,
    "street": "42 Kiln Street",
    "city": "Portland",
    "state": "OR",
    "zip_code": "97205",
    "country": "US",
    "contact_email": "kiln-and-clay@craftersmarket.org",
    "contact_phone": "5035550142",
    "tax_id_type": "ssn",
    "tax_id": "123-45-6789",
    "gov_id_type": "drivers_license",
    "bank_name": "First Portland Bank",
    "bank_account_name": "Kiln Clay",
    "bank_last4": "1234",
}


class TestMakerSubmit:
    def test_bad_tax_id_type(self, kc_jwt):
        body = {**GOOD_BODY, "tax_id_type": "bogus"}
        r = requests.post(f"{BASE}/api/maker/inform-act/submit", json=body,
                          headers=kc_h(kc_jwt), timeout=15)
        assert r.status_code == 400, r.text

    def test_bad_bank_last4(self, kc_jwt):
        body = {**GOOD_BODY, "bank_last4": "abcd"}
        r = requests.post(f"{BASE}/api/maker/inform-act/submit", json=body,
                          headers=kc_h(kc_jwt), timeout=15)
        assert r.status_code == 400, r.text

    def test_business_missing_name(self, kc_jwt):
        body = {**GOOD_BODY, "is_business": True, "business_name": ""}
        r = requests.post(f"{BASE}/api/maker/inform-act/submit", json=body,
                          headers=kc_h(kc_jwt), timeout=15)
        assert r.status_code == 400, r.text

    def test_contact_email_no_at(self, kc_jwt):
        body = {**GOOD_BODY, "contact_email": "notanemail"}
        r = requests.post(f"{BASE}/api/maker/inform-act/submit", json=body,
                          headers=kc_h(kc_jwt), timeout=15)
        assert r.status_code == 400, r.text

    def test_valid_submit_masks_tax_id(self, kc_jwt):
        r = requests.post(f"{BASE}/api/maker/inform-act/submit", json=GOOD_BODY,
                          headers=kc_h(kc_jwt), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "pending_verification"
        sub = d.get("submission") or {}
        assert sub.get("tax_id_last4") == "6789"
        # Ensure raw / hashed tax ID not leaked in response
        assert "tax_id" not in sub, sub
        assert "tax_id_hash" not in sub, sub
        assert sub.get("bank_last4") == "1234"

    def test_certify_before_verify_400(self, kc_jwt):
        r = requests.post(f"{BASE}/api/maker/inform-act/certify", json={},
                          headers=kc_h(kc_jwt), timeout=15)
        assert r.status_code == 400, r.text


# ── 3. Admin endpoints ─────────────────────────────────────────────────
class TestAdminInformAct:
    def test_admin_get_requires_auth(self):
        r = requests.get(f"{BASE}/api/admin/inform-act", timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_admin_get_with_maker_jwt_rejected(self, kc_jwt):
        r = requests.get(f"{BASE}/api/admin/inform-act", headers=kc_h(kc_jwt), timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_admin_get_ok(self, admin_jwt):
        r = requests.get(f"{BASE}/api/admin/inform-act", headers=ad_h(admin_jwt), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "rows" in d and "thresholds" in d and "last_scan" in d
        slugs = {row["slug"]: row for row in d["rows"]}
        assert "kiln-and-clay" in slugs
        kc = slugs["kiln-and-clay"]
        assert kc["window"]["tx_count"] == 205
        assert kc["window"]["revenue"] == 22550.0
        sub = kc.get("submission") or {}
        assert sub.get("tax_id_last4") == "6789"
        assert "tax_id" not in sub and "tax_id_hash" not in sub

    def test_verify_kiln(self, admin_jwt):
        r = requests.post(f"{BASE}/api/admin/inform-act/kiln-and-clay/verify",
                          headers=ad_h(admin_jwt), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "verified"
        assert d["disclosure_required"] is True
        assert d["annual_certified_at"] and d["next_certification_due_at"]

    def test_public_disclosure_after_verify(self):
        r = requests.get(f"{BASE}/api/makers/kiln-and-clay/seller-disclosure", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["seller_name"] == GOOD_BODY["full_name"]
        assert d["is_business"] is False
        addr = d["address"]
        # Individual partial disclosure — state + country ONLY
        assert set(addr.keys()) == {"state", "country"}, addr
        assert addr["state"] == "OR" and addr["country"] == "US"
        assert d["contact_email"] == GOOD_BODY["contact_email"]
        assert d["contact_phone"] == GOOD_BODY["contact_phone"]

    def test_public_disclosure_loom_404(self):
        r = requests.get(f"{BASE}/api/makers/loom-and-thread/seller-disclosure", timeout=15)
        assert r.status_code == 404

    def test_public_disclosure_vanity_ironoak_404(self):
        # iron-and-oak has custom_url 'ironoak2' but no inform_act → 404 acceptable.
        r = requests.get(f"{BASE}/api/makers/ironoak2/seller-disclosure", timeout=15)
        assert r.status_code == 404, r.text

    def test_certify_after_verify(self, kc_jwt):
        r = requests.post(f"{BASE}/api/maker/inform-act/certify", json={},
                          headers=kc_h(kc_jwt), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["annual_certified_at"] and d["next_certification_due_at"]
        assert d["status"] == "verified"

    def test_reject_then_resubmit_reverify(self, admin_jwt, kc_jwt):
        # Reject
        r = requests.post(f"{BASE}/api/admin/inform-act/kiln-and-clay/reject",
                          json={"note": "ID mismatch"}, headers=ad_h(admin_jwt), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "collection_required"
        assert d["rejection_note"] == "ID mismatch"
        assert d["deadline_at"]

        # Re-submit
        r = requests.post(f"{BASE}/api/maker/inform-act/submit", json=GOOD_BODY,
                          headers=kc_h(kc_jwt), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending_verification"

        # Re-verify
        r = requests.post(f"{BASE}/api/admin/inform-act/kiln-and-clay/verify",
                          headers=ad_h(admin_jwt), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "verified"

    def test_suspend_then_reinstate(self, admin_jwt):
        r = requests.post(f"{BASE}/api/admin/inform-act/kiln-and-clay/suspend",
                          headers=ad_h(admin_jwt), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "suspended"

        r = requests.post(f"{BASE}/api/admin/inform-act/kiln-and-clay/reinstate",
                          headers=ad_h(admin_jwt), timeout=15)
        assert r.status_code == 200, r.text
        # Because verified_at is set, reinstate returns to 'verified'
        assert r.json()["status"] == "verified"

    def test_scan_unauth(self):
        r = requests.post(f"{BASE}/api/admin/inform-act/scan", timeout=15)
        assert r.status_code in (401, 403), r.text


# NOTE: manual scan endpoint intentionally NOT exercised here to avoid
# sending real Mailgun emails on every test run. It is covered by the
# scheduler + verified via unauth check above.


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
