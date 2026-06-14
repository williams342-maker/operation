"""iter413x — Pinterest Rich Pin metadata contract.

Pinterest reads OpenGraph + article:* meta tags to auto-format Article
Rich Pins (the pinned card with title + description + author + section
badge). If any of these tags get dropped during a refactor, the Pin
silently degrades to a plain image with no metadata.

Since pytest can't render the React SPA, this file uses static-source
asserts on the SEO landing pages + lib/seo.js to pin the contract that
matters most.

What this catches:
  • Removal of article:author / article:section emission in lib/seo.js
  • A page that flips from `ogType: "article"` back to "website" without
    intent, breaking the Rich Pin classification at Pinterest's side
  • An SEO landing page that forgets to declare an articleSection
"""
import os

import pytest

SEO_LIB = "/app/frontend/src/lib/seo.js"
ARTICLE_PAGES = [
    ("/app/frontend/src/pages/FreeSvgPackPage.jsx", "free-svg-pack"),
    ("/app/frontend/src/pages/HowCustomOrdersWorkPage.jsx", "how-custom-orders-work"),
    ("/app/frontend/src/pages/SEOLandingPage.jsx", "SEO-landing"),
]


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_seo_hook_emits_pinterest_rich_pin_tags():
    """`lib/seo.js` MUST emit the Pinterest-Rich-Pin tags it owns
    (og:type + article:*). Static dimensions (og:image:width/height)
    live in `public/index.html` and apply to the default brand image —
    those are checked separately by the rendered audit in the
    iter413x docs section of the PRD."""
    src = _read(SEO_LIB)
    required = ["og:type", "article:author", "article:section",
                "article:published_time", "og:image"]
    for tag in required:
        assert tag in src, (
            f"iter413x regression: lib/seo.js stopped emitting {tag!r}. "
            "Pinterest Rich Pins require the full OG + article:* tag "
            "set — without it, pinned cards lose author/section badges "
            "and degrade to plain image Pins."
        )


def test_static_index_html_has_image_dimensions():
    """`public/index.html` MUST declare og:image:width + og:image:height
    so Pinterest gets dimensions for the default brand OG image. The
    rich-pin validator rejects pins missing width/height when the
    image is on a domain without a width-header. (Verified end-to-end
    via a Playwright DOM audit on every Article page in iter413x.)"""
    html = _read("/app/frontend/public/index.html")
    assert "og:image:width" in html, (
        "iter413x regression: public/index.html stopped emitting "
        "og:image:width. Pinterest Rich Pin validation requires it."
    )
    assert "og:image:height" in html, (
        "iter413x regression: public/index.html stopped emitting "
        "og:image:height. Pinterest Rich Pin validation requires it."
    )


@pytest.mark.parametrize("path,label", ARTICLE_PAGES)
def test_seo_landing_pages_declare_article_og_type(path, label):
    """Every page that's a Pinterest-target SEO surface MUST declare
    `ogType: "article"` so Pinterest classifies it as an Article Rich
    Pin (not a Product Pin, not a plain Open Graph object)."""
    src = _read(path)
    assert 'ogType: "article"' in src, (
        f"iter413x regression: {label} stopped declaring ogType=article. "
        "Pinterest will reclassify it as a plain Open Graph object and "
        "drop the Rich Pin badge (author, section)."
    )


@pytest.mark.parametrize("path,label", [
    ("/app/frontend/src/pages/FreeSvgPackPage.jsx", "free-svg-pack"),
    ("/app/frontend/src/pages/HowCustomOrdersWorkPage.jsx", "how-custom-orders-work"),
])
def test_pinterest_target_pages_declare_article_section(path, label):
    """Hand-curated SEO landing pages (`/free-svg-pack`,
    `/how-custom-orders-work`) MUST declare an `articleSection`.
    Without it, the Pinterest Rich Pin card shows no category label
    and the pin looks generic in the user's feed."""
    src = _read(path)
    assert "articleSection:" in src, (
        f"iter413x regression: {label} no longer passes `articleSection` "
        "to useStructuredData. Pinterest Rich Pin cards will render "
        "without a category badge."
    )


def test_seo_landing_template_declares_article_section():
    """SEOLandingPage.jsx (template used by /handmade-pottery, /handmade-mugs,
    etc.) must pass an articleSection derived from the page's category."""
    src = _read("/app/frontend/src/pages/SEOLandingPage.jsx")
    assert "articleSection" in src, (
        "iter413x regression: SEOLandingPage.jsx stopped emitting "
        "articleSection. The 10 keyword-targeted landing pages will "
        "all lose Pinterest Rich Pin category badges at once."
    )
