"""Abstract base for all external ad channel gateways."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


class GatewayError(RuntimeError): ...
class GatewayNotEligible(GatewayError):
    """The channel can't be used yet for this maker (missing OAuth,
    missing write scope, awaiting platform approval, etc.). The UI
    should surface `reason` directly to the maker."""

class GatewayNotImplemented(GatewayError):
    """Channel exists in the codebase as a stub — full implementation
    is pending external approval (Google brand verification, Meta App
    Review, etc.)."""


@dataclass
class CreateCampaignSpec:
    """Phase 1.5 — auto-derived from the listing (option 2a).

    `daily_budget_cents` comes from the allocator: per-listing
    allocated_cents divided across the 7-day boost window.

    iter348: `headlines` + `descriptions` are optional richer copy
    (typically from the admin AI Ad-Creative Workshop). When non-empty,
    the gateway uses them directly instead of auto-deriving 3 headlines
    from `listing_title`.
    """
    maker_slug: str
    listing_slug: str
    listing_title: str
    listing_description: str
    listing_url: str             # absolute https URL — final landing
    listing_image_url: Optional[str]
    daily_budget_cents: int
    keywords: list[str] = field(default_factory=list)
    headlines: list[str] = field(default_factory=list)
    descriptions: list[str] = field(default_factory=list)
    # iter355 — When the admin pushes a video creative from the AI
    # Workshop, `video_asset_path` is the local file on disk; the Meta
    # gateway will chunk-upload it to the `advideos` edge before
    # building a video ad creative. Channels that don't support video
    # (Google Search, Microsoft RSA) simply ignore these fields.
    video_asset_path: Optional[str] = None
    video_asset_mime: Optional[str] = None
    # Thumbnail for the video ad. Falls back to `listing_image_url`.
    video_thumbnail_url: Optional[str] = None


@dataclass
class CampaignHandle:
    """Opaque-ish identifier returned by `create_campaign`. Persisted
    in `external_ad_campaigns` so subsequent ops can look it up."""
    channel: str
    external_id: str             # e.g. Bing CampaignId, Google customer/campaign, Meta campaign_id
    status: str                  # "draft" | "paused" | "active" | "rejected"
    note: str = ""               # human-readable status hint for the UI


@dataclass
class MetricsSnapshot:
    spend_cents: int = 0
    clicks: int = 0
    impressions: int = 0
    conversions: int = 0


class AdsGateway:
    """Abstract contract every channel adapter must implement."""

    channel: str = ""

    async def is_eligible(self, maker_slug: str) -> tuple[bool, str]:
        """Returns `(eligible, reason)`. `eligible=False` blocks the UI
        toggle; the UI shows `reason` directly so makers know what to do
        next (e.g. "Connect Microsoft Ads in Admin → Ads first")."""
        raise NotImplementedError

    async def create_campaign(self, spec: CreateCampaignSpec) -> CampaignHandle:
        raise NotImplementedError

    async def pause_campaign(self, external_id: str) -> None:
        raise NotImplementedError

    async def resume_campaign(self, external_id: str) -> None:
        raise NotImplementedError

    async def update_budget(self, external_id: str, daily_budget_cents: int) -> None:
        raise NotImplementedError
