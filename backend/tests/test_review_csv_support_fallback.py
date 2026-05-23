"""Regression: Support-fallback CSV forward (iter185).

The monkeypatch trick doesn't work here because the backend is a
separate process — patching `email_service.send_mailgun_with_attachment`
in the test process has no effect on the running uvicorn worker. So
this file only covers:
  • Auth gate (no real email needed — 401 short-circuits)
  • Empty-file rejection (400 before any send)

The happy path was manually verified during initial development —
two real test emails landed in team@craftersmarket.org with proper
subject + attachment. To re-verify in CI without sending real mail,
swap to fastapi.TestClient with the app loaded in-process so
monkeypatch can reach it. Out of scope for this regression batch.
"""
import io

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


async def _maker_jwt(maker_slug: str = "williams-cnc") -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(maker_slug, f"{maker_slug}@test.local")


@pytest.mark.asyncio
async def test_send_to_support_requires_auth():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import/send-to-support",
            files={"file": ("x.csv", io.BytesIO(b"a,b,c\n1,2,3"), "text/csv")},
        )
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_send_to_support_rejects_empty_file():
    """Empty payload → 400, short-circuits before reaching Mailgun."""
    jwt = await _maker_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import/send-to-support",
            headers={"Authorization": f"Bearer {jwt}"},
            files={"file": ("empty.csv", io.BytesIO(b""), "text/csv")},
        )
    assert r.status_code == 400
    assert "empty" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_send_to_support_rejects_oversize_file():
    """File above the 5 MB cap → 413, short-circuits before Mailgun."""
    jwt = await _maker_jwt()
    huge = b"x," * (3 * 1024 * 1024)  # ~6 MB
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{API}/api/maker/reviews/import/send-to-support",
            headers={"Authorization": f"Bearer {jwt}"},
            files={"file": ("huge.csv", io.BytesIO(huge), "text/csv")},
        )
    assert r.status_code == 413
    assert "too large" in r.json()["detail"].lower()
