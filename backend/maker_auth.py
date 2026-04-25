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


def issue_session_jwt(maker_slug: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": maker_slug,
        "email": email,
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
    return claims["sub"]
