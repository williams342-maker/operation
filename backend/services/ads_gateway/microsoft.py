"""Microsoft (Bing) Ads gateway — LIVE.

Uses the same `bingads` Python SDK as `microsoft_ads_sdk.py` (which
already handles the OAuth + reporting pipeline). Campaign creation is
SOAP-heavy so we run it in a thread executor; the public coroutine
returns a `CampaignHandle` once Bing acknowledges the IDs.

Phase 1.5 strategy — SAFETY FIRST:
  • Newly-created campaigns ALWAYS land in `paused` state. The maker
    must explicitly activate from the Promote tab. This guarantees no
    accidental external spend the moment the channel toggle flips.
  • Daily budget is bounded — minimum $5/day (Bing's floor), maximum
    $200/day (our cap). Per-listing allocator output is clamped.
  • Ad copy is auto-derived from the listing per the Phase 1.5 spec
    (option 2a): title → headline, description → body, primary image
    → display URL only (Bing Search Ads don't support images directly
    — image-based ads live in the Microsoft Audience Network which we
    skip for v1).
  • Tracking template appended: `?msclkid={msclkid}` so the existing
    `payment_transactions.msclkid` attribution keeps working.

Limits per Bing's docs we encode:
  • ResponsiveSearchAd needs 3-15 Headlines (max 30 chars each) and
    2-4 Descriptions (max 90 chars each).
  • Each AdGroup needs at least 1 Keyword.

If the SDK rejects creation (rare — usually a malformed ad copy issue
slipped through), we raise `GatewayError` with the SOAP fault details
so the FE can show a useful toast.
"""
from __future__ import annotations
import asyncio
import logging
import os
import re
from typing import Optional

from core import db, now_iso
from .base import (
    AdsGateway, CreateCampaignSpec, CampaignHandle,
    GatewayError, GatewayNotEligible,
)

logger = logging.getLogger("crafters.promote.gateway.microsoft")

MIN_DAILY_USD = 5     # Bing's documented minimum
MAX_DAILY_USD = 200   # our cap
CAMPAIGN_NAME_PREFIX = "CM"  # so makers can find boosted campaigns in Bing UI


def _clamp_daily(cents: int) -> float:
    """Clamp to Bing's [$5, $200] window. Returns USD (Bing uses
    decimal account currency, not cents)."""
    d = (cents or 0) / 100.0
    return max(MIN_DAILY_USD, min(MAX_DAILY_USD, round(d, 2)))


def _trim(s: str, n: int) -> str:
    """Bing rejects ad text > N chars with a 'String value exceeds
    maximum length' fault. Pre-trim with ellipsis."""
    s = (s or "").strip()
    if len(s) <= n:
        return s
    return s[: n - 1].rstrip() + "…"


def _derive_keywords(spec: CreateCampaignSpec) -> list[str]:
    """If the spec didn't include keywords, derive ~5 from title words.
    Bing requires at least 1 per AdGroup."""
    if spec.keywords:
        return [k for k in spec.keywords if k][:20]
    title_words = re.findall(r"[A-Za-z0-9]+", spec.listing_title.lower())
    # Filter common stopwords (Bing penalizes too-generic keywords).
    STOP = {"a", "an", "and", "or", "the", "of", "for", "to", "in", "on",
            "with", "by", "from", "at"}
    words = [w for w in title_words if w not in STOP and len(w) > 2]
    # Build progressive phrases: ["custom", "custom sign", "custom sign metal"]
    phrases = []
    for i in range(1, min(4, len(words) + 1)):
        phrases.append(" ".join(words[:i]))
    seen = set()
    out = []
    for p in phrases + words:
        if p and p not in seen:
            seen.add(p)
            out.append(p)
        if len(out) >= 5:
            break
    return out or ["handmade"]


