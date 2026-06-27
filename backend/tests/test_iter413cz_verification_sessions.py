"""iter413cz — Verification Session Framework contract.

Verifies:
  • Admin can START a session with any of the 7 canonical types.
  • Rejects unknown verification_type.
  • Manually appended turns (issue / recommendation / note) bump the
    denormalised counters.
  • A help-chat call carrying `verification_session_id` mirrors both
    the question and Compass's response into the session's `turns`.
  • A closed session does NOT accept further turn appends.
  • Listing supports filter-by-type / status / feature_area.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://active-project-4.preview.emergentagent.com"
).rstrip("/")


@pytest.fixture(scope="module")
def admin_jwt():
    from maker_auth import issue_admin_magic_token
    super_email = (
        os.environ.get("ADMIN_EMAILS") or "team@craftersmarket.org"
    ).split(",")[0].strip()
    tok = issue_admin_magic_token(super_email)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _wipe(session_id: str):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _do():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.verification_sessions.delete_one({"id": session_id})
        client.close()
    asyncio.run(_do())


def test_admin_required():
    for path in (
        "/api/admin/verification-sessions/start",
        "/api/admin/verification-sessions",
    ):
        r = requests.get(f"{BASE_URL}{path}", timeout=15)
        assert r.status_code in (401, 403, 405), f"{path} not gated"


def test_rejects_unknown_type(admin_jwt):
    r = requests.post(
        f"{BASE_URL}/api/admin/verification-sessions/start",
        headers=_h(admin_jwt),
        json={"verification_type": "garbage_type", "title": "unknown type probe"},
        timeout=15,
    )
    assert r.status_code == 400


@pytest.mark.parametrize("vtype", [
    "production_verification",
    "founder_onboarding",
    "feature_validation",
    "seller_interview",
    "buyer_research",
    "beta_feedback",
    "ai_evaluation",
])
def test_start_all_canonical_types(admin_jwt, vtype):
    r = requests.post(
        f"{BASE_URL}/api/admin/verification-sessions/start",
        headers=_h(admin_jwt),
        json={"verification_type": vtype, "title": f"test-{vtype}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    sid = r.json()["session"]["id"]
    try:
        assert r.json()["session"]["verification_type"] == vtype
        assert r.json()["session"]["completion_status"] == "open"
    finally:
        _wipe(sid)


def test_full_lifecycle_with_compass_mirror(admin_jwt):
    """Open → append issue + recommendation → Compass chat carries the
    session id and mirrors both turns → close → verify the session has
    the full audit trail."""
    # 1. Open
    r = requests.post(
        f"{BASE_URL}/api/admin/verification-sessions/start",
        headers=_h(admin_jwt),
        json={
            "verification_type": "production_verification",
            "title": f"iter413cz lifecycle {uuid.uuid4().hex[:8]}",
            "feature_area": "listing_video_phase1",
            "subject": {"role": "maker", "slug": "iron-and-oak"},
        },
        timeout=15,
    )
    sid = r.json()["session"]["id"]
    try:
        # 2. Append a manual issue + recommendation
        for kind, text in (("issue", "Editor video drop zone tiny on mobile"),
                            ("recommendation", "Raise drop-zone min-height to 200px")):
            ar = requests.post(
                f"{BASE_URL}/api/admin/verification-sessions/{sid}/turns",
                headers=_h(admin_jwt),
                json={"kind": kind, "author": "admin", "text": text},
                timeout=15,
            )
            assert ar.status_code == 200, ar.text

        # 3. Compass chat carrying the session id
        cr = requests.post(
            f"{BASE_URL}/api/help/chat",
            json={
                "message": "Can I upload a video to my listing?",
                "user_role": "maker",
                "verification_session_id": sid,
            },
            timeout=30,
        )
        assert cr.status_code == 200, cr.text

        # 4. Fetch the session — turns must include question + response
        g = requests.get(
            f"{BASE_URL}/api/admin/verification-sessions/{sid}",
            headers=_h(admin_jwt), timeout=15,
        )
        doc = g.json()["session"]
        assert doc["issues_count"] == 1
        assert doc["recommendations_count"] == 1
        kinds = [t["kind"] for t in doc["turns"]]
        assert "issue" in kinds
        assert "recommendation" in kinds
        assert "question" in kinds
        assert "response" in kinds
        q_turn = next(t for t in doc["turns"] if t["kind"] == "question")
        a_turn = next(t for t in doc["turns"] if t["kind"] == "response")
        assert "video" in q_turn["text"].lower()
        assert a_turn["author"] == "compass"
        assert len(a_turn["text"]) > 20  # real response, not stub

        # 5. Close → status=passed, summary persisted as a note
        cl = requests.post(
            f"{BASE_URL}/api/admin/verification-sessions/{sid}/close",
            headers=_h(admin_jwt),
            json={"completion_status": "passed", "summary": "iter413cz happy path"},
            timeout=15,
        )
        assert cl.status_code == 200
        closed = cl.json()["session"]
        assert closed["completion_status"] == "passed"
        assert closed["closed_at"] and closed["closed_by"]

        # 6. Appending after close → 404
        late = requests.post(
            f"{BASE_URL}/api/admin/verification-sessions/{sid}/turns",
            headers=_h(admin_jwt),
            json={"kind": "note", "author": "admin", "text": "too late"},
            timeout=15,
        )
        assert late.status_code == 404
    finally:
        _wipe(sid)


def test_list_with_filters(admin_jwt):
    sig = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{BASE_URL}/api/admin/verification-sessions/start",
        headers=_h(admin_jwt),
        json={
            "verification_type": "seller_interview",
            "title": f"filter probe {sig}",
            "feature_area": f"probe-{sig}",
        },
        timeout=15,
    )
    sid = r.json()["session"]["id"]
    try:
        ls = requests.get(
            f"{BASE_URL}/api/admin/verification-sessions"
            f"?verification_type=seller_interview&feature_area=probe-{sig}",
            headers=_h(admin_jwt), timeout=15,
        )
        body = ls.json()
        assert any(row["id"] == sid for row in body["rows"])
        assert "valid_types" in body
        # Turns are dropped on list reads to keep the payload light.
        for row in body["rows"]:
            assert "turns" not in row
    finally:
        _wipe(sid)
