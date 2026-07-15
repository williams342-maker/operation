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
from config import env_get
import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Optional

import httpx

from core import db, now_iso
from .base import (
    AdsGateway, CreateCampaignSpec, CampaignHandle,
    GatewayError, GatewayNotEligible,
)

logger = logging.getLogger("crafters.promote.gateway.meta")

GRAPH_VERSION = env_get("META_API_VERSION", "v20.0")
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"
# Video uploads MUST go to graph-video.facebook.com per Graph API docs.
GRAPH_VIDEO_BASE = f"https://graph-video.facebook.com/{GRAPH_VERSION}"

# Chunked video upload tuning. Meta returns end_offset on each `start`
# / `transfer` response telling us the next byte boundary — we honor it.
VIDEO_UPLOAD_TIMEOUT_SEC = 120
VIDEO_PROCESS_POLL_MAX_ATTEMPTS = 36   # 36 × 5s = 3 minutes
VIDEO_PROCESS_POLL_INTERVAL_SEC = 5.0

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

        ad_account = env_get("META_AD_ACCOUNT_ID", "").strip()
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
        ad_account = env_get("META_AD_ACCOUNT_ID").strip()

        try:
            # 1. Campaign — PAUSED. Objective=OUTCOME_TRAFFIC sends
            # users to the listing landing page (cheapest goal that
            # still respects our URL-param attribution).
            async with httpx.AsyncClient(timeout=VIDEO_UPLOAD_TIMEOUT_SEC) as http:
                campaign_id = await _create_campaign(
                    http, ad_account, token, spec,
                )
                adset_id = await _create_adset(
                    http, ad_account, token, campaign_id, spec,
                )
                # iter355 — branch on video vs link creative.
                if spec.video_asset_path:
                    video_id = await _upload_advideo_chunked(
                        http, ad_account, token, spec,
                    )
                    await _poll_video_status(http, token, video_id)
                    creative_id = await _create_video_creative(
                        http, ad_account, token, spec, video_id,
                    )
                else:
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
    page_id = env_get("META_DEFAULT_PAGE_ID", "").strip()
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



# ── iter355 — Video creative path ─────────────────────────────────────
async def _upload_advideo_chunked(http: httpx.AsyncClient, ad_account: str,
                                  token: str,
                                  spec: CreateCampaignSpec) -> str:
    """Chunk-upload a local video file to Meta's `advideos` edge.

    Uses Meta's resumable `upload_phase=start|transfer|finish` protocol
    on `graph-video.facebook.com`. `start` returns the session id and
    initial byte range; we honor the (start_offset, end_offset) Meta
    hands back on each transfer until they converge, then call
    `finish`. Returns the resulting video_id (stable across phases).
    """
    path = Path(spec.video_asset_path or "")
    if not path.exists():
        raise GatewayError(f"Video file not found on disk: {path}")
    file_size = path.stat().st_size
    if file_size <= 0:
        raise GatewayError("Video file is empty.")

    base_url = f"{GRAPH_VIDEO_BASE}/{ad_account}/advideos"
    common = {"access_token": token}

    # 1) start phase
    r = await http.post(
        base_url,
        params=common,
        data={"upload_phase": "start", "file_size": str(file_size)},
    )
    r.raise_for_status()
    body = r.json()
    upload_session_id = body["upload_session_id"]
    video_id = body["video_id"]
    start_offset = int(body["start_offset"])
    end_offset = int(body["end_offset"])

    # 2) transfer phases
    with open(path, "rb") as f:
        while start_offset < end_offset:
            f.seek(start_offset)
            chunk = f.read(end_offset - start_offset)
            files = {
                "video_file_chunk": (
                    path.name, chunk,
                    spec.video_asset_mime or "application/octet-stream",
                ),
            }
            data = {
                "upload_phase": "transfer",
                "upload_session_id": upload_session_id,
                "start_offset": str(start_offset),
            }
            tr = await http.post(base_url, params=common, data=data, files=files)
            tr.raise_for_status()
            tb = tr.json()
            new_start = int(tb["start_offset"])
            new_end = int(tb["end_offset"])
            # Defensive: bail if Meta stops advancing the cursor.
            if new_start == start_offset and new_start < end_offset:
                raise GatewayError(
                    "Meta chunked upload stalled — server did not advance "
                    f"start_offset past {start_offset}."
                )
            start_offset, end_offset = new_start, new_end

    # 3) finish phase
    fr = await http.post(
        base_url,
        params=common,
        data={
            "upload_phase": "finish",
            "upload_session_id": upload_session_id,
            "title": _trim(spec.listing_title, 200) or "Crafters Market",
            "description": _trim(spec.listing_description, 500),
        },
    )
    fr.raise_for_status()
    logger.info("[meta.gateway] advideo uploaded video_id=%s bytes=%d",
                video_id, file_size)
    return video_id