class MicrosoftGateway(AdsGateway):
    channel = "microsoft"

    async def is_eligible(self, maker_slug: str) -> tuple[bool, str]:
        """Gate on the same OAuth + customer/account IDs the read path
        uses. We don't gate per-maker because Bing campaigns live under
        a single managed Crafters Market account in v1 — every maker's
        boost campaigns are children of the platform's MCC."""
        cred = await db.integration_credentials.find_one({"_id": "microsoft_ads"})
        if not cred or not cred.get("refresh_token"):
            return (False, "Connect Microsoft Ads in Admin → Ads first.")
        cust = (cred.get("customer_id") or os.environ.get("BING_CUSTOMER_ID", "")).strip()
        acct = (cred.get("account_id") or os.environ.get("BING_ACCOUNT_ID", "")).strip()
        if not (cust and acct):
            return (False, "Microsoft Ads connected but BING_CUSTOMER_ID / BING_ACCOUNT_ID not set.")
        return (True, "")

    async def create_campaign(self, spec: CreateCampaignSpec) -> CampaignHandle:
        ok, reason = await self.is_eligible(spec.maker_slug)
        if not ok:
            raise GatewayNotEligible(reason)

        cred = await db.integration_credentials.find_one({"_id": "microsoft_ads"})
        refresh = cred["refresh_token"]
        customer_id = (cred.get("customer_id") or os.environ.get("BING_CUSTOMER_ID")).strip()
        account_id = (cred.get("account_id") or os.environ.get("BING_ACCOUNT_ID")).strip()

        loop = asyncio.get_running_loop()
        try:
            external_id = await loop.run_in_executor(
                None, _create_campaign_sync,
                spec, refresh, customer_id, account_id,
            )
        except Exception as e:
            logger.exception("[bing.gateway] create_campaign failed: %s", e)
            raise GatewayError(f"Bing create failed: {str(e)[:300]}")

        return CampaignHandle(
            channel=self.channel,
            external_id=str(external_id),
            status="paused",
            note="Created paused. Activate from Promote → Channels to start spending.",
        )

    async def pause_campaign(self, external_id: str) -> None:
        await self._set_status(external_id, "Paused")

    async def resume_campaign(self, external_id: str) -> None:
        await self._set_status(external_id, "Active")

    async def update_budget(self, external_id: str, daily_budget_cents: int) -> None:
        cred = await db.integration_credentials.find_one({"_id": "microsoft_ads"})
        if not cred:
            raise GatewayNotEligible("Microsoft Ads not connected.")
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None, _update_campaign_budget_sync,
            int(external_id), _clamp_daily(daily_budget_cents),
            cred["refresh_token"],
            (cred.get("customer_id") or os.environ.get("BING_CUSTOMER_ID")).strip(),
            (cred.get("account_id") or os.environ.get("BING_ACCOUNT_ID")).strip(),
        )

    async def _set_status(self, external_id: str, status: str) -> None:
        cred = await db.integration_credentials.find_one({"_id": "microsoft_ads"})
        if not cred:
            raise GatewayNotEligible("Microsoft Ads not connected.")
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None, _set_campaign_status_sync,
            int(external_id), status, cred["refresh_token"],
            (cred.get("customer_id") or os.environ.get("BING_CUSTOMER_ID")).strip(),
            (cred.get("account_id") or os.environ.get("BING_ACCOUNT_ID")).strip(),
        )


# ── SOAP thread-executor helpers ────────────────────────────────────────
def _auth_data(refresh_token: str, customer_id: str, account_id: str):
    """Build a primed AuthorizationData (refresh-token only — no
    user redirect)."""
    from bingads.authorization import (
        AuthorizationData, OAuthWebAuthCodeGrant,
    )
    auth = OAuthWebAuthCodeGrant(
        client_id=os.environ["BING_CLIENT_ID"],
        client_secret=os.environ["BING_CLIENT_SECRET"],
        redirection_uri=os.environ.get("BING_REDIRECT_URI", ""),
        env=os.environ.get("BING_ENVIRONMENT", "production"),
    )
    auth.request_oauth_tokens_by_refresh_token(refresh_token)
    return AuthorizationData(
        account_id=int(account_id),
        customer_id=int(customer_id),
        developer_token=os.environ["BING_DEVELOPER_TOKEN"],
        authentication=auth,
    )


