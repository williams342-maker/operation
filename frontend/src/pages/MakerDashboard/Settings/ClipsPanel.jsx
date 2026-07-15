import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, ExternalLink, Film, Upload, Link as LinkIcon, Pencil, Search, X, ChevronUp, ChevronDown, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  fetchMyClips, createClipFromUrl, deleteMyClip, fetchClipCategories,
  uploadClipFile, fetchClipEditDetails, updateMyClip, searchMyClipProducts, setClipProducts,
} from "../../../lib/api";
import { useConfirm } from "../useConfirm";
import EmptyState from "../../../components/EmptyState";
import { RowsSkeleton } from "../../../components/Skeleton";
import IncentiveBanner from "../../../components/ClipsIncentiveBanner";

const FALLBACK_CATS = [
  // iter344 — kept in sync with backend `routers/clips.py::CATEGORIES`.
  // This is the fallback for when fetchClipCategories() hasn't responded
  // yet; the live list always wins (`setCats(r.categories)` below).
  { id: "workshop",      label: "Workshop clips",       emoji: "◆" },
  { id: "cuts",          label: "Satisfying cuts",      emoji: "✕" },
  { id: "welding",       label: "Welding sparks",       emoji: "⚡" },
  { id: "powder-coat",   label: "Powder coating",       emoji: "▣" },
  { id: "engraving",     label: "Engraving",            emoji: "✎" },
  { id: "before-after",  label: "Before / after",       emoji: "↺" },
  { id: "textiles",      label: "Textiles & fiber",     emoji: "✦" },
  { id: "pottery",       label: "Pottery & ceramics",   emoji: "◍" },
  { id: "jewelry",       label: "Jewelry",              emoji: "◇" },
  { id: "leather",       label: "Leatherwork",          emoji: "▰" },
  { id: "candles-soap",  label: "Candles & soap",       emoji: "❋" },
  { id: "glass",         label: "Glass",                emoji: "❖" },
  { id: "knife-making",  label: "Knife making",         emoji: "▲" },
  { id: "paper",         label: "Paper & print",        emoji: "▤" },
  { id: "resin",         label: "Resin",                emoji: "◐" },
  { id: "florals",       label: "Florals & botanicals", emoji: "✿" },
];

/**
 * Maker self-serve panel for the Clip Feed.
 *
 * Posts to the shared `clips` collection (not the maker-scoped
 * `workshop_videos` field) so they appear in the global feed at
 * `/clips`. Uses YouTube/Vimeo URL embeds — no R2 native upload yet.
 *
 * Includes a small per-clip preview row with delete + a direct
 * "view in feed" link so the maker can verify their post immediately.
 */
