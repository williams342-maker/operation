"""Emergent object storage helper (iter364).

Thin async wrapper over the Emergent object-storage HTTP API, used for
customer personalization photo uploads (25 MB files would bloat Mongo
and R2 is reserved for maker-side listing media). Only file METADATA
lives in MongoDB (`customer_uploads` collection) — bytes live here.

Auth: the storage API is unlocked with EMERGENT_LLM_KEY via a one-time
/init call that returns a session-scoped `storage_key`, cached at module
level. On a 403 (expired key) we re-init once and retry.

Path convention: `craftersmarket/personalization/{uuid}.{ext}` —
app-name prefix isolates our bucket; UUID names prevent collisions.
There is no delete API — orphan handling is a soft-delete flag in Mongo.
"""
from __future__ import annotations

import os

import httpx

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "craftersmarket"

_storage_key: str | None = None


async def _init_storage() -> str:
    """Fetch (and cache) the session storage key. Raises on failure."""
    global _storage_key
    if _storage_key:
        return _storage_key
    emergent_key = os.environ.get("EMERGENT_LLM_KEY")
    if not emergent_key:
        raise RuntimeError("EMERGENT_LLM_KEY is not configured")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{STORAGE_URL}/init", json={"emergent_key": emergent_key},
        )
        resp.raise_for_status()
        _storage_key = resp.json()["storage_key"]
    return _storage_key


def _reset_key() -> None:
    global _storage_key
    _storage_key = None


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload bytes. Returns the storage response ({path, size, etag}).

    `path` must NOT have a leading slash and should already carry the
    APP_NAME prefix. Retries once on 403 (stale storage key).
    """
    for attempt in (0, 1):
        key = await _init_storage()
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.put(
                f"{STORAGE_URL}/objects/{path}",
                headers={"X-Storage-Key": key, "Content-Type": content_type},
                content=data,
            )
        if resp.status_code == 403 and attempt == 0:
            _reset_key()
            continue
        resp.raise_for_status()
        return resp.json()


async def get_object(path: str) -> tuple[bytes, str]:
    """Download bytes. Returns (content, content_type)."""
    for attempt in (0, 1):
        key = await _init_storage()
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(
                f"{STORAGE_URL}/objects/{path}",
                headers={"X-Storage-Key": key},
            )
        if resp.status_code == 403 and attempt == 0:
            _reset_key()
            continue
        resp.raise_for_status()
        return resp.content, resp.headers.get(
            "Content-Type", "application/octet-stream",
        )
