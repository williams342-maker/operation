"""Cloudflare R2 (S3-compatible) storage helper for product / asset uploads.

Public bucket model: every key under `products/` is publicly readable via
`{R2_PUBLIC_URL}/{key}`. We never serve images from the worker — we only use
the API to upload / delete and trust Cloudflare's CDN for reads.

Env (all required for live uploads):
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
  R2_BUCKET, R2_PUBLIC_URL, R2_ENDPOINT
"""
from __future__ import annotations
import base64
import logging
import re
import uuid
from typing import Optional

import boto3
from botocore.config import Config

from config import env_get, settings

logger = logging.getLogger(__name__)


REQUIRED_R2_ENV_VARS = (
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_URL",
    "R2_ENDPOINT",
)


def _env(name: str) -> str:
    return env_get(name, "")


R2_ACCOUNT_ID = settings.r2_account_id
R2_ACCESS_KEY_ID = settings.r2_access_key_id
R2_SECRET_ACCESS_KEY = settings.r2_secret_access_key
R2_BUCKET = settings.r2_bucket
R2_PUBLIC_URL = settings.r2_public_url
R2_ENDPOINT = settings.r2_endpoint

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

# Showcase video uploads on listings.
ALLOWED_VIDEO_TYPES = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",   # iOS .mov uploads come through as quicktime
    "video/x-quicktime": "mov",
}

MAX_BYTES = 8 * 1024 * 1024          # 8 MB image cap
MAX_MODEL_BYTES = 50 * 1024 * 1024   # 50 MB .glb cap (high-poly support)
MAX_VIDEO_BYTES = 50 * 1024 * 1024   # 50 MB video cap (matches editor copy)


def missing_config_vars() -> list[str]:
    return [name for name in REQUIRED_R2_ENV_VARS if not _env(name)]


def any_configured() -> bool:
    return any(_env(name) for name in REQUIRED_R2_ENV_VARS)


def r2_required() -> bool:
    return settings.r2_required


def validate_config(required: bool | None = None) -> dict:
    """Validate R2 configuration loaded from the environment.

    R2 is required by default. Local development can opt into non-R2 storage
    with STORAGE_BACKEND=local. A partially configured R2 environment fails
    fast because uploads would otherwise fail later with less actionable boto3
    errors.
    """
    missing = missing_config_vars()
    configured = not missing
    partial = any_configured() and not configured
    must_configure = r2_required() if required is None else required
    if missing and (must_configure or partial):
        raise RuntimeError(
            "Cloudflare R2 storage configuration incomplete. "
            f"Missing required env vars: {', '.join(missing)}"
        )
    return {
        "configured": configured,
        "missing": missing,
        "bucket": R2_BUCKET,
        "endpoint": R2_ENDPOINT,
        "public_url": R2_PUBLIC_URL,
    }


def validate_startup_config() -> dict:
    return validate_config(required=None)


def is_configured() -> bool:
    return validate_config(required=False)["configured"]


_client = None


def client():
    """Lazy boto3 client — avoids touching the network on import."""
    global _client
    if _client is None:
        validate_config(required=True)
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


def presigned_get_url(key: str, expires_seconds: int = 300) -> str:
    """Short-lived signed GET URL — used for digital-product delivery so
    buyers never receive a long-lived direct storage path."""
    return client().generate_presigned_url(
        "get_object",
        Params={"Bucket": R2_BUCKET, "Key": key},
        ExpiresIn=expires_seconds,
    )


def download_bytes(key: str) -> bytes:
    """Download object bytes from R2 for verification and private workflows."""
    response = client().get_object(Bucket=R2_BUCKET, Key=key)
    return response["Body"].read()


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


def upload_video_bytes(data: bytes, key_prefix: str,
                       filename: Optional[str] = None,
                       content_type: str = "video/mp4") -> str:
    """Upload a listing showcase video (.mp4 / .webm / .mov) and return the
    public URL. We don't transcode — buyers' browsers will handle the codec.
    A future enhancement could pipe through Cloudflare Stream for adaptive
    bitrate, but R2 + native <video> is sufficient for short product videos.
    """
    ct = (content_type or "").lower() or "video/mp4"
    if ct not in ALLOWED_VIDEO_TYPES:
        # Browsers occasionally send blank or wonky mime types — fall back on extension.
        if filename:
            low = filename.lower()
            if low.endswith(".mp4"):
                ct = "video/mp4"
            elif low.endswith(".webm"):
                ct = "video/webm"
            elif low.endswith(".mov"):
                ct = "video/quicktime"
    if ct not in ALLOWED_VIDEO_TYPES:
        raise ValueError(f"Unsupported video type: {ct}")
    ext = ALLOWED_VIDEO_TYPES[ct]
    key = f"{key_prefix.rstrip('/')}/{uuid.uuid4().hex}.{ext}"
    # Shorter cache for videos so makers can iterate without burning new keys.
    return upload_bytes(
        data, key, ct,
        cache_control="public, max-age=86400",
        max_bytes=MAX_VIDEO_BYTES,
    )



