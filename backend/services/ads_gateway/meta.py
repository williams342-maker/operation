"""Meta Marketing API gateway — STUB.

Blocked on Meta App Review for the `ads_management` permission. The
read-only `ads_read` scope we already have is enough for ROAS
attribution (which uses Meta's Conversions API → orders matching) but
not enough to programmatically CREATE campaigns / adsets / ads.

Real implementation will use `facebook_business` SDK (a few hundred
lines) once App Review approves the scope upgrade.
"""
from __future__ import annotations
from .base import (
    AdsGateway, CreateCampaignSpec, CampaignHandle,
    GatewayNotImplemented,
)


class MetaGateway(AdsGateway):
    channel = "meta"

    _REASON = (
        "Meta write-access pending App Review for ads_management scope. "
        "We've submitted; Meta's review window is typically 2–4 weeks. "
        "Until then, boosts continue on Crafters Market itself."
    )

    async def is_eligible(self, maker_slug: str) -> tuple[bool, str]:
        return (False, self._REASON)

    async def create_campaign(self, spec: CreateCampaignSpec) -> CampaignHandle:
        raise GatewayNotImplemented(self._REASON)

    async def pause_campaign(self, external_id: str) -> None: ...
    async def resume_campaign(self, external_id: str) -> None: ...
    async def update_budget(self, external_id: str, daily_budget_cents: int) -> None: ...
