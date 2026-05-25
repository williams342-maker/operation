"""iter224 contract test — /api/admin/prod-health response shape.

DeployHealthPill on the AdminDashboard header reads specific fields from
this snapshot to decide its color. If anyone refactors prod_health.py and
drops one of these keys, the pill silently breaks (shows `Prod · ?` for
every operator). This file pins the contract:
  - top-level: target, enabled, threshold, any_alerted, endpoints[]
  - per-endpoint: endpoint, last_ok, last_status, consecutive_failures, alerted
"""
import os

import pytest
import requests

API_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://active-project-4.preview.emergentagent.com"
API = f"{API_URL.rstrip('/')}/api"


def _admin_headers():
    from maker_auth import issue_session_jwt
    return {"Authorization": f"Bearer {issue_session_jwt('cm-admin', 'admin@craftersmarket.org', role='admin')}"}


def test_prod_health_snapshot_top_level_shape():
    r = requests.get(f"{API}/admin/prod-health", headers=_admin_headers(), timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    # DeployHealthPill.deriveDeployStatus reads these four — locked.
    for key in ("target", "enabled", "any_alerted", "endpoints"):
        assert key in body, f"missing top-level key: {key}"
    assert isinstance(body["endpoints"], list)
    assert isinstance(body["enabled"], bool)
    assert isinstance(body["any_alerted"], bool)


def test_prod_health_snapshot_endpoint_row_shape():
    """At least one watchdog row should exist on this preview pod (we run
    the prod watchdog against craftersmarket.org continuously). The pill
    reads `last_ok`, `last_status`, `consecutive_failures`, `alerted`."""
    r = requests.get(f"{API}/admin/prod-health", headers=_admin_headers(), timeout=15)
    body = r.json()
    eps = body["endpoints"]
    if not eps:
        pytest.skip("watchdog hasn't recorded any results yet (fresh pod)")
    row = eps[0]
    for key in ("endpoint", "last_ok", "last_status", "consecutive_failures", "alerted"):
        assert key in row, f"missing endpoint-row key: {key}"
    # Types the pill assumes
    assert isinstance(row["last_ok"], bool)
    assert isinstance(row["alerted"], bool)
    assert isinstance(row["consecutive_failures"], int)


def test_prod_health_snapshot_requires_admin():
    r = requests.get(f"{API}/admin/prod-health", timeout=10)
    assert r.status_code in (401, 403), f"expected auth required, got {r.status_code}"
