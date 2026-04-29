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
POLICY_VERSION = "2026.08"

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

# ---- Admin capability matrix ----
# Per /app/memory/PRD.md spec — multi-tier admin RBAC.
# 5 togglable capabilities + 1 read-only mode. Super admins (email in
# ADMIN_EMAILS env) implicitly hold ALL capabilities and can never be locked
# out from the UI. Non-super admin rows live in `admin_users` collection.
ADMIN_CAPABILITIES: tuple[str, ...] = (
    "marketplace",  # approve makers, manage listings/categories, suspend makers
    "content",      # homepage, banners, blog/journal, SEO, featured products
    "support",      # tickets, refund initiation, custom-order intervention
    "finance",      # payouts, refund execution, commissions, ad-spend ledger
    "moderation",   # chat/forum/showcase moderation, ban/freeze users
    "read_only",    # view dashboard; blocks every mutation
)
# Capability presets surfaced in the Team tab UI.
ADMIN_CAP_PRESETS: dict[str, list[str]] = {
    "full_operator": ["marketplace", "support", "moderation"],
    "editorial":     ["content"],
    "cfo":           ["finance"],
    "support_only":  ["support"],
    "viewer":        ["read_only"],
}
SUPER_ADMIN_CAPABILITIES: list[str] = list(ADMIN_CAPABILITIES)  # super admins hold every cap


def is_super_admin_email(email: str) -> bool:
    return (email or "").strip().lower() in ADMIN_EMAILS

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
    """Public site origin for canonical URLs in the sitemap.

    Preference order:
      1. `PUBLIC_SITE_URL` env var (explicit operator intent).
      2. `PUBLIC_BACKEND_URL` env var (backend origin — usually the same
         hostname as the site in single-domain deployments).
      3. Forwarded host header — BUT only if it doesn't look like a
         preview / staging domain (e.g. *.emergentagent.com, *.vercel.app).
         We never want to emit preview URLs in an SEO sitemap because
         search engines will index them and create duplicate-content / 301
         penalties when we later flip to prod.
      4. Hard-coded prod hostname (`https://craftersmarket.org`).
    """
    if PUBLIC_SITE_URL:
        return PUBLIC_SITE_URL
    if PUBLIC_BACKEND_URL:
        return PUBLIC_BACKEND_URL
    fwd_host = http_request.headers.get("x-forwarded-host") or ""
    fwd_proto = http_request.headers.get("x-forwarded-proto", "https")
    preview_markers = (
        "emergentagent.com", "vercel.app", "onrender.com",
        "preview.", "staging.", "localhost",
    )
    if fwd_host and not any(m in fwd_host for m in preview_markers):
        return f"{fwd_proto}://{fwd_host}"
    # Safety net: never let search engines discover preview URLs.
    return "https://craftersmarket.org"
