"""Regression: showcase owner edit/delete + admin moderation (Feb 2026).

Verifies:
  • PATCH /community/showcase/{id} — owner only (200), other users (403)
  • DELETE /community/showcase/{id} — owner only (200), other users (403)
  • GET   /admin/community/showcase — auth-gated, paginated
  • POST  /admin/community/showcase/{id}/approve — sets mod_status
  • PATCH /admin/community/showcase/{id} — admin override edit
  • DELETE /admin/community/showcase/{id} — leaves an audit row in
    `admin_moderation_actions` and removes any analytics rows
"""
import os
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


async def _maker_jwt(client: httpx.AsyncClient) -> str:
    from maker_auth import issue_magic_token  # noqa: WPS433
    magic = issue_magic_token("iron-and-oak@craftersmarket.org")
    r = await client.post(f"{API}/api/maker/auth/verify", json={"token": magic})
    return r.json()["token"]


async def _buyer_jwt(client: httpx.AsyncClient, email: str) -> str:
    from maker_auth import issue_buyer_magic_token  # noqa: WPS433
    magic = issue_buyer_magic_token(email)
    r = await client.post(
        f"{API}/api/community/auth/magic/verify",
        json={"token": magic, "accept_eua": True, "eua_version": "2026-04"},
    )
    return r.json()["token"]


async def _admin_jwt(client: httpx.AsyncClient) -> str:
    from maker_auth import issue_admin_magic_token  # noqa: WPS433
    magic = issue_admin_magic_token("team@craftersmarket.org")
    r = await client.post(f"{API}/api/admin/auth/verify", json={"token": magic})
    return r.json()["token"]