# Community design-file uploads — shared library of DXF / SVG / STL / GLB /
# AI / EPS / PDF / ZIP / DWG / G-code / common image formats so makers AND
# buyers can both contribute. Multi-format bundles (one design, multiple
# format variants) are now supported via `variants[]` in design_files.
ALLOWED_DESIGN_FILE_TYPES = {
    "image/vnd.dxf":                   "dxf",
    "application/dxf":                 "dxf",
    "application/x-dxf":               "dxf",
    "image/x-dwg":                     "dwg",
    "application/acad":                "dwg",
    "application/x-acad":              "dwg",
    "application/autocad_dwg":         "dwg",
    "image/svg+xml":                   "svg",
    "model/stl":                       "stl",
    "application/vnd.ms-pki.stl":      "stl",
    "application/sla":                 "stl",
    "model/gltf-binary":               "glb",
    "model/gltf+json":                 "gltf",
    "application/postscript":          "ai",   # .ai / .eps share this
    "application/illustrator":         "ai",
    "application/pdf":                 "pdf",
    "application/zip":                 "zip",
    "application/x-zip-compressed":    "zip",
    # Raster preview images (so a design can ship its own thumbnail).
    "image/jpeg":                      "jpg",
    "image/png":                       "png",
    "image/webp":                      "webp",
    # G-code (machine instructions). Almost always served as text/plain or
    # octet-stream by the browser — we sniff the extension below.
    "text/x-gcode":                    "gcode",
    "application/octet-stream":        "bin",  # fallback; we sniff extension
}

# Extension → mime (used to sanitize browser-provided content-type for CAD
# files that often arrive as application/octet-stream).
_DESIGN_EXT_TO_CT = {
    "dxf":   "application/dxf",
    "dwg":   "image/x-dwg",
    "svg":   "image/svg+xml",
    "stl":   "model/stl",
    "glb":   "model/gltf-binary",
    "gltf":  "model/gltf+json",
    "ai":    "application/postscript",
    "eps":   "application/postscript",
    "pdf":   "application/pdf",
    "zip":   "application/zip",
    "jpg":   "image/jpeg",
    "jpeg":  "image/jpeg",
    "png":   "image/png",
    "webp":  "image/webp",
    "gcode": "text/x-gcode",
    "nc":    "text/x-gcode",  # Mach3 / Fanuc post-processor extension
    "tap":   "text/x-gcode",  # Some CAM packages export .tap
}

MAX_DESIGN_BYTES = 25 * 1024 * 1024  # 25 MB — CAD source files rarely exceed this.


def upload_design_file_bytes(data: bytes, key_prefix: str,
                             filename: str | None = None,
                             content_type: str = "") -> tuple[str, str]:
    """Upload a community design file (dxf/svg/stl/glb/ai/eps/pdf/zip).
    Returns `(public_url, extension)` so the caller can store the canonical
    file type in MongoDB for filtering.

    Falls back to extension-sniffing when the browser sends
    `application/octet-stream` — common for .dxf/.stl/.eps uploads.
    """
    ct = (content_type or "").lower().strip()
    # Try content-type first.
    ext = ALLOWED_DESIGN_FILE_TYPES.get(ct)
    # Fall back to file extension if content-type was missing/generic.
    if not ext or ext == "bin":
        if filename and "." in filename:
            guess = filename.rsplit(".", 1)[-1].lower().strip()
            if guess in _DESIGN_EXT_TO_CT:
                ext = guess
                ct = _DESIGN_EXT_TO_CT[guess]
    if not ext or ext == "bin":
        raise ValueError(
            "Unsupported file type. Allowed: DXF, SVG, STL, GLB/GLTF, AI, EPS, PDF, ZIP."
        )
    key = f"{key_prefix.rstrip('/')}/{uuid.uuid4().hex}.{ext}"
    url = upload_bytes(data, key, ct or _DESIGN_EXT_TO_CT.get(ext, "application/octet-stream"),
                       max_bytes=MAX_DESIGN_BYTES)
    return url, ext.upper()


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


def delete_key(key: str) -> bool:
    """Best-effort delete (used when migrating / replacing images)."""
    try:
        client().delete_object(Bucket=R2_BUCKET, Key=key)
        logger.info("r2: deleted key=%s", key)
        return True
    except Exception as e:
        logger.warning("r2: delete failed for key=%s: %s", key, e)
        return False


def key_from_public_url(url: str) -> Optional[str]:
    if R2_PUBLIC_URL and url.startswith(R2_PUBLIC_URL + "/"):
        return url[len(R2_PUBLIC_URL) + 1:]
    return None


def verify_storage_operations(prefix: str = "health/r2") -> dict:
    """Exercise upload, public URL generation, signed URL, download, and delete.

    This is intentionally opt-in so normal startup does not mutate the bucket.
    It is useful for deployment smoke checks and focused tests.
    """
    validate_config(required=True)
    key = f"{prefix.rstrip('/')}/{uuid.uuid4().hex}.txt"
    payload = b"crafters-market-r2-check"
    deleted = False
    try:
        url = upload_bytes(
            payload,
            key,
            "text/plain",
            cache_control="no-store",
            max_bytes=1024,
        )
        signed_url = presigned_get_url(key, expires_seconds=60)
        downloaded = download_bytes(key)
        deleted = delete_key(key)
        return {
            "key": key,
            "upload_ok": bool(url),
            "public_url": url,
            "public_url_ok": url == public_url(key),
            "signed_url_ok": bool(signed_url),
            "download_ok": downloaded == payload,
            "delete_ok": deleted,
        }
    finally:
        if not deleted:
            delete_key(key)
