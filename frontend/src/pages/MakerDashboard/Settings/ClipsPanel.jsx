import React, { useEffect, useState } from "react";
import { Plus, Trash2, ExternalLink, Film } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  fetchMyClips, createClipFromUrl, deleteMyClip, fetchClipCategories,
} from "../../../lib/api";
import { useConfirm } from "../useConfirm";
import EmptyState from "../../../components/EmptyState";
import { RowsSkeleton } from "../../../components/Skeleton";

const FALLBACK_CATS = [
  { id: "workshop",     label: "Workshop clips",  emoji: "◆" },
  { id: "cuts",         label: "Satisfying cuts", emoji: "✕" },
  { id: "welding",      label: "Welding sparks",  emoji: "⚡" },
  { id: "powder-coat",  label: "Powder coating",  emoji: "▣" },
  { id: "engraving",    label: "Engraving",       emoji: "✎" },
  { id: "before-after", label: "Before / after",  emoji: "↺" },
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
  const [form, setForm] = useState({
    url: "", title: "", description: "", category: "workshop", tags: "", product_slug: "",
  });
  const [busy, setBusy] = useState(false);

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
    if (!form.url.trim() || !form.title.trim()) {
      toast.error("URL and title are required.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        url: form.url.trim(),
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        // Send tags as an array — backend lowercases + dedupes.
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        product_slug: form.product_slug.trim() || null,
      };
      const r = await createClipFromUrl(payload);
      toast.success(`Posted to /clips — "${r.clip.title}"`);
      setForm({ url: "", title: "", description: "", category: "workshop", tags: "", product_slug: "" });
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't add clip.");
    } finally { setBusy(false); }
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
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-1">
          ◆ Workshop Clip Feed
        </div>
        <h2 className="font-display text-2xl md:text-3xl uppercase">Share short-form clips.</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl leading-relaxed">
          Paste a YouTube or Vimeo URL (Shorts work great) and we'll surface it in the global{" "}
          <Link to="/clips" className="text-[#ff4500] hover:underline">Clips</Link> feed.
          Vertical 9:16 clips look best — think satisfying cuts, weld pulls, powder-coat
          sprays, or finished-piece reveals. Optional: link a listing so viewers can "Shop this".
        </p>
      </header>

      <form
        onSubmit={onAdd}
        className="border border-[#262626] p-4 md:p-5 space-y-3"
        data-testid="clips-add-form"
      >
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">YouTube / Vimeo URL *</span>
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://youtube.com/shorts/…"
              className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
              required
              data-testid="clips-add-url"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Title *</span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={120}
              placeholder="Plasma cutting a mountain sign"
              className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
              required
              data-testid="clips-add-title"
            />
          </label>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Category</span>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
              data-testid="clips-add-category"
            >
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Link a listing (optional)</span>
            <input
              type="text"
              value={form.product_slug}
              onChange={(e) => setForm({ ...form, product_slug: e.target.value })}
              placeholder="slug-from-your-listing-url"
              className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
              data-testid="clips-add-product-slug"
            />
          </label>
        </div>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Tags (comma-separated)</span>
          <input
            type="text"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="plasma, mountain, steel"
            className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
            data-testid="clips-add-tags"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Description (optional)</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            maxLength={600}
            placeholder="What's happening in this clip — keep it punchy, viewers see this for 2 seconds."
            className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-none"
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
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
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
          <ul className="border border-[#262626] divide-y divide-[#1f1f1f]" data-testid="clips-my-list">
            {items.map((c) => (
              <li
                key={c.id}
                className="p-4 grid grid-cols-[1fr_auto] gap-3 items-center"
                data-testid={`clips-my-row-${c.id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#ff4500] px-1.5 py-0.5 border border-[#ff4500]/40">
                      {c.category}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">
                      {c.source_type}
                    </span>
                    <span className="font-mono text-[10px] text-[#525252]">
                      {c.views ?? 0} views · {c.likes ?? 0} likes · {c.saves ?? 0} saves
                    </span>
                  </div>
                  <div className="font-display text-lg mt-1 truncate">{c.title}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to={`/clips/${c.slug}`}
                    target="_blank"
                    rel="noopener"
                    className="px-2.5 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1"
                  >
                    <ExternalLink size={12} /> Open
                  </Link>
                  <button
                    onClick={() => onDelete(c)}
                    className="px-2.5 py-1 border border-[#262626] hover:border-red-500 hover:text-red-400 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1"
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
