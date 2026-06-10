"""Meta (Facebook) Marketing API gateway — LIVE.

Phase 1.5 implementation. Uses the same HTTP-only pattern as
`routers/meta_ads.py` (Graph API via httpx, no facebook_business SDK
needed) for consistency.

Approval gating: Meta separates read vs write at the OAuth SCOPE
level. Our existing OAuth grants `ads_read`. Real campaign creation
needs `ads_management` — which requires Meta App Review.

How the gating works in practice:
  1. After App Review approves `ads_management`, the admin updates
     `META_REQUEST_MANAGEMENT_SCOPE=true` in the env. The existing
     `routers/meta_ads.py` then includes `ads_management` in `SCOPES`.
  2. The admin reconnects Meta Ads → the new refresh token now
     carries the management scope.
  3. This gateway's `is_eligible` reads the granted scope list off
     the stored token and returns True only if `ads_management` is
     present.

Until that flag flips on, `is_eligible` returns the "pending App
Review" message — no surprises, no leaked SOAP errors.

SAFETY: campaigns land with `status=PAUSED`. Maker activates explicitly.
"""
from __future__ import annotations
import logging
import os
import re
from typing import Optional

import httpx

from core import db, now_iso
from .base import (
    AdsGateway, CreateCampaignSpec, CampaignHandle,
    GatewayError, GatewayNotEligible,
)

logger = logging.getLogger("crafters.promote.gateway.meta")

GRAPH_VERSION = os.environ.get("META_API_VERSION", "v20.0")
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"

MIN_DAILY_USD = 5
MAX_DAILY_USD = 200
CAMPAIGN_NAME_PREFIX = "CM"
REQUIRED_SCOPE = "ads_management"


def _clamp_daily_cents(cents: int) -> int:
    """Meta uses minor currency units (cents for USD). Clamp to the
    same [$5, $200] safety window as the other channels."""
    return int(max(MIN_DAILY_USD * 100, min(MAX_DAILY_USD * 100, int(cents or 0))))


def _trim(s: str, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


class MetaGateway(AdsGateway):
    channel = "meta"

    async def _get_creds(self) -> Optional[dict]:
        cred = await db.integration_credentials.find_one({"_id": "meta_ads"})
        if not cred or not cred.get("access_token"):
            return None
        return cred

    async def is_eligible(self, maker_slug: str) -> tuple[bool, str]:
        cred = await self._get_creds()
        if not cred:
            return (False, "Connect Meta Ads in Admin → Ads first.")

        ad_account = os.environ.get("META_AD_ACCOUNT_ID", "").strip()
        if not ad_account:
            return (False, "META_AD_ACCOUNT_ID env var missing.")
        if not ad_account.startswith("act_"):
            return (False, "META_AD_ACCOUNT_ID must start with 'act_'.")

        scope_raw = (cred.get("scope") or "")
        # Meta returns scopes as a comma- OR space-separated list.
        granted = set(re.split(r"[,\s]+", scope_raw.strip()))
        if REQUIRED_SCOPE not in granted:
            return (False,
                "Meta Ads write-access pending App Review for "
                "ads_management. After approval, set "
                "META_REQUEST_MANAGEMENT_SCOPE=true + reconnect Meta in "
                "Admin → Ads. Currently granted scopes: "
                f"{', '.join(sorted(s for s in granted if s)) or 'none'}.")

        return (True, "")

    async def create_campaign(self, spec: CreateCampaignSpec) -> CampaignHandle:
        ok, reason = await self.is_eligible(spec.maker_slug)
        if not ok:
            raise GatewayNotEligible(reason)

        cred = await self._get_creds()
        token = cred["access_token"]  # type: ignore[index]
        ad_account = os.environ["META_AD_ACCOUNT_ID"].strip()

        try:
            # 1. Campaign — PAUSED. Objective=OUTCOME_TRAFFIC sends
            # users to the listing landing page (cheapest goal that
            # still respects our URL-param attribution).
            async with httpx.AsyncClient(timeout=30) as http:
                campaign_id = await _create_campaign(
                    http, ad_account, token, spec,
                )
                adset_id = await _create_adset(
                    http, ad_account, token, campaign_id, spec,
                )
                creative_id = await _create_creative(
                    http, ad_account, token, spec,
                )
                ad_id = await _create_ad(
                    http, ad_account, token, adset_id, creative_id, spec,
                )
                logger.info("[meta.gateway] created campaign=%s adset=%s ad=%s",
                            campaign_id, adset_id, ad_id)
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "")[:300]
            logger.exception("[meta.gateway] create_campaign HTTP %s: %s",
                             e.response.status_code, body)
            raise GatewayError(f"Meta create failed ({e.response.status_code}): {body}")
        except Exception as e:
            logger.exception("[meta.gateway] create_campaign: %s", e)
            raise GatewayError(f"Meta create failed: {str(e)[:200]}")

        return CampaignHandle(
            channel=self.channel, external_id=campaign_id, status="paused",
            note="Created paused. Activate from Promote → Channels to start spending.",
        )

    async def pause_campaign(self, external_id: str) -> None:
        await self._set_status(external_id, "PAUSED")

    async def resume_campaign(self, external_id: str) -> None:
        await self._set_status(external_id, "ACTIVE")

    async def update_budget(self, external_id: str, daily_budget_cents: int) -> None:
        cred = await self._get_creds()
        if not cred:
            raise GatewayNotEligible("Meta Ads not connected.")
        token = cred["access_token"]
        clamped = _clamp_daily_cents(daily_budget_cents)
        # Find the adset for this campaign and update its daily_budget.
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.get(
                f"{GRAPH_BASE}/{external_id}/adsets",
                params={"access_token": token, "fields": "id"},
            )
            r.raise_for_status()
            adsets = r.json().get("data", [])
            for adset in adsets:
                await http.post(
                    f"{GRAPH_BASE}/{adset['id']}",
                    data={"access_token": token, "daily_budget": clamped},
                )

    async def _set_status(self, external_id: str, status: str) -> None:
        cred = await self._get_creds()
        if not cred:
            raise GatewayNotEligible("Meta Ads not connected.")
        token = cred["access_token"]
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.post(
                f"{GRAPH_BASE}/{external_id}",
                data={"access_token": token, "status": status},
            )
            r.raise_for_status()