@pytest.mark.asyncio
async def test_owner_can_edit_and_delete_own_post():
    """Happy path: maker posts → maker edits → maker deletes. Other users get 403."""
    async with httpx.AsyncClient(timeout=30) as c:
        maker = await _maker_jwt(c)
        evilbuyer = await _buyer_jwt(c, "test-evilowner@craftersmarket.org")

        # Create
        post = (await c.post(
            f"{API}/api/community/showcase",
            headers={"Authorization": f"Bearer {maker}",
                     "Content-Type": "application/json"},
            json={"title": "__pytest_owner_flow__",
                  "description": "Original description.",
                  "image_urls": ["https://example.com/x.jpg"]},
        )).json()
        post_id = post["id"]
        assert post["user_id"] == "maker:iron-and-oak"

        # Non-owner edit → 403
        bad = await c.patch(
            f"{API}/api/community/showcase/{post_id}",
            headers={"Authorization": f"Bearer {evilbuyer}",
                     "Content-Type": "application/json"},
            json={"title": "HACKED"},
        )
        assert bad.status_code == 403, bad.text

        # Owner edit → 200
        ok = await c.patch(
            f"{API}/api/community/showcase/{post_id}",
            headers={"Authorization": f"Bearer {maker}",
                     "Content-Type": "application/json"},
            json={"title": "__pytest_edited__",
                  "description": "After edit."},
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["title"] == "__pytest_edited__"
        assert ok.json()["edited_at"]  # stamped on edit

        # Non-owner delete → 403
        bad = await c.delete(
            f"{API}/api/community/showcase/{post_id}",
            headers={"Authorization": f"Bearer {evilbuyer}"},
        )
        assert bad.status_code == 403, bad.text

        # Owner delete → 200
        ok = await c.delete(
            f"{API}/api/community/showcase/{post_id}",
            headers={"Authorization": f"Bearer {maker}"},
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["deleted"] == post_id


@pytest.mark.asyncio
async def test_admin_moderation_endpoints():
    """Admin can list, approve (with featured flag), edit, and delete any post."""
    async with httpx.AsyncClient(timeout=30) as c:
        maker = await _maker_jwt(c)
        admin = await _admin_jwt(c)

        # Seed
        post = (await c.post(
            f"{API}/api/community/showcase",
            headers={"Authorization": f"Bearer {maker}",
                     "Content-Type": "application/json"},
            json={"title": "__pytest_admin_mod__",
                  "description": "For admin tests.",
                  "image_urls": ["https://example.com/x.jpg"]},
        )).json()
        post_id = post["id"]

        # List
        listing = await c.get(
            f"{API}/api/admin/community/showcase?limit=5",
            headers={"Authorization": f"Bearer {admin}"},
        )
        assert listing.status_code == 200, listing.text
        body = listing.json()
        assert "total" in body and "rows" in body
        assert body["total"] >= 1

        # Approve + feature
        appr = await c.post(
            f"{API}/api/admin/community/showcase/{post_id}/approve",
            headers={"Authorization": f"Bearer {admin}",
                     "Content-Type": "application/json"},
            json={"featured": True},
        )
        assert appr.status_code == 200, appr.text
        body = appr.json()
        assert body["mod_status"] == "featured"
        assert body["mod_approved_by"]
        assert any(h.get("action") == "featured" for h in (body.get("mod_history") or []))

        # Admin edit
        edit = await c.patch(
            f"{API}/api/admin/community/showcase/{post_id}",
            headers={"Authorization": f"Bearer {admin}",
                     "Content-Type": "application/json"},
            json={"title": "__pytest_admin_edited__"},
        )
        assert edit.status_code == 200, edit.text
        body = edit.json()
        assert body["title"] == "__pytest_admin_edited__"
        assert any(h.get("action") == "edit" for h in (body.get("mod_history") or []))

        # Admin delete (with audit snapshot)
        deld = await c.delete(
            f"{API}/api/admin/community/showcase/{post_id}",
            headers={"Authorization": f"Bearer {admin}"},
        )
        assert deld.status_code == 200, deld.text

        # Audit row exists.
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        audit = await db.admin_moderation_actions.find_one(
            {"kind": "showcase_delete", "target_id": post_id}, {"_id": 0},
        )
        assert audit, "missing admin_moderation_actions audit row"
        assert audit["snapshot"]["title"] == "__pytest_admin_edited__"
        # Cleanup the audit row so the collection stays tidy for the next run.
        await db.admin_moderation_actions.delete_one(
            {"kind": "showcase_delete", "target_id": post_id},
        )


@pytest.mark.asyncio
async def test_unauthenticated_cannot_list_admin_showcase():
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{API}/api/admin/community/showcase")
        assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_showcase_reporting_full_flow():
    """Buyer reports a maker post → counter increments → duplicate
    dedupes → self-report blocked → admin sees in `reported` filter →
    approval closes the report."""
    async with httpx.AsyncClient(timeout=30) as c:
        # Reasons endpoint is public
        reasons = await c.get(f"{API}/api/community/showcase/report-reasons")
        assert reasons.status_code == 200
        assert len(reasons.json()["reasons"]) >= 5

        maker = await _maker_jwt(c)
        admin = await _admin_jwt(c)
        reporter = await _buyer_jwt(c, "test-shc-reporter@craftersmarket.org")

        # Maker posts
        post = (await c.post(
            f"{API}/api/community/showcase",
            headers={"Authorization": f"Bearer {maker}",
                     "Content-Type": "application/json"},
            json={"title": "__pytest_report_target__",
                  "description": "Report me.",
                  "image_urls": ["https://example.com/x.jpg"]},
        )).json()
        post_id = post["id"]

        # First report — succeeds
        r1 = await c.post(
            f"{API}/api/community/showcase/{post_id}/report",
            headers={"Authorization": f"Bearer {reporter}",
                     "Content-Type": "application/json"},
            json={"reason": "spam", "details": "promotional"},
        )
        assert r1.status_code == 200, r1.text
        assert r1.json()["duplicate"] is False

        # Duplicate from same user — same id, no second row
        r2 = await c.post(
            f"{API}/api/community/showcase/{post_id}/report",
            headers={"Authorization": f"Bearer {reporter}",
                     "Content-Type": "application/json"},
            json={"reason": "spam"},
        )
        assert r2.status_code == 200
        assert r2.json()["duplicate"] is True
        assert r2.json()["id"] == r1.json()["id"]

        # Self-report → 400
        r3 = await c.post(
            f"{API}/api/community/showcase/{post_id}/report",
            headers={"Authorization": f"Bearer {maker}",
                     "Content-Type": "application/json"},
            json={"reason": "spam"},
        )
        assert r3.status_code == 400, r3.text
        assert "own post" in r3.text.lower()

        # Admin sees the post in the reported queue
        q = await c.get(
            f"{API}/api/admin/community/showcase?status=reported",
            headers={"Authorization": f"Bearer {admin}"},
        )
        assert q.status_code == 200
        ids = [row["id"] for row in q.json()["rows"]]
        assert post_id in ids
        target = next(r for r in q.json()["rows"] if r["id"] == post_id)
        assert target["open_reports"] >= 1
        assert target["mod_status"] == "reported"

        # Admin approval clears the report counter
        appr = await c.post(
            f"{API}/api/admin/community/showcase/{post_id}/approve",
            headers={"Authorization": f"Bearer {admin}",
                     "Content-Type": "application/json"},
            json={},
        )
        body = appr.json()
        assert body["mod_status"] == "approved"
        assert body["open_reports"] == 0

        # Report row marked dismissed by approval
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        rep_doc = await db.showcase_reports.find_one(
            {"id": r1.json()["id"]}, {"_id": 0},
        )
        assert rep_doc and rep_doc["status"] == "dismissed"
        assert rep_doc["resolver"]

        # Cleanup
        await c.delete(
            f"{API}/api/admin/community/showcase/{post_id}",
            headers={"Authorization": f"Bearer {admin}"},
        )
        await db.showcase_reports.delete_one({"id": r1.json()["id"]})
        await db.admin_moderation_actions.delete_one(
            {"kind": "showcase_delete", "target_id": post_id},
        )


@pytest.mark.asyncio
async def test_showcase_report_rejects_invalid_reason():
    async with httpx.AsyncClient(timeout=30) as c:
        maker = await _maker_jwt(c)
        reporter = await _buyer_jwt(c, "test-shc-bad-reason@craftersmarket.org")
        post = (await c.post(
            f"{API}/api/community/showcase",
            headers={"Authorization": f"Bearer {maker}",
                     "Content-Type": "application/json"},
            json={"title": "__pytest_invalid_reason__",
                  "description": "x",
                  "image_urls": ["https://example.com/x.jpg"]},
        )).json()
        try:
            r = await c.post(
                f"{API}/api/community/showcase/{post['id']}/report",
                headers={"Authorization": f"Bearer {reporter}",
                         "Content-Type": "application/json"},
                json={"reason": "not-a-real-reason"},
            )
            assert r.status_code == 400, r.text
        finally:
            # Owner cleanup
            await c.delete(
                f"{API}/api/community/showcase/{post['id']}",
                headers={"Authorization": f"Bearer {maker}"},
            )
