import React, { useRef } from "react";
import { Plus, Trash2, GripVertical, Image as ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Label } from "./FormControls";

/**
 * iter364 — Variation groups editor (seller-feedback feature).
 *
 * Makers define named option CATEGORIES (Color, Engraving…) instead of a
 * flat list. Each option carries a +$ adjustment and an optional image.
 * Combinations are generated automatically (cartesian product) into
 * `form.variants` — the same flat rows the cart/checkout/stock pipeline
 * already understands — with `option_ids` recording which options compose
 * each combo. Per-combo qty, SKU and an optional absolute price override
 * are editable in the combinations table below the groups.
 *
 * Regeneration PRESERVES existing combo rows (matched by option-id set)
 * so editing a group name or adding a 3rd group doesn't wipe inventory
 * counts the maker already typed.
 *
 * Drag-reorder: group cards and option rows are HTML5-draggable.
 */

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const MAX_OPTION_IMG_BYTES = 4 * 1024 * 1024;

export default function VariationGroupsSection({ form, set }) {
  const groups = form.variant_groups || [];
  const drag = useRef(null); // { type: "group"|"option", gIdx, oIdx }

  // ---- Combo generation (cartesian product, preserving matches) ----
  const syncCombos = (nextGroups) => {
    const effective = nextGroups
      .map((g) => ({ ...g, options: (g.options || []).filter((o) => (o.label || "").trim()) }))
      .filter((g) => g.options.length > 0);
    let combos = [];
    if (effective.length > 0) {
      let rows = [[]];
      for (const g of effective) {
        rows = rows.flatMap((r) => g.options.map((o) => [...r, o]));
      }
      combos = rows.map((opts) => {
        const ids = opts.map((o) => o.id);
        const existing = (form.variants || []).find((v) => {
          const vids = v.option_ids || [];
          return vids.length === ids.length && ids.every((id) => vids.includes(id));
        });
        const delta = opts.reduce((s, o) => s + (Number(o.price_delta) || 0), 0);
        return {
          id: existing?.id || uid(),
          label: opts.map((o) => o.label.trim()).join(" / "),
          price: existing?.price ?? "",          // optional per-combo override
          price_delta: delta,
          in_stock: existing?.in_stock ?? 1,
          sku: existing?.sku || "",
          option_ids: ids,
          image: existing?.image || null,
        };
      });
    }
    set({ variant_groups: nextGroups, variants: combos });
  };

  // ---- Group ops ----
  const addGroup = () => {
    if (groups.length === 0 && (form.variants || []).length > 0 && !(form.variants || []).some((v) => (v.option_ids || []).length)) {
      toast.message("Heads up — switching to option groups will replace your current flat variation list.");
    }
    syncCombos([...groups, { id: uid(), name: "", options: [] }]);
  };
  const patchGroup = (gIdx, patch) =>
    syncCombos(groups.map((g, i) => (i === gIdx ? { ...g, ...patch } : g)));
  const removeGroup = (gIdx) => syncCombos(groups.filter((_, i) => i !== gIdx));

  // ---- Option ops ----
  const addOption = (gIdx) =>
    patchGroup(gIdx, {
      options: [...(groups[gIdx].options || []), { id: uid(), label: "", price_delta: 0, image: null }],
    });
  const patchOption = (gIdx, oIdx, patch) =>
    patchGroup(gIdx, {
      options: groups[gIdx].options.map((o, i) => (i === oIdx ? { ...o, ...patch } : o)),
    });
  const removeOption = (gIdx, oIdx) =>
    patchGroup(gIdx, { options: groups[gIdx].options.filter((_, i) => i !== oIdx) });

  // ---- Drag reorder ----
  const onDropGroup = (gIdx) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.type !== "group" || d.gIdx === gIdx) return;
    const next = [...groups];
    const [moved] = next.splice(d.gIdx, 1);
    next.splice(gIdx, 0, moved);
    syncCombos(next);
  };
  const onDropOption = (gIdx, oIdx) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.type !== "option" || d.gIdx !== gIdx || d.oIdx === oIdx) return;
    const opts = [...groups[gIdx].options];
    const [moved] = opts.splice(d.oIdx, 1);
    opts.splice(oIdx, 0, moved);
    patchGroup(gIdx, { options: opts });
  };

  // ---- Option image (data URL → backend uploads to R2 on save) ----
  const pickOptionImage = (gIdx, oIdx, file) => {
    if (!file) return;
    if (file.size > MAX_OPTION_IMG_BYTES) {
      toast.error("Option image is too large. Max 4 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => patchOption(gIdx, oIdx, { image: reader.result });
    reader.readAsDataURL(file);
  };

  // ---- Combos table editing ----
  const patchCombo = (comboId, patch) =>
    set({
      variants: (form.variants || []).map((v) => (v.id === comboId ? { ...v, ...patch } : v)),
    });

  const combos = (form.variants || []).filter((v) => (v.option_ids || []).length > 0);
  const basePrice = Number(form.price) || 0;

  return (
    <div data-testid="editor-variant-groups">
      {groups.map((g, gIdx) => (
        <div
          key={g.id}
          className="border border-line bg-surface p-4 mb-3"
          data-testid={`editor-group-${gIdx}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDropGroup(gIdx)}
        >
          <div className="flex items-center gap-2 mb-3">
            <span
              draggable
              onDragStart={() => { drag.current = { type: "group", gIdx }; }}
              className="cursor-grab text-ink-muted hover:text-ink"
              title="Drag to reorder groups"
              data-testid={`editor-group-drag-${gIdx}`}
            >
              <GripVertical size={16} />
            </span>
            <input
              className="flex-1 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
              placeholder='Category name (e.g. "Color", "Engraving")'
              value={g.name}
              onChange={(e) => patchGroup(gIdx, { name: e.target.value })}
              data-testid={`editor-group-name-${gIdx}`}
            />
            <button
              type="button"
              onClick={() => removeGroup(gIdx)}
              className="p-2 text-ink-muted hover:text-red-400"
              aria-label="Remove group"
              data-testid={`editor-group-remove-${gIdx}`}
            >
              <Trash2 size={14} />
            </button>
          </div>

          {(g.options || []).length > 0 && (
            <div className="grid grid-cols-12 gap-2 font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted px-1 mb-1">
              <div className="col-span-1" />
              <div className="col-span-6">Option</div>
              <div className="col-span-3">Adjustment (+$)</div>
              <div className="col-span-2" />
            </div>
          )}
          {(g.options || []).map((o, oIdx) => (
            <div
              key={o.id}
              className="grid grid-cols-12 gap-2 items-center mb-2"
              data-testid={`editor-option-${gIdx}-${oIdx}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDropOption(gIdx, oIdx)}
            >
              <span
                draggable
                onDragStart={() => { drag.current = { type: "option", gIdx, oIdx }; }}
                className="col-span-1 cursor-grab text-ink-muted hover:text-ink justify-self-center"
                title="Drag to reorder"
              >
                <GripVertical size={13} />
              </span>
              <input
                className="col-span-6 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
                placeholder="e.g. Tan"
                value={o.label}
                onChange={(e) => patchOption(gIdx, oIdx, { label: e.target.value })}
                data-testid={`editor-option-label-${gIdx}-${oIdx}`}
              />
              <input
                type="number" step="0.01"
                className="col-span-3 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
                placeholder="0.00"
                value={o.price_delta === 0 ? "" : o.price_delta}
                onChange={(e) => patchOption(gIdx, oIdx, { price_delta: e.target.value === "" ? 0 : Number(e.target.value) })}
                data-testid={`editor-option-delta-${gIdx}-${oIdx}`}
              />
              <div className="col-span-2 flex items-center gap-1 justify-self-end">
                {o.image ? (
                  <span className="relative inline-block">
                    <img src={o.image} alt="" className="w-8 h-8 object-cover border border-line" />
                    <button
                      type="button"
                      onClick={() => patchOption(gIdx, oIdx, { image: null })}
                      className="absolute -top-1.5 -right-1.5 bg-paper border border-line rounded-full p-0.5 text-ink-muted hover:text-red-400"
                      aria-label="Remove option image"
                    >
                      <X size={9} />
                    </button>
                  </span>
                ) : (
                  <label
                    className="p-2 border border-line hover:border-brand text-ink-muted hover:text-brand cursor-pointer"
                    title="Optional image — swaps the gallery when buyers pick this option"
                  >
                    <ImageIcon size={13} />
                    <input
                      type="file" accept="image/*" className="hidden"
                      onChange={(e) => { pickOptionImage(gIdx, oIdx, e.target.files?.[0]); e.target.value = ""; }}
                      data-testid={`editor-option-image-${gIdx}-${oIdx}`}
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => removeOption(gIdx, oIdx)}
                  className="p-2 text-ink-muted hover:text-red-400"
                  aria-label="Remove option"
                  data-testid={`editor-option-remove-${gIdx}-${oIdx}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addOption(gIdx)}
            className="mt-1 px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5"
            data-testid={`editor-add-option-${gIdx}`}
          >
            <Plus size={11} /> Add option
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addGroup}
        className="px-4 py-2 border border-brand/50 text-brand hover:bg-brand/10 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2"
        data-testid="editor-add-group"
      >
        <Plus size={12} /> Add option group
      </button>
      {groups.length === 0 && (
        <p className="font-mono text-[10px] text-ink-muted mt-2 leading-relaxed">
          e.g. Group 1: Color (Tan / Brown / Black) · Group 2: Engraving (Front only / Both sides).
          Combinations are generated automatically below.
        </p>
      )}

      {/* ---- Generated combinations ---- */}
      {combos.length > 0 && (
        <div className="mt-6" data-testid="editor-combos">
          <Label>Combinations · {combos.length}</Label>
          <p className="font-mono text-[10px] text-ink-muted mb-3 leading-relaxed">
            Auto-generated from your groups. Set stock per combination; SKU and price
            override are optional — blank price = base ${basePrice.toFixed(2)} + adjustments.
          </p>
          <div className="grid grid-cols-12 gap-2 font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted px-1 mb-1">
            <div className="col-span-4">Combination</div>
            <div className="col-span-2">Price</div>
            <div className="col-span-2">Override ($)</div>
            <div className="col-span-2">SKU</div>
            <div className="col-span-2">Qty</div>
          </div>
          {combos.map((c, i) => {
            const computed = basePrice + (Number(c.price_delta) || 0);
            const override = c.price !== "" && c.price != null && Number(c.price) > 0;
            return (
              <div key={c.id} className="grid grid-cols-12 gap-2 items-center mb-2" data-testid={`editor-combo-${i}`}>
                <div className="col-span-4 font-mono text-xs text-ink truncate" title={c.label}>{c.label}</div>
                <div className={`col-span-2 font-mono text-xs ${override ? "line-through text-ink-muted" : "text-brand"}`}>
                  ${computed.toFixed(2)}
                </div>
                <input
                  type="number" min="0" step="0.01"
                  className="col-span-2 bg-transparent border border-line focus:border-brand outline-none px-2 py-1.5 font-mono text-xs"
                  placeholder="—"
                  value={c.price ?? ""}
                  onChange={(e) => patchCombo(c.id, { price: e.target.value })}
                  data-testid={`editor-combo-override-${i}`}
                />
                <input
                  className="col-span-2 bg-transparent border border-line focus:border-brand outline-none px-2 py-1.5 font-mono text-xs"
                  placeholder="SKU"
                  value={c.sku || ""}
                  onChange={(e) => patchCombo(c.id, { sku: e.target.value })}
                  data-testid={`editor-combo-sku-${i}`}
                />
                <input
                  type="number" min="0" step="1"
                  className="col-span-2 bg-transparent border border-line focus:border-brand outline-none px-2 py-1.5 font-mono text-xs"
                  value={c.in_stock}
                  onChange={(e) => patchCombo(c.id, { in_stock: e.target.value })}
                  data-testid={`editor-combo-qty-${i}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
