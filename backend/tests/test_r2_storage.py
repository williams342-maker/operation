"""R2 storage helper unit tests — pure unit (no live R2 calls)."""
from __future__ import annotations
import base64
import importlib
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

R2_ENV = {
    "R2_ACCOUNT_ID": "acct",
    "R2_ACCESS_KEY_ID": "access",
    "R2_SECRET_ACCESS_KEY": "secret",
    "R2_BUCKET": "bucket",
    "R2_PUBLIC_URL": "https://cdn.example.com",
    "R2_ENDPOINT": "https://acct.r2.cloudflarestorage.com",
}


def _reload_r2(monkeypatch, values):
    for name in tuple(r2_storage.REQUIRED_R2_ENV_VARS) + (
        "CONFIG_SKIP_ENV_FILE", "R2_REQUIRED", "STORAGE_BACKEND", "APP_ENV", "ENVIRONMENT", "NODE_ENV",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CONFIG_SKIP_ENV_FILE", "true")
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    import config
    importlib.reload(config)
    return importlib.reload(r2_storage)


class TestR2Configuration:
    def test_missing_all_r2_env_fails_in_production_by_default(self, monkeypatch):
        module = _reload_r2(monkeypatch, {"APP_ENV": "production"})
        with pytest.raises(RuntimeError, match="R2_ACCOUNT_ID"):
            module.validate_startup_config()

    def test_missing_all_r2_env_is_allowed_for_explicit_local_storage(self, monkeypatch):
        module = _reload_r2(monkeypatch, {"STORAGE_BACKEND": "local"})
        status = module.validate_startup_config()
        assert status["configured"] is False
        assert "R2_ENDPOINT" in status["missing"]

    def test_partial_r2_env_fails_with_clear_missing_vars(self, monkeypatch):
        module = _reload_r2(monkeypatch, {"R2_ACCOUNT_ID": "acct"})
        with pytest.raises(RuntimeError, match="Cloudflare R2 storage configuration incomplete") as exc:
            module.validate_startup_config()
        assert "R2_ACCESS_KEY_ID" in str(exc.value)
        assert "R2_ENDPOINT" in str(exc.value)

    def test_required_r2_env_fails_when_missing(self, monkeypatch):
        module = _reload_r2(monkeypatch, {"R2_REQUIRED": "true"})
        with pytest.raises(RuntimeError, match="R2_ACCOUNT_ID"):
            module.validate_startup_config()

    def test_endpoint_is_read_from_env(self, monkeypatch):
        module = _reload_r2(monkeypatch, R2_ENV)
        status = module.validate_startup_config()
        assert status["configured"] is True
        assert module.R2_ENDPOINT == "https://acct.r2.cloudflarestorage.com"


class _Body:
    def __init__(self, data):
        self.data = data

    def read(self):
        return self.data


class _FakeR2Client:
    def __init__(self):
        self.objects = {}
        self.deleted = []

    def put_object(self, **kwargs):
        self.objects[kwargs["Key"]] = kwargs["Body"]

    def get_object(self, **kwargs):
        return {"Body": _Body(self.objects[kwargs["Key"]])}

    def delete_object(self, **kwargs):
        self.deleted.append(kwargs["Key"])
        self.objects.pop(kwargs["Key"], None)

    def generate_presigned_url(self, *_args, **_kwargs):
        return "https://signed.example.com/download"


class TestR2Operations:
    def test_upload_download_delete_signed_and_public_url_generation(self, monkeypatch):
        module = _reload_r2(monkeypatch, R2_ENV)
        fake = _FakeR2Client()
        monkeypatch.setattr(module, "_client", fake)

        result = module.verify_storage_operations(prefix="tests/r2")

        assert result["upload_ok"] is True
        assert result["public_url_ok"] is True
        assert result["signed_url_ok"] is True
        assert result["download_ok"] is True
        assert result["delete_ok"] is True
        assert result["key"].startswith("tests/r2/")
        assert result["key"] in fake.deleted
