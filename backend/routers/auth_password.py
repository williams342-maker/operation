"""Unified password-auth endpoints (login, set, change, forgot, reset).

Works for buyer / maker / admin via the `role` claim on each request. Magic
links remain the default — these endpoints are an opt-in fallback for users
whose email delivery is unreliable.

Feature flags:
  - ENABLE_BUYER_PASSWORD_AUTH (default: true)
  - ENABLE_MAKER_PASSWORD_AUTH (default: true)
  - ENABLE_ADMIN_PASSWORD_AUTH (default: true) — flip OFF when email is healthy
    and you want admin-only magic-link/Google going forward.
"""
from __future__ import annotations
from config import env_get

import asyncio
import os
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from core import ADMIN_EMAILS, db, logger, now_iso
from email_service import _send, _shell
from maker_auth import (
    current_admin, current_buyer, current_maker_slug,
    issue_password_reset_token, issue_session_jwt,
    verify_password_reset_token,
)
from passwords import (
    PASSWORD_MIN_LENGTH, PasswordValidationError,
    get_login_throttle, hash_password, new_reset_nonce,
    record_login_attempt, validate_password_strength, verify_password,
)

router = APIRouter()

ENABLE_BUYER_PASSWORD_AUTH = env_get("ENABLE_BUYER_PASSWORD_AUTH", "true").lower() == "true"
ENABLE_MAKER_PASSWORD_AUTH = env_get("ENABLE_MAKER_PASSWORD_AUTH", "true").lower() == "true"
ENABLE_ADMIN_PASSWORD_AUTH = env_get("ENABLE_ADMIN_PASSWORD_AUTH", "true").lower() == "true"

# Password rotation policy — admin passwords must be rotated every N days.
# Set to 0 to disable enforcement. Default 30d per the platform security
# review. Buyers + makers are NOT forced to rotate (industry standard — NIST
# no longer recommends periodic rotation for end-users).
ADMIN_PASSWORD_ROTATION_DAYS = int(env_get("ADMIN_PASSWORD_ROTATION_DAYS", "30"))

Role = Literal["buyer", "maker", "admin"]


# ───────────────────── helpers: per-role lookup + writes ─────────────────────
async def _find_user_by_email(role: Role, email: str) -> Optional[dict]:
    email = email.lower().strip()
    if role == "buyer":
        return await db.community_users.find_one({"email": email}, {"_id": 0})
    if role == "maker":
        return await db.makers.find_one({"email": email}, {"_id": 0})
    if role == "admin":
        if email not in ADMIN_EMAILS:
            return None
        # Admin records live in their own collection (lazy upsert on first
        # password set). Magic-link admins don't need a record at all.
        return await db.admin_users.find_one({"email": email}, {"_id": 0})
    return None


async def _update_user(role: Role, email: str, fields: dict) -> None:
    email = email.lower().strip()
    coll = {
        "buyer": db.community_users,
        "maker": db.makers,
        "admin": db.admin_users,
    }[role]
    if role == "admin":
        await coll.update_one({"email": email}, {"$set": fields}, upsert=True)
    else:
        await coll.update_one({"email": email}, {"$set": fields})


def _flag_for(role: Role) -> bool:
    return {
        "buyer": ENABLE_BUYER_PASSWORD_AUTH,
        "maker": ENABLE_MAKER_PASSWORD_AUTH,
        "admin": ENABLE_ADMIN_PASSWORD_AUTH,
    }[role]


def _identity_from_user(role: Role, user: dict) -> tuple[str, str]:
    """Returns (subject, email) for the JWT — buyer uses user_id,
    maker uses slug, admin uses 'admin'."""
    email = user["email"]
    if role == "buyer":
        return user["user_id"], email
    if role == "maker":
        return user["slug"], email
    return "admin", email


def _session_version_for(role: Role, user: dict) -> int:
    return int(user.get("session_version", 0) or 0)


def password_rotation_status(role: Role, user: dict) -> dict:
    """Return `{required, days_since_change, days_until_required, policy_days}`
    for the rotation policy. Admin-only enforcement — buyers/makers always
    return `required=False`.

    Uses `last_password_change_at` → `password_set_at` fallback → now_iso()
    if neither exists (shouldn't happen for a row with a password_hash, but
    we default to "just rotated" so a legacy row doesn't lock anyone out).
    """
    if role != "admin" or ADMIN_PASSWORD_ROTATION_DAYS <= 0:
        return {
            "required": False,
            "days_since_change": 0,
            "days_until_required": None,
            "policy_days": ADMIN_PASSWORD_ROTATION_DAYS if role == "admin" else 0,
        }
    from datetime import datetime, timezone
    ts = user.get("last_password_change_at") or user.get("password_set_at")
    if not ts:
        # No password ever set — nothing to rotate. Shouldn't happen on a
        # successful login path, but belt + braces.
        return {
            "required": False,
            "days_since_change": 0,
            "days_until_required": ADMIN_PASSWORD_ROTATION_DAYS,
            "policy_days": ADMIN_PASSWORD_ROTATION_DAYS,
        }
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return {"required": False, "days_since_change": 0,
                "days_until_required": None,
                "policy_days": ADMIN_PASSWORD_ROTATION_DAYS}
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    age_days = (datetime.now(timezone.utc) - dt).days
    return {
        "required": age_days >= ADMIN_PASSWORD_ROTATION_DAYS,
        "days_since_change": age_days,
        "days_until_required": max(0, ADMIN_PASSWORD_ROTATION_DAYS - age_days),
        "policy_days": ADMIN_PASSWORD_ROTATION_DAYS,
    }


