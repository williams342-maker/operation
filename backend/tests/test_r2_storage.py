"""R2 storage helper unit tests — pure unit (no live R2 calls)."""
from __future__ import annotations
import base64
from unittest.mock import MagicMock, patch

import pytest

import r2_storage


RED_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
RED_PIXEL_DATA_URL = "data:image/png;base64," + base64.b64encode(RED_PIXEL_PNG).decode()


class TestUploadDataUrl:
    def test_decodes_and_uploads_png(self):
        m = MagicMock()
        with patch.object(r2_storage, "client", return_value=m), \
             patch.object(r2_storage, "is_configured", return_value=True), \
             patch.object(r2_storage, "R2_BUCKET", "test-bucket"), \
             patch.object(r2_storage, "R2_PUBLIC_URL", "https://cdn.example.com"):
            url = r2_storage.upload_data_url(
                RED_PIXEL_DATA_URL, key_prefix="products/test-maker"
            )
        assert url and url.startswith("https://cdn.example.com/products/test-maker/")
        assert url.endswith(".png")
        m.put_object.assert_called_once()
        kwargs = m.put_object.call_args.kwargs
        assert kwargs["Bucket"] == "test-bucket"
        assert kwargs["ContentType"] == "image/png"
        assert kwargs["Body"] == RED_PIXEL_PNG
        assert kwargs["Key"].startswith("products/test-maker/")

    def test_returns_none_for_non_data_url(self):
        assert r2_storage.upload_data_url("https://x.com/y.png", "products/x") is None

    def test_rejects_unsupported_type(self):
        bad = "data:application/pdf;base64," + base64.b64encode(b"hello").decode()
        with pytest.raises(ValueError, match="Unsupported"):
            r2_storage.upload_data_url(bad, "products/x")


class TestPublicUrlAndKey:
    def test_public_url_strips_leading_slash(self):
        with patch.object(r2_storage, "R2_PUBLIC_URL", "https://cdn.example.com"):
            assert r2_storage.public_url("/x/y.png") == "https://cdn.example.com/x/y.png"
            assert r2_storage.public_url("x/y.png") == "https://cdn.example.com/x/y.png"

    def test_key_from_public_url_roundtrip(self):
        with patch.object(r2_storage, "R2_PUBLIC_URL", "https://cdn.example.com"):
            assert r2_storage.key_from_public_url("https://cdn.example.com/a/b.png") == "a/b.png"
            assert r2_storage.key_from_public_url("https://other.com/a.png") is None


class TestUploadBytesSizeGuard:
    def test_rejects_oversize(self):
        with patch.object(r2_storage, "client") as cli, \
             patch.object(r2_storage, "is_configured", return_value=True):
            big = b"x" * (r2_storage.MAX_BYTES + 1)
            with pytest.raises(ValueError, match="too large"):
                r2_storage.upload_bytes(big, "k", "image/png")
            cli.assert_not_called()
