"""iter328 — Token-gated digital download delivery.

Mints + verifies short-lived HMAC tokens that grant a buyer access to
the digital files attached to a paid order. Tokens are scoped per
(session_id, file_id) and expire 30 days after the order is paid.

Why HMAC and not JWT?
  - Tokens go in URLs (emails, confirmation page). A bearer JWT would
    feel heavy + larger than needed for a single-purpose download.
  - HMAC keeps the secret on the server, lets the URL be ~80 chars,
    survives copy-paste, and is trivially revocable by rotating the
    secret if we ever need to.

Why 30 days?
  - Common SaaS norm for digital downloads + matches the existing
    Stripe receipt window.
  - The download row carries its own `expires_at`, so we can extend or
    shrink per-order without changing the global TTL.

Token shape (URL-safe):
    {payload}.{sig}
where payload = b64url("v1|{session_id}|{file_id}|{exp_unix}")
      sig     = b64url(HMAC-SHA256(secret, payload))
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time

# Reuse the same MAKER_AUTH_SECRET as the rest of the platform so we
# don't need a new env var. Tokens are single-purpose (only the
# download endpoint accepts them) so the shared secret is fine.
_SECRET_ENV = "MAKER_AUTH_SECRET"
DOWNLOAD_TTL_SECONDS = 30 * 24 * 3600  # 30 days


def _secret() -> bytes:
    val = os.environ.get(_SECRET_ENV)
    if not val:
        raise RuntimeError(f"{_SECRET_ENV} not set")
    return val.encode("utf-8")


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _b64url_dec(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def mint_download_token(
    session_id: str, file_id: str,
    expires_at_unix: int | None = None,
) -> tuple[str, int]:
    """Return `(token, expires_at_unix)`. Defaults expiry to NOW + 30d."""
    exp = int(expires_at_unix if expires_at_unix is not None
              else time.time() + DOWNLOAD_TTL_SECONDS)
    payload = f"v1|{session_id}|{file_id}|{exp}".encode("utf-8")
    sig = hmac.new(_secret(), payload, hashlib.sha256).digest()
    token = f"{_b64url(payload)}.{_b64url(sig)}"
    return token, exp


def verify_download_token(token: str) -> dict:
    """Validate a token. Returns `{session_id, file_id, exp}` on success.

    Raises ValueError on any tampering, malformed input, or expiry.
    """
    if not token or "." not in token:
        raise ValueError("Malformed token.")
    pay_b64, sig_b64 = token.split(".", 1)
    try:
        payload = _b64url_dec(pay_b64)
        sig = _b64url_dec(sig_b64)
    except Exception as e:
        raise ValueError(f"Malformed base64: {e}")
    expected = hmac.new(_secret(), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected):
        raise ValueError("Bad signature.")
    parts = payload.decode("utf-8", errors="replace").split("|")
    if len(parts) != 4 or parts[0] != "v1":
        raise ValueError("Unknown token version.")
    try:
        exp = int(parts[3])
    except ValueError:
        raise ValueError("Bad expiry.")
    if exp < time.time():
        raise ValueError("Token expired.")
    return {"session_id": parts[1], "file_id": parts[2], "exp": exp}
