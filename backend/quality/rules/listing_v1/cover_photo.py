"""listing_quality@v1 — cover_photo rule."""
from quality.engine import register_rule, RuleResult


@register_rule(
    algorithm="listing_quality", version="v1",
    rule_id="cover_photo", weight=15, label="Cover photo",
    description="A cover image is required — it's what buyers see in search results.",
    default_effort="low",
    edit_link_template="/maker/listings/{slug}/edit#cover-photo",
)
def cover_photo(subject) -> RuleResult:
    image = subject.get("image") or ""
    if image:
        return RuleResult(
            passed=True, score=15,
            explanation="Cover photo is set.",
        )
    return RuleResult(
        passed=False, score=0,
        recommendation="Upload a cover photo — the first image buyers see in catalog grids.",
        estimated_impact="high",
        explanation="Listings without a cover photo are skipped in most search surfaces.",
    )
