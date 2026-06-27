"""listing_quality@v1 — description rule (substantive copy)."""
from quality.engine import register_rule, RuleResult


@register_rule(
    algorithm="listing_quality", version="v1",
    rule_id="description", weight=15, label="Description",
    description="A 120+ char description signals craft and helps SEO.",
)
def description(subject) -> RuleResult:
    desc = (subject.get("description") or "").strip()
    n = len(desc)
    if n >= 300:
        return RuleResult(
            passed=True, score=15,
            explanation=f"{n} chars — rich product copy.",
            details={"chars": n},
        )
    if n >= 120:
        return RuleResult(
            passed=True, score=11,
            recommendation="Aim for 300+ chars — describe materials, dimensions, care, and story.",
            estimated_impact="low",
            explanation=f"{n} chars — adequate but could be richer.",
            details={"chars": n},
        )
    if n >= 40:
        return RuleResult(
            passed=False, score=5,
            recommendation="Expand the description to at least 120 chars (materials + dimensions + care).",
            estimated_impact="medium",
            explanation=f"{n} chars — thin description.",
            details={"chars": n},
        )
    return RuleResult(
        passed=False, score=0,
        recommendation="Add a description — what is it, what is it made of, who is it for?",
        estimated_impact="high",
        explanation="Description is missing or under 40 chars.",
        details={"chars": n},
    )
