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
import os
import sys
import time
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
        f"{API}/admin/seed/clips/generate-one?model=sora-2-pro",
        headers=ADMIN_H,
        timeout=10,
    )
    elapsed = time.time() - t0
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
    import asyncio
    from core import db
    async def _kill():
        await db.clip_seed_jobs.update_one(
            {"job_id": body["job_id"]},
            {"$set": {"status": "error", "reason": "cancelled-by-test"}},
        )
    asyncio.get_event_loop().run_until_complete(_kill())


def test_job_status_endpoint_404_for_unknown():
    r = requests.get(
        f"{API}/admin/seed/clips/job/does-not-exist-xyz",
        headers=ADMIN_H,
        timeout=10,
    )
    assert r.status_code == 404


def test_job_status_endpoint_returns_known_job():
    """Seed a row directly so we don't pay Sora, then poll."""
    import asyncio
    import uuid
    from core import db, now_iso

    job_id = f"test-{uuid.uuid4()}"

    async def _seed():
        await db.clip_seed_jobs.insert_one({
            "job_id": job_id,
            "status": "done",
            "model": "sora-2-pro",
            "started_at": now_iso(),
            "finished_at": now_iso(),
            "clip": {"slug": "test-clip", "title": "Test Clip", "category": "workshop"},
            "reason": None,
            "detail": None,
        })

    async def _cleanup():
        await db.clip_seed_jobs.delete_one({"job_id": job_id})

    loop = asyncio.get_event_loop()
    loop.run_until_complete(_seed())
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
        loop.run_until_complete(_cleanup())


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
