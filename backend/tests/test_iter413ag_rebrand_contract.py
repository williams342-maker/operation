"""iter413ag — Rebrand asset wiring contract.

Locks down the rebranded CM-anvil monogram + new tagline ("Built on
craft. Driven by makers.") so a future refactor cannot silently revert
the brand. The visual asset files themselves are PNGs, so we don't
binary-compare them — we just assert they exist, are the right size,
and are referenced from the places they need to be referenced from.

Invariants pinned:
  • All required icon files exist under /app/frontend/public/icons/
    (favicon-16/32, icon-192/512, maskable variants, apple-touch).
  • favicon.ico exists at public/.
  • og-image.png (1200x630) exists at public/.
  • Nav.jsx + Footer.jsx reference logo-monogram-transparent.png
    (no longer render the literal "CM" text box).
  • Boot loader in index.html uses an <img> for the monogram
    (asserted by iter413ae test — duplicated here for clarity).
  • Footer carries the new brand tagline "Built on craft" / "Driven by makers".
  • og:image meta in index.html points to /og-image.png (the new
    horizontal lockup), not the legacy cnc-garage-builders.png.
"""
import os
import re
from pathlib import Path


PUBLIC = Path("/app/frontend/public")
SRC = Path("/app/frontend/src")


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_all_icon_files_exist_and_nonempty():
    required = [
        "icons/favicon-16.png",
        "icons/favicon-32.png",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/icon-maskable-192.png",
        "icons/icon-maskable-512.png",
        "icons/apple-touch-icon.png",
        "icons/logo-monogram.png",
        "icons/logo-monogram-transparent.png",
        "icons/logo-monogram-dark.png",
        "favicon.ico",
        "og-image.png",
    ]
    for rel in required:
        p = PUBLIC / rel
        assert p.exists(), f"missing rebrand asset: {p}"
        assert p.stat().st_size > 200, f"asset too small to be valid: {p}"


def test_favicon_dimensions_match_declared_sizes():
    """Each favicon PNG must match its declared dimensions in
    index.html / manifest. Mismatched sizes degrade browser rendering."""
    from PIL import Image
    expected = {
        "icons/favicon-16.png": (16, 16),
        "icons/favicon-32.png": (32, 32),
        "icons/icon-192.png": (192, 192),
        "icons/icon-512.png": (512, 512),
        "icons/icon-maskable-192.png": (192, 192),
        "icons/icon-maskable-512.png": (512, 512),
        "icons/apple-touch-icon.png": (180, 180),
        "og-image.png": (1200, 630),
    }
    for rel, want in expected.items():
        with Image.open(PUBLIC / rel) as im:
            assert im.size == want, f"{rel} has size {im.size}, expected {want}"


def test_nav_uses_monogram_image_not_text_cm():
    """Nav.jsx must reference the rebranded monogram <img>, not the
    legacy <span>CM</span> placeholder text."""
    nav = _read(SRC / "components/sections/Nav.jsx")
    assert "logo-monogram-transparent.png" in nav, (
        "Nav.jsx is not using the rebranded monogram image"
    )
    # Old placeholder must be gone
    assert 'font-display text-brand text-xl">CM<' not in nav, (
        "Legacy 'CM' text placeholder still present in Nav.jsx"
    )


def test_footer_uses_monogram_image_and_carries_tagline():
    footer = _read(SRC / "components/sections/Footer.jsx")
    assert "logo-monogram-transparent.png" in footer, (
        "Footer.jsx is not using the rebranded monogram image"
    )
    # The new brand tagline must live in the footer
    assert "Built on craft" in footer and "Driven by makers" in footer, (
        "Footer.jsx is missing the new brand tagline"
    )
    # And it must have a testid so the testing agent can target it
    assert 'data-testid="footer-brand-tagline"' in footer


def test_og_image_meta_points_to_new_og_image():
    """og:image in index.html must point to /og-image.png (the new
    horizontal lockup), not the legacy cnc-garage-builders.png."""
    html = _read(PUBLIC / "index.html")
    # Modern og:image
    m = re.search(
        r'<meta\s+property="og:image"\s+content="([^"]+)"',
        html,
    )
    assert m, "og:image meta tag missing"
    assert m.group(1).endswith("/og-image.png"), (
        f"og:image is still pointing at the legacy asset: {m.group(1)}"
    )
    # Width/height must match the new 1200x630
    assert '<meta property="og:image:width" content="1200"' in html
    assert '<meta property="og:image:height" content="630"' in html


def test_manifest_icon_paths_unchanged():
    """Manifest still references the same /icons/icon-*.png paths so
    iOS/Android pick up the new artwork without needing a manifest
    update."""
    import json
    manifest = json.loads(_read(PUBLIC / "manifest.webmanifest"))
    icon_srcs = {i["src"] for i in manifest["icons"]}
    expected = {
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/icon-maskable-192.png",
        "/icons/icon-maskable-512.png",
    }
    assert expected.issubset(icon_srcs), (
        f"manifest missing expected icon paths: {expected - icon_srcs}"
    )
