import pytest

# iter411c — Smoke marker auto-tagging.
# --------------------------------------
# Pre-deploy CI runs `pytest -m smoke` to block ship-readiness on
# regressions in our core ship-blocking flows. Listing files here
# (instead of decorating each one) keeps the curated smoke set in
# ONE place — flip a line, change the gate.
#
# What belongs in here:
#   • Core marketplace flows (products, checkout, custom orders,
#     maker applications)
#   • SEO infrastructure (sitemap, robots, canonical, prerender)
#   • Auth boundaries (admin/maker token gates)
#   • Recently shipped landing-page health checks
#
# What does NOT belong here:
#   • Tests for in-flight or rotted features
#   • Tests that hit external paid APIs (Buffer, Stripe live, etc.)
#   • Long-running e2e suites — those have their own marker
SMOKE_FILES = {
    # Core marketplace flows
    "test_marketplace.py",
    # SEO infrastructure
    "test_admin_seo_shipping.py",
    "test_iter94_sitemap_test_slug_filter.py",
    "test_iter109_canonical_host.py",
    # Contrast lint contract (semantic theme tokens)
    "test_contrast_lint.py",
    # Sitemap / SEO health
    "test_seo_phase3_iter300.py",
    "test_seo_phase4_iter301.py",
    "test_seo_phase4c_iter303.py",
}


def pytest_collection_modifyitems(config, items):
    """Auto-apply @pytest.mark.smoke to every test collected from a
    file listed in SMOKE_FILES. Keeps the smoke set declarative."""
    smoke = pytest.mark.smoke
    for item in items:
        # `item.fspath` is the test file path; we match by basename.
        if item.fspath.basename in SMOKE_FILES:
            item.add_marker(smoke)
