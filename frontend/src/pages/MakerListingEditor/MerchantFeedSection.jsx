import React, { useEffect, useRef, useState } from "react";
import { ShieldCheck, EyeOff } from "lucide-react";
import { Section, Label, ToggleRow } from "./FormControls";
import { previewMerchantFeed } from "../../lib/api";

/**
 * iter365 — Merchant feed settings (Google Shopping).
 *
 * Google Merchant false-positives engraved knife listings into the
 * restricted "Guns and Parts" bucket off title keywords. This section
 * gives makers control over what the GOOGLE FEED exports while the
 * marketplace listing stays untouched:
 *   • Auto optimize  — feed swaps restricted terms (hunting→outdoor,
 *     knife→keepsake…) automatically
 *   • Title override — a hand-written Google-only title wins over both
 *   • Exclude        — drop the listing from the Google feed entirely
 *   • Live preview   — shows exactly what Google will receive
 */
export default function MerchantFeedSection({ form, set }) {
  const [preview, setPreview] = useState(null);
  const timer = useRef(null);

  // Debounced live preview — pure read, server applies the same rules
  // as the real feed (including admin category rules).
  useEffect(() => {
    if (!form.title?.trim()) { setPreview(null); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      previewMerchantFeed({
        title: form.title,
        description: (form.description || "").slice(0, 5000),
        category: form.category || "",
        merchant_title: (form.merchant_title || "").trim() || null,
        merchant_auto_optimize: !!form.merchant_auto_optimize,
        merchant_exclude: !!form.merchant_exclude,
        // iter366 — attribute preview inputs
        materials: (form.materials || []).join(", ").slice(0, 300),
        gpc_path: form.gpc_path || "",
        technique: form.technique || "",
      }).then(setPreview).catch(() => setPreview(null));
    }, 500);
    return () => clearTimeout(timer.current);
  }, [form.title, form.description, form.category, form.merchant_title, form.merchant_auto_optimize, form.merchant_exclude, form.materials, form.gpc_path, form.technique]);

  return (
    <Section
      eyebrow="◆ Google Shopping"
      title="Merchant Feed Settings"
      subtitle="Google Merchant sometimes flags engraved knives and outdoor gear as restricted products based on title keywords. These settings change ONLY what the Google feed exports — your marketplace listing, URL, and title stay exactly as you wrote them."
    >
      <ToggleRow
        on={!!form.merchant_auto_optimize}
        onChange={(v) => set({ merchant_auto_optimize: v })}
        label="Auto optimize for Google"
        hint="Automatically swaps restricted terms in the feed (hunting → outdoor, knife → keepsake, tactical → custom…). Recommended on."
        testid="editor-merchant-auto-optimize"
      />
      <div className="mt-4">
        <Label>
          Merchant feed title <span className="text-ink-muted normal-case">(optional override — Google only)</span>
        </Label>
        <input
          value={form.merchant_title || ""}
          onChange={(e) => set({ merchant_title: e.target.value })}
          maxLength={150}
          placeholder='e.g. "Personalized Engraved Outdoor Gift – Rosewood Handle Custom Engraving"'
          className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
          data-testid="editor-merchant-title"
        />
        <p className="font-mono text-[10px] text-ink-muted mt-1">
          When set, this exact title goes to Google instead of your listing title or the auto-optimized one.
        </p>
      </div>
      <div className="mt-4">
        <ToggleRow
          on={!!form.merchant_exclude}
          onChange={(v) => set({ merchant_exclude: v })}
          label="Exclude from Merchant sync"
          hint="Removes this listing from the Google Shopping feed entirely. It stays live on the marketplace."
          testid="editor-merchant-exclude"
        />
      </div>

      {/* ---- Live preview ---- */}
      {preview && (
        <div
          className="mt-5 border border-line bg-surface p-4"
          data-testid="editor-merchant-preview"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2 inline-flex items-center gap-1.5">
            {preview.include ? <ShieldCheck size={12} className="text-brand" /> : <EyeOff size={12} />}
            Google will receive
          </div>
          {preview.include ? (
            <>
              <div className="font-mono text-sm text-ink" data-testid="editor-merchant-preview-title">
                {preview.title}
              </div>
              <div className="font-mono text-[10px] text-ink-muted mt-2">
                {preview.mode === "override" && "Using your override title."}
                {preview.mode === "rewritten" && "Auto-optimized — restricted terms replaced."}
                {preview.mode === "original" && "No restricted terms found — original title syncs unchanged."}
                {preview.category_rule === "sync" && " (Admin rule: this category always syncs as-is.)"}
              </div>
              {(preview.hits || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2" data-testid="editor-merchant-preview-hits">
                  {preview.hits.map((h) => (
                    <span key={h} className="px-2 py-0.5 border border-amber-500/40 text-amber-600 dark:text-brand font-mono text-[10px] uppercase tracking-[0.14em]">
                      {h}
                    </span>
                  ))}
                </div>
              )}
              {/* iter366 — category-aware attributes: what the feed row
                  carries (✓) vs. suppresses (✗), so sellers never wonder
                  why Google isn't asking them for "gender" on a box. */}
              {preview.attributes_sent && (
                <div className="mt-3 pt-3 border-t border-line" data-testid="editor-merchant-preview-attributes">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1.5">
                    Attributes sent
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {Object.entries(preview.attributes_sent).map(([k, v]) => (
                      <span key={k} className="font-mono text-[11px] text-ink" data-testid={`editor-merchant-attr-${k}`}>
                        <span className="text-green-600 dark:text-green-700">✓</span> {k}
                        <span className="text-ink-muted"> · {v}</span>
                      </span>
                    ))}
                    {(preview.attributes_suppressed || []).map((k) => (
                      <span key={k} className="font-mono text-[11px] text-ink-muted" data-testid={`editor-merchant-attr-${k}-suppressed`}>
                        ✗ {k}
                      </span>
                    ))}
                  </div>
                  <div className="font-mono text-[10px] text-ink-muted mt-1.5">
                    Warnings: {(preview.attribute_warnings || []).length === 0
                      ? "none"
                      : preview.attribute_warnings.join(" · ")}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="font-mono text-xs text-ink-muted" data-testid="editor-merchant-preview-excluded">
              {preview.mode === "category_excluded"
                ? "Excluded by an admin category rule — this category doesn't sync to Google."
                : "Excluded — this listing will not appear in the Google Shopping feed."}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
