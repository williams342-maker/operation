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


def _mask(v: str) -> str:
    return ("…" + v[-4:]) if v and len(v) > 4 else "…"


async def _verify_signature(cfg: dict, headers, raw_body: bytes) -> tuple:
    """Returns (verification_status, verify_debug).
    Status: SUCCESS | FAILURE | ERROR (non-200 from PayPal's verify API).

    CRITICAL: `webhook_event` must be the EXACT raw bytes PayPal sent — any
    re-serialization (key order, whitespace, unicode escapes, float formatting)
    changes the CRC and PayPal returns FAILURE. We therefore splice the raw
    body into the request string instead of letting the JSON encoder touch it.

    Resilience: a stale/invalidated OAuth token (401) or transient PayPal
    hiccup (429/5xx) is retried once with a freshly minted token.
    """
    hdr_names = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id",
                 "paypal-transmission-sig", "paypal-transmission-time"]
    forwarded = {h: headers.get(h) for h in hdr_names}
    meta = {
        "auth_algo": forwarded["paypal-auth-algo"],
        "cert_url": forwarded["paypal-cert-url"],
        "transmission_id": forwarded["paypal-transmission-id"],
        "transmission_sig": forwarded["paypal-transmission-sig"],
        "transmission_time": forwarded["paypal-transmission-time"],
        "webhook_id": cfg["webhook_id"],
    }
    logger.info(
        "[paypal] verifying · webhook_id=%s · env=%s · headers_present=%s",
        _mask(cfg["webhook_id"]), cfg["env"],
        ",".join(h for h in hdr_names if forwarded[h]),
    )
    body = json.dumps(meta)[:-1] + ',"webhook_event":' + raw_body.decode("utf-8") + "}"
    url = f"{cfg['base']}/v1/notifications/verify-webhook-signature"
    attempts = []
    r = None
    for attempt in (1, 2):
        token = await _access_token(cfg)
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                content=body,
            )
        # Response bodies contain no credentials — safe to log verbatim.
        logger.info("[paypal] verify-webhook-signature · attempt=%s · status=%s · body=%s",
                    attempt, r.status_code, r.text[:500])
        attempts.append({"attempt": attempt, "response_status": r.status_code,
                         "response_body": r.text[:500]})
        if r.status_code == 200:
            break
        if attempt == 1 and (r.status_code in (401, 429) or r.status_code >= 500):
            # 401: token stale/invalidated → force-mint a fresh one and retry.
            _token_cache.pop(cfg["env"], None)
            continue
        break
    debug = {
        "webhook_id_last4": _mask(cfg["webhook_id"]),
        "environment": cfg["env"],
        "verify_endpoint": url,
        "response_status": r.status_code,
        "response_body": r.text[:500],
        "attempts": attempts,
        "headers_forwarded": [h for h in hdr_names if forwarded[h]],
        "body_bytes": len(raw_body),
    }
    if r.status_code != 200:
        return "ERROR", debug
    return (r.json().get("verification_status") or "FAILURE").upper(), debug


