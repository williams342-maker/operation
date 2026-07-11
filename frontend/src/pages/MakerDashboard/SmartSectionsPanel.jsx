/**
 * iter452 — Smart Sections manager. Nine automatic/manual collections a
 * maker can toggle on their storefront; Staff Picks + Featured Products
 * take hand-picked product lists.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { fetchMakerSmartSections, updateSmartSection, fetchMakerProducts } from "../../lib/api";

export default function SmartSectionsPanel() {
  const [rows, setRows] = useState(null);
  const [picking, setPicking] = useState(null); // key of the open manual picker
  const [products, setProducts] = useState(null);

  const load = () =>
    fetchMakerSmartSections().then((d) => setRows(d.sections || []))
      .catch(() => toast.error("Could not load smart sections."));
  useEffect(() => { load(); }, []);

  async function toggle(s) {
    try {
      await updateSmartSection(s.key, { enabled: !s.enabled });
      setRows((r) => r.map((x) => x.key === s.key ? { ...x, enabled: !s.enabled } : x));
      toast.success(`${s.name} ${!s.enabled ? "enabled" : "disabled"}.`);
    } catch { toast.error("Update failed."); }
  }

  async function openPicker(s) {
    if (picking === s.key) { setPicking(null); return; }
    setPicking(s.key);
    if (!products) {
      try { setProducts(await fetchMakerProducts()); }
      catch { setProducts([]); }
    }
  }

  async function togglePick(s, slug) {
    const cur = s.product_slugs || [];
    const next = cur.includes(slug) ? cur.filter((x) => x !== slug) : [...cur, slug];
    try {
      await updateSmartSection(s.key, { product_slugs: next });
      setRows((r) => r.map((x) => x.key === s.key
        ? { ...x, product_slugs: next, count: next.length } : x));
    } catch { toast.error("Could not update picks."); }
  }

  if (!rows) return null;

  return (
    <div className="mt-12" data-testid="smart-sections-panel">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} className="text-brand" />
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Smart sections</h3>
      </div>
      <p className="font-mono text-[11px] text-ink-muted mb-4 max-w-xl leading-relaxed">
        Automatic collections that keep themselves up to date from your product,
        sales and review data. Toggle each one on to show it on your storefront —
        Staff Picks and Featured Products are hand-picked by you.
      </p>
      <div className="border border-line divide-y divide-line/60">
        {rows.map((s) => (
          <div key={s.key}>
            <div className="flex items-center gap-3 px-4 py-3" data-testid={`smart-section-row-${s.key}`}>
              <button role="switch" aria-checked={s.enabled} onClick={() => toggle(s)}
                      className={`relative w-9 h-5 shrink-0 border transition ${
                        s.enabled ? "bg-brand border-brand" : "bg-surface border-line"}`}
                      data-testid={`smart-section-toggle-${s.key}`}>
                <span className={`absolute top-0.5 w-3.5 h-3.5 bg-paper transition-all ${
                  s.enabled ? "left-[18px]" : "left-0.5"}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm text-ink">
                  {s.name}
                  {s.auto
                    ? <span className="ml-2 border border-brand/40 text-brand px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]">Auto</span>
                    : <span className="ml-2 border border-line text-ink-muted px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]">Manual</span>}
                </div>
                <div className="font-mono text-[10px] text-ink-muted mt-0.5">{s.description}</div>
              </div>
              <span className="font-mono text-[10px] text-ink-muted shrink-0" data-testid={`smart-section-count-${s.key}`}>
                {s.count} product{s.count === 1 ? "" : "s"}
              </span>
              {!s.auto && (
                <button onClick={() => openPicker(s)}
                        className="border border-line hover:border-brand px-2 py-1 font-mono text-[10px] text-ink transition inline-flex items-center gap-1"
                        data-testid={`smart-section-pick-${s.key}`}>
                  Pick products {picking === s.key ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              )}
            </div>
            {picking === s.key && (
              <div className="px-4 pb-4 pt-1 bg-surface/40" data-testid={`smart-section-picker-${s.key}`}>
                {!products ? (
                  <p className="font-mono text-[11px] text-ink-muted">Loading listings…</p>
                ) : products.length === 0 ? (
                  <p className="font-mono text-[11px] text-ink-muted">No published listings yet.</p>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-1 max-h-56 overflow-y-auto">
                    {products.map((p) => (
                      <label key={p.slug}
                             className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-surface font-mono text-[11px] text-ink">
                        <input type="checkbox"
                               checked={(s.product_slugs || []).includes(p.slug)}
                               onChange={() => togglePick(s, p.slug)}
                               data-testid={`smart-pick-${s.key}-${p.slug}`} />
                        <span className="truncate">{p.title}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
