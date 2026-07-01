"""Policy-publish search-engine notifier.

One-shot module that tells search engines and Google Search Console the
Trust & Policy Center has changed, so /policies/<slug> pages get
re-crawled within minutes rather than waiting for the normal crawl
cycle.

Trigger points:
  - Admin dashboard button (POST /api/admin/seo/policies-published)
  - CLI hook from /app/scripts/regenerate-legal-launch-binder.sh
    after the DOCX + PDF rebuild lands

Behaviour:
  - IndexNow ping for every canonical Trust & Policy URL (Bing / Yandex
    / Naver / Seznam / Yep respect this — Google does not).
  - GSC submit_sitemap (best-effort — only fires when
    is_gsc_enabled() returns True; otherwise skipped with a note so
    operators aren't paged for missing OAuth credentials).

Never raises. Every leg is best-effort; failures return in the response
so operators can see them without breaking the calling flow.
"""
from __future__ import annotations

from typing import Optional

from core import logger, _CANONICAL_SITE_ROOT
from routers.seo import TRUST_POLICY_PATHS


def _absolute_policy_urls(root: str) -> list[str]:
    """Compose the canonical https://<host><path> list from the shared
    TRUST_POLICY_PATHS tuple. Duplicates and mixed-scheme values are
    collapsed so IndexNow's dedupe pass has nothing to reject."""
    seen: set[str] = set()
    out: list[str] = []
    root = root.rstrip("/")
    for p in TRUST_POLICY_PATHS:
        url = f"{root}{p}"
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
    return out


async def notify_policy_publish(
    *,
    override_root: Optional[str] = None,
    include_gsc: bool = True,
) -> dict:
    """Fire IndexNow + optional GSC sitemap submit for the Trust & Policy
    Center URL set. Returns a diagnostic dict the admin dashboard (or
    the CLI shell script) can print verbatim.

    Best-effort — this function never raises. Non-fatal errors are
    surfaced in the response.
    """
    from seo_indexnow import ping as indexnow_ping

    root = (override_root or _CANONICAL_SITE_ROOT).rstrip("/")
    urls = _absolute_policy_urls(root)

    # ---- IndexNow leg -----------------------------------------------------
    try:
        indexnow_result = await indexnow_ping(urls=urls)
    except Exception as e:  # pragma: no cover — indexnow.ping() itself never raises
        logger.exception("[policy_notify] indexnow ping raised unexpectedly")
        indexnow_result = {"ok": False, "error": f"{type(e).__name__}: {e}", "count": len(urls)}

    # ---- GSC sitemap re-nudge --------------------------------------------
    gsc_result: dict = {"ok": False, "skipped": True, "reason": "gsc disabled"}
    if include_gsc:
        try:
            from gsc_client import is_gsc_enabled, submit_sitemap
            if is_gsc_enabled():
                gsc_result = await submit_sitemap(f"{root}/sitemap.xml")
                gsc_result.setdefault("ok", True)
                gsc_result["skipped"] = False
            else:
                gsc_result = {
                    "ok": False,
                    "skipped": True,
                    "reason": (
                        "Google Search Console is not configured on this "
                        "environment (no service-account JSON / OAuth "
                        "credentials). IndexNow still fired — nudge Google "
                        "manually in Search Console → Sitemaps."
                    ),
                }
        except Exception as e:
            logger.exception("[policy_notify] gsc submit_sitemap failed")
            gsc_result = {
                "ok": False,
                "skipped": False,
                "error": f"{type(e).__name__}: {e}",
            }

    return {
        "ok": bool(indexnow_result.get("ok")) or bool(gsc_result.get("ok")),
        "url_count": len(urls),
        "urls": urls,
        "indexnow": indexnow_result,
        "gsc": gsc_result,
        "next_step_for_google": (
            "Google does not support IndexNow. Open Google Search Console → "
            "Sitemaps and click 'Submit' on the existing /api/sitemap.xml "
            "entry to nudge Google specifically. (Skipped automatically here "
            "unless GSC OAuth is configured.)"
        ),
    }
