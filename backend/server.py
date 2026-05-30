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
from routers.meta_ads import router as meta_ads_router
from routers.journal_digest import router as journal_digest_router
from routers.share_counter import router as share_counter_router
from routers.personalization import router as personalization_router
from seed_data import seed_if_empty

app = FastAPI(title="Crafters Market API")
api = APIRouter(prefix="/api")

# Mount each domain router under /api
api.include_router(catalog_router)
api.include_router(seo_router)
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
api.include_router(meta_ads_router)
api.include_router(journal_digest_router)
api.include_router(share_counter_router)
api.include_router(personalization_router)
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
from routers.social_auto_post import router as social_auto_post_router, admin_router as social_auto_post_admin_router
api.include_router(social_auto_post_router)
api.include_router(social_auto_post_admin_router)
# iter265 — Telnyx SMS (webhook + admin send/test).
from routers.sms import router as sms_router
api.include_router(sms_router)
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
    logger.info("Crafters Market API ready (seed checked).")


@app.on_event("shutdown")
async def shutdown_db():
    from scheduler import shutdown_scheduler
    shutdown_scheduler()
    client.close()
