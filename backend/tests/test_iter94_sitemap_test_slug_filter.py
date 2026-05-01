"""iter94 — Sitemap strips test/seed slugs.

Regression guard: ensures product/maker/journal slugs that look like
test or seed artifacts never leak into the public sitemap.

The 6 known offenders from the 2026-05 prod sitemap audit:
  - /shop/test-iter21-bg-ba4bba
  - /makers/test-studio
  - /makers/iter9-acct-f301ff35
  - /makers/test-allowedstudio-iter18
  - /makers/api-test-studio
  - /makers/final-test-studio
"""
import re

from routers.seo import _is_test_slug


TEST_SLUGS_TRUE = [
    "test-iter21-bg-ba4bba",
    "test-studio",
    "iter9-acct-f301ff35",
    "test-allowedstudio-iter18",
    "api-test-studio",
    "final-test-studio",
    "TEST_iter68_bad_stl",
    "iter80-check",
    "api_test_studio_2",
    "final_test",
]

TEST_SLUGS_FALSE = [
    # Real product/maker slugs — MUST NOT be stripped
    "mountain-range-silhouette",
    "rustic-family-name-sign",
    "custom-business-sign",
    "industrial-address-numbers",
    "iron-and-oak",
    "metalart-pro",
    "williams-cnc",
    "cut-n-paiste",
    "coastal-chic-studio-inc",
    "peach-and-pine-designs",
    "anatomy-of-a-cut",
    "plasma-vs-laser",
    # Tricky cases — shouldn't false-positive
    "test-driven-signage",     # "test" as a real word, not a slug prefix
    "ultra-modern-piece",
    "iteration-3-finish",      # "iter" inside a word, not a prefix pattern
]


def test_is_test_slug_catches_known_offenders():
    for s in TEST_SLUGS_TRUE:
        assert _is_test_slug(s) is True, f"should be stripped: {s}"


def test_is_test_slug_preserves_real_slugs():
    for s in TEST_SLUGS_FALSE:
        assert _is_test_slug(s) is False, f"should NOT be stripped: {s}"


def test_is_test_slug_handles_empty():
    assert _is_test_slug("") is True
    assert _is_test_slug(None) is True  # type: ignore[arg-type]
