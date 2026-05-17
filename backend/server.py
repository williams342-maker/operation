"""Crafters Market FastAPI app — wire-up only.
Routers live under /app/backend/routers/.
"""
import os
from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core import client, logger
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
from routers.admin_secrets import router as admin_secrets_router
from routers.follows import router as follows_router
from routers.ad_spend import router as ad_spend_router
from routers.buffer import router as buffer_router
from routers.newsletter import router as newsletter_router
from routers.chat_mod import router as chat_mod_router
from routers.stripe_connect import router as stripe_connect_router
from routers.subscriptions import router as subscriptions_router
from routers.analytics import router as analytics_router
from routers.workshop_analytics import router as workshop_analytics_router
from routers.backorder import router as backorder_router
from routers.restock_waitlist import router as restock_waitlist_router
from routers.contact_messages import router as contact_messages_router
from routers.review_disputes import router as review_disputes_router
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
api.include_router(credits_router)
api.include_router(analytics_router)
api.include_router(admin_router)
api.include_router(ai_router)
api.include_router(community_router)
api.include_router(community_chat_router)
api.include_router(settings_router)
api.include_router(follows_router)
api.include_router(ad_spend_router)
api.include_router(buffer_router)
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
api.include_router(restock_waitlist_router)
api.include_router(contact_messages_router)
api.include_router(review_disputes_router)
api.include_router(prod_health_router)
api.include_router(updates_router)
api.include_router(coming_soon_router)
api.include_router(growth_stats_router)
api.include_router(og_prerender_router)
api.include_router(admin_backup_router)
api.include_router(admin_secrets_router)
api.include_router(push_router)
api.include_router(abandoned_cart_router)
api.include_router(feeds_router)
api.include_router(story_card_router)
api.include_router(google_ads_router)
api.include_router(meta_ads_router)
api.include_router(journal_digest_router)
api.include_router(share_counter_router)
api.include_router(personalization_router)
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
    logger.info("Crafters Market API ready (seed checked).")


@app.on_event("shutdown")
async def shutdown_db():
    from scheduler import shutdown_scheduler
    shutdown_scheduler()
    client.close()