# ── Graph API call helpers ────────────────────────────────────────────
async def _create_campaign(http: httpx.AsyncClient, ad_account: str,
                           token: str, spec: CreateCampaignSpec) -> str:
    r = await http.post(
        f"{GRAPH_BASE}/{ad_account}/campaigns",
        data={
            "access_token": token,
            "name": _trim(f"{CAMPAIGN_NAME_PREFIX} · {spec.maker_slug} · {spec.listing_slug}", 400),
            "objective": "OUTCOME_TRAFFIC",
            "status": "PAUSED",
            # Force Meta to bill us only when ads serve, never billable
            # advance: keeps the wallet predictable.
            "special_ad_categories": "[]",
            "buying_type": "AUCTION",
        },
    )
    r.raise_for_status()
    return r.json()["id"]


async def _create_adset(http: httpx.AsyncClient, ad_account: str, token: str,
                        campaign_id: str, spec: CreateCampaignSpec) -> str:
    """Minimal AdSet: USA-only, broad targeting, link-clicks optimization,
    daily budget from the per-listing allocation."""
    r = await http.post(
        f"{GRAPH_BASE}/{ad_account}/adsets",
        data={
            "access_token": token,
            "name": "Default",
            "campaign_id": campaign_id,
            "daily_budget": _clamp_daily_cents(spec.daily_budget_cents),
            "billing_event": "IMPRESSIONS",
            "optimization_goal": "LINK_CLICKS",
            "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
            "targeting": '{"geo_locations": {"countries": ["US"]}}',
            "status": "PAUSED",
        },
    )
    r.raise_for_status()
    return r.json()["id"]


async def _create_creative(http: httpx.AsyncClient, ad_account: str,
                           token: str, spec: CreateCampaignSpec) -> str:
    """Auto-derived link-ad creative.

    Per the Phase 1.5 spec (option 2a) we don't ask the maker for
    creative inputs — we pull title/description/image from the listing.

    iter349 — when the admin AI Ad-Creative Workshop pushes a draft,
    `spec.headlines[0]` carries the AI-chosen Meta headline (≤40 chars,
    used as `link_data.name`) and `spec.descriptions[0]` carries the
    AI-chosen Meta primary text (≤125 chars, used as `link_data.message`).
    When called from the allocator (no Workshop draft), we fall back to
    the listing title/description.

    Meta requires a Facebook Page ID for any link ad. We use the
    META_DEFAULT_PAGE_ID env var (the Crafters Market page) — every
    boosted listing posts as the platform Page, not as the individual
    maker. Phase 2 will let makers connect their own Page.
    """
    page_id = os.environ.get("META_DEFAULT_PAGE_ID", "").strip()
    if not page_id:
        raise GatewayError("META_DEFAULT_PAGE_ID env var required to create Meta ads.")

    ad_headline = (
        _trim(spec.headlines[0], 40) if spec.headlines and spec.headlines[0]
        else _trim(spec.listing_title, 40)
    )
    primary_text = (
        _trim(spec.descriptions[0], 125) if spec.descriptions and spec.descriptions[0]
        else _trim(spec.listing_description, 125)
    ) or "Handmade by independent artisans."
    base = spec.listing_url.rstrip("/")
    sep = "&" if "?" in base else "?"
    # Meta will substitute {{ad.id}} and we'll forward to checkout.
    link_url = f"{base}{sep}fbclid={{{{ad.id}}}}"

    payload = {
        "access_token": token,
        "name": _trim(f"{CAMPAIGN_NAME_PREFIX} · {spec.listing_slug} creative", 200),
        "object_story_spec": (
            '{"page_id": "' + page_id + '", '
            '"link_data": {'
                '"link": "' + link_url.replace('"', '\\"') + '", '
                '"message": "' + primary_text.replace('"', '\\"') + '", '
                '"name": "' + ad_headline.replace('"', '\\"') + '", '
                '"description": "Shop on Crafters Market", '
                '"call_to_action": {"type": "SHOP_NOW"}'
            '}}'
        ),
    }
    if spec.listing_image_url:
        # Meta accepts hosted image URLs via image_url on link_data.
        # Re-build the spec with image included.
        import json as _json
        oss = _json.loads(payload["object_story_spec"])
        oss["link_data"]["picture"] = spec.listing_image_url
        payload["object_story_spec"] = _json.dumps(oss)

    r = await http.post(
        f"{GRAPH_BASE}/{ad_account}/adcreatives",
        data=payload,
    )
    r.raise_for_status()
    return r.json()["id"]


async def _create_ad(http: httpx.AsyncClient, ad_account: str, token: str,
                     adset_id: str, creative_id: str,
                     spec: CreateCampaignSpec) -> str:
    r = await http.post(
        f"{GRAPH_BASE}/{ad_account}/ads",
        data={
            "access_token": token,
            "name": _trim(f"{CAMPAIGN_NAME_PREFIX} · {spec.listing_slug} ad", 200),
            "adset_id": adset_id,
            "creative": '{"creative_id": "' + creative_id + '"}',
            "status": "PAUSED",
        },
    )
    r.raise_for_status()
    return r.json()["id"]
