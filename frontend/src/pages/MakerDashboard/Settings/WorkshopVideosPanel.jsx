/**
 * Maker → Workshop videos (iter186).
 *
 * Lets makers paste up to 6 YouTube/Vimeo URLs that render as a video
 * grid on their public maker profile. URL embeds only (no direct file
 * upload) — keeps storage cost zero and lets makers retain ownership
 * on their own YouTube channel.
 *
 * Each row shows the YouTube thumbnail (Vimeo skipped — needs an API
 * hop) plus delete + move-up/down controls. Reorder commits to the
 * backend immediately so the public profile reflects the new order.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Video, Trash2, ArrowUp, ArrowDown, ExternalLink, AlertCircle } from "lucide-react";
import {
  fetchMakerWorkshopVideos,
  addMakerWorkshopVideo,
  deleteMakerWorkshopVideo,
  reorderMakerWorkshopVideos,
} from "../../../lib/api";

export default function WorkshopVideosPanel() {
  const [items, setItems] = useState([]);
  const [maxCount, setMaxCount] = useState(6);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await fetchMakerWorkshopVideos();
      setItems(r.items || []);
      setMaxCount(r.max || 6);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); }, []);

  const onAdd = async (e) => {
    e?.preventDefault?.();
    setErr("");
    if (!url.trim()) {
      setErr("Paste a YouTube or Vimeo URL.");
      return;
    }
    setBusy(true);
    try {
      const r = await addMakerWorkshopVideo(url.trim(), title.trim());
      setItems((prev) => [...prev, r.video]);
      setUrl("");
      setTitle("");
      toast.success("Video added — it's live on your shop page now.");
    } catch (ex) {
      setErr(ex?.response?.data?.detail || "Couldn't add video.");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (videoRowId) => {
    if (!window.confirm("Remove this video from your shop page?")) return;
    try {
      await deleteMakerWorkshopVideo(videoRowId);
      setItems((prev) => prev.filter((v) => v.id !== videoRowId));
      toast.success("Video removed");
    } catch (ex) {
      toast.error(ex?.response?.data?.detail || "Couldn't remove video.");
    }
  };

  const move = async (idx, dir) => {
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);  // optimistic
    try {
      await reorderMakerWorkshopVideos(next.map((v) => v.id));
    } catch (ex) {
      toast.error("Couldn't save new order.");
      refresh();  // rollback to source of truth
    }
  };

  const remaining = maxCount - items.length;
  const atCap = remaining <= 0;

  return (
    <section className="space-y-6" data-testid="workshop-videos-panel">
      {/* Header */}
      <header>
        <h3 className="font-display text-2xl text-ink flex items-center gap-2">
          <Video size={20} className="text-brand" />
          Workshop Videos
        </h3>
        <p className="font-mono text-xs text-ink-muted mt-2 max-w-2xl leading-relaxed">
          Add up to <b className="text-ink">{maxCount}</b> short videos from your YouTube
          or Vimeo channel — process shots, time-lapses, behind-the-scenes. They render
          as a grid at the top of your public shop page.
        </p>
        <p className="font-mono text-[11px] text-ink-muted mt-2">
          <b>{items.length}</b> / {maxCount} added · {remaining} slot{remaining === 1 ? "" : "s"} left
        </p>
      </header>

      {/* Add form */}
      <form
        onSubmit={onAdd}
        className="border border-line p-4 space-y-3"
        data-testid="workshop-videos-add-form"
      >
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted block mb-1.5">
            Video URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=… or https://vimeo.com/…"
            disabled={atCap || busy}
            className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink disabled:opacity-50"
            data-testid="workshop-videos-url"
          />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted block mb-1.5">
            Title <span className="text-ink-muted normal-case">(optional, max 120 chars)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            placeholder="e.g. Plasma-cutting a custom ranch sign"
            disabled={atCap || busy}
            className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink disabled:opacity-50"
            data-testid="workshop-videos-title"
          />
        </div>
        {err && (
          <div
            className="flex items-start gap-2 p-2.5 border border-red-500/40 bg-red-500/5 text-red-400 font-mono text-xs"
            data-testid="workshop-videos-error"
          >
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span className="leading-relaxed">{err}</span>
          </div>
        )}
        <button
          type="submit"
          disabled={atCap || busy || !url.trim()}
          className="btn-industrial btn-primary inline-flex disabled:opacity-50"
          data-testid="workshop-videos-submit"
        >
          {busy ? "Adding…" : atCap ? `${maxCount}-video cap hit` : "Add video →"}
        </button>
      </form>

      {/* Past videos list */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
          Your videos
        </div>
        {loading ? (
          <p className="font-mono text-xs text-ink-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p
            className="font-mono text-xs text-ink-muted italic border border-dashed border-line p-6 text-center"
            data-testid="workshop-videos-empty"
          >
            No videos yet. Paste your first URL above to get started.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="workshop-videos-list">
            {items.map((v, i) => (
              <li
                key={v.id}
                className="flex items-start gap-3 p-3 border border-line hover:border-ink-muted transition"
                data-testid={`workshop-videos-row-${v.id}`}
              >
                {/* Thumbnail */}
                <div className="shrink-0 w-32 h-20 bg-paper border border-line flex items-center justify-center overflow-hidden">
                  {v.thumbnail ? (
                    <img
                      src={v.thumbnail}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Video size={24} className="text-ink-muted" />
                  )}
                </div>
                {/* Meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 border border-line font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
                      {v.provider}
                    </span>
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[11px] text-ink-muted hover:text-brand truncate inline-flex items-center gap-1 max-w-[280px]"
                    >
                      {v.url}
                      <ExternalLink size={10} />
                    </a>
                  </div>
                  {v.title && (
                    <p className="font-mono text-sm text-ink mt-1 leading-snug">
                      {v.title}
                    </p>
                  )}
                </div>
                {/* Controls */}
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="p-1.5 border border-line hover:border-brand text-ink-muted hover:text-brand disabled:opacity-30 disabled:hover:border-line disabled:hover:text-ink-muted transition"
                    data-testid={`workshop-videos-up-${v.id}`}
                    aria-label="Move up"
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === items.length - 1}
                    className="p-1.5 border border-line hover:border-brand text-ink-muted hover:text-brand disabled:opacity-30 disabled:hover:border-line disabled:hover:text-ink-muted transition"
                    data-testid={`workshop-videos-down-${v.id}`}
                    aria-label="Move down"
                  >
                    <ArrowDown size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(v.id)}
                    className="p-1.5 border border-red-500/40 text-red-400 hover:bg-red-500/5 transition"
                    data-testid={`workshop-videos-delete-${v.id}`}
                    aria-label="Delete"
                  >
                    <Trash2 size={12} />
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