async def _poll_video_status(http: httpx.AsyncClient, token: str,
                             video_id: str) -> None:
    """Poll the Graph API until the video status becomes 'ready'.

    Raises `GatewayError` on terminal error states or timeout. Meta's
    processing time for ≤50 MB ad videos typically completes in <60s
    but we allow up to ~3 minutes before giving up.
    """
    url = f"{GRAPH_BASE}/{video_id}"
    last_status: Optional[str] = None
    for _ in range(VIDEO_PROCESS_POLL_MAX_ATTEMPTS):
        r = await http.get(url, params={"access_token": token, "fields": "status"})
        r.raise_for_status()
        status_obj = (r.json() or {}).get("status") or {}
        vstatus = status_obj.get("video_status") or status_obj.get("status")
        last_status = vstatus
        if vstatus == "ready":
            return
        if vstatus == "error":
            reason = status_obj.get("processing_phase", {}).get("error") or status_obj
            raise GatewayError(f"Meta rejected the video: {str(reason)[:200]}")
        await asyncio.sleep(VIDEO_PROCESS_POLL_INTERVAL_SEC)
    raise GatewayError(
        f"Meta video {video_id} still processing after "
        f"{VIDEO_PROCESS_POLL_MAX_ATTEMPTS * VIDEO_PROCESS_POLL_INTERVAL_SEC:.0f}s "
        f"(last status: {last_status}). Try again in a minute."
    )


async def _create_video_creative(http: httpx.AsyncClient, ad_account: str,
                                 token: str, spec: CreateCampaignSpec,
                                 video_id: str) -> str:
    """Create an ad creative whose `object_story_spec.video_data`
    references the freshly uploaded `video_id`.

    Maps the AI Workshop copy the same way `_create_creative` does:
      • `spec.headlines[0]` → `video_data.title` (40-char hard cap)
      • `spec.descriptions[0]` → `video_data.message` (125 cap)
    The thumbnail uses `spec.video_thumbnail_url` if set, otherwise the
    listing image (Meta requires an image_url for video creatives).
    """
    import json as _json

    page_id = env_get("META_DEFAULT_PAGE_ID", "").strip()
    if not page_id:
        raise GatewayError("META_DEFAULT_PAGE_ID env var required to create Meta ads.")

    thumb = (spec.video_thumbnail_url or spec.listing_image_url or "").strip()
    if not thumb:
        raise GatewayError(
            "Meta video creatives require a thumbnail. Set the listing image "
            "or pass video_thumbnail_url."
        )

    ad_title = (
        _trim(spec.headlines[0], 40) if spec.headlines and spec.headlines[0]
        else _trim(spec.listing_title, 40)
    )
    primary_text = (
        _trim(spec.descriptions[0], 125) if spec.descriptions and spec.descriptions[0]
        else _trim(spec.listing_description, 125)
    ) or "Handmade by independent artisans."
    base = spec.listing_url.rstrip("/")
    sep = "&" if "?" in base else "?"
    link_url = f"{base}{sep}fbclid={{{{ad.id}}}}"

    object_story_spec = {
        "page_id": page_id,
        "video_data": {
            "video_id": video_id,
            "image_url": thumb,
            "title": ad_title,
            "message": primary_text,
            "call_to_action": {
                "type": "SHOP_NOW",
                "value": {"link": link_url},
            },
        },
    }

    r = await http.post(
        f"{GRAPH_BASE}/{ad_account}/adcreatives",
        data={
            "access_token": token,
            "name": _trim(
                f"{CAMPAIGN_NAME_PREFIX} · {spec.listing_slug} video", 200,
            ),
            "object_story_spec": _json.dumps(object_story_spec),
        },
    )
    r.raise_for_status()
    return r.json()["id"]
