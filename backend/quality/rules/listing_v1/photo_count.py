"""listing_quality@v1 — photo_count rule (≥3 total photos earns full)."""
from quality.engine import register_rule, RuleResult


@register_rule(
    algorithm="listing_quality", version="v1",
    rule_id="photo_count", weight=15, label="Photo variety",
    description="Multiple angles reduce return rates and build trust.",
)
def photo_count(subject) -> RuleResult:
    images = subject.get("images") or []
    n = len(images)
    if n >= 5:
        return RuleResult(
            passed=True, score=15,
            explanation=f"{n} photos — full coverage.",
            details={"count": n},
        )
    if n >= 3:
        return RuleResult(
            passed=True, score=12,
            recommendation="Add 2 more photos for full credit (5+ total).",
            estimated_impact="low",
            explanation=f"{n} photos — good coverage, room to grow.",
            details={"count": n},
        )
    if n >= 1:
        return RuleResult(
            passed=False, score=6,
            recommendation=f"Add {3 - n} more photo(s) — buyers want at least 3 angles.",
            estimated_impact="medium",
            explanation=f"Only {n} photo(s) — sparse coverage.",
            details={"count": n},
        )
    return RuleResult(
        passed=False, score=0,
        recommendation="Add at least 3 photos showing the product from different angles.",
        estimated_impact="high",
        explanation="No photos uploaded.",
        details={"count": 0},
    )