async def _process_event(event: dict) -> str:
    """Business-logic hook. iter438: reconcile PayPal checkout captures."""
    etype = event.get("event_type") or ""
    if etype in ("PAYMENT.CAPTURE.COMPLETED", "CHECKOUT.ORDER.COMPLETED"):
        res = event.get("resource") or {}
        internal_id = res.get("custom_id")
        capture_id = res.get("id")
        flt = {"id": internal_id} if internal_id else {"capture_id": capture_id}
        upd = await db.paypal_orders.update_one(
            flt,
            {"$set": {"reconciled": True, "reconciled_at": now_iso(),
                      "reconciled_by_event": event.get("id")}},
        )
        if upd.matched_count:
            return f"reconciled:{internal_id or capture_id}"
        return "recorded_no_matching_order"
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
    existing = await db.paypal_webhook_events.find_one({"event_id": event_id}, {"_id": 1})
    if existing:
        await db.paypal_webhook_events.update_one(
            {"event_id": event_id},
            {"$inc": {"duplicate_count": 1}, "$set": {"last_duplicate_at": now_iso()}},
        )
        logger.info("[paypal] duplicate event ignored · id=%s", event_id)
        return {"status": "duplicate", "event_id": event_id}

    # 3. Verify with PayPal — pass the RAW bytes, never the re-parsed event.
    try:
        status, verify_debug = await _verify_signature(cfg, request.headers, raw)
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
        "http_outcome": None,
        "duplicate_count": 0,
        "received_at": now_iso(),
        "verify_debug": verify_debug,
        **_extract_ids(event),
        "payload": _sanitize(event),
    }

    if status != "SUCCESS":
        doc["processing_result"] = "rejected_unverified"
        doc["http_outcome"] = "400 signature verification failed"
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
        await db.paypal_webhook_events.update_one(
            {"event_id": event_id},
            {"$inc": {"duplicate_count": 1}, "$set": {"last_duplicate_at": now_iso()}},
        )
        return {"status": "duplicate", "event_id": event_id}

    # 5. Process + record the outcome.
    try:
        result = await _process_event(event)
    except Exception as e:
        result = f"error:{type(e).__name__}"
        logger.error("[paypal] event processing failed · id=%s · %s", event_id, type(e).__name__)
    await db.paypal_webhook_events.update_one(
        {"event_id": event_id},
        {"$set": {"processing_result": result,
                  "http_outcome": "200 ok" if not result.startswith("error:") else "200 processing error"}},
    )
    logger.info("[paypal] webhook processed · id=%s · type=%s · result=%s",
                event_id, doc["event_type"], result)
    return {"status": "ok", "event_id": event_id, "result": result}


# ═════════════════ iter437 — Read-only admin viewer (Admin → PayPal Events) ═

from datetime import datetime, timedelta, timezone  # noqa: E402

from fastapi import Depends, HTTPException, Query  # noqa: E402

from maker_auth import current_admin  # noqa: E402

_SENSITIVE_KEY_PARTS = ("token", "secret", "password", "credential", "authorization", "auth_assertion", "client_id")


def _sanitize(obj, depth: int = 0):
    """Strip anything credential-shaped from a payload before storage/display."""
    if depth > 8:
        return "…"
    if isinstance(obj, dict):
        return {
            k: ("[redacted]" if any(p in k.lower() for p in _SENSITIVE_KEY_PARTS) else _sanitize(v, depth + 1))
            for k, v in obj.items() if k != "links"
        }
    if isinstance(obj, list):
        return [_sanitize(v, depth + 1) for v in obj[:50]]
    return obj


def _extract_ids(event: dict) -> dict:
    """Pull order/capture/invoice/custom ids + amount out of common event shapes."""
    res = event.get("resource") or {}
    rtype = (event.get("resource_type") or "").lower()
    out = {
        "order_id": None, "capture_id": None, "authorization_id": None,
        "invoice_id": res.get("invoice_id"), "custom_id": res.get("custom_id"),
        "amount": None, "currency": None,
    }
    related = ((res.get("supplementary_data") or {}).get("related_ids") or {})
    out["order_id"] = related.get("order_id") or (res.get("id") if rtype in ("checkout-order", "order") else None)
    if rtype == "capture":
        out["capture_id"] = res.get("id")
    if rtype == "authorization":
        out["authorization_id"] = res.get("id")
    amt = res.get("amount") or {}
    if isinstance(amt, dict):
        out["amount"] = amt.get("value") or (amt.get("total"))
        out["currency"] = amt.get("currency_code") or amt.get("currency")
    if out["amount"] is None:
        pu = (res.get("purchase_units") or [{}])[0]
        pamt = pu.get("amount") or {}
        out["amount"], out["currency"] = pamt.get("value"), pamt.get("currency_code")
        out["invoice_id"] = out["invoice_id"] or pu.get("invoice_id")
        out["custom_id"] = out["custom_id"] or pu.get("custom_id")
    return out


