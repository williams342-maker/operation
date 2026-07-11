"""iter442 — WebSocket chat ticket auth tests.

The JWT must never appear in the WS URL: clients exchange it for a 60s
single-use ticket. Also covers the production bug where the widget's
`help` / `showcase` channels were rejected pre-accept.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from server import app
from maker_auth import issue_session_jwt

client = TestClient(app)
MAKER_JWT = issue_session_jwt("iron-and-oak", "iron-and-oak@craftersmarket.org", role="maker")


def _ticket(jwt=MAKER_JWT):
    r = client.post("/api/community/chat/ws-ticket",
                    headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200
    body = r.json()
    assert body["expires_in"] == 60
    return body["ticket"]


def test_ticket_requires_auth():
    r = client.post("/api/community/chat/ws-ticket")
    assert r.status_code == 401
    r2 = client.post("/api/community/chat/ws-ticket",
                     headers={"Authorization": "Bearer not-a-jwt"})
    assert r2.status_code == 401


def test_help_channel_connects_with_ticket():
    t = _ticket()
    with client.websocket_connect(f"/api/ws/chat/help?ticket={t}") as ws:
        snap = ws.receive_json()
        assert snap["kind"] == "presence"


def test_showcase_channel_connects():
    t = _ticket()
    with client.websocket_connect(f"/api/ws/chat/showcase?ticket={t}") as ws:
        assert ws.receive_json()["kind"] == "presence"


def test_ticket_is_single_use():
    t = _ticket()
    with client.websocket_connect(f"/api/ws/chat/help?ticket={t}") as ws:
        ws.receive_json()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/ws/chat/help?ticket={t}"):
            pass


def test_forged_ticket_rejected():
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/ws/chat/help?ticket={uuid.uuid4().hex}"):
            pass


def test_unknown_channel_rejected():
    t = _ticket()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/ws/chat/nope?ticket={t}"):
            pass


def test_no_credentials_rejected():
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/ws/chat/help"):
            pass


def test_legacy_token_param_still_works():
    # Cached bundles mid-rollout still send ?token= — keep them connected.
    with client.websocket_connect(f"/api/ws/chat/help?token={MAKER_JWT}") as ws:
        assert ws.receive_json()["kind"] == "presence"


def test_send_and_broadcast_roundtrip():
    t1, t2 = _ticket(), _ticket()
    with client.websocket_connect(f"/api/ws/chat/help?ticket={t1}") as a:
        a.receive_json()  # presence
        with client.websocket_connect(f"/api/ws/chat/help?ticket={t2}") as b:
            b.receive_json()          # presence
            a.receive_json()          # "signed on" system msg
            marker = f"ticket-test-{uuid.uuid4().hex[:6]}"
            a.send_json({"text": marker})
            for _ in range(4):        # skip typing/system frames
                msg = b.receive_json()
                if msg.get("kind") == "message" and msg.get("text") == marker:
                    break
            else:
                raise AssertionError("broadcast message not received")
