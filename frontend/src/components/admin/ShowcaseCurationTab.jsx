import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  fetchAdminShowcase,
  toggleShowcasePin,
  toggleShowcaseHide,
  moveShowcaseUp,
  moveShowcaseDown,
  shuffleShowcase,
} from "../../lib/api";

/**
 * iter231 — Showcase curation tab. Pure operator tool — lets the admin:
 *   • Pin/unpin posts (newest pin floats to the very top)
 *   • Hide/show posts from the public showcase (soft retire; doesn't
 *     delete or affect the maker's ownership of the post)
 *   • Move individual posts up/down (swaps admin_sort_order with the
 *     adjacent row — safe even on 100s of items)
 *   • Shuffle every non-pinned, non-hidden post in one click
 *
 * The list intentionally renders in the SAME order the public
 * /community/showcase tab will render — so the admin sees the buyer
 * experience as they curate it.
 */
export default function ShowcaseCurationTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [shuffling, setShuffling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchAdminShowcase();
      setItems(d.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load showcase posts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const wrap = async (id, fn, successMsg) => {
    setBusyId(id);
    try {
      const r = await fn(id);
      if (successMsg) toast.success(successMsg);
      await load();
      return r;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Action failed.");
    } finally {
      setBusyId(null);
    }
  };

  const onShuffle = async () => {
    setShuffling(true);
    try {
      const r = await shuffleShowcase();
      toast.success(`Shuffled ${r.shuffled} posts.`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Shuffle failed.");
    } finally {
      setShuffling(false);
    }
  };

  // iter251 — push the showcase post to every connected Buffer channel.
  // Removed iter252 (Buffer replaced by EnrichLabs).

  if (loading) {
    return (
      <div className="font-mono text-sm text-ink-muted" data-testid="showcase-curation-loading">
        Loading showcase posts…
      </div>
    );
  }

  const pinned = items.filter((i) => i.admin_pinned);
  const visible = items.filter((i) => !i.admin_pinned && !i.admin_hidden);
  const hidden = items.filter((i) => i.admin_hidden && !i.admin_pinned);

  return (
    <div className="space-y-8" data-testid="showcase-curation-tab">
      <div className="flex items-end justify-between gap-3 flex-wrap border-b border-line pb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-1">
            ◆ Showcase Curation
          </div>
          <h2 className="font-display text-3xl">Rotate the Community Showcase</h2>
          <p className="font-mono text-[11px] text-ink-muted mt-2 max-w-[68ch] leading-relaxed">
            Pin the work you want greeting buyers, hide anything that's gone stale, shuffle the rest in one click. Pinned posts stay at the top permanently. The public order on <code className="text-emerald-700">/community</code> updates the moment you click — no redeploy needed.
          </p>
        </div>
        <button
          onClick={onShuffle}
          disabled={shuffling || visible.length === 0}
          className="px-4 py-2 border border-amber-500 text-brand font-mono text-[11px] uppercase tracking-[0.22em] hover:bg-amber-500 hover:text-ink disabled:opacity-50"
          data-testid="showcase-shuffle-btn"
        >
          {shuffling ? "Shuffling…" : `🎲 Shuffle ${visible.length} non-pinned`}
        </button>
      </div>

      {/* Pinned */}
      <Section title={`Pinned · ${pinned.length}`}
               blurb="Locked to the very top of /community → Showcase, in pin-order."
               empty="Nothing pinned. Click the ★ icon on any post below to lock it to the top."
               testId="pinned-section">
        {pinned.map((p, i) => (
          <Row key={p.id} item={p} index={i} total={pinned.length}
               busyId={busyId} canReorder={false}
               onPin={() => wrap(p.id, toggleShowcasePin, p.admin_pinned ? "Unpinned." : "Pinned.")}
               onHide={() => wrap(p.id, toggleShowcaseHide)}
               onUp={() => wrap(p.id, moveShowcaseUp)}
               onDown={() => wrap(p.id, moveShowcaseDown)} />
        ))}
      </Section>

      {/* Visible (in rotation) */}
      <Section title={`In rotation · ${visible.length}`}
               blurb="The active showcase order, exactly as buyers see it after the pinned posts."
               empty="No visible posts. Showcase tab is empty — pin or unhide something to populate it."
               testId="visible-section">
        {visible.map((p, i) => (
          <Row key={p.id} item={p} index={i} total={visible.length}
               busyId={busyId} canReorder
               onPin={() => wrap(p.id, toggleShowcasePin, "Pinned.")}
               onHide={() => wrap(p.id, toggleShowcaseHide, "Hidden from showcase.")}
               onUp={() => wrap(p.id, moveShowcaseUp)}
               onDown={() => wrap(p.id, moveShowcaseDown)} />
        ))}
      </Section>

      {/* Hidden */}
      {hidden.length > 0 && (
        <Section title={`Hidden · ${hidden.length}`}
                 blurb="Soft-retired from the public showcase. Click the eye icon to bring back."
                 empty=""
                 testId="hidden-section">
          {hidden.map((p, i) => (
            <Row key={p.id} item={p} index={i} total={hidden.length}
                 busyId={busyId} canReorder={false} dimmed
                 onPin={() => wrap(p.id, toggleShowcasePin, "Pinned.")}
                 onHide={() => wrap(p.id, toggleShowcaseHide, "Restored to showcase.")}
                 onUp={() => wrap(p.id, moveShowcaseUp)}
                 onDown={() => wrap(p.id, moveShowcaseDown)} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, blurb, empty, testId, children }) {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <section data-testid={testId}>
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted mb-1">{title}</div>
      <div className="font-mono text-[11px] text-ink-muted mb-3 max-w-[68ch] leading-relaxed">{blurb}</div>
      {hasChildren ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <div className="border border-dashed border-line px-4 py-6 font-mono text-xs text-ink-muted text-center">
          {empty}
        </div>
      )}
    </section>
  );
}

function Row({ item, index, total, busyId, canReorder, dimmed, onPin, onHide, onUp, onDown }) {
  const busy = busyId === item.id;
  return (
    <div
      className={`grid grid-cols-[64px_1fr_auto] gap-3 items-center p-3 border ${dimmed ? "border-line bg-paper opacity-60" : "border-line bg-paper"} ${busy ? "animate-pulse" : ""}`}
      data-testid={`showcase-row-${item.id}`}
    >
      <div className="w-16 h-16 bg-surface overflow-hidden flex items-center justify-center">
        {item.image_url ? (
          <img src={item.image_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="font-mono text-[9px] text-ink-muted">no img</span>
        )}
      </div>
      <div className="min-w-0">
        <div className="font-display text-sm text-ink truncate" title={item.title}>
          {item.title}
        </div>
        <div className="font-mono text-[10px] text-ink-muted mt-0.5 truncate">
          {item.maker_slug && <span className="text-emerald-700">@{item.maker_slug}</span>}
          {item.maker_slug && item.user_name && <span> · </span>}
          {item.user_name && <span>{item.user_name}</span>}
          {" · "}
          <span>{item.views} views</span>
          {item.is_seed && <span className="text-brand"> · seeded</span>}
          {item.admin_pinned && <span className="text-brand"> · pinned</span>}
          {item.admin_hidden && <span className="text-red-600"> · hidden</span>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onPin}
          disabled={busy}
          className={`px-2 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] hover:bg-yellow-500/15 disabled:opacity-50 ${item.admin_pinned ? "border-yellow-400 text-brand bg-yellow-500/10" : "border-line text-ink-muted"}`}
          title={item.admin_pinned ? "Unpin" : "Pin to top"}
          data-testid={`showcase-pin-${item.id}`}
        >
          {item.admin_pinned ? "★ Pinned" : "☆ Pin"}
        </button>
        <button
          onClick={onHide}
          disabled={busy}
          className={`px-2 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] hover:bg-red-500/15 disabled:opacity-50 ${item.admin_hidden ? "border-red-400 text-red-600 bg-red-500/10" : "border-line text-ink-muted"}`}
          title={item.admin_hidden ? "Restore to showcase" : "Hide from showcase"}
          data-testid={`showcase-hide-${item.id}`}
        >
          {item.admin_hidden ? "↻ Restore" : "✕ Hide"}
        </button>
        {canReorder && (
          <>
            <button
              onClick={onUp}
              disabled={busy || index === 0}
              className="px-2 py-1.5 border border-line text-ink-muted font-mono text-[10px] hover:bg-line disabled:opacity-30"
              title="Move up"
              data-testid={`showcase-up-${item.id}`}
            >
              ▲
            </button>
            <button
              onClick={onDown}
              disabled={busy || index === total - 1}
              className="px-2 py-1.5 border border-line text-ink-muted font-mono text-[10px] hover:bg-line disabled:opacity-30"
              title="Move down"
              data-testid={`showcase-down-${item.id}`}
            >
              ▼
            </button>
          </>
        )}
      </div>
    </div>
  );
}
