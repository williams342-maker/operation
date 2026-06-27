"""iter413de — Quality scoring engine entry point.

Importing `quality` triggers all v1 rule registrations and pins the
defaults. Future versions (`listing_quality@v2`, etc.) sit alongside
in `quality/rules/listing_v2/` and get pinned with another
`set_default_version()` call when they're ready."""
from .engine import (  # noqa: F401  re-export the public API
    register_rule, evaluate, set_default_version,
    registered_algorithms, RuleResult,
)
from .rules import listing_v1  # noqa: F401  side-effect: registers rules

set_default_version("listing_quality", "v1")
