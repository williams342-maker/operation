"""listing_quality@v1 — seo rule (title, slug, meta_description)."""
from quality.engine import register_rule, RuleResult


@register_rule(
    algorithm="listing_quality", version="v1",
    rule_id="seo", weight=15, label="SEO completeness",
    description="Title length + meta_description + slug quality all matter for search.",
    default_effort="low",
    edit_link_template="/maker/listings/{slug}/edit#seo",
)
def seo(subject) -> RuleResult:
    title = (subject.get("title") or "").strip()
    slug = (subject.get("slug") or "").strip()
    meta = (subject.get("meta_description") or "").strip()
    issues: list = []
    score = 0
    # Title 20-80 chars is the sweet spot for SERP truncation.
    if 20 <= len(title) <= 80:
        score += 6
    elif title:
        issues.append("title length should be 20–80 chars")
    else:
        issues.append("title is missing")
    # Slug present + lowercase + hyphen-separated.
    if slug and slug == slug.lower() and " " not in slug:
        score += 3
    elif slug:
        issues.append("slug should be lowercase + hyphenated")
    else:
        issues.append("slug is missing")
    # Meta description ≥ 80 chars.
    if len(meta) >= 80:
        score += 6
    elif meta:
        issues.append("meta_description should be 80+ chars")
    else:
        issues.append("meta_description is missing")
    if score >= 14:
        return RuleResult(
            passed=True, score=score,
            explanation="SEO fields complete.",
        )
    return RuleResult(
        passed=False, score=score,
        recommendation="Fix: " + "; ".join(issues) + ".",
        estimated_impact="medium",
        explanation="SEO gaps reduce organic visibility.",
        details={"issues": issues},
    )
