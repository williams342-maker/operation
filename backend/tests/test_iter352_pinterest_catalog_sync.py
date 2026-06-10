"""iter352 — Pinterest Catalog real-time sync service tests.

Mocks `httpx.AsyncClient` to verify the four scope-detection branches
and the items-batch happy/error paths without ever hitting Pinterest's
servers. Also verifies the scope cache + auto-invalidation on 403."""
from __future__ import annotations
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Ensure module imports cleanly
os.environ.setdefault("PUBLIC_SITE_URL", "https://craftersmarket.org")


def _mock_response(status_code: int, body: dict | None = None,
                   text: str | None = None):
    """Build a fake httpx.Response."""
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = body or {}
    r.text = text or ""
    return r


@pytest.fixture(autouse=True)
def _clear_scope_cache():
    """Reset module-level cache before each test."""
    from services import pinterest_catalog_sync as svc
    svc._SCOPE_CACHE.update({"checked_at": 0.0, "result": None})
    yield
    svc._SCOPE_CACHE.update({"checked_at": 0.0, "result": None})


@pytest.mark.asyncio
async def test_no_token_status(monkeypatch):
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "")
    from services.pinterest_catalog_sync import check_catalog_scope
    r = await check_catalog_scope(force=True)
    assert r["read"] is False
    assert r["write"] is False
    assert r["status"] == "no_token"


@pytest.mark.asyncio
async def test_200_with_catalogs_grants_both_scopes(monkeypatch):
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "tok_test")
    fake = _mock_response(200, {"items": [{"id": "cat_abc"}]})
    fake_get = AsyncMock(return_value=fake)
    client_cls = MagicMock()
    client_cls.return_value.__aenter__.return_value.get = fake_get
    with patch("services.pinterest_catalog_sync.httpx.AsyncClient", client_cls):
        from services.pinterest_catalog_sync import check_catalog_scope
        r = await check_catalog_scope(force=True)
    assert r["read"] is True
    assert r["write"] is True
    assert r["status"] == "ok"
    assert "1 catalog" in r["reason"]


@pytest.mark.asyncio
async def test_401_reports_expired(monkeypatch):
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "tok_expired")
    fake = _mock_response(401, {"message": "Authentication failed"})
    fake_get = AsyncMock(return_value=fake)
    client_cls = MagicMock()
    client_cls.return_value.__aenter__.return_value.get = fake_get
    with patch("services.pinterest_catalog_sync.httpx.AsyncClient", client_cls):
        from services.pinterest_catalog_sync import check_catalog_scope
        r = await check_catalog_scope(force=True)
    assert r["status"] == "expired"
    assert r["read"] is False


@pytest.mark.asyncio
async def test_403_scope_error(monkeypatch):
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "tok_noscope")
    fake = _mock_response(403, {"message": "Insufficient scope: catalogs:read"})
    fake_get = AsyncMock(return_value=fake)
    client_cls = MagicMock()
    client_cls.return_value.__aenter__.return_value.get = fake_get
    with patch("services.pinterest_catalog_sync.httpx.AsyncClient", client_cls):
        from services.pinterest_catalog_sync import check_catalog_scope
        r = await check_catalog_scope(force=True)
    assert r["status"] == "no_read_scope"
    assert r["read"] is False


@pytest.mark.asyncio
async def test_403_role_error(monkeypatch):
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "tok_norole")
    fake = _mock_response(403, {"message": "User does not have access"})
    fake_get = AsyncMock(return_value=fake)
    client_cls = MagicMock()
    client_cls.return_value.__aenter__.return_value.get = fake_get
    with patch("services.pinterest_catalog_sync.httpx.AsyncClient", client_cls):
        from services.pinterest_catalog_sync import check_catalog_scope
        r = await check_catalog_scope(force=True)
    # "access" doesn't contain "scope"/"permission"/"authorization" so role error
    assert r["status"] == "no_catalogs_role"


@pytest.mark.asyncio
async def test_push_items_batch_success(monkeypatch):
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "tok_full")
    fake = _mock_response(200, {"items": [{"item_id": "sku-1", "status": "success"}]})
    fake_post = AsyncMock(return_value=fake)
    client_cls = MagicMock()
    client_cls.return_value.__aenter__.return_value.post = fake_post
    with patch("services.pinterest_catalog_sync.httpx.AsyncClient", client_cls):
        from services.pinterest_catalog_sync import push_items_batch
        r = await push_items_batch([{"item_id": "sku-1",
                                     "attributes": {"price": "49.00 USD"}}])
    assert r["ok"] is True
    assert r["status_code"] == 200


@pytest.mark.asyncio
async def test_push_items_batch_no_write_scope(monkeypatch):
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "tok_nowrite")
    fake = _mock_response(403, {"message": "Missing catalogs:write scope"})
    fake_post = AsyncMock(return_value=fake)
    client_cls = MagicMock()
    client_cls.return_value.__aenter__.return_value.post = fake_post
    # Seed scope cache to verify it's invalidated on 403
    from services import pinterest_catalog_sync as svc
    svc._SCOPE_CACHE.update({"checked_at": 999999.0,
                             "result": {"read": True, "write": True, "status": "ok"}})
    with patch("services.pinterest_catalog_sync.httpx.AsyncClient", client_cls):
        from services.pinterest_catalog_sync import push_items_batch
        r = await push_items_batch([{"item_id": "sku-9",
                                     "attributes": {"price": "10 USD"}}])
    assert r["ok"] is False
    assert r["reason"] == "no_write_scope"
    # Scope cache was invalidated.
    assert svc._SCOPE_CACHE["result"] is None


@pytest.mark.asyncio
async def test_push_item_update_skips_when_no_attributes(monkeypatch):
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "tok_full")
    from services.pinterest_catalog_sync import push_item_update
    r = await push_item_update("sku-x")  # nothing to update
    assert r["ok"] is False
    assert "no attributes" in r["reason"]


@pytest.mark.asyncio
async def test_push_item_update_formats_price_and_availability(monkeypatch):
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "tok_full")
    captured: dict = {}
    fake = _mock_response(200, {"items": []})

    async def _capture_post(url, headers=None, json=None, **kw):  # noqa: A002
        captured["url"] = url
        captured["json"] = json
        return fake

    client_cls = MagicMock()
    client_cls.return_value.__aenter__.return_value.post = _capture_post
    with patch("services.pinterest_catalog_sync.httpx.AsyncClient", client_cls):
        from services.pinterest_catalog_sync import push_item_update
        r = await push_item_update("sku-1", price=49.5, availability="in stock",
                                   link="https://x/y")
    assert r["ok"] is True
    sent = captured["json"]["items"][0]
    assert sent["item_id"] == "sku-1"
    assert sent["attributes"]["price"] == "49.50 USD"
    assert sent["attributes"]["availability"] == "in stock"
    assert sent["attributes"]["link"] == "https://x/y"


@pytest.mark.asyncio
async def test_scope_cache_persists_between_calls(monkeypatch):
    monkeypatch.setenv("PINTEREST_ACCESS_TOKEN", "tok_x")
    fake = _mock_response(200, {"items": [{"id": "cat_1"}]})
    fake_get = AsyncMock(return_value=fake)
    client_cls = MagicMock()
    client_cls.return_value.__aenter__.return_value.get = fake_get
    with patch("services.pinterest_catalog_sync.httpx.AsyncClient", client_cls):
        from services.pinterest_catalog_sync import check_catalog_scope
        r1 = await check_catalog_scope(force=True)
        r2 = await check_catalog_scope()  # should hit cache
    assert r1 == r2
    # Only one HTTP call despite two checks.
    assert fake_get.call_count == 1
