"""Iter73 — `?tab=orders` deep-link plumbing.

The maker "new order" email now renders a CTA that deep-links to the
Orders tab in the maker dashboard. We use `?tab=orders` (query param)
rather than `#orders` (hash fragment) because email link-rewriters
(Postmark, SendGrid, Mailgun) strip URL fragments before sending, so a
`#...` would arrive stripped and land the maker on the default tab.
"""
from __future__ import annotations
from unittest.mock import patch

import pytest


@pytest.mark.asyncio
async def test_maker_new_order_email_deeplinks_to_orders_tab_via_query_param():
    from email_service import send_maker_new_order
    captured = {}

    async def fake_send(to, subj, html):
        captured["html"] = html
        return {"id": "ok"}

    items = [{"title": "Mountain Sign", "price": 149.0, "quantity": 1}]
    with patch("email_service._send", fake_send):
        await send_maker_new_order(
            maker_email="maker@example.com",
            maker_name="Iron & Oak",
            items=items,
            subtotal=149.0,
            buyer_email="buyer@example.com",
        )
    # Deep-link uses `?tab=orders` (query param), NOT `#orders` (fragment)
    assert "/maker/dashboard?tab=orders" in captured["html"]
    assert "/maker/dashboard#orders" not in captured["html"]
    # CTA button text is scanned as a single chunk so we know the link
    # is rendered as an actionable button
    assert "Open orders tab" in captured["html"]
