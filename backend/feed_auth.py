"""Per-channel feed auth (iter293).

HTTP Basic Auth credentials for catalog feeds that crawlers require login
for (Pinterest in particular — Meta and Google work fine without auth).

Storage: single Mongo doc per channel in `feed_auth_credentials`:
  {
    _id: "pinterest",
    username: "pinterest",                       # fixed, stable
    password_hash: "<bcrypt>",                   # what we actually compare
    password_plain: "<the password>",            # so admins can see/copy it
    rotated_at: iso8601,
    rotated_by: "admin@craftersmarket.org",
  }

Why store the plaintext alongside the hash:
  • Pinterest expects the admin to paste the password into their form.
  • Admins need to be able to read it back from the admin card (and rotate).
  • bcrypt-only would mean every rotation is the only chance to see the
    value — a footgun. The admin card is gated behind admin auth, the
    Mongo collection is internal, and the password is purely for
    authenticating Pinterest's crawler (not protecting any sensitive
    data — the underlying feed contents are already public).

Verification: constant-time comparison via `bcrypt.checkpw`.
"""
from __future__ import annotations

import secrets

import bcrypt

from core import db, logger, now_iso


COLLECTION = "feed_auth_credentials"

# Fixed username so admins don't have to copy two values into Pinterest's
# form — only the password rotates.
FIXED_USERNAME = "pinterest"


def _generate_password(length: int = 32) -> str:
    """URL-safe random — printable, no quoting hassles in form fields."""
    return secrets.token_urlsafe(length)[:length]


async def ensure_default(channel: str = "pinterest") -> dict:
    """Idempotent: returns the existing credential doc, or creates one
    with a freshly-generated password if none exists yet. Called on
    backend boot so the admin card is never empty."""
    doc = await db[COLLECTION].find_one({"_id": channel}, {"_id": 1})
    if doc:
        return await get(channel)
    return await rotate(channel, actor="system-bootstrap")


async def get(channel: str = "pinterest") -> dict:
    """Returns `{username, password, rotated_at, rotated_by}` or None.
    Plain password (the `password_plain` field) is included so the admin
    card can display it."""
    doc = await db[COLLECTION].find_one({"_id": channel})
    if not doc:
        return None
    return {
        "channel": channel,
        "username": doc.get("username") or FIXED_USERNAME,
        "password": doc.get("password_plain") or "",
        "rotated_at": doc.get("rotated_at"),
        "rotated_by": doc.get("rotated_by"),
    }


async def rotate(channel: str, *, actor: str = "admin") -> dict:
    """Generate a fresh password, persist hash+plain, return the new
    credentials. Idempotent in the sense that it always succeeds — every
    call produces a new password."""
    new_password = _generate_password()
    h = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("ascii")
    now = now_iso()
    await db[COLLECTION].update_one(
        {"_id": channel},
        {"$set": {
            "username":       FIXED_USERNAME,
            "password_hash":  h,
            "password_plain": new_password,
            "rotated_at":     now,
            "rotated_by":     actor,
        }},
        upsert=True,
    )
    logger.info("[feed_auth] rotated %s by %s", channel, actor)
    return {
        "channel": channel,
        "username": FIXED_USERNAME,
        "password": new_password,
        "rotated_at": now,
        "rotated_by": actor,
    }


async def verify(channel: str, username: str, password: str) -> bool:
    """Returns True iff the submitted creds match the stored hash.
    Constant-time comparison via bcrypt."""
    if not (channel and username and password):
        return False
    doc = await db[COLLECTION].find_one(
        {"_id": channel},
        {"_id": 0, "username": 1, "password_hash": 1},
    )
    if not doc:
        return False
    if (doc.get("username") or FIXED_USERNAME) != username:
        return False
    stored_hash = (doc.get("password_hash") or "").encode("ascii", errors="ignore")
    if not stored_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), stored_hash)
    except Exception:
        return False
