"""iter413ah — Transactional email branding contract.

Locks down the brand monogram + tagline wiring in the master _shell()
helper that wraps EVERY transactional email (order confirmation,
shipping, maker payouts, custom-order receipt, etc.). If the monogram
URL or the tagline string regresses, the whole transactional email
fleet silently loses brand consistency at the doorstep of the
customer's inbox — which is the highest-stakes brand surface we have.

Invariants pinned:
  • _shell() renders an <img> referencing the absolute production URL
    of logo-monogram-transparent.png (transparent PNG composites
    cleanly on the dark email backdrop).
  • The "Built on craft · Driven by makers" tagline appears in the
    rendered output.
  • Image has alt text + explicit width/height so email clients render
    it correctly even when image-loading is initially blocked.
  • Layout uses a table (not flexbox/grid) — Outlook/Yahoo break flex.
"""
import os
import sys

sys.path.insert(0, "/app/backend")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017/_test_iter413ah")
os.environ.setdefault("DB_NAME", "_test_iter413ah")

from email_service import _shell  # noqa: E402


def test_shell_includes_monogram_image_with_absolute_url():
    html = _shell("Test Subject", "Test intro paragraph.", "<p>body</p>")
    # The monogram <img> must be present with an absolute URL (email
    # clients can't follow relative refs back to the origin).
    assert "logo-monogram-transparent.png" in html, (
        "Email shell is missing the brand monogram image"
    )
    assert "https://" in html, "Monogram URL must be absolute (https://)"
    # alt text + explicit dimensions so Outlook + Gmail's image-blocking
    # mode still renders a sensibly-sized placeholder.
    assert 'alt="Crafters Market"' in html
    assert "width=\"48\"" in html and "height=\"36\"" in html


def test_shell_includes_built_on_craft_tagline():
    html = _shell("Test", "Intro", "<p>x</p>")
    # New brand tagline must appear in the email footer area
    assert "Built on craft" in html
    assert "Driven by makers" in html


def test_shell_still_includes_legacy_brand_signals():
    """Existing brand markers should remain in place so we don't
    accidentally remove the existing brand surface during the
    monogram addition."""
    html = _shell("Order received", "Thanks for ordering.", "<p>x</p>")
    assert "Crafters Market" in html
    assert "craftersmarket.org" in html
    assert "Est · 2026" in html  # NEW eyebrow alongside the monogram


def test_shell_uses_table_layout_not_flexbox():
    """Outlook + Yahoo Mail strip flexbox; emails must use <table>
    for layout primitives."""
    html = _shell("X", "y", "z")
    assert "<table" in html
    # Forbidden in email clients
    assert "display:flex" not in html
    assert "display: flex" not in html


def test_shell_respects_frontend_url_env_override():
    """FRONTEND_URL env should override the default craftersmarket.org
    so staging/preview emails use the right monogram source."""
    import importlib
    original = os.environ.get("FRONTEND_URL")
    try:
        os.environ["FRONTEND_URL"] = "https://staging.example.com"
        # _shell reads the env at call time, no module reload needed.
        from email_service import _shell as fresh_shell
        html = fresh_shell("Test", "Intro", "<p>x</p>")
        assert "https://staging.example.com/icons/logo-monogram-transparent.png" in html
    finally:
        if original is None:
            os.environ.pop("FRONTEND_URL", None)
        else:
            os.environ["FRONTEND_URL"] = original
