"""Iter49 — design-file reports: report / admin moderation / quarantine / unquarantine."""

import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

from maker_auth import issue_session_jwt  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_jwt():
    return issue_session_jwt("admin", "team@craftersmarket.org", role="admin")


@pytest.fixture(scope="module")
def buyer_jwt():
    return issue_session_jwt("test-buyer-iter49", "buyer@test.com", role="buyer")


@pytest.fixture(scope="module")
def buyer2_jwt():
    return issue_session_jwt("alice-buyer-iter49", "alice@test.com", role="buyer")


@pytest.fixture(scope="module")
def maker_jwt():
    # reuse iron-and-oak maker to upload a real file we can test against
    return issue_session_jwt("iron-and-oak", "iron-and-oak@craftersmarket.org", role="maker")


@pytest.fixture(scope="module")
def seeded_file(maker_jwt):
    """Upload a design file via URL-paste endpoint to guarantee we have a target."""
    r = requests.post(
        f"{API}/community/files",
        headers={"Authorization": f"Bearer {maker_jwt}", "Content-Type": "application/json"},
        json={
            "title": "TEST_iter49_report_target",
            "file_type": "svg",
            "download_url": "https://example.com/test.svg",
            "thumbnail_url": "https://example.com/thumb.png",
            "description": "iter49 seed",
        },
        timeout=10,
    )
    assert r.status_code in (200, 201), r.text
    data = r.json()
    file_id = data.get("id") or data.get("file_id")
    assert file_id
    yield file_id
    # cleanup: delete file + reports directly via mongo
    try:
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _clean():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            d = client[os.environ["DB_NAME"]]
            await d.design_files.delete_one({"id": file_id})
            await d.design_file_reports.delete_many({"file_id": file_id})
            client.close()
        asyncio.run(_clean())
    except Exception as e:
        print("cleanup failed:", e)


# ── POST /community/files/{id}/report ────────────────────────────────────
def test_report_unauthenticated_401(seeded_file):
    r = requests.post(f"{API}/community/files/{seeded_file}/report",
                      json={"reason": "stolen"})
    assert r.status_code in (401, 403)


def test_report_invalid_reason_400(buyer_jwt, seeded_file):
    r = requests.post(
        f"{API}/community/files/{seeded_file}/report",
        headers={"Authorization": f"Bearer {buyer_jwt}"},
        json={"reason": "bogus_reason"},
    )
    assert r.status_code == 400


def test_report_missing_file_404(buyer_jwt):
    r = requests.post(
        f"{API}/community/files/nonexistent-id-999/report",
        headers={"Authorization": f"Bearer {buyer_jwt}"},
        json={"reason": "stolen"},
    )
    assert r.status_code == 404


def test_report_success_and_dedup(buyer_jwt, seeded_file):
    r1 = requests.post(
        f"{API}/community/files/{seeded_file}/report",
        headers={"Authorization": f"Bearer {buyer_jwt}"},
        json={"reason": "stolen", "details": "Ripped from my listing"},
    )
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    assert d1["ok"] is True and d1["duplicate"] is False
    assert d1["id"]

    # dedup: same user, same file → duplicate=True with same id
    r2 = requests.post(
        f"{API}/community/files/{seeded_file}/report",
        headers={"Authorization": f"Bearer {buyer_jwt}"},
        json={"reason": "copyright"},
    )
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["duplicate"] is True
    assert d2["id"] == d1["id"]


def test_second_buyer_can_report_same_file(buyer2_jwt, seeded_file):
    r = requests.post(
        f"{API}/community/files/{seeded_file}/report",
        headers={"Authorization": f"Bearer {buyer2_jwt}"},
        json={"reason": "duplicate"},
    )
    assert r.status_code == 200
    assert r.json()["duplicate"] is False


# ── Public list excludes quarantined ────────────────────────────────────
def test_file_visible_in_public_list_before_quarantine(seeded_file):
    r = requests.get(f"{API}/community/files", timeout=10)
    assert r.status_code == 200
    ids = [f["id"] for f in r.json()]
    assert seeded_file in ids


# ── Admin GET /admin/design-files/reports ───────────────────────────────
def test_admin_list_reports_requires_admin(buyer_jwt):
    r = requests.get(f"{API}/admin/design-files/reports",
                     headers={"Authorization": f"Bearer {buyer_jwt}"})
    assert r.status_code in (401, 403)


