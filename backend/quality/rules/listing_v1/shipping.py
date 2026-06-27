"""listing_quality@v1 — shipping rule (profile attached / per-listing fields)."""
from quality.engine import register_rule, RuleResult


@register_rule(
    algorithm="listing_quality", version="v1",
    rule_id="shipping", weight=10, label="Shipping",
    description="Shipping cost + processing time MUST be set before checkout works.",
)
def shipping(subject) -> RuleResult:
    has_profile = bool(subject.get("shipping_profile_id"))
    flat_rate = subject.get("shipping_flat_rate_cents")
    processing_days = subject.get("processing_time_days")
    has_flat = flat_rate is not None
    has_processing = processing_days is not None
    if has_profile or (has_flat and has_processing):
        return RuleResult(
            passed=True, score=10,
            explanation="Shipping configured." +
                        (" (profile)" if has_profile else " (per-listing rate + processing)"),
        )
    missing = []
    if not has_flat and not has_profile:
        missing.append("shipping cost")
    if not has_processing and not has_profile:
        missing.append("processing time")
    return RuleResult(
        passed=False, score=0,
        recommendation=f"Set {' and '.join(missing)} (or attach a Shipping Profile in Settings).",
        estimated_impact="high",
        explanation="Listings without shipping config can't checkout.",
    )
