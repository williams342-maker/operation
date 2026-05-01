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


# Preview / staging / localhost host markers. Any URL containing one of
# these tokens is considered non-canonical and MUST NOT appear in the
# sitemap — otherwise Google will index the preview domain and create
# duplicate-content penalties when we later flip to prod.
_PREVIEW_HOST_MARKERS: tuple[str, ...] = (
    "emergentagent.com",
    "emergent.host",
    "vercel.app",
    "onrender.com",
    "preview.",
    "staging.",
    "localhost",
    "127.0.0.1",
)

# Hard-coded canonical prod hostname. Final safety net when every other
# source of truth looks like a preview domain.
_CANONICAL_SITE_ROOT = "https://craftersmarket.org"


def _looks_like_preview(origin: str) -> bool:
    """True if `origin` contains any known preview/staging host marker."""
    if not origin:
        return True
    lower = origin.lower()
    return any(m in lower for m in _PREVIEW_HOST_MARKERS)


def site_root(http_request: Request) -> str:
    """Public site origin for canonical URLs in the sitemap.

    Preference order (first non-preview match wins):
      1. `PUBLIC_SITE_URL` env var (explicit operator intent).
      2. `PUBLIC_BACKEND_URL` env var — only if it is NOT a preview URL.
         (On some deploys this var is pre-populated with the preview URL
         at build time; we must not blindly trust it.)
      3. Forwarded host header — only if it doesn't look like a preview.
      4. Hard-coded prod hostname (`https://craftersmarket.org`).
    """
    # 1. Explicit operator intent always wins, but still validate.
    if PUBLIC_SITE_URL and not _looks_like_preview(PUBLIC_SITE_URL):
        return PUBLIC_SITE_URL
    # 2. Backend URL env var — skip if it smells like preview.
    if PUBLIC_BACKEND_URL and not _looks_like_preview(PUBLIC_BACKEND_URL):
        return PUBLIC_BACKEND_URL
    # 3. Forwarded host header.
    fwd_host = http_request.headers.get("x-forwarded-host") or ""
    fwd_proto = http_request.headers.get("x-forwarded-proto", "https")
    if fwd_host and not _looks_like_preview(fwd_host):
        return f"{fwd_proto}://{fwd_host}"
    # 4. Safety net: never let search engines discover preview URLs.
    return _CANONICAL_SITE_ROOT
