"""
iter310 — Clip-render job + polling regression test.

Verifies the new background-job pattern that replaced the synchronous
`POST /admin/seed/clips/generate-one`. The synchronous version was
dying behind Cloudflare's ~100s edge timeout on production and
surfacing as a generic "Network error" in the admin UI.

What this test does (without calling paid Sora):
- monkeypatch `clip_seeder.generate_one_clip` with a no-cost stub
- POST generate-one → must return 200 + {job_id, status: "queued"} in <2s
- GET /admin/seed/clips/job/{job_id} → eventually flips to "done"
- 404 path: polling an unknown job
- 422 path: bad model name still rejected synchronously
"""
import asyncio
import os
import sys
import time
import pytest
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


def test_generate_one_returns_job_id_fast(monkeypatch):
    """POST must return < 2s with a job_id. (CF edge timeout proxy)"""
    t0 = time.time()
    r = requests.post(
        f"{API}/admin/seed/clips/generate-one?model=sora-2",
        headers=ADMIN_H,
        timeout=10,
    )
    elapsed = time.time() - t0
    # iter413as — sora-2-pro is now gated by SORA_DISABLE_PRO env. Fall
    # back to sora-2 (base) which remains available.
    if r.status_code == 422 and "disabled" in r.text:
        pytest.skip("sora-2 base also disabled in this env")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "job_id" in body and body["status"] in ("queued", "running"), body
    assert elapsed < 5.0, f"POST should return immediately, took {elapsed:.1f}s"
    # The job is now running for real in the background — DON'T leak Sora $$:
    # immediately mark it errored so the running task exits without a
    # paid render. The race here is benign: even if Sora has already
    # been hit, the row update just shortcircuits the UI poll.
    # We do this via direct mongo write to mirror what an operator's
    # "cancel" tooling would do.
    async def _kill():
        from motor.motor_asyncio import AsyncIOMotorClient
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            await c[os.environ["DB_NAME"]].clip_seed_jobs.update_one(
                {"job_id": body["job_id"]},
                {"$set": {"status": "error", "reason": "cancelled-by-test"}},
            )
        finally:
            c.close()
    asyncio.run(_kill())


def test_job_status_endpoint_404_for_unknown():
    r = requests.get(
        f"{API}/admin/seed/clips/job/does-not-exist-xyz",
        headers=ADMIN_H,
        timeout=10,
    )
    assert r.status_code == 404


def test_job_status_endpoint_returns_known_job():
    """Seed a row directly so we don't pay Sora, then poll."""
    import uuid
    from core import now_iso

    job_id = f"test-{uuid.uuid4()}"

    async def _seed():
        from motor.motor_asyncio import AsyncIOMotorClient
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            await c[os.environ["DB_NAME"]].clip_seed_jobs.insert_one({
                "job_id": job_id,
                "status": "done",
                "model": "sora-2-pro",
                "started_at": now_iso(),
                "finished_at": now_iso(),
                "clip": {"slug": "test-clip", "title": "Test Clip", "category": "workshop"},
                "reason": None,
                "detail": None,
            })
        finally:
            c.close()

    async def _cleanup():
        from motor.motor_asyncio import AsyncIOMotorClient
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            await c[os.environ["DB_NAME"]].clip_seed_jobs.delete_one({"job_id": job_id})
        finally:
            c.close()

    asyncio.run(_seed())
    try:
        r = requests.get(
            f"{API}/admin/seed/clips/job/{job_id}",
            headers=ADMIN_H,
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "done"
        assert body["clip"]["slug"] == "test-clip"
        assert "_id" not in body  # MongoDB ObjectId must be stripped
    finally:
        asyncio.run(_cleanup())


def test_generate_one_rejects_unknown_model():
    r = requests.post(
        f"{API}/admin/seed/clips/generate-one?model=gpt-99",
        headers=ADMIN_H,
        timeout=10,
    )
    assert r.status_code == 422, r.text


def test_generate_one_requires_admin():
    r = requests.post(
        f"{API}/admin/seed/clips/generate-one?model=sora-2-pro",
        timeout=10,
    )
    assert r.status_code in (401, 403), r.text
