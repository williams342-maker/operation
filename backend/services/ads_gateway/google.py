"""Google Ads gateway — LIVE.

Phase 1.5 implementation. Uses the `google-ads` Python SDK (already a
pinned dep — see requirements.txt) and the same OAuth refresh token
the existing read-only `routers/google_ads.py` already persists.

Approval gating: Google's `https://www.googleapis.com/auth/adwords`
scope already grants both read AND write — there's no scope upgrade.
The gating mechanism is Google's *developer token tier*:
  • Test access (default after API approval)   → read works on real
    accounts; writes work only on test accounts.
  • Basic access (after brand verification)    → read + write on real
    accounts, with daily quota caps.
  • Standard access (after Basic + good faith) → no quota caps.

So `is_eligible` works by attempting a `validate_only=True` mutate
call. If Google returns PERMISSION_DENIED with the "developer token
not approved" error, we surface the message verbatim. Once your
brand verification approval lands, this same code path becomes LIVE
without any deploy — the only thing that changed is Google's
server-side approval flag.

SAFETY: like the Microsoft adapter, every campaign lands in PAUSED
state. Maker explicitly clicks Activate (which flips status to
ENABLED) before any real spend.
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

logger = logging.getLogger("crafters.promote.gateway.google")

MIN_DAILY_USD = 5
MAX_DAILY_USD = 200
CAMPAIGN_NAME_PREFIX = "CM"


def _clamp_daily_micros(cents: int) -> int:
    """Google Ads uses 'micros' (= 1/1,000,000 of account currency).
    $5/day = 5_000_000 micros. Clamp to our [$5, $200] safety window."""
    d = (cents or 0) / 100.0
    d = max(MIN_DAILY_USD, min(MAX_DAILY_USD, d))
    return int(round(d * 1_000_000))


def _trim(s: str, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _derive_keywords(spec: CreateCampaignSpec) -> list[str]:
    """Same algorithm as the Microsoft adapter — stay consistent so
    cross-channel ROAS comparisons are apples-to-apples."""
    if spec.keywords:
        return [k for k in spec.keywords if k][:20]
    words = re.findall(r"[A-Za-z0-9]+", spec.listing_title.lower())
    STOP = {"a","an","and","or","the","of","for","to","in","on","with","by","from","at"}
    words = [w for w in words if w not in STOP and len(w) > 2]
    phrases = [" ".join(words[:i]) for i in range(1, min(4, len(words) + 1))]
    seen, out = set(), []
    for p in phrases + words:
        if p and p not in seen:
            seen.add(p); out.append(p)
        if len(out) >= 5: break
    return out or ["handmade"]


def _make_client():
    """Build a google-ads client from env + persisted refresh_token.
    Returns `None` if any required piece is missing — the caller's
    `is_eligible` translates that into a user-facing reason."""
    cred = None
    # Sync-friendly cred lookup is done in the calling coroutine; here
    # we just expect env vars + a refresh_token already in scope.
    refresh_token = os.environ.get("_GOOGLE_REFRESH_TOKEN_CACHE")  # set by adapter
    if not refresh_token:
        return None
    from google.ads.googleads.client import GoogleAdsClient
    return GoogleAdsClient.load_from_dict({
        "developer_token": os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN", ""),
        "client_id": os.environ.get("GOOGLE_ADS_CLIENT_ID", ""),
        "client_secret": os.environ.get("GOOGLE_ADS_CLIENT_SECRET", ""),
        "refresh_token": refresh_token,
        "login_customer_id": (
            os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "") or ""
        ).replace("-", ""),
        "use_proto_plus": True,
    })


class GoogleGateway(AdsGateway):
    channel = "google"

    async def _get_creds(self) -> Optional[tuple[str, str]]:
        """Pull (refresh_token, customer_id) from the integration row
        the existing read-only OAuth flow persists."""
        cred = await db.integration_credentials.find_one({"_id": "google_ads"})
        if not cred or not cred.get("refresh_token"):
            return None
        customer_id = (
            cred.get("customer_id")
            or os.environ.get("GOOGLE_ADS_CUSTOMER_ID", "")
        ).replace("-", "").strip()
        if not customer_id:
            return None
        return (cred["refresh_token"], customer_id)

    async def is_eligible(self, maker_slug: str) -> tuple[bool, str]:
        """Confirm: (1) OAuth row exists, (2) env vars present,
        (3) developer-token tier permits writes. The last check is a
        dry-run validate_only mutate that costs nothing but surfaces
        the right error if approval hasn't landed yet."""
        creds = await self._get_creds()
        if not creds:
            return (False, "Connect Google Ads in Admin → Ads first.")
        missing = [
            k for k in ("GOOGLE_ADS_DEVELOPER_TOKEN",
                        "GOOGLE_ADS_CLIENT_ID",
                        "GOOGLE_ADS_CLIENT_SECRET")
            if not os.environ.get(k)
        ]
        if missing:
            return (False, f"Missing Google env vars: {', '.join(missing)}")

        refresh_token, customer_id = creds
        loop = asyncio.get_running_loop()
        try:
            err = await loop.run_in_executor(
                None, _probe_write_access_sync, refresh_token, customer_id,
            )
        except Exception as e:
            return (False, f"Google probe failed: {str(e)[:160]}")
        if err:
            return (False, err)
        return (True, "")

    async def create_campaign(self, spec: CreateCampaignSpec) -> CampaignHandle:
        ok, reason = await self.is_eligible(spec.maker_slug)
        if not ok:
            raise GatewayNotEligible(reason)
        creds = await self._get_creds()
        refresh_token, customer_id = creds  # type: ignore[misc]
        loop = asyncio.get_running_loop()
        try:
            resource_name = await loop.run_in_executor(
                None, _create_campaign_sync, spec, refresh_token, customer_id,
            )
        except Exception as e:
            logger.exception("[google.gateway] create_campaign: %s", e)
            raise GatewayError(f"Google create failed: {str(e)[:300]}")
        # Extract numeric campaign ID from `customers/{cid}/campaigns/{id}`.
        external_id = resource_name.split("/")[-1]
        return CampaignHandle(
            channel=self.channel, external_id=external_id, status="paused",
            note="Created paused. Activate from Promote → Channels to start spending.",
        )

    async def pause_campaign(self, external_id: str) -> None:
        await self._set_status(external_id, "PAUSED")

    async def resume_campaign(self, external_id: str) -> None:
        await self._set_status(external_id, "ENABLED")

    async def update_budget(self, external_id: str, daily_budget_cents: int) -> None:
        creds = await self._get_creds()
        if not creds:
            raise GatewayNotEligible("Google Ads not connected.")
        refresh_token, customer_id = creds
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None, _update_budget_sync,
            int(external_id), _clamp_daily_micros(daily_budget_cents),
            refresh_token, customer_id,
        )

    async def _set_status(self, external_id: str, status: str) -> None:
        creds = await self._get_creds()
        if not creds:
            raise GatewayNotEligible("Google Ads not connected.")
        refresh_token, customer_id = creds
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None, _set_status_sync,
            int(external_id), status, refresh_token, customer_id,
        )


