"""Crafters Market FastAPI app — wire-up only.
Routers live under /app/backend/routers/.
"""
import os
from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core import client, db, logger
from routers.admin import router as admin_router
from routers.ai import router as ai_router
from routers.ai_marketing import router as ai_marketing_router
from routers.auth_password import router as auth_password_router
from routers.catalog import router as catalog_router
from routers.csv_import import router as csv_import_router
from routers.discount_codes import router as discount_codes_router
from routers.checkout import router as checkout_router
from routers.community import router as community_router
from routers.community_chat import router as community_chat_router
from routers.credits import router as credits_router
from routers.maker import router as maker_router
from routers.messages import router as messages_router
from routers.retention import router as retention_router
from routers.reddit_feeds import router as reddit_feeds_router
from routers.seo import router as seo_router
from routers.state_pages import router as state_pages_router
from routers.lead_magnet import router as lead_magnet_router
from routers.admin_lead_magnet import router as admin_lead_magnet_router
from routers.admin_feeds_health import router as admin_feeds_health_router
from routers.admin_distribution_status import router as admin_distribution_router
from routers.og_static_prerender import router as og_static_prerender_router
from routers.og_showcase_prerender import router as og_showcase_prerender_router
from routers.listing_budgets import router as listing_budgets_router
from routers.promote import router as promote_router
from routers.admin_ads_health import router as admin_ads_health_router
from routers.promote_themes import router as promote_themes_router
from routers.site_promos import router as site_promos_router
from routers.ai_ad_creative import router as ai_ad_creative_router
from routers.ai_ad_push import router as ai_ad_push_router
from routers.pinterest_catalog import router as pinterest_catalog_router
from routers.leaderboard import router as leaderboard_router
from routers.help_chat import router as help_chat_router
from routers.settings import router as settings_router
from routers.shipping import router as shipping_router
from routers.admin_shipping import router as admin_shipping_router
from routers.admin_backup import router as admin_backup_router
from routers.gsc_admin import router as gsc_admin_router
from routers.admin_secrets import router as admin_secrets_router
from routers.follows import router as follows_router
from routers.ad_spend import router as ad_spend_router
from routers.newsletter import router as newsletter_router
from routers.chat_mod import router as chat_mod_router
from routers.stripe_connect import router as stripe_connect_router
from routers.subscriptions import router as subscriptions_router
from routers.custom_url import router as custom_url_router
from routers.referrals import router as referrals_router
from routers.site_velocity import router as site_velocity_router
from routers.analytics import router as analytics_router
from routers.workshop_analytics import router as workshop_analytics_router
from routers.backorder import router as backorder_router
from routers.founders import router as founders_router
from routers.founder_funnel import router as founder_funnel_router  # iter413ba
from routers.attribution import router as attribution_router  # iter413bb
from routers.orphan_pages import router as orphan_pages_router  # iter413bc
from routers.freshness import router as freshness_router  # iter413bd
from routers.nurture_queue import router as nurture_queue_router  # iter413be
from routers.meta_capi import router as meta_capi_router  # iter413bl
from routers.ops_dashboard import router as ops_dashboard_router  # iter413bp
from routers.brand_kit import router as brand_kit_router  # iter413bw
from routers.not_found_log import router as not_found_log_router  # iter413bz
from routers.restock_waitlist import router as restock_waitlist_router
from routers.contact_messages import router as contact_messages_router
from routers.review_disputes import router as review_disputes_router
from routers.maker_review_imports import router as maker_review_imports_router
from routers.maker_workshop_videos import router as maker_workshop_videos_router
from routers.prod_health import router as prod_health_router
from routers.updates import router as updates_router
from routers.coming_soon import router as coming_soon_router
from routers.growth_stats import router as growth_stats_router
from routers.og_prerender import router as og_prerender_router
from routers.push import router as push_router
from routers.abandoned_cart import router as abandoned_cart_router
from routers.feeds import router as feeds_router
from routers.story_card import router as story_card_router
from routers.google_ads import router as google_ads_router
from routers.microsoft_ads import router as microsoft_ads_router
from routers.meta_ads import router as meta_ads_router
from routers.journal_digest import router as journal_digest_router
from routers.share_counter import router as share_counter_router
from routers.personalization import router as personalization_router
from routers.customer_uploads import router as customer_uploads_router
from routers.merchant_rules import router as merchant_rules_router
from routers.shop_health import router as shop_health_router
from routers.seo_health import router as seo_health_router
from routers.seo_agent import router as seo_agent_router  # iter412
from routers.ci_badge import router as ci_badge_router  # iter413at
from seed_data import seed_if_empty

app = FastAPI(title="Crafters Market API")
api = APIRouter(prefix="/api")

