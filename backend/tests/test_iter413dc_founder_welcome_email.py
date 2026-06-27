"""iter413dc — Tier-aware welcome email contract.

Verifies the application-decision welcome packet renders DIFFERENTLY for:
  • Inaugural Founder approvals (subject + title + intro + banner all
    surface "Inaugural Founder #NNN of 100")
  • Regular Founder approvals (subject + title + intro surface
    "Founder #NNN" without the "of 100" cap framing)
  • Standard approvals (legacy "Welcome to the Workshop." copy intact)
  • Declines (unchanged — Founder fields ignored on the reject path)

The Inaugural badge MUST carry the explicit "of 100" suffix so the
recipient understands the scarcity. The supporting checklist + fee
breakdown sections are unchanged across all paths — those are NOT
re-asserted here (iter413ah covers them).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from email_service import render_application_decision_email


def test_inaugural_founder_top_of_fold():
    r = render_application_decision_email(
        name="Loretta", studio="Loretta's Fibers", approved=True,
        founder_number=15, is_inaugural=True,
    )
    # Subject — inbox preview must signal Inaugural identity + cap.
    assert r["subject"] == "Welcome to Crafters Market — You are Inaugural Founder #015 of 100."
    # Title in shell
    assert "You're Inaugural Founder #015." in r["html"]
    # Intro — legacy framing + scarcity copy.
    assert "claimed one of the 100 inaugural Founder slots" in r["html"]
    assert "Lifetime tier" in r["html"]
    # Banner — Inaugural Founder badge + "of 100" suffix.
    assert "Inaugural Founder #015 · of 100" in r["html"]
    # Perks block still present.
    assert "3% platform commission" in r["html"]
    assert "50 free listings every month" in r["html"]


def test_regular_founder_top_of_fold():
    r = render_application_decision_email(
        name="Mason", studio="Mason's Metalworks", approved=True,
        founder_number=142, is_inaugural=False,
    )
    # Subject — Founder number, no "of 100" framing (cap is full path).
    assert r["subject"] == "Welcome to Crafters Market — You are Founder #142."
    assert "of 100" not in r["subject"]
    # Title in shell
    assert "You're Founder #142." in r["html"]
    # Intro — 12-month framing, no inaugural language.
    assert "12 months" in r["html"]
    assert "100 inaugural" not in r["html"]
    # Banner — 12-month badge, no "of 100" suffix.
    assert "Founder · 12-month #142" in r["html"]
    assert "Founder · 12-month #142 · of 100" not in r["html"]


def test_standard_approval_unchanged():
    """Non-founder approvals must keep the legacy welcome copy intact."""
    r = render_application_decision_email(
        name="Jamie", studio="Jamie's Studio", approved=True,
        founder_number=None, is_inaugural=False,
    )
    # Subject — legacy welcome packet copy.
    assert r["subject"] == "Welcome to Crafters Market, Jamie's Studio — your launch packet"
    # Title
    assert "Welcome to the Workshop." in r["html"]
    # No Founder banner / no scarcity copy.
    assert "Inaugural Founder" not in r["html"]
    assert "of 100" not in r["html"]
    assert "100 inaugural" not in r["html"]


def test_decline_path_ignores_founder_fields():
    """Reject path: Founder fields must be a silent no-op."""
    r = render_application_decision_email(
        name="Alex", studio="Alex Co", approved=False, note="not the right fit",
        # Even if these slip in by accident, they MUST NOT render.
        founder_number=99, is_inaugural=True,
    )
    assert r["subject"] == "Crafters Market application update — Alex Co"
    assert "Application Update." in r["html"]
    assert "Founder" not in r["html"]
    assert "of 100" not in r["html"]
    # Admin's note still surfaces.
    assert "not the right fit" in r["html"]