# ── google-ads SDK thread-executor helpers ─────────────────────────────
def _build_client_sync(refresh_token: str, customer_id: str):
    """Synchronous client construction — called inside the executor."""
    from google.ads.googleads.client import GoogleAdsClient
    login_cust = (os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "")
                  or customer_id).replace("-", "")
    return GoogleAdsClient.load_from_dict({
        "developer_token": os.environ["GOOGLE_ADS_DEVELOPER_TOKEN"],
        "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": refresh_token,
        "login_customer_id": login_cust,
        "use_proto_plus": True,
    })


def _probe_write_access_sync(refresh_token: str, customer_id: str) -> Optional[str]:
    """Returns None if write-access is granted, else a human-readable
    reason string. Uses `validate_only=True` so nothing is created."""
    try:
        client = _build_client_sync(refresh_token, customer_id)
        svc = client.get_service("CampaignBudgetService")
        op = client.get_type("CampaignBudgetOperation")
        budget = op.create
        budget.name = "CM probe (validate_only)"
        budget.amount_micros = 5_000_000
        budget.delivery_method = client.enums.BudgetDeliveryMethodEnum.STANDARD
        # iter413z — google-ads 30.x removed `validate_only` as a kwarg
        # on `mutate_campaign_budgets()`; it lives on the request object
        # now. Pre-30 the kwarg form worked. Build the request first,
        # then pass `request=...` so the call works across both shapes.
        request = client.get_type("MutateCampaignBudgetsRequest")
        request.customer_id = customer_id
        request.operations.append(op)
        request.validate_only = True
        svc.mutate_campaign_budgets(request=request)
        return None
    except Exception as e:
        msg = str(e).lower()
        if "developer token" in msg and ("not approved" in msg or "pending" in msg):
            return ("Google Ads developer token still in Test access — "
                    "submit for Basic access in the Google Ads API Center.")
        if "permission_denied" in msg or "user_permission_denied" in msg:
            return ("Google Ads denied write access. Confirm your developer "
                    "token has Basic access and the OAuth user can manage "
                    f"customer {customer_id}.")
        return f"Google write probe failed: {str(e)[:200]}"


