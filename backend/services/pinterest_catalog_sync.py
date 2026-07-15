"""iter352 — Pinterest Catalog real-time sync.

The TSV catalog feed at /api/pinterest/catalog.tsv (iter350) handles bulk
sync every 24-48h. This module adds the **real-time** complement:
`POST /v5/catalogs/items/batch` to push individual item updates (new
listings, price changes) so Pinterest reflects them within minutes
instead of waiting for the next full feed ingestion.

Per Pinterest's official guidance (developers.pinterest.com/docs/work-
with-catalogs/modify-items-in-batch/), this batch API is the
intended mechanism for dynamic catalogs — there is no documented
"force re-fetch the TSV feed now" endpoint. The two mechanisms
complement each other: feed = nightly bulk truth, batch = real-time
deltas.

Token scope requirements:
  * `catalogs:read`   — required for scope detection (GET /v5/catalogs)
  * `catalogs:write`  — required for batch item updates

The existing `PINTEREST_ACCESS_TOKEN` (used today only for one-off pin
publishing) almost certainly lacks both. We probe scopes lazily and
degrade gracefully — every helper logs once and returns a structured
result rather than raising, so the rest of the platform keeps working.

Public entry points (called from routes or background jobs):
  check_catalog_scope()                    → dict(read, write, reason)
  push_item_update(item_id, fields)        → dict(ok, status_code, ...)
  push_items_batch(items, operation)       → dict(ok, status_code, ...)
"""
from __future__ import annotations
from config import env_get
import logging
import os
from typing import Any

import httpx

PINTEREST_API_BASE = "https://api.pinterest.com/v5"
PINTEREST_ACCESS_TOKEN_ENV = "PINTEREST_ACCESS_TOKEN"

log = logging.getLogger("crafters.pinterest_catalog_sync")

# Module-level cache of the last scope-probe result so we don't re-probe
# on every batch push. Auto-invalidates after `_SCOPE_CACHE_TTL_S`.
_SCOPE_CACHE: dict[str, Any] = {"checked_at": 0.0, "result": None}
_SCOPE_CACHE_TTL_S = 600  # 10 min


def _token() -> str:
    return (env_get(PINTEREST_ACCESS_TOKEN_ENV) or "").strip()


def _hdrs(token: str | None = None) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token or _token()}",
        "Content-Type": "application/json",
    }


def _is_scope_error(resp: httpx.Response) -> bool:
    """403 with a body mentioning 'scope' / 'permission' / 'authorization'."""
    if resp.status_code != 403:
        return False
    try:
        msg = (resp.json().get("message") or "").lower()
    except Exception:
        msg = (resp.text or "").lower()
    return any(k in msg for k in ("scope", "permission", "authorization"))


async def check_catalog_scope(force: bool = False) -> dict[str, Any]:
    """Probe whether the current PINTEREST_ACCESS_TOKEN has catalog
    scopes by calling `GET /v5/catalogs`.

    Returns:
        {
          "read":   bool,   # catalogs:read present
          "write":  bool | None,  # None when we can't tell without a write probe
          "status": "ok" | "no_token" | "expired" | "no_read_scope" |
                    "no_catalogs_role" | "network_error",
          "reason": str,    # human-readable
          "raw":    dict,   # last response body (truncated)
        }

    `write` is reported optimistically as True when read works AND the
    Pinterest user has at least one catalog (since by Pinterest's
    docs, accounts with `catalogs:read` typically also requested
    `catalogs:write` together — the scopes are paired in onboarding
    UIs). For definitive write-capability detection, callers should
    monitor `push_item_update` for `no_write_scope` results.
    """
    import time
    now = time.monotonic()
    if not force and _SCOPE_CACHE["result"] is not None and \
            (now - _SCOPE_CACHE["checked_at"]) < _SCOPE_CACHE_TTL_S:
        return dict(_SCOPE_CACHE["result"])  # return a copy

    token = _token()
    if not token:
        result = {"read": False, "write": False, "status": "no_token",
                  "reason": "PINTEREST_ACCESS_TOKEN env var is empty.",
                  "raw": {}}
        _SCOPE_CACHE.update(checked_at=now, result=result)
        return dict(result)

    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.get(f"{PINTEREST_API_BASE}/catalogs", headers=_hdrs(token))
    except (httpx.RequestError, httpx.TimeoutException) as e:
        log.warning("[pinterest-scope] network error probing /catalogs: %s", e)
        result = {"read": False, "write": False, "status": "network_error",
                  "reason": f"Network error: {str(e)[:200]}", "raw": {}}
        # Don't cache transient network errors.
        return result

    body: dict[str, Any]
    try:
        body = resp.json()
    except Exception:
        body = {"raw_text": (resp.text or "")[:500]}

    if resp.status_code == 200:
        n_catalogs = len(body.get("items") or [])
        result = {
            "read": True,
            "write": n_catalogs > 0,  # optimistic — see docstring
            "status": "ok",
            "reason": f"{n_catalogs} catalog(s) accessible.",
            "raw": body,
        }
    elif resp.status_code == 401:
        result = {"read": False, "write": False, "status": "expired",
                  "reason": "Token rejected (401). Re-run the Pinterest "
                            "OAuth flow.", "raw": body}
    elif resp.status_code == 403:
        if _is_scope_error(resp):
            result = {"read": False, "write": False, "status": "no_read_scope",
                      "reason": "Token lacks catalogs:read. Re-run OAuth with "
                                "scope=catalogs:read,catalogs:write.", "raw": body}
        else:
            result = {"read": False, "write": False, "status": "no_catalogs_role",
                      "reason": "Token user lacks a Catalogs role on the ad "
                                "account (Owner / Admin / Catalogs Manager).",
                      "raw": body}
    else:
        result = {"read": False, "write": False, "status": "unexpected",
                  "reason": f"Unexpected {resp.status_code} from Pinterest.",
                  "raw": body}

    _SCOPE_CACHE.update(checked_at=now, result=result)
    return dict(result)


