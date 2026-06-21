"""iter413bo — Weekly Enrich Labs export contract.

Verifies:
  • GET /admin/makers/approved.csv?include_emails=false
      - 200, text/csv
      - email column is OMITTED from the header
      - row count matches the directory endpoint
  • GET /admin/makers/approved.csv (default include_emails=true)
      - email column preserved (locks the iter413az contract)
  • GET /admin/makers/approved/enrichlabs-status
      - returns {configured, recipient, last_send, total_sends, schedule_human}
      - schedule_human stays as the documented cron description
  • POST /admin/makers/approved/enrichlabs-send
      - when ENRICHLABS_EXPORT_EMAIL is unset → ok=false with a clear reason
      - writes an admin_audit row of kind `enrichlabs_export_sent`
"""
from __future__ import annotations

import asyncio
import csv
import io
import os
import sys
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def admin_jwt():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    super_email = (os.environ.get("ADMIN_EMAILS") or os.environ.get("OPS_EMAIL") or "team@craftersmarket.org").split(",")[0].strip()
    tok = issue_admin_magic_token(super_email)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def H(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


def test_csv_default_keeps_email_column(H):
    """iter413az regression — default (no query) must keep the email column."""
    r = requests.get(f"{BASE_URL}/api/admin/makers/approved.csv", headers=H, timeout=30)
    assert r.status_code == 200, r.text
    header = next(csv.reader(io.StringIO(r.text)))
    assert "email" in header, "default CSV must keep the email column (iter413az contract)"
    assert header[0] == "slug"


def test_csv_no_emails_variant_omits_email_column(H):
    r = requests.get(
        f"{BASE_URL}/api/admin/makers/approved.csv",
        params={"include_emails": "false"},
        headers=H, timeout=30,
    )
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("text/csv")
    cd = r.headers.get("content-disposition", "")
    assert "no-emails" in cd, "filename should contain 'no-emails' marker"

    rows = list(csv.reader(io.StringIO(r.text)))
    header = rows[0]
    assert "email" not in header, "no-emails CSV must NOT contain an email column"
    # Lock the new column shape so a future refactor doesn't accidentally
    # restore PII downstream.
    assert header == [
        "slug", "name",
        "location", "techniques", "bio",
        "is_beta", "is_veteran_owned", "subscription_status",
        "listings_count", "lifetime_gmv_usd",
        "approved_at", "created_at",
    ]
    # And spot-check that no row in the body looks like an email.
    body = rows[1:]
    for row in body[:50]:
        for cell in row:
            assert "@" not in cell or "." not in cell.split("@", 1)[-1], (
                f"PII leak: cell {cell!r} looks like an email address"
            )


def test_csv_no_emails_row_count_matches_directory(H):
    """The no-emails CSV should match the directory row count."""
    json_r = requests.get(f"{BASE_URL}/api/admin/makers/approved", headers=H, timeout=30)
    json_r.raise_for_status()
    json_count = len(json_r.json())

    csv_r = requests.get(
        f"{BASE_URL}/api/admin/makers/approved.csv",
        params={"include_emails": "false"},
        headers=H, timeout=30,
    )
    csv_r.raise_for_status()
    rows = list(csv.reader(io.StringIO(csv_r.text)))
    assert len(rows) - 1 == json_count


def test_enrichlabs_status_shape(H):
    r = requests.get(
        f"{BASE_URL}/api/admin/makers/approved/enrichlabs-status",
        headers=H, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "configured" in body
    assert "recipient" in body
    assert "last_send" in body
    assert "total_sends" in body
    assert body["schedule_human"] == "Every Monday at 11:00 UTC"


def test_enrichlabs_send_now_writes_audit(H):
    """Sending without a recipient configured returns ok=false with a clear
    reason AND does NOT raise. When configured, it writes an audit row."""
    r = requests.post(
        f"{BASE_URL}/api/admin/makers/approved/enrichlabs-send",
        headers=H, timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    if not body.get("ok"):
        # Not configured path — must return a useful reason.
        assert "ENRICHLABS_EXPORT_EMAIL" in (body.get("error") or "")
        return

    # Configured path — verify an audit row was just written.
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _check():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        audit = await db.admin_audit.find_one(
            {"kind": "enrichlabs_export_sent"},
            sort=[("ts", -1)],
        )
        client.close()
        return audit

    audit = asyncio.run(_check())
    assert audit is not None
    assert audit["recipient"] == body["sent_to"]
    assert audit["rows"] == body["rows"]


def test_endpoints_require_auth():
    for path, method in (
        ("/api/admin/makers/approved.csv?include_emails=false", "GET"),
        ("/api/admin/makers/approved/enrichlabs-status",        "GET"),
        ("/api/admin/makers/approved/enrichlabs-send",          "POST"),
    ):
        url = f"{BASE_URL}{path}"
        r = requests.get(url, timeout=15) if method == "GET" else requests.post(url, timeout=15)
        assert r.status_code in (401, 403), f"{path} should require auth"