def _create_campaign_sync(spec: CreateCampaignSpec, refresh_token: str,
                          customer_id: str) -> str:
    """Creates Budget → Campaign (PAUSED) → AdGroup → RSA → Keywords.
    Returns the campaign's full resource_name."""
    client = _build_client_sync(refresh_token, customer_id)

    # 1. Budget
    budget_svc = client.get_service("CampaignBudgetService")
    budget_op = client.get_type("CampaignBudgetOperation")
    budget = budget_op.create
    budget.name = _trim(
        f"{CAMPAIGN_NAME_PREFIX} · {spec.maker_slug} · {spec.listing_slug} budget", 255
    )
    budget.amount_micros = _clamp_daily_micros(spec.daily_budget_cents)
    budget.delivery_method = client.enums.BudgetDeliveryMethodEnum.STANDARD
    budget_resp = budget_svc.mutate_campaign_budgets(
        customer_id=customer_id, operations=[budget_op],
    )
    budget_resource = budget_resp.results[0].resource_name

    # 2. Campaign (PAUSED — safety first)
    campaign_svc = client.get_service("CampaignService")
    camp_op = client.get_type("CampaignOperation")
    c = camp_op.create
    c.name = _trim(f"{CAMPAIGN_NAME_PREFIX} · {spec.maker_slug} · {spec.listing_slug}", 255)
    c.advertising_channel_type = client.enums.AdvertisingChannelTypeEnum.SEARCH
    c.status = client.enums.CampaignStatusEnum.PAUSED
    c.manual_cpc.enhanced_cpc_enabled = True
    c.campaign_budget = budget_resource
    c.network_settings.target_google_search = True
    c.network_settings.target_search_network = True
    c.network_settings.target_partner_search_network = False
    c.network_settings.target_content_network = False
    from datetime import datetime as _dt
    c.start_date = _dt.utcnow().strftime("%Y%m%d")
    # Add the tracking template so existing `gclid` checkout attribution
    # keeps working without any other plumbing.
    base = spec.listing_url.rstrip("/")
    sep = "&" if "?" in base else "?"
    c.tracking_url_template = f"{{lpurl}}{sep}gclid={{gclid}}"
    camp_resp = campaign_svc.mutate_campaigns(
        customer_id=customer_id, operations=[camp_op],
    )
    campaign_resource = camp_resp.results[0].resource_name

    # 3. AdGroup
    ag_svc = client.get_service("AdGroupService")
    ag_op = client.get_type("AdGroupOperation")
    ag = ag_op.create
    ag.name = "Default"
    ag.status = client.enums.AdGroupStatusEnum.PAUSED
    ag.campaign = campaign_resource
    ag.type_ = client.enums.AdGroupTypeEnum.SEARCH_STANDARD
    ag.cpc_bid_micros = 500_000  # $0.50 default
    ag_resp = ag_svc.mutate_ad_groups(
        customer_id=customer_id, operations=[ag_op],
    )
    ad_group_resource = ag_resp.results[0].resource_name

    # 4. Responsive Search Ad
    ad_svc = client.get_service("AdGroupAdService")
    ad_op = client.get_type("AdGroupAdOperation")
    a = ad_op.create
    a.status = client.enums.AdGroupAdStatusEnum.PAUSED
    a.ad_group = ad_group_resource
    a.ad.final_urls.append(spec.listing_url)
    rsa = a.ad.responsive_search_ad
    # iter348 — prefer admin-supplied (AI-generated) RSA assets when
    # present. Google RSA limits: up to 15 headlines × 30 chars and
    # 4 descriptions × 90 chars. Fall back to the auto-derived trio
    # when called from the allocator (no Workshop draft).
    headlines: list[str]
    descriptions: list[str]
    if spec.headlines:
        seen_h: set[str] = set()
        headlines = []
        for raw in spec.headlines:
            h = _trim(raw, 30)
            if h and h not in seen_h:
                headlines.append(h)
                seen_h.add(h)
            if len(headlines) >= 15:
                break
    else:
        headlines = [
            _trim(spec.listing_title, 30),
            _trim(f"Handmade: {spec.listing_title}", 30),
            _trim(f"Shop {spec.listing_title}", 30),
        ]
    # Google RSA requires ≥3 headlines.
    if len(headlines) < 3:
        for fallback in (
            _trim(f"Handmade: {spec.listing_title}", 30),
            _trim(f"Shop {spec.listing_title}", 30),
            _trim(spec.listing_title, 30),
        ):
            if fallback and fallback not in headlines:
                headlines.append(fallback)
            if len(headlines) >= 3:
                break
    for h in headlines:
        asset = client.get_type("AdTextAsset")
        asset.text = h
        rsa.headlines.append(asset)

    if spec.descriptions:
        seen_d: set[str] = set()
        descriptions = []
        for raw in spec.descriptions:
            d = _trim(raw, 90)
            if d and d not in seen_d:
                descriptions.append(d)
                seen_d.add(d)
            if len(descriptions) >= 4:
                break
    else:
        descriptions = [
            _trim(spec.listing_description, 90) or "Handmade by independent artisans on Crafters Market.",
            "Free shipping · Made in USA · Crafters Market",
        ]
    if len(descriptions) < 2:
        descriptions.append("Free shipping · Made in USA · Crafters Market")
    for d in descriptions:
        asset = client.get_type("AdTextAsset")
        asset.text = d
        rsa.descriptions.append(asset)
    ad_svc.mutate_ad_group_ads(
        customer_id=customer_id, operations=[ad_op],
    )

    # 5. Keywords (broad-match)
    crit_svc = client.get_service("AdGroupCriterionService")
    ops = []
    for kw in _derive_keywords(spec):
        op = client.get_type("AdGroupCriterionOperation")
        cr = op.create
        cr.ad_group = ad_group_resource
        cr.status = client.enums.AdGroupCriterionStatusEnum.PAUSED
        cr.keyword.text = _trim(kw, 80)
        cr.keyword.match_type = client.enums.KeywordMatchTypeEnum.BROAD
        ops.append(op)
    if ops:
        crit_svc.mutate_ad_group_criteria(
            customer_id=customer_id, operations=ops,
        )

    logger.info("[google.gateway] created campaign %s for %s/%s",
                campaign_resource, spec.maker_slug, spec.listing_slug)
    return campaign_resource


