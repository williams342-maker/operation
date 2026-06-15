"""iter413ae — Branded boot-loader + prerender-hider contract.

Locks down the FOUC fix in `public/index.html`:
  • Inline 1-liner script stamps `html.js` BEFORE body parses, so the
    CSS rule that hides [data-prerender] applies on first paint.
  • Critical CSS lives inline in <head> so the loader paints before
    any stylesheet downloads.
  • #cm-boot-loader div sits as the FIRST child of <body> (before
    #root) so it renders without waiting on React.
  • SEO prerender block remains inside #root so non-JS crawlers
    (Bing, DuckDuckBot, Screaming Frog default) still see the full
    content + H1.
  • src/index.js flips body.cm-booted after first paint to fade the
    loader out, then removes it from the DOM.

If any one of these invariants regresses, real users will see the raw
prerender SEO text flash before React mounts — a UX regression and a
brand integrity issue. This test catches that at the source level so
the contract can't silently break.
"""
import os
import re


INDEX_HTML = "/app/frontend/public/index.html"
INDEX_JS = "/app/frontend/src/index.js"


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def test_html_js_stamp_runs_before_body():
    """The 1-liner script stamping html.js MUST appear in <head> and
    BEFORE the <body> tag — otherwise the CSS rule that hides the
    prerender block won't apply on first paint and users see the flash."""
    html = _read(INDEX_HTML)
    head_idx = html.lower().index("<head")
    body_idx = html.lower().index("<body")
    js_stamp_idx = html.find('documentElement.className+=" js"')
    assert js_stamp_idx != -1, "html.js stamp script is missing — flash of prerender content will return"
    assert head_idx < js_stamp_idx < body_idx, (
        "html.js stamp must execute in <head> before <body> parses"
    )


def test_inline_critical_css_hides_prerender_for_js_users():
    """The inline <style> in <head> MUST contain the rule that hides
    [data-prerender] for any html.js user. This is the actual mechanism
    that prevents the flash."""
    html = _read(INDEX_HTML)
    # Allow whitespace flexibility; the rule itself must be present.
    assert re.search(
        r"html\.js\s*\[data-prerender[^\]]*\]\s*\{\s*display\s*:\s*none",
        html,
    ), "CSS rule hiding [data-prerender] for html.js missing — prerender block will flash to JS users"


def test_inline_critical_css_hides_loader_for_non_js_crawlers():
    """The loader must NEVER show to non-JS crawlers — they should see
    the prerender block instead. The CSS rule guards this."""
    html = _read(INDEX_HTML)
    assert re.search(
        r"html:not\(\.js\)\s*#cm-boot-loader\s*\{\s*display\s*:\s*none",
        html,
    ), "CSS rule hiding loader from non-JS crawlers is missing"


def test_boot_loader_div_is_first_body_child_before_root():
    """The #cm-boot-loader must appear in the HTML BEFORE #root, so it
    paints first while React bootstraps."""
    html = _read(INDEX_HTML)
    loader_idx = html.find('id="cm-boot-loader"')
    root_idx = html.find('id="root"')
    assert loader_idx != -1, "Boot loader div is missing"
    assert root_idx != -1, "Root div is missing"
    assert loader_idx < root_idx, (
        "Boot loader must come BEFORE #root so it paints before React mounts"
    )


def test_boot_loader_has_brand_anchored_content():
    """Loader must include the CM monogram + Crafters Market wordmark
    + animated bar so users see a polished branded screen, not a
    generic spinner. iter413ag rebranded the literal text "CM" into an
    inline <img> referencing logo-monogram-transparent.png."""
    html = _read(INDEX_HTML)
    # Extract loader block
    m = re.search(
        r'<div id="cm-boot-loader"[^>]*>(.*?)</div>\s*<div id="root"',
        html,
        re.DOTALL,
    )
    assert m, "Could not locate the cm-boot-loader block"
    block = m.group(1)
    # Monogram is now an <img> referencing the rebranded transparent PNG
    assert "logo-monogram-transparent" in block, "CM monogram image missing from loader"
    assert "Crafters Market" in block, "Crafters Market wordmark missing from loader"
    assert "cm-boot-bar" in block, "Animated progress bar missing from loader"


def test_prerender_block_still_present_for_crawlers():
    """The whole point of the prerender block is non-JS crawlers — it
    MUST remain inline in the HTML or every Bing/DuckDuckBot/Screaming-
    Frog crawl will see an empty <div id='root'></div>."""
    html = _read(INDEX_HTML)
    assert 'data-prerender="true"' in html, (
        "Prerender block missing — non-JS crawlers will see an empty page"
    )
    # The H1 must still be there for SEO weight.
    assert "Handmade Wood, Metal, Pottery" in html


def test_react_entry_flips_cm_booted_and_removes_loader():
    """src/index.js MUST flip body.cm-booted in a rAF callback after
    render and remove the loader from the DOM — otherwise the loader
    stays visible forever."""
    js = _read(INDEX_JS)
    assert "cm-booted" in js, "index.js must add 'cm-booted' to body after mount"
    assert "requestAnimationFrame" in js, (
        "index.js must wait for first paint via rAF before fading loader"
    )
    assert "cm-boot-loader" in js, "index.js must reference the loader by id"
    assert "removeChild" in js or "remove(" in js, (
        "index.js must remove the loader from the DOM after fade"
    )
