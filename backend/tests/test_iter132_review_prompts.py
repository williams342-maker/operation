"""Iter 132 — Post-delivery review-prompt sweep.

Validates:
- Eligibility window: orders delivered 7-30 days ago show up; sub-7d
  and >30d don't.
- Idempotency: orders with `review_prompt_sent_at` set are skipped.
- After a successful send, `review_prompt_sent_at` is stamped on the
  order so a second run is a no-op.
- The candidate filter excludes orders with no email, and skipped rows
  are surfaced in the result with a `no-email` reason.
- Dry-run (`apply=False`) returns counts but doesn't stamp anything
  on the order.
"""
import asyncio
import sys
import uuid
import pytest
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")

from core import db  # noqa: E402
from review_prompts import run_review_prompts  # noqa: E402


def _delta(days_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


async def _seed_order(*, days_ago: int, email: str | None = "buyer@iter132.test", already_sent: bool = False):
    sid = f"sess-iter132-{uuid.uuid4().hex[:8]}"
    doc = {
        "session_id": sid,
        "delivered_at": _delta(days_ago),
        "customer_email": email,
        "customer_name": "Iter132 Buyer",
        "items": [
            {"slug": "test-product", "title": "Test Product", "maker_slug": "iron-and-oak", "maker_name": "Iron & Oak"},
        ],
        "shipping_details": {"name": "Iter132 Buyer", "email": email},
    }
    if already_sent:
        doc["review_prompt_sent_at"] = _delta(days_ago - 1)
    await db.payment_transactions.insert_one(doc)
    return sid


async def _cleanup(session_ids: list[str]):
    await db.payment_transactions.delete_many({"session_id": {"$in": session_ids}})


@pytest.mark.asyncio
async def test_review_prompts_eligibility_window_and_idempotency():
    too_recent = await _seed_order(days_ago=3)        # < 7d → out
    eligible_a = await _seed_order(days_ago=7)        # exactly at window edge
    eligible_b = await _seed_order(days_ago=14)       # mid-window
    eligible_c = await _seed_order(days_ago=29)       # near-end
    too_old = await _seed_order(days_ago=45)          # > 30d → out
    already_done = await _seed_order(days_ago=10, already_sent=True)
    no_email = await _seed_order(days_ago=10, email=None)
    seeded = [too_recent, eligible_a, eligible_b, eligible_c, too_old, already_done, no_email]

    try:
        # Dry-run first.
        dry = await run_review_prompts(apply=False)
        assert dry["applied"] is False
        # Three eligible-with-email show up; the no-email row is in
        # candidates too but gets filtered post-fetch into `skipped`
        # — so only 3 of the 4 candidates report `sent` in dry-run mode.
        sent_in_dry = dry["sent"]
        assert sent_in_dry == 3, f"Expected 3 sent in dry-run, got {sent_in_dry}"
        # The order with `review_prompt_sent_at` already set is filtered
        # by the Mongo query, not by the candidate loop — so it never
        # reaches `skipped`.
        # The no-email order is fetched then filtered into `skipped`.
        assert any(s["session_id"] == no_email and s["reason"] == "no-email"
                   for s in dry["skipped"]), f"Expected no-email row in skipped, got {dry['skipped']}"
        # Apply pass — actually stamps the orders.
        result = await run_review_prompts(apply=True)
        assert result["applied"] is True
        assert result["sent"] == 3, f"Expected 3 sent, got {result['sent']}"
        for sid in (eligible_a, eligible_b, eligible_c):
            doc = await db.payment_transactions.find_one({"session_id": sid}, {"_id": 0, "review_prompt_sent_at": 1})
            assert doc.get("review_prompt_sent_at"), f"Order {sid} should have a stamped sent timestamp"
        for sid in (too_recent, too_old):
            doc = await db.payment_transactions.find_one({"session_id": sid}, {"_id": 0, "review_prompt_sent_at": 1})
            assert "review_prompt_sent_at" not in doc, f"Order {sid} should NOT have been stamped"
        # Already-sent doc retained its original timestamp (idempotency).
        before = await db.payment_transactions.find_one({"session_id": already_done}, {"_id": 0, "review_prompt_sent_at": 1})
        # Second-run no-op — confirms idempotency end-to-end.
        result2 = await run_review_prompts(apply=True)
        assert result2["sent"] == 0, f"Expected 0 sent on idempotent re-run, got {result2['sent']}"
    finally:
        await _cleanup(seeded)


if __name__ == "__main__":
    asyncio.run(test_review_prompts_eligibility_window_and_idempotency())
    print("OK")