def _set_status_sync(campaign_id: int, status: str, refresh_token: str,
                     customer_id: str) -> None:
    """Flip campaign status. `status` is the string name of the enum
    (e.g. 'PAUSED' / 'ENABLED' / 'REMOVED')."""
    client = _build_client_sync(refresh_token, customer_id)
    svc = client.get_service("CampaignService")
    op = client.get_type("CampaignOperation")
    op.update.resource_name = (
        f"customers/{customer_id}/campaigns/{campaign_id}"
    )
    op.update.status = client.enums.CampaignStatusEnum[status]
    # field_mask must list every field we touched.
    client.copy_from(
        op.update_mask,
        client.get_type("FieldMask")(paths=["status"]),
    )
    svc.mutate_campaigns(customer_id=customer_id, operations=[op])


def _update_budget_sync(campaign_id: int, daily_micros: int,
                        refresh_token: str, customer_id: str) -> None:
    """Updates the budget linked to a campaign. Google requires
    updating the CampaignBudget, not the campaign itself."""
    client = _build_client_sync(refresh_token, customer_id)
    # First look up the budget resource for this campaign.
    ga_svc = client.get_service("GoogleAdsService")
    query = (
        "SELECT campaign.campaign_budget FROM campaign "
        f"WHERE campaign.id = {int(campaign_id)} LIMIT 1"
    )
    rows = ga_svc.search(customer_id=customer_id, query=query)
    budget_resource = None
    for r in rows:
        budget_resource = r.campaign.campaign_budget
        break
    if not budget_resource:
        raise RuntimeError(f"No budget found for campaign {campaign_id}")

    budget_svc = client.get_service("CampaignBudgetService")
    op = client.get_type("CampaignBudgetOperation")
    op.update.resource_name = budget_resource
    op.update.amount_micros = daily_micros
    client.copy_from(
        op.update_mask,
        client.get_type("FieldMask")(paths=["amount_micros"]),
    )
    budget_svc.mutate_campaign_budgets(
        customer_id=customer_id, operations=[op],
    )
