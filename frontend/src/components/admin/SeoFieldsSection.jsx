/**
 * iter338d — Shared SEO fields section used by both Quick Edit modals
 * (design files + showcase posts).
 *
 * Collapsible by default to avoid crowding the main modal. Surfaces
 * the four canonical SEO fields the auto-tag cron also writes:
 *   - seo_title
 *   - seo_description  (textarea)
 *   - seo_tags         (CSV input, normalized server-side to list[str])
 *   - alt_text
 *
 * Props:
 *   - values        : { seoTitle, seoDescription, seoTagsCsv, altText }
 *   - setters       : { setSeoTitle, setSeoDescription, setSeoTagsCsv, setAltText }
 *   - testidPrefix  : e.g. "quick-edit" or "quick-edit-showcase"
 *   - focusBorder   : Tailwind class for input focus border (e.g. "focus:border-cyan-400")
 */
import React, { useState } from "react";

export default function SeoFieldsSection({ values, setters, testidPrefix, focusBorder }) {
  const [open, setOpen] = useState(false);
  const { seoTitle, seoDescription, seoTagsCsv, altText } = values;
  const { setSeoTitle, setSeoDescription, setSeoTagsCsv, setAltText } = setters;

  const filled = [seoTitle, seoDescription, seoTagsCsv, altText].filter((v) => (v || "").trim()).length;

  return (
    <div className="mt-4 border-t border-line pt-3">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink"
        data-testid={`${testidPrefix}-seo-toggle`}
      >
        <span>SEO fields · {filled}/4 set</span>
        <span className="text-ink-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-3 mt-3" data-testid={`${testidPrefix}-seo-section`}>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              SEO Title <span className="text-ink-muted normal-case tracking-normal">— overrides &lt;title&gt; tag</span>
            </span>
            <input
              type="text"
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              placeholder="Defaults to row title"
              className={`mt-1 w-full bg-paper border border-line ${focusBorder} px-3 py-2 font-mono text-sm text-ink outline-none`}
              data-testid={`${testidPrefix}-seo-title`}
            />
          </label>

          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              SEO Description <span className="text-ink-muted normal-case tracking-normal">— 150-160 chars ideal</span>
            </span>
            <textarea
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              placeholder="Concise summary for search results…"
              rows={2}
              className={`mt-1 w-full bg-paper border border-line ${focusBorder} px-3 py-2 font-mono text-sm text-ink outline-none resize-none`}
              data-testid={`${testidPrefix}-seo-description`}
            />
            <span className="font-mono text-[9px] text-ink-muted mt-0.5 inline-block">
              {(seoDescription || "").length} chars
            </span>
          </label>

          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Keyword Tags <span className="text-ink-muted normal-case tracking-normal">— comma-separated, max 12</span>
            </span>
            <input
              type="text"
              value={seoTagsCsv}
              onChange={(e) => setSeoTagsCsv(e.target.value)}
              placeholder="laser cut, walnut, modern decor"
              className={`mt-1 w-full bg-paper border border-line ${focusBorder} px-3 py-2 font-mono text-sm text-ink outline-none`}
              data-testid={`${testidPrefix}-seo-tags`}
            />
          </label>

          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Alt Text <span className="text-ink-muted normal-case tracking-normal">— for image accessibility + image search</span>
            </span>
            <input
              type="text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              placeholder="Describe the image briefly"
              className={`mt-1 w-full bg-paper border border-line ${focusBorder} px-3 py-2 font-mono text-sm text-ink outline-none`}
              data-testid={`${testidPrefix}-alt-text`}
            />
          </label>
        </div>
      )}
    </div>
  );
}
