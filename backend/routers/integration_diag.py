"""Integration diagnostics — Shippo / Mailgun / R2.

iter226 — mirrors the iter222 Stripe diag pattern. Each endpoint is a
one-shot admin-only probe that:
  1. Validates the relevant env vars are present (catches placeholder /
     missing config without ever touching the network).
  2. Calls the cheapest possible auth probe on the upstream API.
  3. Translates raw SDK / HTTP errors into friendly, operator-actionable
     copy so the admin UI can render a clear "what's broken + how to fix"
     line instead of generic 500s.

The frontend (SettingsTab → DiagCard) renders three coloured pills:
  • emerald — reachable, mode/tier surfaced
  • amber   — configured but the upstream rejected us (with reason)
  • red     — env missing / placeholder, never reached the wire

All three endpoints require the admin JWT (same gate as /admin/stripe/diag).
"""
from __future__ import annotations

import os
from typing import Optional

import httpx
from fastapi import APIRouter, Depends

from core import logger
from maker_auth import current_admin

router = APIRouter()


def _looks_placeholder(value: str) -> bool:
    """Emergent pod injects masked dummies like `mg-key-****gent`. Real
    API keys never contain four consecutive `*`."""
    return bool(value) and "****" in value


# ═══════════════════════════════════════════════════════════════════════
# Shippo
# ═══════════════════════════════════════════════════════════════════════
@router.get("/admin/shippo/diag")
async def shippo_diag(_: dict = Depends(current_admin)):
    """Probe Shippo by listing one carrier account — cheapest auth-only
    call that doesn't create any state. Surfaces test vs live mode from
    the key prefix (`shippo_test_` vs `shippo_live_`)."""
    key = os.environ.get("SHIPPO_API_KEY", "")
    if not key:
        return {
            "ok": False,
            "mode": None,
            "reason": "SHIPPO_API_KEY missing — add it to /app/backend/.env and restart. "
                      "Get a key from https://apps.goshippo.com/settings/api.",
        }
    if _looks_placeholder(key):
        return {
            "ok": False,
            "mode": "placeholder",
            "key_prefix": key[:12],
            "reason": "SHIPPO_API_KEY is a `****`-masked Emergent pod placeholder. "
                      "Set a real Shippo API key in /app/backend/.env and restart.",
        }
    mode = "live" if key.startswith("shippo_live_") else (
        "test" if key.startswith("shippo_test_") else "unknown")
    # Use httpx directly — Shippo SDK creates network state we don't want
    # to spin up just for a health probe.
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://api.goshippo.com/carrier_accounts",
                headers={"Authorization": f"ShippoToken {key}"},
                params={"results": "1"},
            )
    except httpx.RequestError as e:
        return {"ok": False, "mode": mode, "key_prefix": key[:12],
                "reason": f"Network error reaching Shippo: {type(e).__name__}"}
    if r.status_code == 401:
        return {"ok": False, "mode": mode, "key_prefix": key[:12],
                "reason": "Shippo rejected the API key (401). Verify SHIPPO_API_KEY "
                          "in /app/backend/.env matches an active key at "
                          "https://apps.goshippo.com/settings/api."}
    if r.status_code >= 400:
        return {"ok": False, "mode": mode, "key_prefix": key[:12],
                "reason": f"Shippo returned HTTP {r.status_code}: {r.text[:200]}"}
    body = r.json() if r.content else {}
    carriers = body.get("results") or []
    return {
        "ok": True,
        "mode": mode,
        "key_prefix": key[:12],
        "carriers_count": len(carriers),
        "first_carrier": (carriers[0].get("carrier") if carriers else None),
    }


