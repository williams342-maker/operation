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
SESSION_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days

_serializer = URLSafeTimedSerializer(SECRET, salt="maker-magic-link")
_admin_serializer = URLSafeTimedSerializer(SECRET, salt="admin-magic-link")


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


def issue_session_jwt(maker_slug: str, email: str, role: str = "maker") -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": maker_slug,
        "email": email,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=SESSION_TTL_SECONDS)).timestamp()),
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
    return claims["sub"]


async def current_admin(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: returns the JWT claims for an admin Bearer token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_session_jwt(token)
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return claims


async def current_buyer(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: returns the JWT claims for a community buyer Bearer token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_session_jwt(token)
    if claims.get("role") != "buyer":
        raise HTTPException(status_code=403, detail="Buyer access required.")
    return claims


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