export default function ClipsPanel() {
  const [confirm, confirmModal] = useConfirm();
  const [items, setItems] = useState(null);
  const [cats, setCats] = useState(FALLBACK_CATS);
  // `mode = 'url'` = paste a YouTube/Vimeo link; `'file'` = drag-drop MP4.
  const [mode, setMode] = useState("url");
  const [form, setForm] = useState({
    url: "", title: "", description: "", category: "workshop", tags: "", product_slug: "",
  });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  // R2 upload state — separate from form so the progress bar can update
  // without re-rendering the URL form.
  const fileInputRef = useRef(null);
  const [pickedFile, setPickedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const refresh = async () => {
    try {
      const r = await fetchMyClips();
      setItems(r.items || []);
    } catch (e) {
      toast.error("Couldn't load your clips.");
      setItems([]);
    }
  };

  useEffect(() => {
    refresh();
    fetchClipCategories().then((r) => {
      if (r?.categories?.length) setCats(r.categories);
    }).catch(() => {});
  }, []);

  const onAdd = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error("Title is required.");
      return;
    }
    if (mode === "url" && !form.url.trim()) {
      toast.error("URL is required.");
      return;
    }
    if (mode === "file" && !pickedFile) {
      toast.error("Pick a video file first.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "url") {
        const payload = {
          url: form.url.trim(),
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
          product_slug: form.product_slug.trim() || null,
        };
        const r = await createClipFromUrl(payload);
        if (r.featured) {
          toast.success(`★ Featured slot claimed! "${r.clip.title}" is now live.`, { duration: 6000 });
        } else {
          toast.success(`Posted to /clips — "${r.clip.title}"`);
        }
      } else {
        const r = await uploadClipFile(pickedFile, {
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category,
          tags: form.tags.trim(),
          product_slug: form.product_slug.trim(),
        }, (e) => {
          if (e?.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        });
        if (r.featured) {
          toast.success(`★ Featured slot claimed! "${r.clip.title}" uploaded.`, { duration: 6000 });
        } else {
          toast.success(`Uploaded — "${r.clip.title}"`);
        }
        setPickedFile(null);
        setUploadProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
      setForm({ url: "", title: "", description: "", category: "workshop", tags: "", product_slug: "" });
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't add clip.");
    } finally {
      setBusy(false);
      setUploadProgress(0);
    }
  };

  const onFilePick = (f) => {
    if (!f) { setPickedFile(null); return; }
    if (!/^video\//.test(f.type)) {
      toast.error("Please pick a video file (MP4/WebM/MOV).");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      toast.error("Video is over 50 MB — try a shorter clip or use a YouTube URL.");
      return;
    }
    setPickedFile(f);
  };

  const onDelete = async (c) => {
    const ok = await confirm({
      title: "Delete this clip?",
      body: `"${c.title}" will be removed from the global feed.`,
      confirmLabel: "Delete",
      tone: "danger",
      testId: `confirm-delete-clip-${c.id}`,
    });
    if (!ok) return;
    try {
      await deleteMyClip(c.id);
      toast.success("Clip removed.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete.");
    }
  };

  return (
    <section className="space-y-6" data-testid="maker-clips-panel">
      {confirmModal}
      {editing && (
        <EditClipModal
          clip={editing}
          cats={cats}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refresh(); }}
        />
      )}
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-1">
          ◆ Workshop Clip Feed
        </div>
        <h2 className="font-display text-2xl md:text-3xl uppercase">Share short-form clips.</h2>
        <p className="font-mono text-xs text-ink-muted mt-2 max-w-2xl leading-relaxed">
          Paste a YouTube or Vimeo URL (Shorts work great) and we'll surface it in the global{" "}
          <Link to="/clips" className="text-brand hover:underline">Clips</Link> feed.
          Vertical 9:16 clips look best — think satisfying cuts, weld pulls, powder-coat
          sprays, or finished-piece reveals. Optional: link a listing so viewers can "Shop this".
        </p>
      </header>

      <IncentiveBanner variant="maker" />

      <form
        onSubmit={onAdd}
        className="border border-line p-4 md:p-5 space-y-3"
        data-testid="clips-add-form"
      >
        {/* Mode picker — URL embed (fast) vs native upload (R2). */}
        <div className="flex gap-2 -mt-1 mb-3" data-testid="clips-mode-tabs">
          <button
            type="button"
            onClick={() => setMode("url")}
            className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 ${
              mode === "url"
                ? "border-brand text-brand bg-brand/10"
                : "border-line text-ink-muted hover:border-ink-muted"
            }`}
            data-testid="clips-mode-url"
          >
            <LinkIcon size={11} /> Paste URL
          </button>
          <button
            type="button"
            onClick={() => setMode("file")}
            className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 ${
              mode === "file"
                ? "border-brand text-brand bg-brand/10"
                : "border-line text-ink-muted hover:border-ink-muted"
            }`}
            data-testid="clips-mode-file"
          >
            <Upload size={11} /> Upload MP4 (≤50 MB)
          </button>
        </div>

        {mode === "url" ? (
          <div className="grid md:grid-cols-2 gap-3">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">YouTube / Vimeo URL *</span>
              <input
                type="url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://youtube.com/shorts/…"
                className="mt-1 w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                data-testid="clips-add-url"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Title *</span>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                maxLength={120}
                placeholder="Plasma cutting a mountain sign"
                className="mt-1 w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                required
                data-testid="clips-add-title"
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <label
              htmlFor="clip-file-input"
              className={`block border-2 border-dashed p-6 text-center cursor-pointer transition ${
                pickedFile ? "border-brand bg-brand/5" : "border-line hover:border-ink-muted"
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFilePick(e.dataTransfer.files?.[0]); }}
              data-testid="clips-file-drop"
            >
              <Upload size={28} className="mx-auto text-ink-muted mb-2" />
              {pickedFile ? (
                <>
                  <div className="font-mono text-xs text-ink break-all">{pickedFile.name}</div>
                  <div className="font-mono text-[10px] text-ink-muted mt-1">
                    {(pickedFile.size / 1024 / 1024).toFixed(1)} MB · {pickedFile.type || "video"}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-mono text-xs text-ink-muted">
                    Drag a vertical MP4 / WebM / MOV here, or click to pick
                  </div>
                  <div className="font-mono text-[10px] text-ink-muted mt-1">
                    Max 50 MB · ideal 9:16 · ≤60 seconds
                  </div>
                </>
              )}
              <input
                ref={fileInputRef}
                id="clip-file-input"
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => onFilePick(e.target.files?.[0])}
                data-testid="clips-add-file"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Title *</span>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                maxLength={120}
                placeholder="Plasma cutting a mountain sign"
                className="mt-1 w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                required
                data-testid="clips-add-title"
              />
            </label>
            {busy && uploadProgress > 0 && (
              <div data-testid="clips-upload-progress" className="space-y-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                  Uploading… {uploadProgress}%
                </div>
                <div className="h-1.5 bg-surface overflow-hidden">
                  <div
                    className="h-full bg-brand transition-[width] duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Category</span>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="mt-1 w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
              data-testid="clips-add-category"
            >
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Link a listing (optional)</span>
            <input
              type="text"
              value={form.product_slug}
              onChange={(e) => setForm({ ...form, product_slug: e.target.value })}
              placeholder="slug-from-your-listing-url"
              className="mt-1 w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
              data-testid="clips-add-product-slug"
            />
          </label>
        </div>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Tags (comma-separated)</span>
          <input
            type="text"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="plasma, mountain, steel"
            className="mt-1 w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
            data-testid="clips-add-tags"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Description (optional)</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            maxLength={600}
            placeholder="What's happening in this clip — keep it punchy, viewers see this for 2 seconds."
            className="mt-1 w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs resize-none"
            data-testid="clips-add-description"
          />
        </label>
        <div>
          <button
            type="submit"
            disabled={busy}
            className="btn-industrial btn-primary inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="clips-add-submit"
          >
            <Plus size={14} /> {busy ? "Posting…" : "Post clip"}
          </button>
        </div>
      </form>

      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
          ◇ Your posted clips
        </div>
        {items === null && <RowsSkeleton count={3} />}
        {items?.length === 0 && (
          <EmptyState
            icon={Film}
            eyebrow="◆ Empty stage"
            title="No clips posted yet."
            body="Drop a YouTube Shorts or Vimeo URL above to publish your first clip to the global feed."
            testId="clips-my-empty"
          />
        )}
        {items?.length > 0 && (
          <ul className="border border-line divide-y divide-[#1f1f1f]" data-testid="clips-my-list">
            {items.map((c) => (
              <li
                key={c.id}
                className="p-4 grid grid-cols-[1fr_auto] gap-3 items-center"
                data-testid={`clips-my-row-${c.id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-brand px-1.5 py-0.5 border border-brand/40">
                      {c.category}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
                      {c.source_type}
                    </span>
                    <span className="font-mono text-[10px] text-ink-muted">
                      {c.metrics?.views ?? c.views ?? 0} views - {c.metrics?.product_clicks ?? 0} product clicks - {c.metrics?.store_visits ?? 0} store visits - {c.metrics?.click_through_rate ?? 0}% CTR
                    </span>
                  </div>
                  <div className="font-display text-lg mt-1 truncate">{c.title}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setEditing(c)}
                    className="px-2.5 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1"
                    data-testid={`clips-my-edit-${c.id}`}
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <Link
                    to={`/clips/${c.slug}`}
                    target="_blank"
                    rel="noopener"
                    className="px-2.5 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1"
                  >
                    <ExternalLink size={12} /> Open
                  </Link>
                  <button
                    onClick={() => onDelete(c)}
                    className="px-2.5 py-1 border border-line hover:border-red-500 hover:text-red-400 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1"
                    data-testid={`clips-my-delete-${c.id}`}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}


function money(v) {
  const n = Number(v || 0);
  return `$${n.toFixed(n % 1 ? 2 : 0)}`;
}

function EditClipModal({ clip, cats, onClose, onSaved }) {
  const [draft, setDraft] = useState({
    title: clip.title || "",
    description: clip.description || "",
    category: clip.category || "workshop",
    tags: (clip.tags || []).join(", "),
    visibility: clip.visibility || "public",
    comments_enabled: clip.comments_enabled !== false,
  });
  const [selected, setSelected] = useState(clip.linked_products || []);
  const [results, setResults] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchClipEditDetails(clip.id);
      const c = r.clip || clip;
      setDraft({
        title: c.title || "",
        description: c.description || "",
        category: c.category || "workshop",
        tags: (c.tags || []).join(", "),
        visibility: c.visibility || "public",
        comments_enabled: c.comments_enabled !== false,
      });
      setSelected(c.linked_products || []);
      const search = await searchMyClipProducts("");
      setResults(search.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load clip editor.");
    } finally {
      setLoading(false);
    }
  }, [clip]);

  useEffect(() => { load(); }, [load]);

  const runSearch = async () => {
    try {
      const r = await searchMyClipProducts(q.trim());
      setResults(r.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Product search failed.");
    }
  };

  const addProduct = (p) => {
    if (selected.some((x) => x.slug === p.slug)) return;
    if (selected.length >= 10) {
      toast.error("A clip can link up to 10 products.");
      return;
    }
    setSelected((rows) => [...rows, { ...p, is_featured: rows.length === 0 }]);
  };

  const removeProduct = (slug) => {
    setSelected((rows) => {
      const next = rows.filter((p) => p.slug !== slug);
      if (next.length && !next.some((p) => p.is_featured)) next[0] = { ...next[0], is_featured: true };
      return next;
    });
  };

  const move = (idx, dir) => {
    setSelected((rows) => {
      const next = [...rows];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return rows;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const feature = (slug) => {
    setSelected((rows) => rows.map((p) => ({ ...p, is_featured: p.slug === slug })));
  };

  const save = async () => {
    if (!draft.title.trim()) {
      toast.error("Title is required.");
      return;
    }
    setBusy(true);
    try {
      await updateMyClip(clip.id, {
        title: draft.title.trim(),
        description: draft.description.trim(),
        category: draft.category,
        tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
        visibility: draft.visibility,
        comments_enabled: !!draft.comments_enabled,
      });
      await setClipProducts(clip.id, selected.map((p) => ({
        product_id: p.slug,
        is_featured: !!p.is_featured,
      })));
      toast.success("Clip updated.");
      onSaved && onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save clip.");
    } finally {
      setBusy(false);
    }
  };

  const selectedSlugs = new Set(selected.map((p) => p.slug));

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end md:items-center justify-center p-0 md:p-6" data-testid="clip-edit-modal">
      <div className="bg-paper border border-line w-full md:max-w-5xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-paper/95 backdrop-blur border-b border-line p-4 flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand">Edit published clip</div>
            <h3 className="font-display text-2xl uppercase leading-none mt-1">{clip.title}</h3>
          </div>
          <button onClick={onClose} className="w-9 h-9 border border-line hover:border-brand grid place-items-center" aria-label="Close clip editor">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="p-6 font-mono text-sm text-ink-muted">Loading editor...</div>
        ) : (
          <div className="p-4 md:p-6 grid lg:grid-cols-[1fr_1.1fr] gap-6">
            <div className="space-y-4">
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Title</span>
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={120} className="mt-1 w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs" data-testid="clip-edit-title" />
              </label>
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Description</span>
                <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={600} rows={4} className="mt-1 w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs resize-y" data-testid="clip-edit-description" />
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Category</span>
                  <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="mt-1 w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs" data-testid="clip-edit-category">
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Visibility</span>
                  <select value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value })} className="mt-1 w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs" data-testid="clip-edit-visibility">
                    <option value="public">Public</option>
                    <option value="unlisted">Unlisted</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Hashtags</span>
                <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="walnut, shop, process" className="mt-1 w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs" data-testid="clip-edit-tags" />
              </label>
              <label className="inline-flex items-center gap-2 font-mono text-xs text-ink-muted">
                <input type="checkbox" checked={draft.comments_enabled} onChange={(e) => setDraft({ ...draft, comments_enabled: e.target.checked })} data-testid="clip-edit-comments" />
                Comments enabled
              </label>
            </div>

            <div className="space-y-4" data-testid="clip-product-selector">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">Linked products ({selected.length}/10)</div>
                {selected.length === 0 ? (
                  <div className="border border-line p-4 font-mono text-xs text-ink-muted" data-testid="clip-products-empty">No products linked.</div>
                ) : (
                  <div className="space-y-2">
                    {selected.map((p, i) => (
                      <div key={p.slug} className="border border-line p-2 grid grid-cols-[44px_1fr_auto] gap-3 items-center" data-testid={`clip-selected-product-${p.slug}`}>
                        {p.image ? <img src={p.image} alt="" className="w-11 h-11 object-cover" /> : <div className="w-11 h-11 bg-surface" />}
                        <div className="min-w-0">
                          <div className="font-mono text-xs truncate">{p.title}</div>
                          <div className="font-mono text-[10px] text-ink-muted">{money(p.price)} ? {p.stock_status || (p.in_stock > 0 ? "In stock" : "Out of stock")}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="w-7 h-7 border border-line disabled:opacity-30 grid place-items-center" aria-label="Move product up"><ChevronUp size={13} /></button>
                          <button type="button" onClick={() => move(i, 1)} disabled={i === selected.length - 1} className="w-7 h-7 border border-line disabled:opacity-30 grid place-items-center" aria-label="Move product down"><ChevronDown size={13} /></button>
                          <button type="button" onClick={() => feature(p.slug)} className={`w-7 h-7 border grid place-items-center ${p.is_featured ? "border-brand text-brand" : "border-line"}`} aria-label="Feature product"><Star size={13} /></button>
                          <button type="button" onClick={() => removeProduct(p.slug)} className="w-7 h-7 border border-line hover:border-red-500 hover:text-red-400 grid place-items-center" aria-label="Remove product"><X size={13} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border border-line p-3 space-y-3">
                <div className="flex gap-2">
                  <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }} placeholder="Search your active products" className="min-w-0 flex-1 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs" data-testid="clip-product-search" />
                  <button type="button" onClick={runSearch} className="w-10 border border-line hover:border-brand grid place-items-center" aria-label="Search products"><Search size={15} /></button>
                </div>
                <div className="space-y-2 max-h-72 overflow-y-auto" data-testid="clip-product-results">
                  {results.length === 0 ? (
                    <div className="font-mono text-xs text-ink-muted py-2">No eligible active products found.</div>
                  ) : results.map((p) => (
                    <div key={p.slug} className="grid grid-cols-[44px_1fr_auto] gap-3 items-center border border-line p-2">
                      {p.image ? <img src={p.image} alt="" className="w-11 h-11 object-cover" /> : <div className="w-11 h-11 bg-surface" />}
                      <div className="min-w-0">
                        <div className="font-mono text-xs truncate">{p.title}</div>
                        <div className="font-mono text-[10px] text-ink-muted">{money(p.price)} ? {p.stock_status}</div>
                      </div>
                      <button type="button" onClick={() => addProduct(p)} disabled={selectedSlugs.has(p.slug) || selected.length >= 10} className="btn-industrial btn-secondary text-[10px] px-3 py-2 disabled:opacity-40" data-testid={`clip-product-add-${p.slug}`}>
                        {selectedSlugs.has(p.slug) ? "Added" : "Add"}
                      </button>
                    </div>
                  ))}
                </div>
                {selected.length >= 10 && <div className="font-mono text-[10px] text-red-400" data-testid="clip-products-max">Maximum of 10 linked products reached.</div>}
              </div>
            </div>
          </div>
        )}

        <div className="sticky bottom-0 bg-paper/95 backdrop-blur border-t border-line p-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="btn-industrial btn-secondary text-xs">Cancel</button>
          <button onClick={save} disabled={busy || loading} className="btn-industrial btn-primary text-xs" data-testid="clip-edit-save">{busy ? "Saving..." : "Save clip"}</button>
        </div>
      </div>
    </div>
  );
}
