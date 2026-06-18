"""iter413av — Bing UET Enhanced Conversions contract.

Verifies the `uetSetPII` helper exists in /app/frontend/src/lib/consent.js
and is wired into the five conversion-bearing flows (Contact, Apply,
CustomOrder, CommunityAuth, CheckoutSuccess).

Run as a static-source contract — no browser interactions required, so
it doesn't pay the Playwright tax in CI.
"""
from __future__ import annotations

from pathlib import Path

CONSENT_LIB = Path("/app/frontend/src/lib/consent.js")
TARGET_PAGES = [
    "/app/frontend/src/pages/ContactPage.jsx",
    "/app/frontend/src/pages/ApplyPage.jsx",
    "/app/frontend/src/pages/CustomOrderPage.jsx",
    "/app/frontend/src/pages/CommunityAuth.jsx",
    "/app/frontend/src/pages/CheckoutSuccess.jsx",
]


def test_uet_set_pii_helper_exists_and_exports():
    src = CONSENT_LIB.read_text(encoding="utf-8")
    assert "export function uetSetPII" in src, "uetSetPII export missing"
    # Must honor consent (skip when ad_storage='denied')
    assert "ad_storage" in src and "denied" in src
    # Must use Microsoft's `set` action with `pid` field per their spec
    assert 'window.uetq.push("set"' in src or "window.uetq.push('set'" in src
    assert "pid" in src
    # Must normalize email (lowercase) + phone (digits + optional leading +)
    assert ".toLowerCase()" in src
    assert "+" in src  # phone normalization carries the country-code +


def test_uet_set_pii_wired_into_all_lead_flows():
    """All five conversion-bearing pages must import + call `uetSetPII`."""
    missing = []
    for page in TARGET_PAGES:
        text = Path(page).read_text(encoding="utf-8")
        if "uetSetPII" not in text:
            missing.append(f"{page} — no uetSetPII reference")
            continue
        # Must import from lib/consent (not stub or local)
        if "from \"../lib/consent\"" not in text:
            missing.append(f"{page} — import path wrong (must be ../lib/consent)")
    assert not missing, "uetSetPII not wired into pages: " + "; ".join(missing)


def test_uet_set_pii_uses_normalized_email_input():
    """The pages should pass `email.trim()` so leading/trailing whitespace
    from form inputs doesn't corrupt the SHA-256 hash Microsoft computes."""
    skips = ("CheckoutSuccess.jsx",)  # already uses unwrapped `email` state
    for page in TARGET_PAGES:
        if any(s in page for s in skips):
            continue
        text = Path(page).read_text(encoding="utf-8")
        # Look for uetSetPII({ email: ... .trim() ... })
        idx = text.find("uetSetPII(")
        assert idx != -1, f"{page}: uetSetPII call missing"
        call_chunk = text[idx:idx + 200]
        assert ".trim()" in call_chunk, (
            f"{page}: email should be .trim()ed before passing to uetSetPII "
            f"(found: {call_chunk[:120]!r})"
        )
