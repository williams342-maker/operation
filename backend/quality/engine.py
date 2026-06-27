"""iter413de — Modular, versioned Quality Scoring Engine.

Crafters Market's marketplace-wide static analyzer. Each scorecard
is a (algorithm, version) tuple — e.g. `listing_quality@v1`,
`shop_quality@v1`, `trust_score@v1`, `marketplace_health@v1`.

Versioning is FIRST-CLASS so when we ship `listing_quality@v2` (new
weights, new rules) the old `@v1` rules stay registered and
analytics that pinned to v1 keep returning the original numbers.

Rule registration is decorator-based:

    from quality.engine import register_rule, RuleResult

    @register_rule(algorithm="listing_quality", version="v1",
                   rule_id="cover_photo", weight=15, label="Cover photo")
    def cover_photo(subject) -> RuleResult:
        ok = bool(subject.get("image"))
        return RuleResult(
            passed=ok,
            score=15 if ok else 0,
            recommendation="" if ok else "Upload a cover photo.",
            estimated_impact="high" if not ok else None,
            explanation="The cover photo is the first thing buyers see.",
        )

Rules are pure functions: they receive a dict-like `subject` and
return a `RuleResult`. No I/O inside rules — the caller fetches the
listing/maker/shop document and passes it in.

Evaluation:

    from quality.engine import evaluate
    report = evaluate("listing_quality", "v1", listing_doc)
    # report = {
    #   "algorithm": "listing_quality", "version": "v1",
    #   "score": 84, "max_score": 100, "percent": 84,
    #   "rules": [{rule_id, label, weight, score, max_score,
    #              passed, recommendation, estimated_impact,
    #              explanation}, ...],
    #   "evaluated_at": "2026-02-27T17:00:00+00:00",
    # }
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger("crafters")

# (algorithm, version) → list of registered rules in declaration order.
# Rule order is preserved so the rendered scorecard is deterministic
# (helpful for diffing across versions during a v1 → v2 migration).
_REGISTRY: Dict[tuple, list] = {}

# Default version per algorithm — set by `set_default_version()`. Lets
# endpoints request "the current listing_quality scorecard" without
# pinning a version. Analytics pipelines pin explicitly to v1 / v2 / …
# so they never get surprised by a default flip.
_DEFAULT_VERSIONS: Dict[str, str] = {}


@dataclass
class RuleResult:
    """The contract every rule MUST return.

    All fields except `passed` and `score` are optional so simple
    presence checks can be one-liners; richer rules surface actionable
    recommendations + impact estimates.

    iter413df — `effort` joined `estimated_impact` as a first-class
    coaching signal. The Impact Engine ranks failing rules by the
    (impact, effort) matrix to surface "highest-leverage move first".
    Both fields override the rule's defaults declared at registration."""
    passed: bool
    score: float                            # 0 .. weight
    recommendation: str = ""
    estimated_impact: Optional[str] = None  # "low" | "medium" | "high"
    effort: Optional[str] = None            # "low" | "medium" | "high"
    explanation: str = ""
    # Optional structured payload for UI-rich rules (e.g. quality
    # rule that wants to show "3 / 5 photos" or surface a thumbnail).
    details: dict = field(default_factory=dict)


@dataclass
class _RegisteredRule:
    rule_id: str
    label: str
    weight: float
    fn: Callable[[Any], RuleResult]
    description: str = ""
    # iter413df — Default effort + deep-link template per rule. Rules
    # can still override `effort` at evaluation time via RuleResult.
    # `edit_link_template` is a relative URL with {slug} interpolation
    # so the Impact Engine can build maker-specific deep-links into
    # the appropriate edit screen.
    default_effort: str = "medium"
    edit_link_template: str = ""


