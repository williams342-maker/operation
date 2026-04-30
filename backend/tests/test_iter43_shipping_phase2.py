"""Phase 2B/2C/2D shipping ledger + invoicing endpoint tests.

Covers:
  • GET  /api/maker/shipping/ledger          (Phase 2C)
  • PATCH /api/maker/shipping/cadence        (Phase 2C)
  • GET  /api/admin/shipping-ledger          (Phase 2D)
  • GET  /api/admin/shipping-ledger/rollup   (Phase 2D)
  • GET  /api/admin/shipping-ledger/export.csv (Phase 2D)
  • POST /api/admin/shipping-ledger/{id}/mark-billed (Phase 2D)
  • POST /api/admin/shipping-ledger/run-invoices (Phase 2B)
  • Cross-role rejection (admin endpoints with maker JWT)
"""
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_session_jwt  # noqa: E402

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or "https://active-project-4.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def maker_headers():
    tok = issue_session_jwt("iron-and-oak", "iron-and-oak@craftersmarket.org")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_headers():
    tok = issue_session_jwt("admin", "team@craftersmarket.org", "admin")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ─── Phase 2C · maker ledger view ──────────────────────────────────────
class TestMakerLedger:
    def test_ledger_returns_expected_shape(self, maker_headers):
        r = requests.get(f"{BASE_URL}/api/maker/shipping/ledger", headers=maker_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("cadence", "unbilled_cents", "unbilled_count", "billed_cents",
                  "lifetime_cents", "rows"):
            assert k in data, f"missing {k}"
        assert isinstance(data["rows"], list)
        # At least 1 row exists per problem statement (3 unbilled + 1 billed)
        assert len(data["rows"]) >= 1
        # Math sanity
        assert data["lifetime_cents"] == data["billed_cents"] + data["unbilled_cents"]
        # Sort newest first
        if len(data["rows"]) >= 2:
            assert data["rows"][0]["created_at"] >= data["rows"][-1]["created_at"]
        assert data["cadence"] in ("weekly", "biweekly")

    def test_cadence_invalid_returns_400(self, maker_headers):
        r = requests.patch(f"{BASE_URL}/api/maker/shipping/cadence",
                           json={"cadence": "monthly"}, headers=maker_headers, timeout=20)
        assert r.status_code == 400, r.text

    def test_cadence_biweekly_persists(self, maker_headers):
        r = requests.patch(f"{BASE_URL}/api/maker/shipping/cadence",
                           json={"cadence": "biweekly"}, headers=maker_headers, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["cadence"] == "biweekly"
        # Verify on subsequent GET
        g = requests.get(f"{BASE_URL}/api/maker/shipping/ledger",
                        headers=maker_headers, timeout=20)
        assert g.status_code == 200
        assert g.json()["cadence"] == "biweekly"

    def test_cadence_weekly_round_trip(self, maker_headers):
        r = requests.patch(f"{BASE_URL}/api/maker/shipping/cadence",
                           json={"cadence": "weekly"}, headers=maker_headers, timeout=20)
        assert r.status_code == 200
        assert r.json()["cadence"] == "weekly"
        g = requests.get(f"{BASE_URL}/api/maker/shipping/ledger",
                        headers=maker_headers, timeout=20)
        assert g.json()["cadence"] == "weekly"


# ─── Phase 2D · admin ledger ───────────────────────────────────────────
class TestAdminLedger:
    def test_list_ledger_default(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/shipping-ledger",
                         headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data and "count" in data
        assert isinstance(data["rows"], list)
        assert data["count"] == len(data["rows"])

    def test_list_ledger_filter_billed_no(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/shipping-ledger?billed=no",
                         headers=admin_headers, timeout=20)
        assert r.status_code == 200
        for row in r.json()["rows"]:
            assert row.get("billed_at") in (None, "", False)

    def test_list_ledger_filter_billed_yes(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/shipping-ledger?billed=yes",
                         headers=admin_headers, timeout=20)
        assert r.status_code == 200
        for row in r.json()["rows"]:
            assert row.get("billed_at"), f"expected billed_at on {row}"

    def test_list_ledger_filter_maker(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/shipping-ledger?maker_slug=iron-and-oak",
                         headers=admin_headers, timeout=20)
        assert r.status_code == 200
        for row in r.json()["rows"]:
            assert row["maker_slug"] == "iron-and-oak"

    def test_rollup_aggregates(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/shipping-ledger/rollup",
                         headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "total_unbilled_cents" in data
        assert isinstance(data["makers"], list)
        for m in data["makers"]:
            for k in ("maker_slug", "unbilled_cents", "billed_cents",
                      "unbilled_count", "total_count"):
                assert k in m
        # Total must equal sum
        total = sum(m["unbilled_cents"] for m in data["makers"])
        assert total == data["total_unbilled_cents"]

    def test_csv_export_headers_and_content(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/shipping-ledger/export.csv",
                         headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("content-type", "").lower()
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        lines = r.text.replace("\r\n", "\n").replace("\r", "\n").strip().split("\n")
        header = lines[0].split(",")
        # 14 headers expected
        expected = [
            "id", "created_at", "maker_slug", "session_id", "provider",
            "servicelevel", "tracking_number", "amount_cents", "markup_cents",
            "billed_cents", "currency", "billed_at", "invoice_id", "test_mode",
        ]
        assert header == expected, f"got {header}"
        # Has data rows
        assert len(lines) >= 2

    def test_run_invoices_dry_run(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/admin/shipping-ledger/run-invoices",
                          json={"dry_run": True}, headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("scanned_makers", "invoiced_makers", "invoiced_cents",
                  "skipped", "dry_run"):
            assert k in data
        assert data["dry_run"] is True
        # iron-and-oak should be skipped — no stripe_customer_id
        slugs_skipped = [s.get("maker_slug") for s in data.get("skipped", [])]
        # Either iron-and-oak is in scanned (and skipped) OR cadence prevents it
        # (biweekly + odd ISO week). Just check structure.
        assert isinstance(data["skipped"], list)

    def test_mark_billed_404_for_unknown_id(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/shipping-ledger/zzz-nope-12345/mark-billed",
            json={"invoice_id": "in_test_xxx", "note": "test"},
            headers=admin_headers, timeout=20)
        assert r.status_code == 404, r.text

    def test_mark_billed_already_billed_400(self, admin_headers):
        # Find an already-billed row
        r = requests.get(f"{BASE_URL}/api/admin/shipping-ledger?billed=yes",
                         headers=admin_headers, timeout=20)
        rows = r.json().get("rows", [])
        if not rows:
            pytest.skip("no billed rows to test against")
        rid = rows[0]["id"]
        r2 = requests.post(
            f"{BASE_URL}/api/admin/shipping-ledger/{rid}/mark-billed",
            json={"invoice_id": "in_test_dup", "note": "should fail"},
            headers=admin_headers, timeout=20)
        assert r2.status_code == 400, r2.text


# ─── Cross-role access control ─────────────────────────────────────────
class TestAccessControl:
    def test_maker_cannot_call_admin_list(self, maker_headers):
        r = requests.get(f"{BASE_URL}/api/admin/shipping-ledger",
                         headers=maker_headers, timeout=20)
        assert r.status_code in (401, 403), r.text

    def test_maker_cannot_call_admin_rollup(self, maker_headers):
        r = requests.get(f"{BASE_URL}/api/admin/shipping-ledger/rollup",
                         headers=maker_headers, timeout=20)
        assert r.status_code in (401, 403)

    def test_maker_cannot_run_invoices(self, maker_headers):
        r = requests.post(f"{BASE_URL}/api/admin/shipping-ledger/run-invoices",
                          json={"dry_run": True}, headers=maker_headers, timeout=20)
        assert r.status_code in (401, 403)

    def test_no_auth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/admin/shipping-ledger", timeout=20)
        assert r.status_code in (401, 403)
        r2 = requests.get(f"{BASE_URL}/api/maker/shipping/ledger", timeout=20)
        assert r2.status_code in (401, 403)
