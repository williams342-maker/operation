"""Core: env loading, db handle, common helpers, public-host resolution."""
import os
import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from fastapi import Request
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
# iter224 — Selective override: load `.env` WITHOUT global override (so real
# Kubernetes deployment env vars on craftersmarket.org keep winning — critical
# for MONGO_URL, DB_NAME, SECRET, JWT_SECRET that prod sets differently than
# the preview .env). THEN, for any key that exists in `.env`, if the OS env
# currently holds an Emergent-pod placeholder (contains the `****` mask
# pattern Emergent uses for dummy values, e.g. STRIPE_API_KEY=sk_test_****gent),
# we overwrite it from `.env` so preview testing works with real keys.
#
# Why this matters:
#   - Previous fix used `override=True` globally → preview Stripe worked
#     BUT production crashed with Cloudflare 520 because .env's MONGO_URL
#     replaced the production cluster URL.
#   - This selective approach: preview gets real keys (dummies replaced),
#     production keeps its real K8s-injected vars (no `****` mask, so no
#     override). Best of both worlds, no manual env edits required.
def _selective_env_override(env_path: Path) -> None:
    """Override OS env from .env ONLY for keys whose OS value is an Emergent
    pod placeholder (contains `****`). Returns silently if .env is missing."""
    from dotenv import dotenv_values
    if not env_path.exists():
        return
    # First, fill in keys MISSING from OS env (standard load_dotenv behavior
    # with override=False — we want the same default fill-in).
    load_dotenv(env_path, override=False)
    # Then, for keys present in BOTH .env and OS env, replace OS value only
    # if OS value looks like a dummy. The `****` mask is unique to Emergent
    # pod placeholders — real API keys never contain four consecutive stars.
    for key, env_val in dotenv_values(env_path).items():
        if not env_val:
            continue
        os_val = os.environ.get(key, "")
        if os_val and "****" in os_val:
            os.environ[key] = env_val

_selective_env_override(ROOT_DIR / ".env")

# Policy version stamped on every order acceptance. Bump when policy text
# changes substantially so the audit trail can prove which version a buyer
# agreed to. Frontend reads this from /api/policy/version.
POLICY_VERSION = "2026.08"

# ---- Mongo ----
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


class _LoopAwareMotor:
    """Motor binds each AsyncIOMotorClient to the event loop it first runs
    I/O on. In production (one uvicorn loop) that's fine, but under pytest
    many loops come and go — pytest-asyncio's session loop, TestClient's
    anyio portal, and bare `asyncio.run()` calls inside sync tests. Once
    the bound loop closes, any further query raises
    `RuntimeError: Event loop is closed` (the long-standing "global pytest
    is broken, run files individually" issue).

    This manager keeps ONE client per living event loop and transparently
    hands back the right one at attribute-access time. Closed loops are
    pruned so the registry can't grow unbounded across a test session.
    The production fast path is a dict hit + an `is_closed()` check.
    """

    def __init__(self, url: str):
        self._url = url
        self._clients: dict[int, tuple] = {}  # id(loop) -> (loop, client)

    def current(self) -> AsyncIOMotorClient:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None  # sync context (import time, scripts before run)
        key = id(loop)
        entry = self._clients.get(key)
        if entry is not None and entry[0] is loop and (
            loop is None or not loop.is_closed()
        ):
            return entry[1]
        # Prune clients whose loops have closed (their sockets are dead).
        for k in [k for k, (l, c) in self._clients.items()
                  if l is not None and l.is_closed()]:
            self._clients.pop(k, None)
        c = AsyncIOMotorClient(self._url)
        self._clients[key] = (loop, c)
        return c

    def close_all(self) -> None:
        for _, c in list(self._clients.values()):
            try:
                c.close()
            except Exception:
                pass
        self._clients.clear()


class _ClientProxy:
    """Drop-in stand-in for the module-level AsyncIOMotorClient."""

    def __init__(self, mgr: _LoopAwareMotor):
        object.__setattr__(self, "_mgr", mgr)

    def __getattr__(self, name):
        return getattr(self._mgr.current(), name)

    def __getitem__(self, name):
        return self._mgr.current()[name]

    def close(self):  # server shutdown hook calls client.close()
        self._mgr.close_all()


