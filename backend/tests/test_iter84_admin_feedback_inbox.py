"""
Iter84 — Admin Beta Feedback inbox.

Confirms:
  • POST /api/feedback (public) records a submission
  • GET /api/admin/feedback returns rows newest-first
  • POST /api/admin/feedback/{id}/resolve flips the resolved flag
  • POST /api/admin/feedback/{id}/reply sends + auto-resolves
  • Filter param `?resolved=true|false` segments correctly
"""
import os
import sys
import time
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
from maker_auth import issue_admin_magic_token  # noqa: E402

API = os.environ.get(
    "PUBLIC_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
ADMIN_EMAIL = "team@craftersmarket.org"


def _admin_jwt() -> str:
    tok = issue_admin_magic_token(ADMIN_EMAIL)
    r = requests.post(f"{API}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _submit(name: str, msg: str) -> dict:
    r = requests.post(
        f"{API}/api/feedback",
        json={"name": name, "email": f"{name.lower()}@example.com",
              "message": msg, "page": "/maker/dashboard"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def test_full_inbox_lifecycle():
    h = {"Authorization": f"Bearer {_admin_jwt()}"}

    # 1. Three submissions, ~0.5s apart so created_at ordering is deterministic.
    ids = []
    for i in (1, 2, 3):
        body = _submit(f"Iter84-{i}", f"iter84 test message #{i}")
        ids.append(body["id"])
        time.sleep(0.5)

    try:
        # 2. Newest-first listing → id #3 should be first
        rows = requests.get(
            f"{API}/api/admin/feedback", params={"resolved": False},
            headers=h, timeout=15,
        ).json()["items"]
        first_three_ids = [r["id"] for r in rows[:3]]
        assert first_three_ids == [ids[2], ids[1], ids[0]], (first_three_ids, ids)

        # 3. Resolve middle one
        r = requests.post(
            f"{API}/api/admin/feedback/{ids[1]}/resolve",
            headers=h, timeout=15,
        )
        assert r.status_code == 200

        # 4. Pending list now skips ids[1]
        pending = [
            r["id"] for r in requests.get(
                f"{API}/api/admin/feedback", params={"resolved": False},
                headers=h, timeout=15,
            ).json()["items"]
        ]
        assert ids[1] not in pending
        assert ids[0] in pending and ids[2] in pending

        # 5. Reply to ids[0] → auto-resolves
        r = requests.post(
            f"{API}/api/admin/feedback/{ids[0]}/reply",
            headers=h, timeout=15,
            json={"subject": "Re: your iter84 test", "message": "Thanks for the report.", "auto_resolve": True},
        )
        assert r.status_code == 200, r.text

        resolved = [
            r["id"] for r in requests.get(
                f"{API}/api/admin/feedback", params={"resolved": True},
                headers=h, timeout=15,
            ).json()["items"]
        ]
        assert ids[0] in resolved and ids[1] in resolved

        # 6. The replied row carries replied_at + replied_by
        full = [
            r for r in requests.get(
                f"{API}/api/admin/feedback", params={"resolved": True},
                headers=h, timeout=15,
            ).json()["items"] if r["id"] == ids[0]
        ][0]
        assert full.get("replied_at") and full.get("replied_by")

    finally:
        # Cleanup: drop test docs so the inbox stays clean.
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio
        async def _cleanup():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            await client[os.environ["DB_NAME"]].beta_feedback.delete_many(
                {"id": {"$in": ids}},
            )
        asyncio.run(_cleanup())


if __name__ == "__main__":
    test_full_inbox_lifecycle(); print("✓ admin feedback inbox lifecycle")
    print("\niter84 check passed.")
