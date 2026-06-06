"""Google Ads gateway — STUB.

Real implementation is blocked on Google Ads brand verification
(application uses customer's Manager Account). Once approved, the
write path will use the `google-ads` Python SDK (already a transitive
dep of `googleapiclient`) to create Search campaigns.

The stub exists so the allocator dispatcher can be wired now — turning
this on becomes a 1-day implementation job once the developer-token's
basic-access flag flips to "approved".
"""
from __future__ import annotations
from .base import (
    AdsGateway, CreateCampaignSpec, CampaignHandle,
    GatewayNotImplemented,
)


class GoogleGateway(AdsGateway):
    channel = "google"

    _REASON = (
        "Google Ads write-access pending brand verification. The team has "
        "submitted; expected timeline 5–10 business days. Until then, "
        "boosts continue on Crafters Market itself."
    )

    async def is_eligible(self, maker_slug: str) -> tuple[bool, str]:
        return (False, self._REASON)

    async def create_campaign(self, spec: CreateCampaignSpec) -> CampaignHandle:
        raise GatewayNotImplemented(self._REASON)

    async def pause_campaign(self, external_id: str) -> None: ...
    async def resume_campaign(self, external_id: str) -> None: ...
    async def update_budget(self, external_id: str, daily_budget_cents: int) -> None: ...