def register_rule(
    *, algorithm: str, version: str, rule_id: str,
    weight: float, label: str, description: str = "",
    default_effort: str = "medium", edit_link_template: str = "",
):
    """Decorator — register a rule against (algorithm, version).

    Re-registering the SAME (algorithm, version, rule_id) replaces
    the previous registration (so `import quality.rules` is idempotent
    in dev with hot-reload). A logger.warning surfaces the swap.

    iter413df — `default_effort` and `edit_link_template` feed the
    Impact Engine. Effort matrix: low / medium / high. Link template
    accepts a `{slug}` placeholder, e.g. `/maker/listings/{slug}/edit#video`."""
    if weight <= 0:
        raise ValueError(f"Rule weight must be > 0 (got {weight} for {rule_id})")
    if default_effort not in {"low", "medium", "high"}:
        raise ValueError(f"default_effort must be low|medium|high (got {default_effort!r})")

    def wrap(fn: Callable[[Any], RuleResult]) -> Callable[[Any], RuleResult]:
        key = (algorithm, version)
        bucket = _REGISTRY.setdefault(key, [])
        existing = next((i for i, r in enumerate(bucket) if r.rule_id == rule_id), None)
        rule = _RegisteredRule(
            rule_id=rule_id, label=label, weight=float(weight),
            fn=fn, description=description,
            default_effort=default_effort, edit_link_template=edit_link_template,
        )
        if existing is not None:
            logger.warning("[quality] swap rule %s/%s/%s", algorithm, version, rule_id)
            bucket[existing] = rule
        else:
            bucket.append(rule)
        return fn
    return wrap


def set_default_version(algorithm: str, version: str) -> None:
    """Pin the algorithm's "current" version. Endpoints that don't
    specify a version use this; analytics pin explicitly."""
    _DEFAULT_VERSIONS[algorithm] = version


def registered_algorithms() -> list:
    """Introspection: all (algorithm, version) scorecards currently
    registered. Used by an admin debug endpoint."""
    return sorted({k for k in _REGISTRY})


def evaluate(algorithm: str, version: Optional[str], subject: Any) -> dict:
    """Run every rule registered to (algorithm, version) against the
    `subject` and return a render-ready scorecard. Pure — no DB I/O.

    Each rule is called inside a try/except so one buggy rule cannot
    take down the whole scorecard. A crashed rule is recorded as
    passed=False, score=0, explanation=<traceback summary>."""
    v = version or _DEFAULT_VERSIONS.get(algorithm)
    if not v:
        raise ValueError(f"No default version registered for algorithm {algorithm!r}")
    key = (algorithm, v)
    bucket = _REGISTRY.get(key)
    if not bucket:
        raise ValueError(f"No rules registered for {algorithm}@{v}")

    rules_out: list = []
    earned = 0.0
    total_weight = 0.0
    for rule in bucket:
        total_weight += rule.weight
        try:
            res = rule.fn(subject)
            if not isinstance(res, RuleResult):
                raise TypeError(f"rule {rule.rule_id} did not return RuleResult")
            score = max(0.0, min(float(res.score), rule.weight))
            earned += score
            rules_out.append({
                "rule_id": rule.rule_id,
                "label": rule.label,
                "weight": rule.weight,
                "score": score,
                "max_score": rule.weight,
                "passed": bool(res.passed),
                "recommendation": res.recommendation or "",
                "estimated_impact": res.estimated_impact,
                # iter413df — Effort + edit link surface so the Impact
                # Engine can rank by leverage AND deep-link straight
                # into the right edit screen. Effort defaults to the
                # rule's declared `default_effort` if the rule fn
                # didn't override it. Edit link interpolates {slug}
                # at the Impact-Engine layer (engine stays pure).
                "effort": res.effort or rule.default_effort,
                "edit_link_template": rule.edit_link_template or "",
                "explanation": res.explanation or "",
                "details": res.details or {},
            })
        except Exception as e:
            logger.exception("[quality] rule %s/%s/%s crashed: %s",
                             algorithm, v, rule.rule_id, e)
            rules_out.append({
                "rule_id": rule.rule_id,
                "label": rule.label,
                "weight": rule.weight,
                "score": 0,
                "max_score": rule.weight,
                "passed": False,
                "recommendation": "Internal scoring error — engineering notified.",
                "estimated_impact": None,
                "effort": rule.default_effort,
                "edit_link_template": rule.edit_link_template or "",
                "explanation": f"rule crashed: {type(e).__name__}",
                "details": {},
            })

    percent = round((earned / total_weight) * 100, 1) if total_weight else 0.0
    return {
        "algorithm": algorithm,
        "version": v,
        "score": round(earned, 1),
        "max_score": round(total_weight, 1),
        "percent": percent,
        "rules": rules_out,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
    }