class _DBProxy:
    """Drop-in stand-in for the module-level AsyncIOMotorDatabase."""

    def __init__(self, mgr: _LoopAwareMotor, name: str):
        object.__setattr__(self, "_mgr", mgr)
        object.__setattr__(self, "_name", name)

    def __getattr__(self, name):
        return getattr(self._mgr.current()[self._name], name)

    def __getitem__(self, name):
        return self._mgr.current()[self._name][name]


_motor = _LoopAwareMotor(MONGO_URL)
client = _ClientProxy(_motor)
db = _DBProxy(_motor, DB_NAME)

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


def custom_options_summary(prod: dict, option_ids: list) -> tuple:
    """iter380 — Resolve a buyer's customization-only option picks.

    Walks the product's `variant_groups` where `tracks_inventory == False`
    and matches the supplied option ids. Returns `(label, delta)` where
    `label` is e.g. "Font: Script · Finish: Matte" (or None when nothing
    matched) and `delta` is the summed price adjustment of the matched
    options. Used by checkout pricing, receipts, and maker order views.
    """
    if not option_ids:
        return None, 0.0
    parts, delta = [], 0.0
    for g in (prod.get("variant_groups") or []):
        if g.get("tracks_inventory") is not False:
            continue
        o = next((o for o in (g.get("options") or []) if o.get("id") in option_ids), None)
        if o:
            parts.append(f"{g.get('name')}: {o.get('label')}")
            delta += float(o.get("price_delta") or 0)
    return (" · ".join(parts) or None), delta


def effective_variant_price(base_price: float, variant) -> float:
    """Compute the unit price for a given (product, variant) pair.

    Accepts either a Pydantic `ProductVariant` or a raw dict (Mongo doc).
    Precedence:
      1. `variant.price` (absolute SKU price) when set and > 0
      2. `base_price + variant.price_delta` (legacy)
    Negative results clamp to 0 — we never want to charge a buyer a
    nonsensical price even if data is mis-entered."""
    if variant is None:
        return max(float(base_price or 0), 0.0)
    if hasattr(variant, "model_dump"):
        v = variant.model_dump()
    else:
        v = dict(variant or {})
    abs_price = v.get("price")
    if abs_price is not None and float(abs_price) > 0:
        return round(float(abs_price), 2)
    return max(round(float(base_price or 0) + float(v.get("price_delta") or 0), 2), 0.0)


def listing_price_range(product) -> tuple[float, float]:
    """Return (min_price, max_price) across the listing's variants for
    use in shop cards when the base price is 0. Falls back to (base, base)
    when no variants exist."""
    if hasattr(product, "model_dump"):
        p = product.model_dump()
    else:
        p = dict(product or {})
    base = float(p.get("price") or 0)
    variants = p.get("variants") or []
    if not variants:
        return (base, base)
    prices = [effective_variant_price(base, v) for v in variants]
    prices = [x for x in prices if x > 0]
    if not prices:
        return (base, base)
    return (min(prices), max(prices))

# ---- Logger ----
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("crafters")

# Log Stripe mode at boot so we always know what mode we're in.
# Prevents silent mistakes like deploying a test key to prod or vice versa.
_stripe_mode = (
    "LIVE" if STRIPE_API_KEY.startswith("sk_live_")
    else "TEST" if STRIPE_API_KEY.startswith("sk_test_")
    else "MISSING/UNKNOWN"
)
logger.warning("[stripe] mode=%s", _stripe_mode)

# Log Shippo mode at boot for the same reason — a test-mode Shippo key
# silently buys non-trackable demo labels that never reach the carrier.
_shippo_key = os.environ.get("SHIPPO_API_KEY", "")
_shippo_mode = (
    "LIVE" if _shippo_key.startswith("shippo_live_")
    else "TEST" if _shippo_key.startswith("shippo_test_")
    else "MISSING/UNKNOWN"
)
logger.warning("[shippo] mode=%s", _shippo_mode)


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