async def push_items_batch(items: list[dict[str, Any]],
                           operation: str = "UPDATE",
                           country: str = "US",
                           language: str = "EN") -> dict[str, Any]:
    """Push a batch of catalog-item updates to Pinterest.

    `items` is a list of Pinterest item dicts, each at minimum:
        {"item_id": "<stable-sku-or-slug>", "attributes": {...}}

    Returns `{ok, status_code, response, reason}`. Never raises — caller
    inspects `ok` and `reason` to decide whether to retry or wait for
    the next nightly feed ingestion."""
    if not items:
        return {"ok": False, "status_code": 0, "reason": "no items to push",
                "response": {}}
    token = _token()
    if not token:
        return {"ok": False, "status_code": 0, "reason": "no PINTEREST_ACCESS_TOKEN",
                "response": {}}
    payload = {
        "operation": operation,
        "country": country,
        "language": language,
        "items": items,
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            resp = await http.post(
                f"{PINTEREST_API_BASE}/catalogs/items/batch",
                headers=_hdrs(token), json=payload,
            )
    except (httpx.RequestError, httpx.TimeoutException) as e:
        log.warning("[pinterest-batch] network error: %s", e)
        return {"ok": False, "status_code": 0,
                "reason": f"network error: {str(e)[:200]}", "response": {}}

    try:
        body = resp.json()
    except Exception:
        body = {"raw_text": (resp.text or "")[:500]}

    if 200 <= resp.status_code < 300:
        return {"ok": True, "status_code": resp.status_code,
                "reason": f"pushed {len(items)} item(s)", "response": body}
    if resp.status_code == 401:
        return {"ok": False, "status_code": 401, "reason": "token expired",
                "response": body}
    if resp.status_code == 403:
        if _is_scope_error(resp):
            log.warning("[pinterest-batch] missing catalogs:write scope — "
                        "falling back to feed-only sync (24-48h cadence).")
            # Force a scope re-probe so the admin status endpoint reflects
            # reality next time it's hit.
            _SCOPE_CACHE["result"] = None
            return {"ok": False, "status_code": 403, "reason": "no_write_scope",
                    "response": body}
        return {"ok": False, "status_code": 403,
                "reason": "no_catalogs_role", "response": body}
    log.warning("[pinterest-batch] unexpected %s: %s",
                resp.status_code, str(body)[:300])
    return {"ok": False, "status_code": resp.status_code,
            "reason": f"http_{resp.status_code}", "response": body}


async def push_item_update(item_id: str, *, price: float | None = None,
                           availability: str | None = None,
                           **extra: Any) -> dict[str, Any]:
    """Convenience wrapper to push a single UPDATE for one item.

    `availability` should be Pinterest spec values: 'in stock' | 'out of stock'
    | 'preorder' (matches our feed format). Extra keyword args are merged
    into the item's attributes verbatim, so callers can pass `link`,
    `description`, `image_link`, etc."""
    attrs: dict[str, Any] = {}
    if price is not None:
        # Match the feed: "49.00 USD"
        attrs["price"] = f"{float(price):.2f} USD"
    if availability:
        attrs["availability"] = availability
    attrs.update(extra)
    if not attrs:
        return {"ok": False, "status_code": 0,
                "reason": "no attributes to update", "response": {}}
    item = {"item_id": str(item_id), "attributes": attrs}
    return await push_items_batch([item], operation="UPDATE")
