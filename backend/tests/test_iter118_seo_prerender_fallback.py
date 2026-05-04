"""
iter118 — SEO pre-mount fallback content in index.html.

Non-JS crawlers (Screaming Frog default mode, Bing, DuckDuckBot, most SEO
auditors) should see a real H1, section headings, paragraphs, and a healthy
word count when they fetch the homepage. React overwrites this block the
moment it mounts, so real users never see the fallback.

This test reads the source template at /app/frontend/public/index.html
(the build pipeline copies it untouched) and asserts the floor that our
SEO tooling needs.
"""

import re
import html
from pathlib import Path


INDEX_HTML = Path("/app/frontend/public/index.html")


def _extract_root_inner(raw: str) -> str:
    m = re.search(r'<div id="root">(.*?)</div>\s*<a\s+id="emergent-badge"', raw, re.DOTALL)
    assert m, "Could not find <div id='root'> ... <a id='emergent-badge'> in index.html"
    return m.group(1)


def test_index_html_exists():
    assert INDEX_HTML.is_file(), f"missing {INDEX_HTML}"


def test_fallback_has_single_visible_h1():
    raw = INDEX_HTML.read_text(encoding="utf-8")
    inner = _extract_root_inner(raw)
    h1s = re.findall(r"<h1[^>]*>(.*?)</h1>", inner, re.DOTALL)
    assert len(h1s) == 1, f"expected exactly 1 H1 in #root fallback, got {len(h1s)}"
    # H1 should not be sr-only / clipped / display:none — SEO tools devalue hidden H1s.
    h1_tag_open = re.search(r"<h1[^>]*>", inner).group(0)
    assert "display:none" not in h1_tag_open.lower()
    assert "clip:rect(0,0,0,0)" not in h1_tag_open.lower().replace(" ", "")
    assert "width:1px" not in h1_tag_open.lower().replace(" ", "")


def test_fallback_has_section_headings_and_paragraphs():
    raw = INDEX_HTML.read_text(encoding="utf-8")
    inner = _extract_root_inner(raw)
    h2s = re.findall(r"<h2[^>]*>", inner)
    ps = re.findall(r"<p[^>]*>", inner)
    assert len(h2s) >= 2, f"expected >=2 H2s (section headings), got {len(h2s)}"
    assert len(ps) >= 4, f"expected >=4 <p> tags, got {len(ps)}"


def test_fallback_wordcount_floor():
    raw = INDEX_HTML.read_text(encoding="utf-8")
    inner = _extract_root_inner(raw)
    text = html.unescape(re.sub(r"<[^>]+>", " ", inner))
    words = [w for w in re.split(r"\s+", text) if w]
    # Handoff screenshot flagged ~41 words. SEO auditors generally need 250+
    # for a homepage to avoid "thin content" warnings. We ship ~340.
    assert len(words) >= 250, f"fallback word count too low ({len(words)}); SEO tools flag thin content"


def test_fallback_has_primary_internal_links():
    raw = INDEX_HTML.read_text(encoding="utf-8")
    inner = _extract_root_inner(raw)
    # These are the core indexable destinations off the homepage.
    for href in ["/shop", "/makers", "/custom-order", "/journal", "/contact"]:
        assert f'href="{href}"' in inner, f"missing internal link to {href} in fallback"


def test_fallback_mentions_core_keywords():
    raw = INDEX_HTML.read_text(encoding="utf-8").lower()
    inner = _extract_root_inner(raw)
    # These keywords are the ones the marketplace actually ranks for; if any
    # one of them drops out of the fallback we want a loud test failure.
    required = ["cnc", "handcraft", "signs", "custom", "maker", "wood"]
    missing = [k for k in required if k not in inner]
    assert not missing, f"fallback missing required keywords: {missing}"


def test_fallback_is_inside_root_so_react_replaces_it():
    """React's createRoot().render() replaces children of #root, so our
    fallback MUST live inside #root (not as a sibling) or JS users will see
    a double-render flash."""
    raw = INDEX_HTML.read_text(encoding="utf-8")
    # The semantic <main data-prerender="true"> must appear inside #root.
    root_open = raw.index('<div id="root">')
    root_close_candidates = [m.start() for m in re.finditer(r"</div>", raw)]
    root_close = next(c for c in root_close_candidates if c > root_open)
    prerender_idx = raw.find('data-prerender="true"')
    assert prerender_idx != -1, "prerender marker missing"
    assert root_open < prerender_idx < root_close, "prerender block must live inside #root"
