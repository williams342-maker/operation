"""Optional accessors for Emergent-only integrations.

The public local dev environment does not always have the private
``emergentintegrations`` package. Import it only at feature runtime so the
FastAPI app can still start and non-AI/non-Emergent routes keep working.
"""
from __future__ import annotations

import importlib
from functools import lru_cache
from typing import Any

from fastapi import HTTPException

from core import logger

_WARNED: set[str] = set()


def _warn_once(feature: str, exc: Exception) -> None:
    if feature in _WARNED:
        return
    _WARNED.add(feature)
    logger.warning(
        "[emergentintegrations] unavailable; %s disabled locally: %s",
        feature,
        exc,
    )


@lru_cache(maxsize=1)
def _chat_module() -> Any | None:
    try:
        return importlib.import_module("emergentintegrations.llm.chat")
    except Exception as exc:
        _warn_once("Emergent AI/LLM features", exc)
        return None


@lru_cache(maxsize=1)
def _stripe_checkout_cls() -> Any | None:
    try:
        module = importlib.import_module("emergentintegrations.payments.stripe.checkout")
        return module.StripeCheckout
    except Exception as exc:
        _warn_once("Emergent Stripe webhook adapter", exc)
        return None


def get_llm_chat() -> tuple[Any, Any] | None:
    module = _chat_module()
    if module is None:
        return None
    return module.LlmChat, module.UserMessage


def get_multimodal_chat() -> tuple[Any, Any, Any | None, Any | None] | None:
    module = _chat_module()
    if module is None:
        return None
    return (
        module.LlmChat,
        module.UserMessage,
        getattr(module, "ImageContent", None),
        getattr(module, "FileContent", None),
    )


def get_stripe_checkout_cls() -> Any | None:
    return _stripe_checkout_cls()


def raise_emergent_unavailable(feature: str) -> None:
    logger.warning("[emergentintegrations] %s requested but package is unavailable", feature)
    raise HTTPException(
        status_code=503,
        detail=f"{feature} is unavailable in this local environment because emergentintegrations is not installed.",
    )