# Mount each domain router under /api
api.include_router(catalog_router)
api.include_router(seo_router)
api.include_router(ci_badge_router)  # iter413at — live CI pass-rate badge
api.include_router(state_pages_router)
api.include_router(lead_magnet_router)
api.include_router(admin_lead_magnet_router)
api.include_router(admin_feeds_health_router)
api.include_router(admin_distribution_router)
api.include_router(og_static_prerender_router)
api.include_router(og_showcase_prerender_router)
api.include_router(checkout_router)
api.include_router(maker_router)
api.include_router(stripe_connect_router)
api.include_router(subscriptions_router)
api.include_router(custom_url_router)
api.include_router(referrals_router)
api.include_router(site_velocity_router)
api.include_router(credits_router)
api.include_router(analytics_router)
api.include_router(admin_router)
api.include_router(gsc_admin_router)
api.include_router(ai_router)
api.include_router(help_chat_router)
api.include_router(listing_budgets_router)
api.include_router(promote_router)
api.include_router(admin_ads_health_router)
api.include_router(promote_themes_router)
api.include_router(site_promos_router)
api.include_router(ai_ad_creative_router)
api.include_router(ai_ad_push_router)
api.include_router(pinterest_catalog_router)
api.include_router(leaderboard_router)
api.include_router(community_router)
api.include_router(community_chat_router)
api.include_router(settings_router)
api.include_router(follows_router)
api.include_router(ad_spend_router)
api.include_router(newsletter_router)
api.include_router(chat_mod_router)
api.include_router(auth_password_router)
api.include_router(ai_marketing_router)
api.include_router(discount_codes_router)
api.include_router(csv_import_router)
api.include_router(messages_router)
api.include_router(retention_router)
api.include_router(reddit_feeds_router)
api.include_router(shipping_router)
api.include_router(admin_shipping_router)
api.include_router(workshop_analytics_router)
api.include_router(backorder_router)
api.include_router(founders_router)
api.include_router(founder_funnel_router)  # iter413ba — admin founder funnel dashboard
api.include_router(attribution_router)  # iter413bb — lead → apply attribution
api.include_router(orphan_pages_router)  # iter413bc — orphan pages detector
api.include_router(freshness_router)  # iter413bd — freshness engine
api.include_router(nurture_queue_router)  # iter413be — nurture queue (drafts only)
api.include_router(meta_capi_router)  # iter413bl — Meta Conversions API (server-side)
api.include_router(ops_dashboard_router)  # iter413bp — admin operations dashboard aggregator
api.include_router(brand_kit_router)  # iter413bw — maker brand kit (Garage Builders identity)
api.include_router(not_found_log_router)  # iter413bz — 404 referrer beacon + admin surface
api.include_router(restock_waitlist_router)
api.include_router(contact_messages_router)
api.include_router(review_disputes_router)
api.include_router(maker_review_imports_router)
api.include_router(maker_workshop_videos_router)
api.include_router(prod_health_router)
api.include_router(updates_router)
api.include_router(coming_soon_router)
api.include_router(growth_stats_router)
api.include_router(og_prerender_router)
api.include_router(admin_backup_router)
api.include_router(admin_secrets_router)
from routers.seed_admin import router as seed_admin_router
api.include_router(seed_admin_router)
from routers.ai_discovery import router as ai_discovery_router
api.include_router(ai_discovery_router)
from routers.clips import router as clips_router
api.include_router(clips_router)
api.include_router(push_router)
api.include_router(abandoned_cart_router)
api.include_router(feeds_router)
api.include_router(story_card_router)
api.include_router(google_ads_router)
api.include_router(microsoft_ads_router)
api.include_router(meta_ads_router)
api.include_router(journal_digest_router)
api.include_router(share_counter_router)
api.include_router(personalization_router)
api.include_router(customer_uploads_router)
api.include_router(merchant_rules_router)
api.include_router(shop_health_router)
api.include_router(seo_health_router)
api.include_router(seo_agent_router)  # iter412 — AI SEO Growth Agent
from routers.hero_headlines_api import router as hero_headlines_router
api.include_router(hero_headlines_router)
# iter226 — Integration diagnostics (Shippo/Mailgun/R2) + GA4 live analytics
from routers.integration_diag import router as integration_diag_router
api.include_router(integration_diag_router)
from routers.ga4_analytics import router as ga4_analytics_router
api.include_router(ga4_analytics_router)
from routers.ga4_oauth import router as ga4_oauth_router
api.include_router(ga4_oauth_router)
from routers.onboarding import router as onboarding_router
api.include_router(onboarding_router)
# iter231 — Admin showcase curation (pin / hide / reorder / shuffle)
from routers.showcase_admin import router as showcase_admin_router
api.include_router(showcase_admin_router)
# iter232 — Grow With Us page (public traction counters)
from routers.grow_page import router as grow_page_router
from routers.maker_studio import router as maker_studio_router
api.include_router(grow_page_router)
api.include_router(maker_studio_router)
# iter258 — EnrichLabs read-only marketing data API (API-key auth).
from routers.enrichlabs import router as enrichlabs_router, admin_router as enrichlabs_admin_router
api.include_router(enrichlabs_router)
api.include_router(enrichlabs_admin_router)
# iter290 — Public Pinterest catalog feed (unauthenticated; Pinterest crawler doesn't send custom headers)
from routers.pinterest_feed import router as pinterest_feed_router
api.include_router(pinterest_feed_router)
# iter291 — Google Merchant XML + Meta (FB/IG Shop) CSV feeds
from routers.shop_feeds import router as shop_feeds_router
api.include_router(shop_feeds_router)
from routers.social_auto_post import router as social_auto_post_router, admin_router as social_auto_post_admin_router
api.include_router(social_auto_post_router)
api.include_router(social_auto_post_admin_router)
# iter265 — Telnyx SMS (webhook + admin send/test).
from routers.sms import router as sms_router
api.include_router(sms_router)
# iter334 — Live Shippo rates for the listing editor preset picker.
from routers.maker_shipping_presets import router as maker_shipping_presets_router
api.include_router(maker_shipping_presets_router)
# iter334 — AI Price Comparison companion (Jina Reader + Claude).
from routers.ai_price_compare import router as ai_price_compare_router
api.include_router(ai_price_compare_router)
# iter334c — Weekly AI pricing digest (cron + admin manual trigger).
from routers.pricing_digest import router as pricing_digest_router
api.include_router(pricing_digest_router)
# iter334l — Microsoft Ads ROAS tile + spend recorder (admin only).
from routers.admin_msft_roas import router as admin_msft_roas_router
api.include_router(admin_msft_roas_router)
# iter334u — Google Ads ROAS tile (live spend from synced ad_spend rows).
from routers.admin_google_roas import router as admin_google_roas_router
api.include_router(admin_google_roas_router)
# iter334x — Meta Ads ROAS tile (live spend from synced ad_spend rows).
from routers.admin_meta_roas import router as admin_meta_roas_router
api.include_router(admin_meta_roas_router)
# iter334y — Weekly ROAS digest email (Monday morning cron + admin tools).
from routers.roas_digest import router as roas_digest_router
api.include_router(roas_digest_router)
# iter334v — Combined "All Ads ROAS" header card (Microsoft + Google).
from routers.admin_all_roas import router as admin_all_roas_router
api.include_router(admin_all_roas_router)
# iter334s — A/B test: pricing-label headline framing.
from routers.ab_pricing_label import router as ab_pricing_label_router
api.include_router(ab_pricing_label_router)
app.include_router(api)

