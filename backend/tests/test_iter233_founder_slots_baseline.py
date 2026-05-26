"""iter233 — Founder slot baseline-taken offset.

The /api/founders/slots endpoint adds a small `FOUNDER_INAUGURAL_BASELINE_TAKEN`
offset (default 5) to the real DB count so a fresh prod stack with zero
approved founders still renders "95 / 100" instead of the optics-killing
"100 / 100".
"""
import os
import sys

import pytest
import httpx

sys.path.insert(0, "/app/backend")

# Resolve API base from env (preferred) or .env file.
API = os.environ.get("REACT_APP_BACKEND_URL")
if not API:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                API = line.split("=", 1)[1].strip()
                break


@pytest.mark.asyncio
async def test_slot_counter_includes_baseline_offset():
    """Baseline default 5 means taken should always be >= 5."""
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{API}/api/founders/slots")
    assert r.status_code == 200
    body = r.json()
    # Even on an empty DB, the counter never reads 0 taken / 100 remaining.
    assert body["inaugural_taken"] >= 5, f"expected baseline ≥5, got {body['inaugural_taken']}"
    assert body["inaugural_remaining"] <= 95, f"expected ≤95 remaining, got {body['inaugural_remaining']}"


@pytest.mark.asyncio
async def test_slot_counter_invariants_hold():
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{API}/api/founders/slots")
    body = r.json()
    assert body["inaugural_total"] == 100
    assert body["inaugural_taken"] + body["inaugural_remaining"] == 100
    assert 0 <= body["inaugural_taken"] <= 100
    assert 0 <= body["inaugural_remaining"] <= 100
