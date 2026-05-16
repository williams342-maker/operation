"""Helpers for Stripe webhook signing secrets with a dual-secret
rotation window.

Standard flow:
  1. `STRIPE_WEBHOOK_SECRET` lives in env. Signature verifier uses it.

Rotation flow (admin clicks "Auto-rotate" in Admin → Secrets):
  1. We create a NEW Stripe webhook endpoint at the same URL with the
     same events. Stripe returns a fresh signing secret.
  2. The new secret is stored as a row in `db.secret_overrides` with
     `_id = "stripe_webhook_pending"`. The old endpoint stays live.
  3. Admin copies the new secret into env, redeploys.
  4. Verifier accepts BOTH the env secret and the pending override
     until admin clicks "Finalize" (which deletes the old endpoint
     and clears the override). This 24-72h overlap window prevents
     in-flight events from failing signature checks during deploy.

We never store the OLD secret in the override — env is the source of
truth for it. We only store the NEW secret until admin promotes it
to env and finalizes.
"""
from __future__ import annotations

import os
from typing import Optional

from core import db, logger


async def get_active_webhook_secrets(kind: str = "main") -> list[str]:
    """Return list of webhook secrets to attempt signature verification
    against, in priority order.

    `kind` is "main" (checkout webhook) or "connect" (Stripe Connect).
    For "main": env STRIPE_WEBHOOK_SECRET + any pending rotation.
    For "connect": env STRIPE_CONNECT_WEBHOOK_SECRET (falling back to
    STRIPE_WEBHOOK_SECRET) + any pending rotation.
    """
    secrets: list[str] = []
    if kind == "connect":
        env = (os.environ.get("STRIPE_CONNECT_WEBHOOK_SECRET")
               or os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()
    else:
        env = (os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()
    if env:
        secrets.append(env)

    # Pending rotation override (stored by /admin/secrets/stripe-webhook/rotate)
    override_id = "stripe_webhook_pending" if kind == "main" else "stripe_connect_webhook_pending"
    try:
        row = await db.secret_overrides.find_one({"_id": override_id}, {"new_secret": 1})
        if row and row.get("new_secret"):
            secrets.append(row["new_secret"])
    except Exception as e:
        logger.warning("[stripe_webhook_secrets] override lookup failed: %s", e)

    return secrets


def verify_with_secrets(payload: bytes, signature: str, secrets: list[str]):
    """Try each secret against `stripe.Webhook.construct_event`. Returns
    the constructed event on the first success, or raises the last
    exception if all fail.
    """
    import stripe as stripe_sdk
    last_err: Optional[Exception] = None
    for sec in secrets:
        try:
            return stripe_sdk.Webhook.construct_event(payload, signature, sec)
        except Exception as e:
            last_err = e
            continue
    if last_err:
        raise last_err
    raise RuntimeError("no webhook secrets configured")
