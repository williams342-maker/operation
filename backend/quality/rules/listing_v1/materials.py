"""listing_quality@v1 — materials rule."""
from quality.engine import register_rule, RuleResult


@register_rule(
    algorithm="listing_quality", version="v1",
    rule_id="materials", weight=15, label="Materials",
    description="Listed materials build trust + power faceted search filters.",
)
def materials(subject) -> RuleResult:
    mats = subject.get("materials") or []
    if isinstance(mats, str):
        mats = [m.strip() for m in mats.split(",") if m.strip()]
    n = len(mats) if isinstance(mats, list) else 0
    if n >= 3:
        return RuleResult(
            passed=True, score=15,
            explanation=f"{n} materials listed.",
            details={"count": n},
        )
    if n >= 1:
        return RuleResult(
            passed=True, score=10,
            recommendation="Add 2 more materials for full credit (3+ total).",
            estimated_impact="low",
            explanation=f"{n} material(s) listed.",
            details={"count": n},
        )
    return RuleResult(
        passed=False, score=0,
        recommendation="Add materials (wood species, metal type, fiber blend, etc.) — buyers filter on them.",
        estimated_impact="medium",
        explanation="No materials listed.",
        details={"count": 0},
    )
