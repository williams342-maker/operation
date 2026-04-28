import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Section, Label, FieldError } from "./FormControls";

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
            <div className="flex items-center border border-[#262626] focus-within:border-[#ff4500]">
              <span className="px-3 font-mono text-sm text-[#a3a3a3]">$</span>
              <input
                type="number" min="0" step="0.01" value={form.price}
                onChange={(e) => set({ price: e.target.value })}
                placeholder="0.00"
                className="flex-1 bg-transparent outline-none px-2 py-2 font-mono text-sm"
                data-testid="editor-price"
              />
            </div>
            {errors.price && <FieldError msg={errors.price} />}
          </div>
          <div>
            <Label>Quantity *</Label>
            <input
              type="number" min="0" step="1" value={form.in_stock}
              onChange={(e) => set({ in_stock: e.target.value })}
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
              data-testid="editor-quantity"
            />
            <p className="font-mono text-[10px] text-[#525252] mt-1">units available</p>
          </div>
        </div>
      </Section>

      {/* ---------- Variations ---------- */}
      <Section
        eyebrow="◆ Options"
        title="Variations"
        subtitle="Add options buyers can choose — like size, color, or finish. You can also add a price difference per option."
      >
        {form.variants.length === 0 ? (
          <div className="border border-dashed border-[#262626] p-8 text-center" data-testid="editor-variants-empty">
            <p className="font-mono text-xs text-[#737373] mb-1">No variations yet.</p>
            <p className="font-mono text-[10px] text-[#525252]">e.g. Size: Small, Medium, Large</p>
          </div>
        ) : (
          <div className="space-y-3" data-testid="editor-variants">
            {form.variants.map((v, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`editor-variant-${i}`}>
                <input
                  className="col-span-6 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
                  placeholder="Label (e.g. Large · Walnut)"
                  value={v.label}
                  onChange={(e) => updateVariant(i, { label: e.target.value })}
                />
                <input
                  type="number" step="0.01"
                  className="col-span-3 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
                  placeholder="±$"
                  value={v.price_delta}
                  onChange={(e) => updateVariant(i, { price_delta: e.target.value })}
                />
                <input
                  type="number" min="0" step="1"
                  className="col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
                  placeholder="Qty"
                  value={v.in_stock}
                  onChange={(e) => updateVariant(i, { in_stock: e.target.value })}
                />
                <button
                  onClick={() => removeVariant(i)}
                  className="col-span-1 p-2 text-[#737373] hover:text-red-400 justify-self-center"
                  aria-label="Remove variant"
                  data-testid={`editor-variant-remove-${i}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button" onClick={addVariant}
          className="mt-4 px-4 py-2 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2"
          data-testid="editor-add-variant"
        >
          <Plus size={12} /> Add variation
        </button>
      </Section>
    </>
  );
}
