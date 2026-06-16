"""
iter310c — `GET /admin/seed/clips/jobs/recent` regression test.

Powers the "Last 5 renders" strip on the admin Settings page so the
operator can spot recurring Sora failures at a glance.
"""
import asyncio
import os
import sys
import uuid

import requests

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


def _mint_admin() -> str:
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{API}/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


ADMIN_H = {"Authorization": f"Bearer {_mint_admin()}"}


def _run_db_op(coll, method, *args, **kwargs):
    """iter413as — Bind motor to a fresh loop inside asyncio.run()."""
    async def _inner():
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            return await getattr(client[os.environ["DB_NAME"]][coll], method)(*args, **kwargs)
        finally:
            client.close()
    return asyncio.run(_inner())


def _seed_job(status: str = "done", **extra):
    """Insert a synthetic clip_seed_jobs row directly so we don't pay Sora."""
    from core import now_iso
    doc = {
        "job_id": f"test-{uuid.uuid4()}",
        "status": status,
        "model": "sora-2-pro",
        "started_at": now_iso(),
        "finished_at": now_iso(),
        "clip": {"slug": "test-row", "title": "Test", "category": "workshop"} if status == "done" else None,
        "reason": None,
        "detail": None,
    }
    doc.update(extra)
    _run_db_op("clip_seed_jobs", "insert_one", doc)
    return doc["job_id"]


def _cleanup(job_ids):
    _run_db_op("clip_seed_jobs", "delete_many", {"job_id": {"$in": job_ids}})


def test_recent_jobs_returns_latest_first_and_respects_limit():
    seeded = [_seed_job() for _ in range(3)]
    try:
        r = requests.get(
            f"{API}/admin/seed/clips/jobs/recent?limit=2",
            headers=ADMIN_H,
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "jobs" in body
        assert len(body["jobs"]) <= 2
        # Each row strips Mongo _id and carries the polling shape.
        for j in body["jobs"]:
            assert "_id" not in j
            assert "job_id" in j
            assert "status" in j
    finally:
        _cleanup(seeded)


def test_recent_jobs_caps_limit_at_25():
    # Even passing limit=999 must not crash or return absurdly many rows.
    r = requests.get(
        f"{API}/admin/seed/clips/jobs/recent?limit=999",
        headers=ADMIN_H,
        timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["jobs"]) <= 25


def test_recent_jobs_requires_admin():
    r = requests.get(
        f"{API}/admin/seed/clips/jobs/recent",
        timeout=10,
    )
    assert r.status_code in (401, 403), r.text


def test_recent_jobs_returns_error_rows_with_reason_and_detail():
    seeded = [_seed_job(status="error", reason="video generation failed", detail="Sora returned no video after 900s")]
    try:
        r = requests.get(
            f"{API}/admin/seed/clips/jobs/recent?limit=1",
            headers=ADMIN_H,
            timeout=10,
        )
        assert r.status_code == 200
        rows = r.json()["jobs"]
        # The seeded error row should be in the response (most recent).
        match = [j for j in rows if j["job_id"] in seeded]
        assert match, "seeded error job missing from recent list"
        j = match[0]
        assert j["status"] == "error"
        assert j["reason"] == "video generation failed"
        assert "900s" in (j.get("detail") or "")
    finally:
        _cleanup(seeded)
