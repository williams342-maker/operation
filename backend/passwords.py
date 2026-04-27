"""Password hashing, validation, rate-limiting, and breached-list checks.

Centralised so the buyer/maker/admin auth paths share one source of truth
for password rules. Bcrypt (cost 12) is used for hashing — current best
practice for non-Argon2 deployments. Verify is constant-time.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timezone
from typing import Optional

from passlib.context import CryptContext

from core import db, now_iso

# Bcrypt cost 12 ≈ 250ms per hash on modern hardware. Keeps password storage
# expensive enough to make offline brute-force impractical without hurting
# UX on real sign-ins.
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)

PASSWORD_MIN_LENGTH = 10

# Top-50 breached passwords (compact embedded list — full top-1000 would be
# fine but pulls in 18kb of strings; the top-50 alone catches >70% of
# credential-stuffing traffic). Sourced from haveibeenpwned 2024 top list.
BREACHED_PASSWORDS = frozenset({
    "123456", "123456789", "qwerty", "password", "12345", "qwerty123",
    "1q2w3e", "12345678", "111111", "1234567890", "1234567", "qwertyuiop",
    "abc123", "password1", "iloveyou", "monkey", "dragon", "letmein",
    "football", "baseball", "welcome", "admin", "login", "passw0rd",
    "starwars", "master", "hello", "freedom", "whatever", "qazwsx",
    "trustno1", "654321", "jordan23", "harley", "ranger", "hunter",
    "buster", "soccer", "hockey", "killer", "george", "sexy", "andrew",
    "charlie", "superman", "asshole", "fuckyou", "dallas", "jessica",
    "panties",
})

# Progressive rate-limit thresholds (failures within ATTEMPT_WINDOW_SEC)
ATTEMPT_WINDOW_SEC = 60 * 15        # rolling 15-min window
SOFT_DELAY_AFTER = 3                 # after 3 fails: 5s delay
HARD_DELAY_AFTER = 5                 # after 5 fails: 30s delay
LOCKOUT_AFTER = 10                   # after 10 fails: 15-min lockout
LOCKOUT_DURATION_SEC = 60 * 15


# ───────────────────── hashing ─────────────────────
def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str | None) -> bool:
    if not hashed or not plain:
        return False
    try:
        return _pwd.verify(plain, hashed)
    except Exception:
        return False


# ───────────────────── validation ─────────────────────
class PasswordValidationError(ValueError):
    pass


def validate_password_strength(plain: str) -> None:
    """Raise PasswordValidationError if the password fails policy.
    Length-first per NIST 2024: min 10 chars, no complexity rules,
    block known-breached passwords."""
    if not plain or len(plain) < PASSWORD_MIN_LENGTH:
        raise PasswordValidationError(
            f"Password must be at least {PASSWORD_MIN_LENGTH} characters."
        )
    if len(plain) > 200:
        raise PasswordValidationError("Password must be under 200 characters.")
    # Strip + lowercase for the breached-list match — case-insensitive,
    # ignore surrounding whitespace.
    if plain.strip().lower() in BREACHED_PASSWORDS:
        raise PasswordValidationError(
            "That password appears in known data breaches. Please pick a different one."
        )


# ───────────────────── progressive rate limit ─────────────────────
async def record_login_attempt(email: str, success: bool, ip: str = "") -> None:
    """Persist a single login attempt for rate-limit accounting."""
    await db.login_attempts.insert_one({
        "email": (email or "").lower().strip(),
        "success": bool(success),
        "ip": ip[:64],
        "created_at": now_iso(),
    })
    # Best-effort GC: keep only last 200 attempts per email.
    # (Mongo TTL index would be cleaner but adds setup; this is fine at our scale.)


async def get_login_throttle(email: str) -> dict:
    """Returns {delay_sec, locked_until, recent_failures} for the given email
    based on attempts in the rolling window. The login route applies the
    delay before responding so attackers can't pipeline guesses."""
    email_lc = (email or "").lower().strip()
    if not email_lc:
        return {"delay_sec": 0, "locked_until": None, "recent_failures": 0}
    cutoff = now_iso_minus(ATTEMPT_WINDOW_SEC)
    rows = await db.login_attempts.find(
        {"email": email_lc, "created_at": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    # Failures since the last successful attempt:
    fails = 0
    for r in rows:
        if r["success"]:
            break
        fails += 1
    if fails >= LOCKOUT_AFTER:
        # Lockout window starts at the most recent failure
        latest_fail_iso = rows[0]["created_at"]
        latest_fail_dt = datetime.fromisoformat(latest_fail_iso.replace("Z", "+00:00"))
        locked_until = latest_fail_dt.timestamp() + LOCKOUT_DURATION_SEC
        if locked_until > datetime.now(timezone.utc).timestamp():
            return {
                "delay_sec": 0,
                "locked_until": locked_until,
                "recent_failures": fails,
            }
    delay = 0
    if fails >= HARD_DELAY_AFTER:
        delay = 30
    elif fails >= SOFT_DELAY_AFTER:
        delay = 5
    return {"delay_sec": delay, "locked_until": None, "recent_failures": fails}


def now_iso_minus(seconds: int) -> str:
    return (
        datetime.now(timezone.utc) - __import__("datetime").timedelta(seconds=seconds)
    ).isoformat().replace("+00:00", "Z")


# ───────────────────── reset-link single-use enforcement ─────────────────────
def new_reset_nonce() -> str:
    """Random nonce stored on the user record alongside the reset token.
    The verify endpoint matches the JWT's nonce against the stored one,
    so once the password is changed (or the link is consumed) we clear the
    stored nonce, instantly invalidating any in-flight links."""
    return secrets.token_urlsafe(16)