# ───────────────────── login ─────────────────────
class PasswordLoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)
    role: Role


@router.post("/auth/password/login")
async def password_login(payload: PasswordLoginIn):
    if not _flag_for(payload.role):
        raise HTTPException(403, "Password sign-in is disabled for this account type.")

    email = payload.email.lower().strip()

    # Progressive throttle BEFORE we even look up the user — also prevents
    # email-enumeration timing attacks since we sleep regardless of existence.
    throttle = await get_login_throttle(email)
    if throttle["locked_until"]:
        raise HTTPException(
            429,
            "Too many failed sign-in attempts. Please try again in 15 minutes "
            "or use the magic-link option below.",
        )
    if throttle["delay_sec"]:
        await asyncio.sleep(throttle["delay_sec"])

    user = await _find_user_by_email(payload.role, email)
    pw_hash = (user or {}).get("password_hash")
    ok = verify_password(payload.password, pw_hash)
    await record_login_attempt(email, ok)

    if not ok:
        # Generic message — don't leak whether email exists or password wrong
        raise HTTPException(401, "That email + password combination didn't work.")

    sub, em = _identity_from_user(payload.role, user)
    jwt_token = issue_session_jwt(sub, em, role=payload.role,
                                   session_version=_session_version_for(payload.role, user))
    # Update last_seen / last_login_at
    await _update_user(payload.role, em, {
        "last_seen": now_iso(),
        "last_login_at": now_iso(),
        "last_login_method": "password",
    })
    logger.info("[auth] password login · role=%s · email=%s", payload.role, em)
    rotation = password_rotation_status(payload.role, user)
    return {
        "token": jwt_token,
        "role": payload.role,
        "user": _public_user(payload.role, user),
        "requires_password_rotation": rotation["required"],
        "password_rotation": rotation,
    }


def _public_user(role: Role, user: dict) -> dict:
    """Strip the password_hash + reset nonce from any user dict returned to clients."""
    safe = {k: v for k, v in user.items() if k not in ("password_hash", "password_reset_nonce")}
    return safe


# ───────────────────── set/change own password (signed-in) ─────────────────────
class PasswordSetIn(BaseModel):
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=200)
    current_password: Optional[str] = None  # required if a password is already set


async def _set_password_for(role: Role, email: str, new_password: str, current_password: Optional[str]) -> None:
    user = await _find_user_by_email(role, email)
    if not user:
        raise HTTPException(404, "User not found.")
    has_existing = bool(user.get("password_hash"))
    if has_existing:
        if not current_password or not verify_password(current_password, user["password_hash"]):
            raise HTTPException(401, "Current password is incorrect.")
    try:
        validate_password_strength(new_password)
    except PasswordValidationError as e:
        raise HTTPException(400, str(e))
    await _update_user(role, email, {
        "password_hash": hash_password(new_password),
        "password_set_at": now_iso(),
        "last_password_change_at": now_iso(),
        "password_reset_nonce": "",  # invalidate any in-flight reset links
    })
    await db.audit_log.insert_one({
        "kind": "password_set",
        "role": role,
        "email": email,
        "had_existing": has_existing,
        "created_at": now_iso(),
    })
    logger.info("[auth] password set/changed · role=%s · email=%s", role, email)


@router.post("/auth/password/set/buyer")
async def buyer_password_set(payload: PasswordSetIn, claims: dict = Depends(current_buyer)):
    if not ENABLE_BUYER_PASSWORD_AUTH:
        raise HTTPException(403, "Buyer passwords are disabled.")
    await _set_password_for("buyer", claims["email"], payload.new_password, payload.current_password)
    return {"ok": True}


@router.post("/auth/password/set/maker")
async def maker_password_set(payload: PasswordSetIn, slug: str = Depends(current_maker_slug)):
    if not ENABLE_MAKER_PASSWORD_AUTH:
        raise HTTPException(403, "Maker passwords are disabled.")
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0, "email": 1})
    if not maker:
        raise HTTPException(404, "Maker not found.")
    await _set_password_for("maker", maker["email"], payload.new_password, payload.current_password)
    return {"ok": True}


@router.post("/auth/password/set/admin")
async def admin_password_set(payload: PasswordSetIn, claims: dict = Depends(current_admin)):
    if not ENABLE_ADMIN_PASSWORD_AUTH:
        raise HTTPException(403, "Admin passwords are disabled.")
    await _set_password_for("admin", claims["email"], payload.new_password, payload.current_password)
    return {"ok": True}


