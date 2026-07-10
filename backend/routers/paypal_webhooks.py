"""iter436 — Secure PayPal webhook receiver.

POST /api/webhooks/paypal
  1. Reads the RAW request body (PayPal signs the exact bytes).
  2. Verifies the signature via PayPal's verify-webhook-signature API
     (OAuth2 client-credentials token, cached until expiry).
  3. Rejects invalid/unverified messages (400).
  4. Dedupes on the PayPal event ID (atomic $setOnInsert upsert).
  5. Persists event_id, event_type, resource_id, timestamps, verification
     status, and processing result in db.paypal_webhook_events.
  6. Returns 200 after successful processing.
  7. Logs failures without ever logging credentials.
  8. Sandbox and live are fully separated via env:
       PAYPAL_ENVIRONMENT=sandbox|live
       PAYPAL_CLIENT_ID_SANDBOX / PAYPAL_CLIENT_SECRET_SANDBOX / PAYPAL_WEBHOOK_ID_SANDBOX
       PAYPAL_CLIENT_ID_LIVE    / PAYPAL_CLIENT_SECRET_LIVE    / PAYPAL_WEBHOOK_ID_LIVE
"""
import base64
import json
import os
import time

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from core import db, logger, now_iso

router = APIRouter(prefix="", tags=["paypal-webhooks"])

_API_BASE = {
    "sandbox": "https://api-m.sandbox.paypal.com",
    "live": "https://api-m.paypal.com",
}

_REQUIRED_HEADERS = [
    "paypal-transmission-id",
    "paypal-transmission-time",
    "paypal-transmission-sig",
    "paypal-cert-url",
    "paypal-auth-algo",
]


def _config() -> dict:
    env = (os.environ.get("PAYPAL_ENVIRONMENT") or "sandbox").strip().lower()
    if env not in _API_BASE:
        env = "sandbox"
    suffix = "LIVE" if env == "live" else "SANDBOX"
    return {
        "env": env,
        "base": _API_BASE[env],
        "client_id": (os.environ.get(f"PAYPAL_CLIENT_ID_{suffix}") or "").strip(),
        "client_secret": (os.environ.get(f"PAYPAL_CLIENT_SECRET_{suffix}") or "").strip(),
        "webhook_id": (os.environ.get(f"PAYPAL_WEBHOOK_ID_{suffix}") or "").strip(),
    }


def paypal_configured() -> bool:
    c = _config()
    return bool(c["client_id"] and c["client_secret"] and c["webhook_id"])


# ── OAuth token cache (per environment) ─────────────────────────────────────
_token_cache: dict = {}


async def _access_token(cfg: dict) -> str:
    cached = _token_cache.get(cfg["env"])
    if cached and cached["expires_at"] > time.time() + 60:
        return cached["token"]
    basic = base64.b64encode(f"{cfg['client_id']}:{cfg['client_secret']}".encode()).decode()
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"{cfg['base']}/v1/oauth2/token",
            headers={"Authorization": f"Basic {basic}",
                     "Content-Type": "application/x-www-form-urlencoded"},
            content="grant_type=client_credentials",
        )
    if r.status_code != 200:
        # Never log the body verbatim on auth endpoints — it can echo creds context.
        logger.error("[paypal] OAuth token request failed · status=%s", r.status_code)
        raise RuntimeError("paypal oauth failed")
    data = r.json()
    _token_cache[cfg["env"]] = {
        "token": data["access_token"],
        "expires_at": time.time() + int(data.get("expires_in", 3600)),
    }
    return data["access_token"]