def test_admin_list_reports_open(admin_jwt, seeded_file):
    r = requests.get(f"{API}/admin/design-files/reports?status=open",
                     headers={"Authorization": f"Bearer {admin_jwt}"})
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    mine = [row for row in rows if row["file_id"] == seeded_file]
    assert len(mine) >= 2  # buyer + buyer2
    # Verify hydration
    for row in mine:
        assert row["file"] is not None
        assert row["file"]["id"] == seeded_file
        assert "title" in row["file"]
        assert "file_type" in row["file"]
        assert row["status"] == "open"


# ── POST resolve with dismiss ───────────────────────────────────────────
def test_resolve_bad_action(admin_jwt, seeded_file):
    # grab an open report
    r = requests.get(f"{API}/admin/design-files/reports?status=open",
                     headers={"Authorization": f"Bearer {admin_jwt}"})
    report = next(x for x in r.json() if x["file_id"] == seeded_file)
    rr = requests.post(
        f"{API}/admin/design-files/reports/{report['id']}/resolve",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        json={"action": "bogus"},
    )
    assert rr.status_code == 400


def test_resolve_missing_report_404(admin_jwt):
    r = requests.post(
        f"{API}/admin/design-files/reports/nonexistent-report-id/resolve",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        json={"action": "dismiss"},
    )
    assert r.status_code == 404


def test_dismiss_one_report_decrements_counter(admin_jwt, seeded_file):
    r = requests.get(f"{API}/admin/design-files/reports?status=open",
                     headers={"Authorization": f"Bearer {admin_jwt}"})
    open_rows = [x for x in r.json() if x["file_id"] == seeded_file]
    before = open_rows[0]["file"]["open_reports"]
    report_id = open_rows[0]["id"]

    rr = requests.post(
        f"{API}/admin/design-files/reports/{report_id}/resolve",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        json={"action": "dismiss", "note": "Looks fine"},
    )
    assert rr.status_code == 200
    assert rr.json()["action"] == "dismiss"

    # second dismiss → already closed → 400
    rr2 = requests.post(
        f"{API}/admin/design-files/reports/{report_id}/resolve",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        json={"action": "dismiss"},
    )
    assert rr2.status_code == 400

    # verify dismissed filter includes it
    r2 = requests.get(f"{API}/admin/design-files/reports?status=dismissed",
                      headers={"Authorization": f"Bearer {admin_jwt}"})
    assert any(x["id"] == report_id for x in r2.json())

    # counter decremented
    r3 = requests.get(f"{API}/admin/design-files/reports?status=open",
                      headers={"Authorization": f"Bearer {admin_jwt}"})
    still_open = [x for x in r3.json() if x["file_id"] == seeded_file]
    if still_open:
        assert still_open[0]["file"]["open_reports"] == before - 1


def test_quarantine_rolls_up_and_hides_file(admin_jwt, seeded_file):
    # remaining open report
    r = requests.get(f"{API}/admin/design-files/reports?status=open",
                     headers={"Authorization": f"Bearer {admin_jwt}"})
    open_rows = [x for x in r.json() if x["file_id"] == seeded_file]
    assert open_rows, "expected at least 1 open report for quarantine test"
    report_id = open_rows[0]["id"]

    rr = requests.post(
        f"{API}/admin/design-files/reports/{report_id}/resolve",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        json={"action": "quarantine", "note": "stolen asset"},
    )
    assert rr.status_code == 200
    assert rr.json()["action"] == "quarantine"

    # file hidden from public list
    pub = requests.get(f"{API}/community/files").json()
    assert seeded_file not in [f["id"] for f in pub]

    # resolved filter has at least 1 row for this file with resolution_action=quarantine
    res = requests.get(f"{API}/admin/design-files/reports?status=resolved",
                       headers={"Authorization": f"Bearer {admin_jwt}"})
    q_rows = [x for x in res.json() if x["file_id"] == seeded_file]
    assert any(x.get("resolution_action") == "quarantine" for x in q_rows)

    # no more open rows for file
    r2 = requests.get(f"{API}/admin/design-files/reports?status=open",
                      headers={"Authorization": f"Bearer {admin_jwt}"})
    assert not [x for x in r2.json() if x["file_id"] == seeded_file]


def test_unquarantine_restores_file(admin_jwt, seeded_file):
    r = requests.post(
        f"{API}/admin/design-files/{seeded_file}/unquarantine",
        headers={"Authorization": f"Bearer {admin_jwt}"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # reappears in public list
    pub = requests.get(f"{API}/community/files").json()
    assert seeded_file in [f["id"] for f in pub]


def test_unquarantine_missing_404(admin_jwt):
    r = requests.post(
        f"{API}/admin/design-files/nonexistent-file-id-zzz/unquarantine",
        headers={"Authorization": f"Bearer {admin_jwt}"},
    )
    assert r.status_code == 404
