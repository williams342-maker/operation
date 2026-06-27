"""iter413df — Impact Engine.

Turns a Quality Scorecard from `quality.engine.evaluate(...)` into a
prioritized coaching plan that answers ONE question:

    "What should I do next to increase my chances of making a sale?"

The output is a ranked list of recommendations, highest-leverage move
first. Each item carries the points gained on completion + the effort
required + a deep-link to the edit screen.

Ranking key (descending — best move first):
  1. Highest expected POINT GAIN (rule weight - current score)
  2. Highest impact (high > medium > low > unspecified)
  3. Lowest effort (low > medium > high)
  4. Original rule order (stability — Compass should suggest the
     same #1 move every time the same listing is queried)

Passing rules are NOT included — coaching never says "keep doing X".
Resolved rules are silent. The shape is intentionally version-agnostic
so it works for `listing_quality@v1`, `shop_quality@v1`, `trust_score@v1`,
`marketplace_health@v1`, anything that goes through the engine."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

IMPACT_RANK = {"high": 3, "medium": 2, "low": 1, None: 0}
EFFORT_RANK = {"low": 3, "medium": 2, "high": 1, None: 2}  # unknown = medium


def _sales_opportunity(percent: float, gap: float) -> dict:
    """iter413dg — Qualitative sales-opportunity indicator.

    Deliberately NOT a numeric prediction — we don't have enough
    marketplace data yet to calibrate "+15 score = +X% sales". Instead
    we surface a 5-star opportunity rating + plain-English level
    ('low' / 'moderate' / 'high') derived from current score AND the
    closeable gap. Sellers respond more strongly to "what they could
    gain" than to a raw deficit, so the rating ROSE as the gap grows
    AND falls back to "saturated" once the listing is already strong.

    Calibration (rebaseline once we have conversion data):
      • gap ≥ 40   → 5★ high      (huge headroom, urgent attention)
      • gap ≥ 25   → 4★ high      (real, attainable wins)
      • gap ≥ 12   → 3★ moderate  (worth the time)
      • gap ≥ 5    → 2★ low       (polish work)
      • gap < 5    → 1★ saturated (already near ceiling)
    """
    if gap >= 40:
        return {"stars": 5, "level": "high", "label": "High"}
    if gap >= 25:
        return {"stars": 4, "level": "high", "label": "High"}
    if gap >= 12:
        return {"stars": 3, "level": "moderate", "label": "Moderate"}
    if gap >= 5:
        return {"stars": 2, "level": "low", "label": "Low"}
    return {"stars": 1, "level": "saturated", "label": "Near ceiling"}


def _interp_link(template: str, identifier: Optional[str]) -> str:
    """Best-effort {slug} interpolation. Returns empty string when the
    template is missing OR the identifier isn't provided (template
    becomes a non-functional placeholder, never rendered)."""
    if not template:
        return ""
    if "{slug}" in template:
        if not identifier:
            return ""
        return template.replace("{slug}", str(identifier))
    return template


def prioritize(scorecard: dict, identifier: Optional[str] = None) -> dict:
    """Rank the failing rules into a coaching plan.

    Args:
        scorecard: full payload from `quality.engine.evaluate()`.
        identifier: optional slug/id used to interpolate `edit_link`
            templates (so the action plan deep-links to the right
            edit screen). For listing_quality this is the listing slug;
            for shop_quality the maker slug; etc.

    Returns:
        {
          algorithm, version,
          score, max_score, percent,                  # echoed from scorecard
          ceiling: <max possible after fixing all failing rules>,
          gap: <ceiling - score>,
          next_action: <single highest-leverage move>,
          actions: [<ranked list of all actionable items>],
          summary: <one-line plain-English digest>,
          evaluated_at,
        }
    """
    rules = scorecard.get("rules") or []
    actions: list = []
    for idx, r in enumerate(rules):
        if r.get("passed") and r.get("score") >= r.get("max_score"):
            # Perfect score on this rule — coaching has nothing to add.
            continue
        gain = round(float(r.get("max_score", 0)) - float(r.get("score", 0)), 1)
        if gain <= 0:
            continue
        impact = r.get("estimated_impact")
        effort = r.get("effort") or "medium"
        actions.append({
            "rule_id": r.get("rule_id"),
            "label": r.get("label"),
            "recommendation": r.get("recommendation") or "",
            "points_gain": gain,
            "estimated_impact": impact,
            "effort": effort,
            "edit_link": _interp_link(r.get("edit_link_template") or "", identifier),
            "current_score": float(r.get("score", 0)),
            "max_score": float(r.get("max_score", 0)),
            "explanation": r.get("explanation") or "",
            "_idx": idx,                             # stability tiebreaker
        })

    # Sort: highest leverage first.
    actions.sort(key=lambda a: (
        -a["points_gain"],
        -IMPACT_RANK.get(a["estimated_impact"], 0),
        -EFFORT_RANK.get(a["effort"], 2),
        a["_idx"],
    ))
    for a in actions:
        a.pop("_idx", None)

    score = float(scorecard.get("score", 0))
    max_score = float(scorecard.get("max_score", 0))
    ceiling = score + sum(a["points_gain"] for a in actions)
    next_action = actions[0] if actions else None
    summary = _render_summary(scorecard, actions, next_action)
    percent = scorecard.get("percent", 0.0)
    gap = ceiling - score
    opportunity = _sales_opportunity(percent, gap)

    return {
        "algorithm": scorecard.get("algorithm"),
        "version": scorecard.get("version"),
        "identifier": identifier,
        "score": round(score, 1),
        "max_score": round(max_score, 1),
        "percent": percent,
        "ceiling": round(ceiling, 1),
        "gap": round(gap, 1),
        "sales_opportunity": opportunity,
        "next_action": next_action,
        "actions": actions,
        "summary": summary,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
    }


def _render_summary(scorecard: dict, actions: list, top: Optional[dict]) -> str:
    """One-line plain-English digest the dashboard hero AND Compass
    can both surface. Keeps prose short — the action list does the
    detail work."""
    score = scorecard.get("score", 0)
    max_score = scorecard.get("max_score", 0)
    if not actions:
        return f"You're at {score:.0f}/{max_score:.0f} — perfect score on every rule. Nothing left to improve."
    if top:
        gain = top["points_gain"]
        return (
            f"You're at {score:.0f}/{max_score:.0f}. "
            f"Biggest next win: {top['recommendation']} (+{gain:.0f} pts)."
        )
    return f"You're at {score:.0f}/{max_score:.0f}."
