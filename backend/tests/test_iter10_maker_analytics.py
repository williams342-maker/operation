"""Iter10 backend tests — per-maker analytics endpoint."""
import os
import sys
import uuid

import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import (  # noqa: E402
    issue_admin_magic_token, issue_buyer_magic_token, issue_magic_token,
)

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_jwt():
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{API}/admin/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200
    return r.json()["token"]


def H(jwt):
    return {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}


class TestMakerAnalytics:

    def test_unauth_rejected(self):
        r = requests.get(f"{API}/admin/maker-analytics/iron-and-oak", timeout=15)
        assert r.status_code in (401, 403)

    def test_buyer_jwt_rejected(self):
        email = f"TEST_iter10_{uuid.uuid4().hex[:6]}@example.com"
        tok = issue_buyer_magic_token(email)
        bjwt = requests.post(f"{API}/community/auth/magic/verify",
                             json={"token": tok}, timeout=15).json()["token"]
        r = requests.get(f"{API}/admin/maker-analytics/iron-and-oak",
                         headers=H(bjwt), timeout=15)
        assert r.status_code == 403

    def test_maker_jwt_rejected(self):
        tok = issue_magic_token("iron-and-oak@craftersmarket.org")
        mjwt = requests.post(f"{API}/maker/auth/verify",
                             json={"token": tok}, timeout=15).json()["token"]
        r = requests.get(f"{API}/admin/maker-analytics/iron-and-oak",
                         headers=H(mjwt), timeout=15)
        assert r.status_code == 403

    def test_unknown_maker_404(self, admin_jwt):
        r = requests.get(f"{API}/admin/maker-analytics/does-not-exist",
                         headers=H(admin_jwt), timeout=15)
        assert r.status_code == 404

    def test_happy_path_shape(self, admin_jwt):
        r = requests.get(f"{API}/admin/maker-analytics/iron-and-oak",
                         headers=H(admin_jwt), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # Shape assertions
        assert "maker" in d
        assert d["maker"]["slug"] == "iron-and-oak"
        for k in ("name", "stripe_account_id", "stripe_charges_enabled",
                  "stripe_payouts_enabled", "stripe_details_submitted"):
            assert k in d["maker"]
        for k in ("products_count", "paid_orders_count", "refunded_orders_count",
                  "refunded_amount", "gross_revenue", "gross_revenue_30d",
                  "gross_revenue_7d", "platform_fee_bps",
                  "maker_share_gross", "maker_share_after_refunds",
                  "top_products", "payout_totals", "recent_payouts"):
            assert k in d, f"missing {k}"
        assert d["platform_fee_bps"] == 1000
        # Maker share = gross * 0.9 (no refunds yet)
        if d["gross_revenue"]:
            assert abs(d["maker_share_gross"] - round(d["gross_revenue"] * 0.9, 2)) < 0.02
        assert isinstance(d["top_products"], list)
        assert isinstance(d["recent_payouts"], list)
        # Payout totals shape
        for k in ("succeeded", "deferred", "reversed", "error", "cancelled"):
            assert k in d["payout_totals"]

    def test_no_id_leak(self, admin_jwt):
        r = requests.get(f"{API}/admin/maker-analytics/iron-and-oak",
                         headers=H(admin_jwt), timeout=15)
        assert r.status_code == 200
        # Sanity: response does not leak raw Mongo _id keys.
        # (Substring "_id" appears legitimately inside "stripe_account_id" etc;
        # assert against the JSON key form instead.)
        assert '"_id":' not in r.text
