"""iter335.5 — External Ads Gateway interface.

Abstracts campaign-create / pause / resume / sync across Google, Meta,
Microsoft. The allocator only knows about `AdsGateway` — channel
specifics live in `microsoft.py`, `google.py`, `meta.py`.

Why this exists separately from `promote_allocator.py`:
  • Channel SDKs are bulky (bingads SOAP, google-ads protobuf, meta
    Marketing API) and import-time slow. Loading them lazily through
    the factory keeps boot + test runs fast.
  • Each channel needs its own monkey-patch surface for tests — easier
    when concrete adapters live in dedicated files.
"""
from __future__ import annotations
import logging
from typing import Literal

from services.ads_gateway.base import (
    AdsGateway, CreateCampaignSpec, CampaignHandle, MetricsSnapshot,
    GatewayError, GatewayNotEligible, GatewayNotImplemented,
)

log = logging.getLogger("crafters.promote.gateway")

Channel = Literal["microsoft", "google", "meta"]

_REGISTRY: dict[str, str] = {
    "microsoft": "services.ads_gateway.microsoft:MicrosoftGateway",
    "google":    "services.ads_gateway.google:GoogleGateway",
    "meta":      "services.ads_gateway.meta:MetaGateway",
}


def get_gateway(channel: str) -> AdsGateway:
    """Lazy-import the gateway for `channel`. Raises ValueError for
    unknown channels."""
    spec = _REGISTRY.get(channel)
    if not spec:
        raise ValueError(f"Unknown ad channel: {channel!r}")
    mod_path, cls_name = spec.split(":")
    import importlib
    mod = importlib.import_module(mod_path)
    return getattr(mod, cls_name)()


__all__ = [
    "AdsGateway", "CreateCampaignSpec", "CampaignHandle", "MetricsSnapshot",
    "GatewayError", "GatewayNotEligible", "GatewayNotImplemented",
    "get_gateway", "Channel",
]
