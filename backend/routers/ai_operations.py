"""iter413cr — AI Operations Center (admin surface).

Aggregates the new `ai_diagnosed_bug` reports + help-chat telemetry into
**operational intelligence** for the admin dashboard. This is the first
card of a broader plan to turn the Operations Dashboard into a live
read on what's actually breaking, confusing, or trending for sellers
and buyers — driven by real conversations, not guesses.

Roadmap (this file ships card 1, leaves room for the rest):
  ▸ Card 1 — **Top AI-diagnosed issues (last 7d)** with trend deltas
              (current vs prior window), severity, sample report IDs.
              SHIPPED HERE.
  ▸ Card 2 — Emerging issues (clusters that appeared in the last 24h
              with no presence in the prior 6 days).
  ▸ Card 3 — AI confidence (answered from CAPABILITIES vs escalated
              vs unknown — read from `help_questions` telemetry).
  ▸ Card 4 — Feature confusion (top repeated questions from
              `help_questions` without a corresponding bug report).
  ▸ Card 5 — Trending seller feedback (group recurring feature
              requests surfaced in beta-feedback + contact_messages).
  ▸ Card 6 — AI Watch Window — post-deploy proactive monitoring.
              When the `LAST_DEPLOY_AT` env var (or DB flag) flips, a
              24-48h window opens that highlights any spike vs the
              7-day baseline.

Endpoint layout (kept stable so the frontend doesn't churn):
  GET /api/admin/ops/ai-issues?window_days=7   — card 1 payload
  GET /api/admin/ops/ai-summary                — overall card-bar
                                                  numbers (future)

Design constraints inherited from `ops_dashboard.py`:
  • Admin-only via `Depends(current_admin)`.
  • Read-only — never mutates contact_messages or help_questions.
  • Cheap: one Mongo round-trip per card, post-process in Python.
  • No external LLM calls in v1 — the clustering is a pure-Python
    keyword fingerprint. We'll add semantic clustering (via Claude)
    only if the keyword approach produces too many singletons.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Iterable

from fastapi import APIRouter, Depends

from core import db
from maker_auth import current_admin

router = APIRouter()
logger = logging.getLogger("crafters")


# ── Clustering ─────────────────────────────────────────────────────────
# v1 — a deliberately simple fingerprint. The goal is to group reports
# describing the same underlying issue without pulling in a vector DB
# or an LLM. If the fingerprint over-splits in production (lots of
# 1-report clusters that should clearly merge), we'll graduate to a
# semantic approach. Keep the function small + testable.

_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "than", "to", "of",
    "for", "in", "on", "at", "by", "with", "from", "as", "is", "are", "was",
    "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
    "i", "you", "he", "she", "it", "we", "they", "me", "my", "mine", "your",
    "yours", "this", "that", "these", "those", "there", "here", "what",
    "which", "who", "whom", "whose", "when", "where", "why", "how", "all",
    "any", "both", "each", "few", "more", "most", "other", "some", "such",
    "no", "nor", "not", "only", "own", "same", "so", "too", "very", "can",
    "cant", "won", "wont", "will", "would", "should", "could", "may",
    "might", "must", "shall", "let", "lets", "us", "im", "ive", "id",
    "youre", "youve", "youd", "hes", "shes", "its", "were", "theyre",
    "theyve", "theyd", "isnt", "arent", "wasnt", "werent", "hasnt",
    "havent", "hadnt", "doesnt", "didnt", "wouldnt", "shouldnt",
    "couldnt", "wont", "page", "site", "thing", "stuff",
}

# Listing/maker slugs and category names are KEPT (not stopworded) since
# they're often the differentiator between two superficially-similar
# reports. We only strip when they collapse to noise.

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _normalize_tokens(text: str) -> list[str]:
    if not text:
        return []
    toks = _TOKEN_RE.findall(text.lower())
    out: list[str] = []
    for t in toks:
        if len(t) <= 2:
            continue
        if t in _STOPWORDS:
            continue
        # Light stemming — drop common plural / -ing / -ed endings so
        # "uploads"/"uploading"/"uploaded" cluster as "upload".
        if len(t) > 5:
            for suf in ("ing", "ed", "es", "s"):
                if t.endswith(suf) and len(t) - len(suf) >= 4:
                    t = t[: -len(suf)]
                    break
        out.append(t)
    return out


def _signature(description: str, page_url: str | None, listing_slug: str | None,
               category: str | None) -> tuple[str, str]:
    """Return (cluster_key, human_label).

    The cluster_key drives grouping (stable, deterministic). The label
    is what the admin sees in the dashboard.
    """
    desc_tokens = _normalize_tokens(description)[:4]  # top-4 keywords
    path_seg = ""
    if page_url:
        # First non-empty path segment as a coarse area-of-app bucket.
        m = re.match(r"^/?([a-z0-9_\-]+)", (page_url or "").lower())
        if m:
            path_seg = m.group(1)
    bucket = listing_slug or path_seg or "site"
    key = f"{bucket}::{'-'.join(desc_tokens) or 'misc'}"
    # Pretty label: keep the original-cased keywords from the first
    # ~80 chars of the description as a fallback when we can't infer
    # something cleaner.
    label_src = (description or "").strip().split("\n", 1)[0]
    label = label_src[:80] + ("…" if len(label_src) > 80 else "")
    if not label:
        label = f"Issue on {bucket}"
    return key, label


def _severity(count: int) -> str:
    if count >= 10:
        return "high"
    if count >= 5:
        return "medium"
    if count >= 2:
        return "low"
    return "info"


def _iso_minus(days: int = 0, hours: int = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours)).isoformat()


def _trend_arrow(current: int, prior: int) -> str:
    if prior == 0 and current > 0:
        return "new"
    if current > prior * 1.25:
        return "up"
    if current < prior * 0.75:
        return "down"
    return "flat"


def _trend_delta(current: int, prior: int) -> int:
    return current - prior


# ── Card 1 — Top AI-diagnosed issues ─────────────────────────────────
@router.get("/admin/ops/ai-issues")
async def ai_issues_top(
    window_days: int = 7,
    limit: int = 12,
    claims: dict = Depends(current_admin),
):
    """Cluster `contact_messages` rows tagged `kind=ai_diagnosed_bug`
    by keyword fingerprint and return the top N clusters in the current
    window, with trend deltas against the prior equal-length window.

    Response shape (stable — additive changes only):
      {
        "window_days": int,
        "current_window": { "start": iso, "end": iso, "total": int },
        "prior_window":   { "start": iso, "end": iso, "total": int },
        "clusters": [{
            "key": str,             # opaque cluster id (stable across calls)
            "label": str,           # human-friendly headline
            "count": int,           # reports in the current window
            "prior_count": int,
            "trend": "up"|"down"|"flat"|"new",
            "trend_delta": int,     # current - prior
            "severity": "info"|"low"|"medium"|"high",
            "first_seen": iso,
            "last_seen": iso,
            "sample_ids": [str, ...],         # up to 5 contact_message ids
            "sample_pages": [str, ...],       # up to 3 distinct page URLs
            "sample_listing_slugs": [str, ...] # up to 3 listing slugs seen
        }],
        "generated_at": iso,
      }

    Admin-only. Read-only. No mutations.
    """
    window_days = max(1, min(30, int(window_days or 7)))
    limit = max(1, min(50, int(limit or 12)))

    now = datetime.now(timezone.utc)
    cur_start = (now - timedelta(days=window_days)).isoformat()
    prior_start = (now - timedelta(days=window_days * 2)).isoformat()
    prior_end = cur_start  # back-to-back, no gap
    now_iso = now.isoformat()

    # Pull both windows in one shot to keep the math obvious.
    rows = await db.contact_messages.find(
        {
            "kind": "ai_diagnosed_bug",
            "created_at": {"$gte": prior_start},
        },
        {
            "_id": 0,
            "id": 1,
            "message": 1,
            "created_at": 1,
            "ai_bug_meta": 1,
        },
    ).sort("created_at", -1).to_list(2000)

    cur_clusters: dict[str, dict] = {}
    prior_counts: dict[str, int] = {}
    cur_total = 0
    prior_total = 0

    for row in rows:
        ts = row.get("created_at") or ""
        meta = row.get("ai_bug_meta") or {}
        desc = ""
        # Pull the user's description from the message body (it's the
        # first chunk after "User report:" in the standard layout).
        msg_body = row.get("message") or ""
        if "User report:" in msg_body:
            desc = msg_body.split("User report:", 1)[1].split("\n\n", 1)[0].strip()
        if not desc:
            desc = msg_body[:200]

        key, label = _signature(
            desc,
            meta.get("page_url"),
            meta.get("listing_slug"),
            meta.get("category"),
        )

        if ts >= cur_start:
            cur_total += 1
            cluster = cur_clusters.get(key)
            if not cluster:
                cluster = {
                    "key": key,
                    "label": label,
                    "count": 0,
                    "first_seen": ts,
                    "last_seen": ts,
                    "sample_ids": [],
                    "sample_pages": [],
                    "sample_listing_slugs": [],
                }
                cur_clusters[key] = cluster
            cluster["count"] += 1
            if ts < cluster["first_seen"]:
                cluster["first_seen"] = ts
            if ts > cluster["last_seen"]:
                cluster["last_seen"] = ts
            if row.get("id") and len(cluster["sample_ids"]) < 5:
                cluster["sample_ids"].append(row["id"])
            page = (meta.get("page_url") or "").strip()
            if page and page not in cluster["sample_pages"] and len(cluster["sample_pages"]) < 3:
                cluster["sample_pages"].append(page)
            slug = (meta.get("listing_slug") or "").strip()
            if slug and slug not in cluster["sample_listing_slugs"] and len(cluster["sample_listing_slugs"]) < 3:
                cluster["sample_listing_slugs"].append(slug)
        elif prior_start <= ts < prior_end:
            prior_total += 1
            prior_counts[key] = prior_counts.get(key, 0) + 1

    clusters: list[dict] = []
    for c in cur_clusters.values():
        prior = prior_counts.get(c["key"], 0)
        c["prior_count"] = prior
        c["trend"] = _trend_arrow(c["count"], prior)
        c["trend_delta"] = _trend_delta(c["count"], prior)
        c["severity"] = _severity(c["count"])
        clusters.append(c)

    # Severity-then-count ordering keeps the most actionable at the top.
    severity_rank = {"high": 0, "medium": 1, "low": 2, "info": 3}
    clusters.sort(key=lambda x: (severity_rank.get(x["severity"], 9), -x["count"], -len(x["sample_ids"])))
    clusters = clusters[:limit]

    return {
        "window_days": window_days,
        "current_window": {"start": cur_start, "end": now_iso, "total": cur_total},
        "prior_window":   {"start": prior_start, "end": prior_end, "total": prior_total},
        "clusters": clusters,
        "generated_at": now_iso,
    }
