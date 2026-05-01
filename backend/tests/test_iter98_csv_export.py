"""iter98 — CSV export endpoint tests.

In a separate file because TestClient spawns its own asyncio loop via
anyio's blocking portal, which conflicts with Motor's module-scoped
event-loop binding when async DB tests run in the same module.

We share ONE TestClient across both tests via a module fixture; spinning
up a second client in the same process triggers the same loop-binding
collision we're trying to avoid.
"""
import pytest
from fastapi.testclient import TestClient

from server import app
from maker_auth import issue_session_jwt


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_csv_export_returns_streaming_csv(client):
    token = issue_session_jwt("admin", "team@craftersmarket.org", role="admin")
    r = client.get(
        "/api/admin/updates/subscribers.csv",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd and "subscribers-" in cd and ".csv" in cd
    body = r.text
    assert body.startswith("email,name,subscribed_at,")


def test_csv_export_requires_admin_auth(client):
    r = client.get("/api/admin/updates/subscribers.csv")
    assert r.status_code in (401, 403)

