import React from "react";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { Section, Label, FieldError } from "./FormControls";
import VariationGroupsSection from "./VariationGroupsSection";

/**
 * Pricing + Variations.
 *
 * Variations are kept here (rather than in their own file) because they're
 * conceptually a pricing decision — each variation can carry a price delta
 * and its own stock count, and the buyer-facing total is computed from
 * `price + variant.price_delta`.
 */
export default function PricingSection({
  form, set, errors,
  addVariant, updateVariant, removeVariant,
  onOpenPriceCheck,   // iter334 — opens the AI Price Comparison side panel
  canPriceCheck,      // iter334 — only enable once the listing has a slug (draft saved)
}) {
  return (
    <>
      {/* ---------- Pricing ---------- */}
      <Section
        eyebrow="◆ Pricing"
        title="Pricing"
        subtitle="Set a price for your item. Crafters Market charges a platform commission on completed sales."
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Price *</Label>
            <div className="flex items-center border border-line focus-within:border-brand">
              <span className="px-3 font-mono text-sm text-ink-muted">$</span>
              <input
                type="number" min="0" step="0.01" value={form.price}
                onChange={(e) => set({ price: e.target.value })}
                placeholder="0.00"
                className="flex-1 bg-transparent outline-none px-2 py-2 font-mono text-sm"
                data-testid="editor-price"
              />
            </div>
            {errors.price && <FieldError msg={errors.price} />}
            {/* iter334 — AI Price Check companion button. Disabled until
                the listing has a slug (i.e., draft has been saved at
                least once) so the backend has something concrete to
                analyze. */}
            <button
              type="button"
              onClick={onOpenPriceCheck}
              disabled={!canPriceCheck || !form.price}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 border border-cyan-400/40 hover:border-cyan-300 hover:bg-cyan-400/5 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-300 transition"
              title={!canPriceCheck ? "Save draft first to enable price check" : !form.price ? "Enter a price first" : "Compare with similar items on the web"}
              data-testid="editor-price-check-btn"
            >
              <Sparkles size={11} /> AI Price Check
            </button>
            {!canPriceCheck && (
              <p className="font-mono text-[9px] text-ink-muted mt-1.5 leading-relaxed">
                Save the draft once to unlock — the AI compares against your listing's title, category &amp; specs.
              </p>
            )}
          </div>
          <div>
            <Label>Quantity *</Label>
            <input
              type="number" min="0" step="1" value={form.in_stock}
              onChange={(e) => set({ in_stock: e.target.value })}
              className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
              data-testid="editor-quantity"
            />
            <p className="font-mono text-[10px] text-ink-muted mt-1">units available</p>
          </div>
        </div>

        {/* Backorder controls — only relevant once the listing might hit
            0 stock. Three states: inherit (null) / on (true) / off (false).
            Lead-time is shown only when on, since `off` will never need it. */}
        <div className="mt-5 border-t border-line pt-5">
          <Label>Backorders</Label>
          <p className="font-mono text-[10px] text-ink-muted mb-3 leading-relaxed">
            When this listing hits 0 stock, should buyers be able to submit a
            backorder request? Default uses your shop-wide setting.
          </p>
          <div className="flex flex-wrap gap-2 mb-3" data-testid="editor-backorder-mode">
            {[
              { v: null,  label: "◆ Use shop default" },
              { v: true,  label: "✓ Allow backorders" },
              { v: false, label: "✕ Disable" },
            ].map((opt) => {
              const active = (form.accepts_backorders === undefined ? null : form.accepts_backorders) === opt.v;
              return (
                <button
                  key={String(opt.v)}
                  type="button"
                  onClick={() => set({ accepts_backorders: opt.v })}
                  data-testid={`editor-backorder-${opt.v === null ? "inherit" : opt.v ? "on" : "off"}`}
                  className={`px-3 py-2 border font-mono text-[11px] uppercase tracking-[0.22em] transition ${
                    active
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-line text-ink-muted hover:border-brand/50"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {form.accepts_backorders === true && (
            <div data-testid="editor-backorder-lead-row">
              <Label>Lead time (weeks)</Label>
              <input
                type="number" min="1" max="52" step="1"
                value={form.backorder_lead_weeks ?? ""}
                onChange={(e) => set({ backorder_lead_weeks: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                placeholder="4"
                className="w-32 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
                data-testid="editor-backorder-lead"
              />
              <p className="font-mono text-[10px] text-ink-muted mt-1 leading-relaxed">
                Shown to buyers as &ldquo;~N weeks after acceptance&rdquo;. Default 4 weeks if blank.
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* ---------- Variations ---------- */}
      <Section
        eyebrow="◆ Options"
        title="Variations"
        subtitle="Add option categories buyers choose from — like Color and Engraving. Each option can adjust the price, and every combination gets its own stock count, SKU, and optional price override."
      >
        {/* iter364 — Option groups are the primary path. */}
        <VariationGroupsSection form={form} set={set} />

        {/* Legacy flat list — shown only for existing listings that still
            use it (no groups defined). Adding a group above replaces it. */}
        {(form.variant_groups || []).length === 0 && form.variants.length > 0 && (
          <div className="mt-8 border-t border-line pt-6">
            <Label>Flat variations (legacy)</Label>
            <p className="font-mono text-[10px] text-ink-muted mb-3 leading-relaxed">
              This listing uses the old single-list format. You can keep editing it here,
              or add option groups above to switch to combinations.
            </p>
            <div className="space-y-3" data-testid="editor-variants">
              {/* iter334r — Column headers so the absolute price column reads clearly.  */}
              <div className="grid grid-cols-12 gap-2 font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted px-1">
                <div className="col-span-6">Label</div>
                <div className="col-span-3">Price ($)</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-1" />
              </div>
              {form.variants.map((v, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`editor-variant-${i}`}>
                  <input
                    className="col-span-6 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
                    placeholder="Label (e.g. Large · Walnut)"
                    value={v.label}
                    onChange={(e) => updateVariant(i, { label: e.target.value })}
                  />
                  <input
                    type="number" min="0" step="0.01"
                    className="col-span-3 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
                    placeholder={form.price ? `${Number(form.price).toFixed(2)}` : "0.00"}
                    value={v.price ?? ""}
                    onChange={(e) => updateVariant(i, { price: e.target.value })}
                    data-testid={`editor-variant-price-${i}`}
                  />
                  <input
                    type="number" min="0" step="1"
                    className="col-span-2 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
                    placeholder="Qty"
                    value={v.in_stock}
                    onChange={(e) => updateVariant(i, { in_stock: e.target.value })}
                  />
                  <button
                    onClick={() => removeVariant(i)}
                    className="col-span-1 p-2 text-ink-muted hover:text-red-400 justify-self-center"
                    aria-label="Remove variant"
                    data-testid={`editor-variant-remove-${i}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button" onClick={addVariant}
              className="mt-4 px-4 py-2 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2"
              data-testid="editor-add-variant"
            >
              <Plus size={12} /> Add variation
            </button>
          </div>
        )}
      </Section>
    </>
  );
}