# iter109 — Canonical-host 301 redirect middleware. When `CANONICAL_HOST`
# env var is set (e.g. `craftersmarket.org`), every request arriving on a
# non-canonical public hostname (most commonly `www.craftersmarket.org`,
# but also any legacy alias you'd point a CNAME at) is 301-redirected to
# the canonical equivalent with path + query-string preserved. No-op
# when `CANONICAL_HOST` is unset — safe default for preview deploys.
# Added BEFORE CORS so the redirect happens as early as possible and
# we never leak cross-host cookies / preflight state.
from canonical_host import CanonicalHostRedirectMiddleware
app.add_middleware(CanonicalHostRedirectMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


# iter334q — Auto-invalidate the /api/products TTL cache after any
# successful product mutation. Catches publish/unpublish/edit/delete/
# restore/promote/renew/duplicate/bulk-edit in one place rather than
# instrumenting ~17 individual handler sites. Triggers on:
#   • POST/PATCH/PUT/DELETE under /api/maker/products or /api/maker/listings
#   • Same methods under /api/admin/products
# Failed responses (>=400) don't clear — keeps the cache warm during
# validation errors. Internal cron paths (background loops) call
# `db.products.update_one` directly and are NOT routed through here, so
# they keep relying on natural TTL — fine, those mutations are not
# user-visible-immediately.
@app.middleware("http")
async def auto_invalidate_products_cache(request, call_next):
    response = await call_next(request)
    try:
        path = request.url.path
        if (
            request.method in ("POST", "PATCH", "PUT", "DELETE")
            and response.status_code < 400
            and (
                path.startswith("/api/maker/products")
                or path.startswith("/api/maker/listings")
                or path.startswith("/api/admin/products")
            )
        ):
            from routers.catalog import clear_list_products_cache
            clear_list_products_cache()
    except Exception:
        pass  # cache invalidation is best-effort
    return response


@app.on_event("startup")
async def on_startup():
    await seed_if_empty()
    # iter220 — Idempotent seed of hero headline pool baseline. Cheap
    # (8 find-then-insert ops) and ensures /api/hero/headlines never
    # returns an empty list, even on a fresh deploy before the daily
    # cron has fired.
    try:
        from hero_headlines import ensure_seed_pool
        await ensure_seed_pool()
    except Exception:
        logger.exception("[hero_headlines] seed bootstrap failed (non-fatal)")
    # iter221 — Backfill `file_verified` for pre-existing seeded design
    # rows so the new orphan guard doesn't hide working cards on
    # production. Reads disk only; never inserts. Idempotent.
    try:
        from design_file_seeder import backfill_file_verified
        await backfill_file_verified()
    except Exception:
        logger.exception("[design_seeder] file_verified backfill failed (non-fatal)")
    from scheduler import start_scheduler
    start_scheduler()
    # Register the Shippo tracking webhook idempotently. PUBLIC_BACKEND_URL
    # is the only thing we trust for a stable callback origin — skip if
    # unset so dev stacks don't pollute the Shippo account with preview URLs.
    try:
        import shippo_service
        public_backend = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
        if public_backend and shippo_service.is_configured():
            res = shippo_service.ensure_tracking_webhook(f"{public_backend}/api/shippo/webhook")
            logger.info("[shippo] webhook registration: %s", res)
    except Exception:
        logger.exception("[shippo] webhook bootstrap failed (non-fatal)")
    # Idempotent backfill of the "Crafters Market Workshop Team" author on
    # every seeded (`is_seed: true`) community doc. Re-runs on every boot —
    # cheap (3 update_many's that match nothing once attribution exists)
    # and ensures fresh production deploys never ship un-attributed seed
    # posts. Scoped strictly to is_seed:true rows so organic content from
    # real members is never touched.
    try:
        WS = "Crafters Market Workshop Team"
        WSE = "workshop@craftersmarket.org"
        for coll in (db.forum_threads, db.forum_replies, db.showcase_posts):
            await coll.update_many(
                {"is_seed": True, "$or": [{"user_name": {"$ne": WS}}, {"user_name": {"$exists": False}}]},
                {"$set": {"user_name": WS, "user_email": WSE}},
            )
    except Exception:
        logger.exception("[seed] workshop-team attribution bootstrap failed (non-fatal)")
    # iter233 — Idempotent seed of 2 Crafters Market Workshop Team
    # replies on every forum thread with zero replies so a fresh deploy
    # never looks like a dead forum. Safe to re-run; only touches
    # reply-empty threads.
    try:
        from forum_team_replies_bootstrap import bootstrap_team_replies
        await bootstrap_team_replies()
    except Exception:
        logger.exception("[forum_team_replies] bootstrap failed (non-fatal)")
    # iter274 — On-deploy sitemap submission. Re-submits to GSC + pings
    # IndexNow on every backend boot, gated by a 6h restart-storm guard
    # so supervisor reloads/hot-reload don't hammer the crawlers. Best-
    # effort; never blocks startup. Kill-switch: SCHEDULER_STARTUP_SEO=false.
    try:
        from startup_seo import run_startup_seo_submit
        import asyncio as _asyncio
        _asyncio.create_task(run_startup_seo_submit())
    except Exception:
        logger.exception("[startup_seo] kickoff failed (non-fatal)")
    # iter289 — Initialize the stripe_webhook_log TTL + lookup indexes.
    try:
        from stripe_webhook_log import ensure_indexes as _ensure_swh
        await _ensure_swh()
    except Exception:
        logger.exception("[stripe_webhook_log] index init failed (non-fatal)")
    # iter292 — Initialize the feed_access_log TTL + lookup indexes.
    try:
        from feed_access_log import ensure_indexes as _ensure_fal
        await _ensure_fal()
    except Exception:
        logger.exception("[feed_access_log] index init failed (non-fatal)")
    # iter293 — Bootstrap a Pinterest feed password if none exists yet.
    # Idempotent: subsequent boots are a no-op once a credential is set.
    try:
        from feed_auth import ensure_default as _ensure_feed_auth
        await _ensure_feed_auth("pinterest")
    except Exception:
        logger.exception("[feed_auth] bootstrap failed (non-fatal)")
    logger.info("Crafters Market API ready (seed checked).")


@app.on_event("shutdown")
async def shutdown_db():
    from scheduler import shutdown_scheduler
    shutdown_scheduler()
    client.close()
