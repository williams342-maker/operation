"""
Iter85 — Public Contact form + admin Contact Inbox.

Covers:
  • POST /api/contact-messages — public submission, validation, honeypot
  • GET /api/admin/contact-messages — newest-first, filter by resolved + topic
  • POST /admin/contact-messages/:id/resolve — flips resolved=true
  • POST /admin/contact-messages/:id/reply — sends email + auto-resolves
  • IPs are excluded from admin response (privacy)
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


def test_public_submit_validates():
    # too short message
    r = requests.post(f"{API}/api/contact-messages", json={
        "name": "Bob", "email": "bob@example.com", "message": "hi",
    }, timeout=15)
    assert r.status_code == 422

    # invalid email
    r = requests.post(f"{API}/api/contact-messages", json={
        "name": "Bob", "email": "not-an-email", "message": "valid message body length",
    }, timeout=15)
    assert r.status_code == 422


def test_honeypot_silently_succeeds():
    # The honeypot should return 200 but NOT persist the row.
    r = requests.post(f"{API}/api/contact-messages", json={
        "name": "Spammer", "email": "spam@example.com",
        "message": "buy followers cheap and quickly today", "website": "http://spam.example",
    }, timeout=15)
    assert r.status_code == 200
    # Verify nothing landed in admin inbox
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    rows = requests.get(
        f"{API}/api/admin/contact-messages", headers=h,
        params={"resolved": False}, timeout=15,
    ).json()["items"]
    assert all(r0["email"] != "spam@example.com" for r0 in rows)


def test_full_inbox_lifecycle():
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    ids = []
    payloads = [
        {"name": "Iter85-A", "email": "iter85a@example.com", "topic": "general",
         "subject": "Q1", "message": "general inquiry message here"},
        {"name": "Iter85-B", "email": "iter85b@example.com", "topic": "custom_order",
         "subject": "Q2", "message": "custom order inquiry message body"},
        {"name": "Iter85-C", "email": "iter85c@example.com", "topic": "bug",
         "subject": "Q3", "message": "bug report long enough body"},
    ]
    for p in payloads:
        r = requests.post(f"{API}/api/contact-messages", json=p, timeout=15)
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])
        time.sleep(0.4)

    try:
        # 1. newest-first
        rows = requests.get(
            f"{API}/api/admin/contact-messages", headers=h,
            params={"resolved": False}, timeout=15,
        ).json()["items"]
        first_three_ids = [r["id"] for r in rows[:3]]
        assert first_three_ids == [ids[2], ids[1], ids[0]]

        # 2. IPs are NOT exposed
        for r in rows:
            assert "ip" not in r, "admin response leaked IP"

        # 3. topic filter
        bug_only = requests.get(
            f"{API}/api/admin/contact-messages", headers=h,
            params={"topic": "bug"}, timeout=15,
        ).json()["items"]
        assert any(r0["id"] == ids[2] for r0 in bug_only)
        assert all(r0["topic"] == "bug" for r0 in bug_only)

        # 4. resolve middle one
        r = requests.post(
            f"{API}/api/admin/contact-messages/{ids[1]}/resolve",
            headers=h, timeout=15,
        )
        assert r.status_code == 200

        # 5. reply auto-resolves first
        r = requests.post(
            f"{API}/api/admin/contact-messages/{ids[0]}/reply",
            headers=h,
            json={"subject": "Re: Q1", "message": "Thanks for reaching out.", "auto_resolve": True},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        # Both ids[0] and ids[1] should now be resolved
        resolved_ids = [
            r["id"] for r in requests.get(
                f"{API}/api/admin/contact-messages", headers=h,
                params={"resolved": True}, timeout=15,
            ).json()["items"]
        ]
        assert ids[0] in resolved_ids and ids[1] in resolved_ids
        # ids[2] still pending
        assert ids[2] not in resolved_ids

    finally:
        # Cleanup
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio
        async def _cleanup():
            c = AsyncIOMotorClient(os.environ["MONGO_URL"])
            await c[os.environ["DB_NAME"]].contact_messages.delete_many({"id": {"$in": ids}})
        asyncio.run(_cleanup())


if __name__ == "__main__":
    test_public_submit_validates(); print("✓ submit validation")
    test_honeypot_silently_succeeds(); print("✓ honeypot")
    test_full_inbox_lifecycle(); print("✓ full inbox lifecycle")
    print("\niter85 checks passed.")
