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
    # ── Core marketplace flows ──────────────────────────────────────
    "test_marketplace.py",                       # products + custom orders + maker apps + checkout
    "test_admin_seo_shipping.py",                # checkout shape + admin auth + SEO endpoints
    "test_iter383_pre_stripe_shipping.py",       # pre-Stripe shipping collection (iter383)
    "test_iter385_delivery_eta.py",              # cart ETA window calc (iter385)

    # ── Listings: variations, options, uploads, personalization ─────
    "test_iter364_variant_groups_uploads.py",    # variation groups + customer photo uploads
    "test_iter380_cart_quote_http.py",           # cart /quote HTTP shape
    "test_iter380_variation_inventory_split.py", # tracked vs customization-only groups
    "test_iter381_option_stats.py",              # /api/maker/products/option-stats
    "test_personalization.py",                   # personalization persists end-to-end
    "test_listing_image_upload.py",              # R2 image upload happy path

    # ── Digital products + delivery ─────────────────────────────────
    "test_iter327_digital_listings.py",          # digital listing creation flow
    "test_iter328_digital_delivery.py",          # digital download unlock + delivery

    # ── Storage + infrastructure ────────────────────────────────────
    "test_r2_storage.py",                        # R2 storage helper sanity
    "test_iter93_prod_health_watchdog.py",       # prod-health watchdog endpoint
    "test_iter224_deploy_health_pill_contract.py", # deploy-health pill contract

    # ── SEO infrastructure (sitemap, canonical, prerender, landing) ─
    "test_iter94_sitemap_test_slug_filter.py",   # test-slug stripping from sitemap
    "test_iter109_canonical_host.py",            # canonical host enforcement
    "test_iter120_seo_prerender_and_dormant.py", # SEO prerender + dormant
    "test_iter318_seo_prerender_and_trust.py",   # SEO prerender + trust signals
    "test_iter321_seo_trust_audit.py",           # trust audit (validates landing slugs in sitemap)
    "test_seo_phase1_iter298.py",                # SEO phase 1 baseline
    "test_seo_phase3_iter300.py",                # SEO phase 3
    "test_seo_phase4_iter301.py",                # SEO phase 4 (guides hub)
    "test_seo_phase4c_iter303.py",               # SEO phase 4c (lead magnet)
    "test_iter373_seo_health.py",                # SEO health endpoint
    "test_seo_landing_analytics.py",             # landing page analytics
    "test_startup_seo.py",                       # startup-time SEO baseline

    # ── Merchant feed / GPC / category quality ──────────────────────
    "test_iter315c_gpc_auto_map.py",             # GPC auto-map suggestions
    "test_iter330_jewelry_wearables_category.py", # jewelry & wearables category
    "test_iter365_merchant_feed.py",             # merchant feed sanitization
    "test_iter366_merchant_attributes.py",       # merchant attribute normalization

    # ── Auth boundaries + anti-abuse ────────────────────────────────
    "test_iter324_maker_apply_antispam.py",      # maker application antispam
    "test_iter325_founders_hardening.py",        # founder slot hardening

    # ── iter412 AI SEO Growth Agent ─────────────────────────────────
    "test_iter412_seo_agent.py",                 # admin auth + scan + queue lifecycle

    # ── iter413k regression — Plus-required 403 contract ────────────
    # Pins the structured-error response shape for
    # GET /api/maker/analytics/plus so the frontend's upsell gate never
    # silently breaks (prod bug 2026-02-13).
    "test_iter413k_plus_required_contract.py",

    # ── iter413p regression — Canonical-URL contract for /shop ──────
    # Pins the GSC "Duplicate, Google chose different canonical" fix
    # via 3 invariants:  (1) ShopPage canonical = bare /shop,
    # (2) ShopPage emits noindex on filter variants, (3) sitemap never
    # lists query-string URLs. Source-grep style so it runs without
    # Playwright in the backend env.
    "test_iter413p_canonical_contract.py",

    # ── Contrast lint contract (semantic theme tokens) ──────────────
    "test_contrast_lint.py",
}


def pytest_collection_modifyitems(config, items):
    """Auto-apply @pytest.mark.smoke to every test collected from a
    file listed in SMOKE_FILES. Keeps the smoke set declarative."""
    smoke = pytest.mark.smoke
    for item in items:
        # `item.fspath` is the test file path; we match by basename.
        if item.fspath.basename in SMOKE_FILES:
            item.add_marker(smoke)