async def _verify_signature(cfg: dict, headers, event: dict) -> str:
    """Returns PayPal's verification_status: SUCCESS | FAILURE (or ERROR on transport issues)."""
    token = await _access_token(cfg)
    payload = {
        "auth_algo": headers.get("paypal-auth-algo"),
        "cert_url": headers.get("paypal-cert-url"),
        "transmission_id": headers.get("paypal-transmission-id"),
        "transmission_sig": headers.get("paypal-transmission-sig"),
        "transmission_time": headers.get("paypal-transmission-time"),
        "webhook_id": cfg["webhook_id"],
        "webhook_event": event,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"{cfg['base']}/v1/notifications/verify-webhook-signature",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
    if r.status_code != 200:
        logger.error("[paypal] verify-webhook-signature HTTP %s", r.status_code)
        return "ERROR"
    return (r.json().get("verification_status") or "FAILURE").upper()


async def _process_event(event: dict) -> str:
    """Business-logic hook. Extend with per-event handling (e.g.
    PAYMENT.CAPTURE.COMPLETED) as PayPal payments come online."""
    return "recorded"


@router.post("/webhooks/paypal")
async def paypal_webhook(request: Request):
    cfg = _config()
    if not paypal_configured():
        logger.warning("[paypal] webhook received but PayPal env vars are not configured")
        return JSONResponse({"error": "PayPal webhooks not configured"}, status_code=503)

    # 1. Raw body — PayPal signs the exact bytes.
    raw = await request.body()
    try:
        event = json.loads(raw)
    except Exception:
        logger.warning("[paypal] webhook rejected · invalid JSON body")
        return JSONResponse({"error": "invalid JSON"}, status_code=400)

    missing = [h for h in _REQUIRED_HEADERS if not request.headers.get(h)]
    if missing:
        logger.warning("[paypal] webhook rejected · missing headers: %s", ",".join(missing))
        return JSONResponse({"error": "missing PayPal signature headers"}, status_code=400)

    event_id = event.get("id") or ""
    if not event_id:
        return JSONResponse({"error": "missing event id"}, status_code=400)

    # 2. Fast-path dedupe before burning a verification API call.
    if await db.paypal_webhook_events.find_one({"event_id": event_id}, {"_id": 1}):
        logger.info("[paypal] duplicate event ignored · id=%s", event_id)
        return {"status": "duplicate", "event_id": event_id}

    # 3. Verify with PayPal.
    try:
        status = await _verify_signature(cfg, request.headers, event)
    except Exception as e:
        logger.error("[paypal] verification error · id=%s · %s", event_id, type(e).__name__)
        return JSONResponse({"error": "verification unavailable"}, status_code=503)

    resource = event.get("resource") or {}
    doc = {
        "event_id": event_id,
        "event_type": event.get("event_type"),
        "resource_type": event.get("resource_type"),
        "resource_id": resource.get("id"),
        "summary": event.get("summary"),
        "event_time": event.get("create_time"),
        "environment": cfg["env"],
        "verification_status": status,
        "processing_result": None,
        "received_at": now_iso(),
    }

    if status != "SUCCESS":
        doc["processing_result"] = "rejected_unverified"
        await db.paypal_webhook_events.update_one(
            {"event_id": event_id}, {"$setOnInsert": doc}, upsert=True,
        )
        logger.warning("[paypal] webhook signature verification FAILED · id=%s · type=%s",
                       event_id, doc["event_type"])
        return JSONResponse({"error": "signature verification failed"}, status_code=400)

    # 4. Atomic insert — a concurrent duplicate loses the upsert race.
    res = await db.paypal_webhook_events.update_one(
        {"event_id": event_id}, {"$setOnInsert": doc}, upsert=True,
    )
    if res.upserted_id is None:
        return {"status": "duplicate", "event_id": event_id}

    # 5. Process + record the outcome.
    try:
        result = await _process_event(event)
    except Exception as e:
        result = f"error:{type(e).__name__}"
        logger.error("[paypal] event processing failed · id=%s · %s", event_id, type(e).__name__)
    await db.paypal_webhook_events.update_one(
        {"event_id": event_id}, {"$set": {"processing_result": result}},
    )
    logger.info("[paypal] webhook processed · id=%s · type=%s · result=%s",
                event_id, doc["event_type"], result)
    return {"status": "ok", "event_id": event_id, "result": result}
