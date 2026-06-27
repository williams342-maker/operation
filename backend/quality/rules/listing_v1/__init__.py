"""iter413de — listing_quality@v1 rules.

Each file in this package registers itself on import via the
`@register_rule(algorithm="listing_quality", version="v1", ...)`
decorator. The parent `quality.__init__` imports this package to
trigger registration at process start.

v1 rule set (covers Loretta's `Listing Quality v1` outline):
  • cover_photo  — listing has a cover image
  • photo_count  — ≥3 total photos
  • description  — ≥120 chars (substantive copy)
  • product_video — iter413cx listing_video attached
  • shipping      — shipping configured (profile OR per-listing fields)
  • seo           — slug + title sane, meta_description present
  • materials     — materials field non-empty
"""
from . import (  # noqa: F401  — side-effect imports register rules
    cover_photo,
    photo_count,
    description,
    product_video,
    shipping,
    seo,
    materials,
)
