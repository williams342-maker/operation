"""Crafters Market FastAPI app — wire-up only.
Routers live under /app/backend/routers/.
"""
import os
from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core import client, logger
from routers.admin import router as admin_router
from routers.ai import router as ai_router
from routers.catalog import router as catalog_router
from routers.checkout import router as checkout_router
from routers.community import router as community_router
from routers.credits import router as credits_router
from routers.maker import router as maker_router
from routers.seo import router as seo_router
from routers.settings import router as settings_router
from routers.stripe_connect import router as stripe_connect_router
from routers.subscriptions import router as subscriptions_router
from routers.analytics import router as analytics_router
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
api.include_router(settings_router)
app.include_router(api)

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
    logger.info("Crafters Market API ready (seed checked).")


@app.on_event("shutdown")
async def shutdown_db():
    from scheduler import shutdown_scheduler
    shutdown_scheduler()
    client.close()
