"""Core: env loading, db handle, common helpers, public-host resolution."""
import os
import logging
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from fastapi import Request
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# Policy version stamped on every order acceptance. Bump when policy text
# changes substantially so the audit trail can prove which version a buyer
# agreed to. Frontend reads this from /api/policy/version.
POLICY_VERSION = "2026.05"

# ---- Mongo ----
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# ---- Public hosts ----
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
PUBLIC_BACKEND_URL = (os.environ.get("PUBLIC_BACKEND_URL") or "").rstrip("/")
PUBLIC_SITE_URL = (os.environ.get("PUBLIC_SITE_URL") or "").rstrip("/")

# ---- Admin allow-list (CSV; falls back to OPS_EMAIL for backward compat) ----
def _admin_emails() -> set[str]:
    raw = os.environ.get("ADMIN_EMAILS") or os.environ.get("OPS_EMAIL") or ""
    return {e.strip().lower() for e in raw.split(",") if e.strip()}

ADMIN_EMAILS: set[str] = _admin_emails()

# ---- Logger ----
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("crafters")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def public_host(http_request: Request) -> str:
    """Public origin for webhooks. Prefer PUBLIC_BACKEND_URL; fall back to forwarded host."""
    if PUBLIC_BACKEND_URL:
        return PUBLIC_BACKEND_URL
    fwd_host = http_request.headers.get("x-forwarded-host")
    fwd_proto = http_request.headers.get("x-forwarded-proto", "https")
    if fwd_host:
        return f"{fwd_proto}://{fwd_host}"
    return str(http_request.base_url).rstrip("/")


def site_root(http_request: Request) -> str:
    """Public site origin for canonical URLs in the sitemap."""
    site = PUBLIC_SITE_URL or PUBLIC_BACKEND_URL
    if site:
        return site
    fwd_host = http_request.headers.get("x-forwarded-host")
    fwd_proto = http_request.headers.get("x-forwarded-proto", "https")
    if fwd_host:
        return f"{fwd_proto}://{fwd_host}"
    return str(http_request.base_url).rstrip("/")