def _create_campaign_sync(spec: CreateCampaignSpec, refresh_token: str,
                          customer_id: str, account_id: str) -> int:
    """Three SOAP calls in sequence: AddCampaigns → AddAdGroups → AddAds + AddKeywords.
    Returns the Bing CampaignId on success."""
    from bingads.service_client import ServiceClient
    from bingads import AuthorizationData  # noqa: F401  (re-export check)

    auth = _auth_data(refresh_token, customer_id, account_id)
    svc = ServiceClient(
        service="CampaignManagementService",
        version=13,
        authorization_data=auth,
        environment=os.environ.get("BING_ENVIRONMENT", "production"),
    )

    # 1. Campaign (paused, daily budget, US only).
    campaign = svc.factory.create("Campaign")
    campaign.Name = _trim(f"{CAMPAIGN_NAME_PREFIX} · {spec.maker_slug} · {spec.listing_slug}", 128)
    campaign.DailyBudget = _clamp_daily(spec.daily_budget_cents)
    campaign.BudgetType = "DailyBudgetStandard"
    campaign.Status = "Paused"   # SAFETY FIRST — never auto-spend
    campaign.TimeZone = "PacificTimeUSCanadaTijuana"
    campaign.Languages = {"string": ["English"]}
    # Tracking template — appends msclkid so checkout attribution works.
    base = spec.listing_url.rstrip("/")
    sep = "&" if "?" in base else "?"
    campaign.TrackingUrlTemplate = f"{{lpurl}}{sep}msclkid={{msclkid}}"
    campaigns = svc.factory.create("ArrayOfCampaign")
    campaigns.Campaign.append(campaign)
    resp = svc.AddCampaigns(AccountId=int(account_id), Campaigns=campaigns)
    cid = int(resp.CampaignIds["long"][0])

    # 2. AdGroup (single, broad-match keywords).
    ag = svc.factory.create("AdGroup")
    ag.Name = "Default"
    ag.StartDate = None
    ag.EndDate = None
    ag.Status = "Paused"
    ag.Language = "English"
    ad_groups = svc.factory.create("ArrayOfAdGroup")
    ad_groups.AdGroup.append(ag)
    ag_resp = svc.AddAdGroups(CampaignId=cid, AdGroups=ad_groups, ReturnInheritedBidStrategyTypes=False)
    agid = int(ag_resp.AdGroupIds["long"][0])

    # 3a. ResponsiveSearchAd (3 headlines + 2 descriptions auto-derived).
    title_short = _trim(spec.listing_title, 30)
    title_med   = _trim(f"Handmade: {spec.listing_title}", 30)
    title_cta   = _trim(f"Shop {spec.listing_title}", 30)
    desc_main = _trim(spec.listing_description, 90) or "Handmade by independent artisans on Crafters Market."
    desc_cta  = "Free shipping · Made in USA · Crafters Market"

    rsa = svc.factory.create("ResponsiveSearchAd")
    headlines = svc.factory.create("ArrayOfAssetLink")
    for txt in (title_short, title_med, title_cta):
        link = svc.factory.create("AssetLink")
        asset = svc.factory.create("TextAsset")
        asset.Text = txt
        asset.Name = txt[:50]
        asset.Type = "TextAsset"
        link.Asset = asset
        link.AssetPerformanceLabel = "None"
        headlines.AssetLink.append(link)
    rsa.Headlines = headlines

    descriptions = svc.factory.create("ArrayOfAssetLink")
    for txt in (desc_main, desc_cta):
        link = svc.factory.create("AssetLink")
        asset = svc.factory.create("TextAsset")
        asset.Text = txt
        asset.Name = txt[:50]
        asset.Type = "TextAsset"
        link.Asset = asset
        link.AssetPerformanceLabel = "None"
        descriptions.AssetLink.append(link)
    rsa.Descriptions = descriptions

    rsa.FinalUrls = {"string": [spec.listing_url]}
    rsa.Path1 = "shop"
    rsa.Path2 = _trim(re.sub(r"[^a-z0-9-]", "-", spec.listing_slug.lower())[:15], 15)
    rsa.Type = "ResponsiveSearchAd"
    rsa.Status = "Paused"
    ads = svc.factory.create("ArrayOfAd")
    ads.Ad.append(rsa)
    svc.AddAds(AdGroupId=agid, Ads=ads, ReturnInheritedBidStrategyTypes=False)

    # 3b. Keywords (broad-match by default).
    keywords = svc.factory.create("ArrayOfKeyword")
    for kw in _derive_keywords(spec):
        k = svc.factory.create("Keyword")
        k.Text = _trim(kw, 100)
        k.MatchType = "Broad"
        k.Status = "Paused"
        k.Bid = svc.factory.create("Bid")
        k.Bid.Amount = 0.50  # $0.50 default CPC — Bing auto-bids on top of this
        keywords.Keyword.append(k)
    svc.AddKeywords(AdGroupId=agid, Keywords=keywords, ReturnInheritedBidStrategyTypes=False)

    logger.info("[bing.gateway] created campaign cid=%s ag=%s for %s/%s daily=$%.2f",
                cid, agid, spec.maker_slug, spec.listing_slug,
                _clamp_daily(spec.daily_budget_cents))
    return cid


def _set_campaign_status_sync(cid: int, status: str, refresh_token: str,
                              customer_id: str, account_id: str) -> None:
    from bingads.service_client import ServiceClient
    auth = _auth_data(refresh_token, customer_id, account_id)
    svc = ServiceClient(
        service="CampaignManagementService", version=13,
        authorization_data=auth,
        environment=os.environ.get("BING_ENVIRONMENT", "production"),
    )
    campaign = svc.factory.create("Campaign")
    campaign.Id = int(cid)
    campaign.Status = status
    campaigns = svc.factory.create("ArrayOfCampaign")
    campaigns.Campaign.append(campaign)
    svc.UpdateCampaigns(AccountId=int(account_id), Campaigns=campaigns)


def _update_campaign_budget_sync(cid: int, daily_usd: float, refresh_token: str,
                                 customer_id: str, account_id: str) -> None:
    from bingads.service_client import ServiceClient
    auth = _auth_data(refresh_token, customer_id, account_id)
    svc = ServiceClient(
        service="CampaignManagementService", version=13,
        authorization_data=auth,
        environment=os.environ.get("BING_ENVIRONMENT", "production"),
    )
    campaign = svc.factory.create("Campaign")
    campaign.Id = int(cid)
    campaign.DailyBudget = daily_usd
    campaign.BudgetType = "DailyBudgetStandard"
    campaigns = svc.factory.create("ArrayOfCampaign")
    campaigns.Campaign.append(campaign)
    svc.UpdateCampaigns(AccountId=int(account_id), Campaigns=campaigns)