# ───────────────────── forgot password (public) ─────────────────────
class ForgotIn(BaseModel):
    email: EmailStr
    role: Role
    origin_url: str


def _build_reset_email(role: Role, link: str) -> str:
    label = {"buyer": "Crafters Market", "maker": "Crafters Market — Maker Portal",
             "admin": "Crafters Market — Admin"}[role]
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 24px'>"
        f"Click below to set a new password for your {label} account. "
        f"This link is valid for 30 minutes and can only be used once.</p>"
        f"<a href='{link}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:16px 28px;font-family:Impact,Arial Black,sans-serif;font-size:14px;"
        f"letter-spacing:0.18em;text-transform:uppercase;text-decoration:none'>Reset password →</a>"
        f"<p style='font-size:12px;color:#a3a3a3;word-break:break-all;margin-top:24px'>"
        f"<a href='{link}' style='color:#ff4500'>{link}</a></p>"
        "<p style='font-size:11px;color:#525252;margin-top:24px'>If you didn't request "
        "this, you can ignore this email — your password won't change.</p>"
    )
    return _shell("Password Reset.", "One click to set a new password.", body,
                  "Crafters Market password reset")


@router.post("/auth/password/forgot")
async def password_forgot(payload: ForgotIn, bg: BackgroundTasks):
    """Public — always returns 200 to prevent email enumeration. Sends a
    reset link only if the role+email actually exists and password auth is
    enabled for that role."""
    email = payload.email.lower().strip()
    if _flag_for(payload.role):
        user = await _find_user_by_email(payload.role, email)
        if user:
            nonce = new_reset_nonce()
            await _update_user(payload.role, email, {"password_reset_nonce": nonce})
            token = issue_password_reset_token(email, payload.role, used_at="")
            link = f"{payload.origin_url.rstrip('/')}/reset-password?token={token}&n={nonce}"
            html = _build_reset_email(payload.role, link)
            bg.add_task(_send, email, "Reset your Crafters Market password", html)
            logger.info("[auth] password reset link issued · role=%s · email=%s",
                        payload.role, email)
        else:
            logger.info("[auth] password reset requested for unknown %s=%s (silent)",
                        payload.role, email)
    return {"sent": True, "message": "If that email is registered, a reset link is on its way."}


# ───────────────────── reset password (token-gated) ─────────────────────
class ResetIn(BaseModel):
    token: str
    nonce: str = Field(min_length=4, max_length=64)
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=200)


@router.post("/auth/password/reset")
async def password_reset(payload: ResetIn):
    data = verify_password_reset_token(payload.token)
    email = data["email"]
    role: Role = data["role"]                   # type: ignore[assignment]

    if not _flag_for(role):
        raise HTTPException(403, "Password sign-in is disabled for this account type.")

    user = await _find_user_by_email(role, email)
    if not user:
        raise HTTPException(401, "Reset link is no longer valid.")

    stored_nonce = user.get("password_reset_nonce") or ""
    # Single-use enforcement: stored nonce must match URL nonce. After we
    # apply the password change we clear the stored nonce, instantly
    # invalidating any other in-flight link.
    if not stored_nonce or stored_nonce != payload.nonce:
        raise HTTPException(401, "Reset link has already been used or expired.")

    try:
        validate_password_strength(payload.new_password)
    except PasswordValidationError as e:
        raise HTTPException(400, str(e))

    # Bump session_version so any active JWTs from a possibly-compromised
    # account stop working. Bump force_signout_at too for audit.
    new_session_version = int(user.get("session_version", 0) or 0) + 1
    await _update_user(role, email, {
        "password_hash": hash_password(payload.new_password),
        "password_set_at": now_iso(),
        "last_password_change_at": now_iso(),
        "password_reset_nonce": "",
        "session_version": new_session_version,
    })
    await db.audit_log.insert_one({
        "kind": "password_reset_consumed",
        "role": role,
        "email": email,
        "created_at": now_iso(),
    })
    logger.info("[auth] password reset consumed · role=%s · email=%s", role, email)
    return {"ok": True, "message": "Password updated. Sign in with your new password."}


# ───────────────────── public capability flags ─────────────────────
@router.get("/auth/password/flags")
async def auth_password_flags():
    """Public — frontend reads to decide whether to show password forms."""
    return {
        "buyer_enabled": ENABLE_BUYER_PASSWORD_AUTH,
        "maker_enabled": ENABLE_MAKER_PASSWORD_AUTH,
        "admin_enabled": ENABLE_ADMIN_PASSWORD_AUTH,
        "min_length": PASSWORD_MIN_LENGTH,
        "apple_enabled": bool(
            (env_get("APPLE_SERVICE_ID") or "").strip()
            and (env_get("APPLE_REDIRECT_URI") or "").strip()
        ),
    }