# ═══════════════════════════════════════════════════════════════════════
# Mailgun (only probed when EMAIL_PROVIDER chain includes mailgun)
# ═══════════════════════════════════════════════════════════════════════
@router.get("/admin/mailgun/diag")
async def mailgun_diag(_: dict = Depends(current_admin)):
    """Probe Mailgun by hitting `GET /v3/<domain>` — auth + domain
    verification in one call. Surfaces the region (us/eu) since a
    mismatch is Mailgun's #1 silent failure mode (404 "domain not
    found" when you're actually on the EU stack)."""
    key = os.environ.get("MAILGUN_API_KEY", "")
    domain = os.environ.get("MAILGUN_DOMAIN", "")
    region = (os.environ.get("MAILGUN_REGION") or "us").lower()
    if not key or not domain:
        missing = []
        if not key:
            missing.append("MAILGUN_API_KEY")
        if not domain:
            missing.append("MAILGUN_DOMAIN")
        return {
            "ok": False,
            "region": region,
            "reason": f"Missing {', '.join(missing)} in /app/backend/.env. "
                      "Mailgun keys live at https://app.mailgun.com/app/account/security/api_keys, "
                      "domains at https://app.mailgun.com/app/sending/domains.",
        }
    if _looks_placeholder(key):
        return {
            "ok": False,
            "region": region,
            "reason": "MAILGUN_API_KEY is a `****`-masked Emergent pod placeholder. "
                      "Set a real key from https://app.mailgun.com/app/account/security/api_keys.",
        }
    base = "https://api.eu.mailgun.net" if region == "eu" else "https://api.mailgun.net"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{base}/v3/domains/{domain}", auth=("api", key))
    except httpx.RequestError as e:
        return {"ok": False, "region": region, "domain": domain,
                "reason": f"Network error reaching Mailgun: {type(e).__name__}"}
    if r.status_code == 401:
        return {"ok": False, "region": region, "domain": domain,
                "reason": "Mailgun rejected the API key (401). The key is invalid OR "
                          "the wrong region — try flipping MAILGUN_REGION between 'us' and 'eu'."}
    if r.status_code == 404:
        return {"ok": False, "region": region, "domain": domain,
                "reason": f"Mailgun 404 on domain `{domain}`. Either MAILGUN_DOMAIN is wrong, "
                          f"or your account is on the {('us' if region == 'eu' else 'eu')} stack "
                          f"(flip MAILGUN_REGION)."}
    if r.status_code >= 400:
        return {"ok": False, "region": region, "domain": domain,
                "reason": f"Mailgun returned HTTP {r.status_code}: {r.text[:200]}"}
    body = r.json() if r.content else {}
    dom = body.get("domain") or {}
    state = dom.get("state") or "unknown"
    return {
        "ok": True,
        "region": region,
        "domain": domain,
        "state": state,                                    # "active" / "unverified"
        "verified": state == "active",
        "sending_type": dom.get("type") or "—",
    }


# ═══════════════════════════════════════════════════════════════════════
# R2 (Cloudflare object storage — S3-compatible)
# ═══════════════════════════════════════════════════════════════════════
@router.get("/admin/r2/diag")
async def r2_diag(_: dict = Depends(current_admin)):
    """Probe R2 by listing the configured bucket with MaxKeys=1 — cheapest
    auth + bucket-exists check. Surfaces the public URL so the admin can
    confirm the CDN domain is wired (many R2 outages turn out to be a
    misconfigured custom-domain alias, not a bad key)."""
    import r2_storage
    missing = [k for k, v in {
        "R2_ACCOUNT_ID": os.environ.get("R2_ACCOUNT_ID", ""),
        "R2_ACCESS_KEY_ID": os.environ.get("R2_ACCESS_KEY_ID", ""),
        "R2_SECRET_ACCESS_KEY": os.environ.get("R2_SECRET_ACCESS_KEY", ""),
        "R2_BUCKET": os.environ.get("R2_BUCKET", ""),
        "R2_PUBLIC_URL": os.environ.get("R2_PUBLIC_URL", ""),
    }.items() if not v]
    if missing:
        return {
            "ok": False,
            "reason": f"Missing {', '.join(missing)} in /app/backend/.env. "
                      "Generate keys at Cloudflare dashboard → R2 → Manage R2 API Tokens.",
        }
    for env_key in ("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
        if _looks_placeholder(os.environ.get(env_key, "")):
            return {
                "ok": False,
                "reason": f"{env_key} is a `****`-masked Emergent pod placeholder. "
                          "Replace with the real key from Cloudflare R2.",
            }
    try:
        # head_bucket → 200 if exists & authed, 403 if wrong key, 404 if missing.
        cli = r2_storage.client()
        cli.head_bucket(Bucket=r2_storage.R2_BUCKET)
        # List 1 object to confirm read perms (head_bucket only checks existence).
        listing = cli.list_objects_v2(Bucket=r2_storage.R2_BUCKET, MaxKeys=1)
    except Exception as e:
        msg = str(e)
        if "InvalidAccessKeyId" in msg or "SignatureDoesNotMatch" in msg or "403" in msg:
            return {"ok": False, "bucket": r2_storage.R2_BUCKET,
                    "reason": "R2 rejected the access key. Verify R2_ACCESS_KEY_ID + "
                              "R2_SECRET_ACCESS_KEY in /app/backend/.env match an active "
                              "token at https://dash.cloudflare.com → R2 → Manage R2 API Tokens."}
        if "NoSuchBucket" in msg or "404" in msg:
            return {"ok": False, "bucket": r2_storage.R2_BUCKET,
                    "reason": f"Bucket `{r2_storage.R2_BUCKET}` doesn't exist in this R2 account. "
                              "Either create it in the Cloudflare dashboard or fix R2_BUCKET in .env."}
        return {"ok": False, "bucket": r2_storage.R2_BUCKET,
                "reason": f"R2 error: {type(e).__name__}: {msg[:200]}"}
    return {
        "ok": True,
        "bucket": r2_storage.R2_BUCKET,
        "public_url": r2_storage.R2_PUBLIC_URL,
        "object_count_sample": listing.get("KeyCount", 0),
        "first_key": (listing.get("Contents", [{}])[0].get("Key") if listing.get("Contents") else None),
    }
