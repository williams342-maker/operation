"""Regression: LLM budget exhaustion watchdog (iter261)."""
import pytest

from llm_budget_alert import is_budget_exhaustion_error


@pytest.mark.parametrize("msg, expected", [
    # Positive — these should trigger an alert
    ("insufficient_quota: please check your billing", True),
    ("HTTP 402 Payment Required", True),
    ("Budget exceeded for this API key", True),
    ("Out of credit on Universal Key", True),
    ("Quota exhausted", True),
    ("Payment required", True),
    ("Emergent LLM budget depleted", True),
    ("low balance", True),
    # Negative — these should NOT trigger
    ("Connection timeout", False),
    ("content_policy_violation", False),
    ("Sora-2 returned empty response", False),
    ("HTTP 500 server error", False),
    ("save_video failed: disk full", False),
    ("", False),
])
def test_is_budget_exhaustion_error(msg, expected):
    assert is_budget_exhaustion_error(msg) is expected


def test_is_budget_exhaustion_error_with_exception_object():
    # Should handle exception instances too, not just strings
    class FakeErr(Exception):
        pass
    assert is_budget_exhaustion_error(FakeErr("insufficient_quota: bla")) is True
    assert is_budget_exhaustion_error(FakeErr("timeout")) is False


@pytest.mark.asyncio
async def test_notify_dedupes_within_window(monkeypatch):
    """Two rapid alerts for the same kind → only one fires."""
    from llm_budget_alert import notify_budget_exhausted
    from core import db

    test_kind = "_pytest_dedup_test"
    # Clean slate
    await db.llm_budget_alerts.delete_many({"kind": test_kind})

    # First call → should fire
    r1 = await notify_budget_exhausted(
        kind=test_kind,
        service="(test) Sora",
        error_message="insufficient_quota",
        context={"test": True},
    )
    assert r1["alerted"] is True
    assert r1["deduped"] is False

    # Second call within window → should dedupe
    r2 = await notify_budget_exhausted(
        kind=test_kind,
        service="(test) Sora",
        error_message="insufficient_quota",
        context={"test": True},
    )
    assert r2["alerted"] is False
    assert r2["deduped"] is True

    # Cleanup
    await db.llm_budget_alerts.delete_many({"kind": test_kind})


@pytest.mark.asyncio
async def test_alerts_endpoint_requires_admin():
    """The /admin/llm-budget-alerts endpoints must require admin auth."""
    import httpx
    with open("/app/frontend/.env") as f:
        api = next((ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")), "http://localhost:8001")
    async with httpx.AsyncClient(timeout=10) as c:
        r1 = await c.get(f"{api}/api/admin/llm-budget-alerts")
        r2 = await c.post(f"{api}/api/admin/llm-budget-alerts/test")
    assert r1.status_code == 401
    assert r2.status_code == 401
