"""Magic-link + JWT auth for the Maker Portal.

- Magic link: itsdangerous URLSafeTimedSerializer, 15 min expiry, one purpose.
- Session: PyJWT HS256, 7 day expiry, claims = {sub: maker_slug, email}.
"""
import os
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import Header, HTTPException
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

SECRET = os.environ["MAKER_AUTH_SECRET"]
MAGIC_TTL_SECONDS = 60 * 15           # 15 minutes
SESSION_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days (buyers + makers)
ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24  # 24 hours (admins — tighter)
PASSWORD_RESET_TTL_SECONDS = 60 * 30   # 30 minutes for reset links

_serializer = URLSafeTimedSerializer(SECRET, salt="maker-magic-link")
_admin_serializer = URLSafeTimedSerializer(SECRET, salt="admin-magic-link")
_password_reset_serializer = URLSafeTimedSerializer(SECRET, salt="password-reset")


def issue_magic_token(email: str) -> str:
    return _serializer.dumps({"email": email.lower().strip()})


def verify_magic_token(token: str) -> str:
    try:
        data = _serializer.loads(token, max_age=MAGIC_TTL_SECONDS)
    except SignatureExpired:
        raise HTTPException(status_code=401, detail="Magic link expired — request a new one.")
    except BadSignature:
        raise HTTPException(status_code=401, detail="Invalid magic link.")
    return data["email"]


def issue_admin_magic_token(email: str) -> str:
    return _admin_serializer.dumps({"email": email.lower().strip()})


def verify_admin_magic_token(token: str) -> str:
    try:
        data = _admin_serializer.loads(token, max_age=MAGIC_TTL_SECONDS)
    except SignatureExpired:
        raise HTTPException(status_code=401, detail="Admin link expired — request a new one.")
    except BadSignature:
        raise HTTPException(status_code=401, detail="Invalid admin link.")
    return data["email"]


def issue_session_jwt(maker_slug: str, email: str, role: str = "maker", session_version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    ttl = ADMIN_SESSION_TTL_SECONDS if role == "admin" else SESSION_TTL_SECONDS
    payload = {
        "sub": maker_slug,
        "email": email,
        "role": role,
        "sv": session_version,  # bumped when admin force-signs-out a user → invalidates old JWTs
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
    }
    return jwt.encode(payload, SECRET, algorithm="HS256")


def decode_session_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session.")


async def current_maker_slug(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: returns the maker_slug from a valid Bearer JWT."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_session_jwt(token)
    if claims.get("role", "maker") != "maker":
        raise HTTPException(status_code=403, detail="Maker access required.")
    await _check_session_version("maker", claims)
    return claims["sub"]


async def current_admin(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: returns the JWT claims for an admin Bearer token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_session_jwt(token)
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    await _check_session_version("admin", claims)
    return claims


async def current_buyer(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: returns the JWT claims for a community buyer Bearer token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_session_jwt(token)
    if claims.get("role") != "buyer":
        raise HTTPException(status_code=403, detail="Buyer access required.")
    await _check_session_version("buyer", claims)
    return claims


async def _check_session_version(role: str, claims: dict) -> None:
    """If the user's stored session_version is HIGHER than the JWT's `sv`,
    the admin has force-signed-them-out — reject the JWT. We keep this in a
    single helper so all 3 role dependencies enforce it identically.
    Falls open silently if Mongo is briefly unavailable (don't lock everyone
    out of the site if the DB blips)."""
    try:
        from core import db
        email = (claims.get("email") or "").lower().strip()
        if not email:
            return
        coll = {
            "buyer": db.community_users,
            "maker": db.makers,
            "admin": db.admin_users,
        }[role]
        doc = await coll.find_one({"email": email}, {"session_version": 1, "_id": 0})
        if not doc:
            return
        stored = int(doc.get("session_version", 0) or 0)
        token_sv = int(claims.get("sv", 0) or 0)
        if stored > token_sv:
            raise HTTPException(401, "Your session was signed out by an admin. Please sign in again.")
    except HTTPException:
        raise
    except Exception:
        # Don't lock the site out on a transient DB issue.
        return


async def optional_buyer(authorization: str | None = Header(default=None)) -> dict | None:
    """Like `current_buyer` but returns None for unauthenticated requests
    instead of 401-ing. Use for endpoints whose response shape differs based
    on whether the caller is signed in (e.g. follow-status)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    try:
        token = authorization.split(" ", 1)[1].strip()
        claims = decode_session_jwt(token)
    except HTTPException:
        return None
    return claims if claims.get("role") == "buyer" else None


_buyer_serializer = URLSafeTimedSerializer(SECRET, salt="buyer-magic-link")


def issue_buyer_magic_token(email: str) -> str:
    return _buyer_serializer.dumps({"email": email.lower().strip()})


def verify_buyer_magic_token(token: str) -> str:
    try:
        data = _buyer_serializer.loads(token, max_age=MAGIC_TTL_SECONDS)
    except SignatureExpired:
        raise HTTPException(status_code=401, detail="Magic link expired — request a new one.")
    except BadSignature:
        raise HTTPException(status_code=401, detail="Invalid magic link.")
    return data["email"]


# ───────────────────── Password reset tokens ─────────────────────
def issue_password_reset_token(email: str, role: str, used_at: str = "") -> str:
    """Sign a password-reset token tied to a specific role + email.
    `used_at` is set after consumption — the verify side rejects any token
    whose payload's stored hash doesn't match the user record's reset-hash,
    enforcing single-use even before the 30-min expiry.
    """
    return _password_reset_serializer.dumps({
        "email": email.lower().strip(),
        "role": role,           # 'buyer' | 'maker' | 'admin'
        "nonce": __import__("secrets").token_urlsafe(8),
    })


def verify_password_reset_token(token: str) -> dict:
    """Returns {email, role, nonce} or raises 401."""
    try:
        data = _password_reset_serializer.loads(token, max_age=PASSWORD_RESET_TTL_SECONDS)
    except SignatureExpired:
        raise HTTPException(status_code=401, detail="Reset link expired — request a new one.")
    except BadSignature:
        raise HTTPException(status_code=401, detail="Invalid reset link.")
    return data
