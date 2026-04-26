"""Cloudflare R2 (S3-compatible) storage helper for product / asset uploads.

Public bucket model: every key under `products/` is publicly readable via
`{R2_PUBLIC_URL}/{key}`. We never serve images from the worker — we only use
the API to upload / delete and trust Cloudflare's CDN for reads.

Env (all required for live uploads):
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
  R2_BUCKET, R2_PUBLIC_URL
"""
from __future__ import annotations
import base64
import logging
import os
import re
import uuid
from typing import Optional

import boto3
from botocore.config import Config

logger = logging.getLogger(__name__)

R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.environ.get("R2_BUCKET", "")
R2_PUBLIC_URL = os.environ.get("R2_PUBLIC_URL", "").rstrip("/")

# https://<account>.r2.cloudflarestorage.com is the S3-API endpoint.
R2_ENDPOINT = (
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    if R2_ACCOUNT_ID else ""
)

ALLOWED_CONTENT_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}

# 3D model files for the @google/model-viewer
ALLOWED_MODEL_TYPES = {
    "model/gltf-binary": "glb",
    "model/gltf+json": "gltf",
    "application/octet-stream": "glb",   # browsers often send this for .glb
}

MAX_BYTES = 8 * 1024 * 1024          # 8 MB image cap
MAX_MODEL_BYTES = 50 * 1024 * 1024   # 50 MB .glb cap (high-poly support)


def is_configured() -> bool:
    return all([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
                R2_BUCKET, R2_PUBLIC_URL])


_client = None


def client():
    """Lazy boto3 client — avoids touching the network on import."""
    global _client
    if _client is None:
        if not is_configured():
            raise RuntimeError("R2 storage is not configured (missing env).")
        _client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=Config(
                signature_version="s3v4",
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )
    return _client


def public_url(key: str) -> str:
    return f"{R2_PUBLIC_URL}/{key.lstrip('/')}"


def upload_bytes(data: bytes, key: str, content_type: str,
                 cache_control: str = "public, max-age=31536000, immutable",
                 max_bytes: int = MAX_BYTES) -> str:
    """Upload raw bytes and return the public URL."""
    if len(data) > max_bytes:
        raise ValueError(f"File too large ({len(data)} bytes, max {max_bytes}).")
    client().put_object(
        Bucket=R2_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl=cache_control,
    )
    logger.info("r2: uploaded key=%s ct=%s size=%d", key, content_type, len(data))
    return public_url(key)


def upload_model_bytes(data: bytes, key_prefix: str,
                       filename: Optional[str] = None,
                       content_type: str = "model/gltf-binary") -> str:
    """Upload a .glb / .gltf model and return the public URL."""
    ct = (content_type or "").lower() or "model/gltf-binary"
    if ct not in ALLOWED_MODEL_TYPES:
        raise ValueError(f"Unsupported model type: {ct}")
    ext = ALLOWED_MODEL_TYPES[ct]
    # Force .glb extension if filename hints at it (octet-stream uploads)
    if filename and filename.lower().endswith(".glb"):
        ext = "glb"
        ct = "model/gltf-binary"
    elif filename and filename.lower().endswith(".gltf"):
        ext = "gltf"
        ct = "model/gltf+json"
    key = f"{key_prefix.rstrip('/')}/{uuid.uuid4().hex}.{ext}"
    return upload_bytes(data, key, ct, max_bytes=MAX_MODEL_BYTES)


_DATA_URL_RE = re.compile(r"^data:(?P<ct>[\w/+.\-]+);base64,(?P<b64>.+)$", re.DOTALL)


def upload_data_url(data_url: str, key_prefix: str) -> Optional[str]:
    """Decode a `data:image/...;base64,...` URL, upload to R2, return public URL.
    Returns None if the input is not a base64 data URL."""
    m = _DATA_URL_RE.match(data_url)
    if not m:
        return None
    ct = m.group("ct").lower()
    if ct not in ALLOWED_CONTENT_TYPES:
        raise ValueError(f"Unsupported image type: {ct}")
    raw = base64.b64decode(m.group("b64"), validate=False)
    ext = ALLOWED_CONTENT_TYPES[ct]
    key = f"{key_prefix.rstrip('/')}/{uuid.uuid4().hex}.{ext}"
    return upload_bytes(raw, key, ct)


def delete_key(key: str) -> None:
    """Best-effort delete (used when migrating / replacing images)."""
    try:
        client().delete_object(Bucket=R2_BUCKET, Key=key)
        logger.info("r2: deleted key=%s", key)
    except Exception as e:
        logger.warning("r2: delete failed for key=%s: %s", key, e)


def key_from_public_url(url: str) -> Optional[str]:
    if R2_PUBLIC_URL and url.startswith(R2_PUBLIC_URL + "/"):
        return url[len(R2_PUBLIC_URL) + 1:]
    return None
