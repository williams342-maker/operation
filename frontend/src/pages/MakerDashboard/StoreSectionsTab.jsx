/**
 * iter450 — Maker Dashboard → Store Sections manager (Phase 1).
 * Create / rename / describe / hide / delete / drag-reorder sections and
 * assign listings per section. "Store Sections" = the maker's own shop
 * departments — completely separate from Marketplace Categories.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { GripVertical, Plus, Eye, EyeOff, Trash2, Pencil, ExternalLink } from "lucide-react";
import {
  fetchMakerSections, createStoreSection, updateStoreSection,
  deleteStoreSection, reorderStoreSections, setSectionProducts,
  fetchMakerProducts,
} from "../../lib/api";

export default function StoreSectionsTab({ maker }) {
  const [sections, setSections] = useState([]);
  const [allCount, setAllCount] = useState(0);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // section being edited
  const [products, setProducts] = useState(null);
  const dragId = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchMakerSections();
      setSections(d.sections || []);
      setAllCount(d.all_count || 0);
    } catch (e) { toast.error("Could not load sections."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await createStoreSection({ name: newName.trim() });
      setNewName("");
      toast.success("Section created.");
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Create failed."); }
    finally { setBusy(false); }
  }

  async function patch(id, payload, msg) {
    try {
      await updateStoreSection(id, payload);
      if (msg) toast.success(msg);
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Update failed."); }
  }

  async function remove(s) {
    if (!window.confirm(`Delete "${s.name}"? Listings stay — they just leave this section.`)) return;
    try {
      await deleteStoreSection(s.id);
      toast.success("Section deleted.");
      if (editing?.id === s.id) setEditing(null);
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Delete failed."); }
  }

  // ── Drag & drop reorder (HTML5) ────────────────────────────────────────
  function onDrop(targetId) {
    const from = sections.findIndex((s) => s.id === dragId.current);
    const to = sections.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setSections(next);
    reorderStoreSections(next.map((s) => s.id))
      .then(() => toast.success("Order saved."))
      .catch(() => { toast.error("Reorder failed."); load(); });
  }

  async function openEditor(s) {
    setEditing(s);
    if (!products) {
      try { setProducts(await fetchMakerProducts()); }
      catch { setProducts([]); }
    }
  }

  return (
    <div className="space-y-6" data-testid="store-sections-tab">
      <div>
        <h2 className="font-display text-3xl text-ink">Store Sections</h2>
        <p className="font-mono text-xs text-ink-muted mt-1 leading-relaxed max-w-xl">
          Organize your storefront into departments buyers can browse — like "Fruit Trees" or
          "Digital Downloads". Different from Marketplace Categories: categories control where
          you appear across Crafters Market; sections organize <em>your own shop</em>.
          Drag <GripVertical size={11} className="inline" /> to reorder. Hidden sections stay
          out of your storefront and Google.
        </p>
      </div>

      <form onSubmit={create} className="flex gap-2 max-w-md">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
               placeholder="New section name — e.g. Berry Plants"
               maxLength={60}
               className="flex-1 bg-paper border border-line px-3 py-2 font-mono text-sm text-ink focus:border-brand outline-none"
               data-testid="section-new-name" />
        <button type="submit" disabled={busy || !newName.trim()}
                className="px-4 py-2 bg-brand hover:bg-brand-hover text-[#0a0a0a] font-mono text-[11px] uppercase tracking-[0.16em] font-bold disabled:opacity-40 transition flex items-center gap-1.5"
                data-testid="section-create-btn">
          <Plus size={13} /> Create
        </button>
      </form>

      {sections.length === 0 ? (
        <div className="border border-dashed border-line p-8 text-center" data-testid="sections-empty">
          <p className="font-mono text-xs text-ink-muted">
            No sections yet. Your storefront shows all {allCount} listing{allCount === 1 ? "" : "s"} in
            one grid — create your first section above to give buyers a way to browse.
          </p>
        </div>
      ) : (
        <div className="border border-line divide-y divide-line max-w-3xl" data-testid="sections-list">
          <div className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted flex justify-between">
            <span>{sections.length} section{sections.length === 1 ? "" : "s"} · All Products ({allCount}) always shows first</span>
          </div>
          {sections.map((s) => (
            <div key={s.id}
                 draggable
                 onDragStart={() => { dragId.current = s.id; }}
                 onDragOver={(e) => e.preventDefault()}
                 onDrop={() => onDrop(s.id)}
                 className={`px-3 py-2.5 flex items-center gap-3 bg-paper ${!s.visible ? "opacity-60" : ""}`}
                 data-testid={`section-row-${s.slug}`}>
              <GripVertical size={14} className="text-ink-muted cursor-grab shrink-0" data-testid={`section-drag-${s.slug}`} />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm text-ink truncate">
                  {s.name}
                  <span className="text-ink-muted text-xs"> ({s.count})</span>
                  {!s.visible && (
                    <span className="ml-2 border border-amber-400/40 text-amber-500 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em]">hidden</span>
                  )}
                </div>
                <div className="font-mono text-[10px] text-ink-muted truncate">
                  /makers/{maker?.slug}/{s.slug}
                  {s.description ? ` · ${s.description}` : ""}
                </div>
              </div>
              <Link to={`/makers/${maker?.slug}/${s.slug}`} target="_blank" title="View on storefront"
                    className="text-ink-muted hover:text-brand transition" data-testid={`section-view-${s.slug}`}>
                <ExternalLink size={14} />
              </Link>
              <button onClick={() => patch(s.id, { visible: !s.visible }, s.visible ? "Section hidden." : "Section visible.")}
                      title={s.visible ? "Hide from storefront" : "Show on storefront"}
                      className="text-ink-muted hover:text-brand transition" data-testid={`section-toggle-${s.slug}`}>
                {s.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button onClick={() => openEditor(s)} title="Edit + assign listings"
                      className="text-ink-muted hover:text-brand transition" data-testid={`section-edit-${s.slug}`}>
                <Pencil size={14} />
              </button>
              <button onClick={() => remove(s)} title="Delete section"
                      className="text-ink-muted hover:text-red-400 transition" data-testid={`section-delete-${s.slug}`}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && products !== null && (
        <SectionEditor key={editing.id} section={editing} products={products}
                       onClose={() => setEditing(null)}
                       onSaved={() => { setEditing(null); load(); }} />
      )}
      {editing && products === null && (
        <p className="font-mono text-[11px] text-ink-muted">Loading listings…</p>
      )}
    </div>
  );
}

function SectionEditor({ section, products, onClose, onSaved }) {
  const [name, setName] = useState(section.name);
  const [description, setDescription] = useState(section.description || "");
  const [image, setImage] = useState(section.image || "");
  const [selected, setSelected] = useState(
    () => new Set(products.filter((p) => (p.section_slugs || []).includes(section.slug)).map((p) => p.slug)));
  const [saving, setSaving] = useState(false);

  const toggle = (slug) => setSelected((prev) => {
    const n = new Set(prev);
    n.has(slug) ? n.delete(slug) : n.add(slug);
    return n;
  });

  async function save() {
    setSaving(true);
    try {
      await updateStoreSection(section.id, {
        name: name.trim() || section.name,
        description, image: image.trim(),
      });
      await setSectionProducts(section.id, [...selected]);
      toast.success("Section saved.");
      onSaved();
    } catch (err) { toast.error(err?.response?.data?.detail || "Save failed."); }
    finally { setSaving(false); }
  }

  return (
    <div className="border border-brand/40 p-4 max-w-3xl space-y-4" data-testid="section-editor">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-[0.22em] text-brand">◆ Edit · {section.name}</h3>
        <button onClick={onClose} className="font-mono text-[10px] uppercase text-ink-muted hover:text-ink" data-testid="section-editor-close">✕ Close</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
                 className="w-full bg-paper border border-line px-3 py-2 font-mono text-sm mt-1 focus:border-brand outline-none"
                 data-testid="section-editor-name" />
          <p className="font-mono text-[9px] text-ink-muted mt-1">
            Renaming keeps the URL (/{section.slug}) stable so links and Google rankings survive.
          </p>
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">Banner image URL <span className="normal-case">(optional)</span></label>
          <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…"
                 className="w-full bg-paper border border-line px-3 py-2 font-mono text-sm mt-1 focus:border-brand outline-none"
                 data-testid="section-editor-image" />
        </div>
      </div>
      <div>
        <label className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">Description <span className="normal-case">(optional — shows atop the section page)</span></label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2}
                  className="w-full bg-paper border border-line px-3 py-2 font-mono text-sm mt-1 focus:border-brand outline-none"
                  data-testid="section-editor-description" />
      </div>
      <div>
        <label className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          Listings in this section ({selected.size})
        </label>
        <div className="border border-line mt-1 max-h-64 overflow-y-auto divide-y divide-line/50" data-testid="section-editor-products">
          {products.length === 0 && (
            <p className="font-mono text-[11px] text-ink-muted p-3">No listings yet.</p>
          )}
          {products.map((p) => (
            <label key={p.slug} className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-surface">
              <input type="checkbox" checked={selected.has(p.slug)} onChange={() => toggle(p.slug)}
                     className="accent-[#ff4500]" data-testid={`section-editor-product-${p.slug}`} />
              <span className="font-mono text-xs text-ink truncate flex-1">{p.title}</span>
              <span className={`font-mono text-[9px] uppercase ${p.status === "published" ? "text-green-600" : "text-ink-muted"}`}>{p.status}</span>
            </label>
          ))}
        </div>
      </div>
      <button onClick={save} disabled={saving}
              className="px-5 py-2 bg-brand hover:bg-brand-hover text-[#0a0a0a] font-mono text-[11px] uppercase tracking-[0.16em] font-bold disabled:opacity-40 transition"
              data-testid="section-editor-save">
        {saving ? "Saving…" : "Save section"}
      </button>
    </div>
  );
}
