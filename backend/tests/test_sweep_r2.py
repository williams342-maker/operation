"""R2 orphan sweeper smoke test — no live R2 calls."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from scripts import sweep_r2_orphans


@pytest.mark.asyncio
async def test_collect_referenced_keys_extracts_keys_from_images_and_model_url():
    """Given a fake DB cursor, the helper should pull keys from both images
    list and model_url field."""
    docs = [
        {"images": [
            "https://pub-xxx.r2.dev/products/maker-a/aaa.webp",
            "https://other-cdn.com/keep.jpg",   # not r2 → ignored
        ], "model_url": "https://pub-xxx.r2.dev/models/maker-a/m.glb"},
        {"images": [], "model_url": None},
    ]

    class _Cursor:
        def __aiter__(self):
            self._i = iter(docs)
            return self

        async def __anext__(self):
            try:
                return next(self._i)
            except StopIteration:
                raise StopAsyncIteration

    db = MagicMock()
    db.products.find.return_value = _Cursor()

    with patch.object(sweep_r2_orphans.r2_storage, "R2_PUBLIC_URL",
                      "https://pub-xxx.r2.dev"):
        refs = await sweep_r2_orphans.collect_referenced_keys(db)

    assert refs == {"products/maker-a/aaa.webp", "models/maker-a/m.glb"}


def test_dry_run_does_not_delete():
    """When `apply=False` the sweep MUST NOT call delete_object."""
    fake_cli = MagicMock()
    fake_cli.list_objects_v2.return_value = {
        "Contents": [{"Key": "products/m/orphan.webp"}],
        "IsTruncated": False,
    }
    with patch.object(sweep_r2_orphans.r2_storage, "is_configured", return_value=True), \
         patch.object(sweep_r2_orphans.r2_storage, "client", return_value=fake_cli), \
         patch.object(sweep_r2_orphans.r2_storage, "R2_BUCKET", "test"), \
         patch.object(sweep_r2_orphans, "collect_referenced_keys",
                      AsyncMock(return_value=set())), \
         patch("scripts.sweep_r2_orphans.AsyncIOMotorClient"):
        import asyncio
        res = asyncio.run(sweep_r2_orphans.sweep(apply=False))
    assert res["orphans"] == 3  # _list_keys_under scans all 3 PREFIXES (products/ models/ banners/), so list_objects_v2 fake fires 3x
    assert res["deleted"] == 0
    fake_cli.delete_object.assert_not_called()
