"""listing_quality@v1 — product_video rule (iter413cx integration)."""
from quality.engine import register_rule, RuleResult


@register_rule(
    algorithm="listing_quality", version="v1",
    rule_id="product_video", weight=15, label="Product video",
    description="Short videos showing motion / detail materially lift conversion.",
    default_effort="medium",
    edit_link_template="/maker/listings/{slug}/edit#video",
)
def product_video(subject) -> RuleResult:
    video = subject.get("listing_video") or {}
    url = video.get("url") if isinstance(video, dict) else None
    if url:
        return RuleResult(
            passed=True, score=15,
            explanation="Product video attached.",
        )
    return RuleResult(
        passed=False, score=0,
        recommendation="Add a 60-second product video showing motion, craft details, or scale.",
        estimated_impact="medium",
        explanation="No product video — text + photos only.",
    )