_indexes_ready = False


async def _ensure_indexes():
    global _indexes_ready
    if _indexes_ready:
        return
    col = db.paypal_webhook_events
    for key in ("event_id", "event_type", "received_at", "verification_status", "environment"):
        await col.create_index(key)
    _indexes_ready = True


@router.get("/admin/paypal/events")
async def admin_paypal_events(
    environment: str = "",
    event_type: str = "",
    verification_status: str = "",
    processing_result: str = "",
    q: str = "",
    date_from: str = "",
    date_to: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    _: dict = Depends(current_admin),
):
    await _ensure_indexes()
    flt: dict = {}
    if environment in ("sandbox", "live"):
        flt["environment"] = environment
    if event_type:
        flt["event_type"] = event_type
    if verification_status:
        flt["verification_status"] = verification_status.upper()
    if processing_result:
        if processing_result == "error":
            flt["processing_result"] = {"$regex": "^error:"}
        else:
            flt["processing_result"] = processing_result
    if q:
        needle = q.strip()
        flt["$or"] = [
            {"event_id": needle}, {"order_id": needle}, {"resource_id": needle},
            {"invoice_id": needle}, {"capture_id": needle}, {"authorization_id": needle},
        ]
    date_flt = {}
    if date_from:
        date_flt["$gte"] = date_from
    if date_to:
        date_flt["$lte"] = date_to + ("T23:59:59Z" if len(date_to) == 10 else "")
    if date_flt:
        flt["received_at"] = date_flt

    col = db.paypal_webhook_events
    total = await col.count_documents(flt)
    rows = await (
        col.find(flt, {"_id": 0, "payload": 0})
        .sort("received_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list(page_size)
    )
    event_types = await col.distinct("event_type")
    return {
        "events": rows, "total": total, "page": page, "page_size": page_size,
        "event_types": sorted(t for t in event_types if t),
    }


@router.get("/admin/paypal/events/summary")
async def admin_paypal_summary(_: dict = Depends(current_admin)):
    await _ensure_indexes()
    col = db.paypal_webhook_events
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    base = {"received_at": {"$gte": cutoff}}
    received = await col.count_documents(base)
    verified = await col.count_documents({**base, "verification_status": "SUCCESS"})
    ver_failed = await col.count_documents({**base, "verification_status": {"$in": ["FAILURE", "ERROR"]}})
    proc_failed = await col.count_documents({**base, "processing_result": {"$regex": "^error:"}})
    dup_agg = await col.aggregate([
        {"$match": {"last_duplicate_at": {"$gte": cutoff}}},
        {"$group": {"_id": None, "n": {"$sum": "$duplicate_count"}}},
    ]).to_list(1)
    cfg = _config()
    return {
        "last_24h": {
            "received": received, "verified": verified,
            "verification_failures": ver_failed, "processing_failures": proc_failed,
            "duplicates": (dup_agg[0]["n"] if dup_agg else 0),
        },
        "health": {
            "environment": cfg["env"],
            "client_id": "Configured" if cfg["client_id"] else "Missing",
            "client_secret": "Configured" if cfg["client_secret"] else "Missing",
            "webhook_id": "Configured" if cfg["webhook_id"] else "Missing",
        },
    }


@router.get("/admin/paypal/events/{event_id}")
async def admin_paypal_event_detail(event_id: str, _: dict = Depends(current_admin)):
    doc = await db.paypal_webhook_events.find_one({"event_id": event_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Event not found.")
    # Defense in depth: payloads are sanitized at write time, but re-sanitize
    # on the way out in case older rows predate sanitization.
    if doc.get("payload"):
        doc["payload"] = _sanitize(doc["payload"])
    return doc
