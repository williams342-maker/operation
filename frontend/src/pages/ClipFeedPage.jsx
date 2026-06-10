import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Bookmark, Share2, ShoppingBag, Volume2, VolumeX, Play, Pause, ExternalLink, X, Star } from "lucide-react";
import { toast } from "sonner";
import {
  fetchClipCategories, fetchClipFeed,
  recordClipView, recordClipShare, toggleClipLike, toggleClipSave,
} from "../lib/api";
import IncentiveBanner from "../components/ClipsIncentiveBanner";

const CATEGORY_FALLBACK = [
  { id: null,           label: "For you",        emoji: "✦" },
  { id: "workshop",     label: "Workshop clips", emoji: "◆" },
  { id: "cuts",         label: "Satisfying cuts",emoji: "✕" },
  { id: "welding",      label: "Welding sparks", emoji: "⚡" },
  { id: "powder-coat",  label: "Powder coating", emoji: "▣" },
  { id: "engraving",    label: "Engraving",      emoji: "✎" },
  { id: "before-after", label: "Before / after", emoji: "↺" },
];

/**
 * TikTok-style vertical swipe feed.
 *
 * Architecture:
 *   * One <ClipPlayer /> per clip, stacked vertically inside a `snap-y
 *     snap-mandatory` container.
 *   * IntersectionObserver tracks the currently centered clip — that one
 *     autoplays + records a view; everything else is paused.
 *   * Bottom of feed triggers `loadMore()` via a sentinel observer.
 *
 * Engagement:
 *   * Like / save fire the optimistic-update toggle and reconcile from
 *     the server response.
 *   * Share buttons (X, Pinterest, Facebook, copy-link) all bump the
 *     `shares` counter anonymously.
 *   * Each clip has an optional "Shop the maker" CTA — deep links to
 *     `/maker/<slug>` or `/listing/<product_slug>` when provided.
 */
export default function ClipFeedPage() {
  const [categories, setCategories] = useState(CATEGORY_FALLBACK);
  const [activeCat, setActiveCat] = useState(null);
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(true);
  const [done, setDone] = useState(false);

  // ─── load categories once (with counts) ────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await fetchClipCategories();
        // Prepend a "For you" tile (no category filter)
        setCategories([{ id: null, label: "For you", emoji: "✦", count: r.total },
          ...r.categories]);
      } catch { /* fallback list already set */ }
    })();
    // Show SEO-friendly tab title
    document.title = "Workshop Clips · Crafters Market";
  }, []);

  // ─── reset feed whenever the category changes ──────────────────────────
  const loadFirst = useCallback(async (cat) => {
    setLoading(true);
    setDone(false);
    try {
      const r = await fetchClipFeed({ category: cat || undefined, limit: 12 });
      setItems(r.items || []);
      setCursor(r.next_cursor);
      if (!r.next_cursor) setDone(true);
    } catch (e) {
      toast.error("Couldn't load clips. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFirst(activeCat); }, [activeCat, loadFirst]);

  const loadMore = useCallback(async () => {
    if (!cursor || done || loading) return;
    setLoading(true);
    try {
      const r = await fetchClipFeed({ category: activeCat || undefined, cursor, limit: 12 });
      setItems((prev) => [...prev, ...(r.items || [])]);
      setCursor(r.next_cursor);
      if (!r.next_cursor) setDone(true);
    } catch { /* swallow */ } finally { setLoading(false); }
  }, [activeCat, cursor, done, loading]);

  // bottom-sentinel observer for infinite scroll
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  // Local optimistic update — write back the toggled flag/counter so the
  // UI stays responsive even if the server re-orders the list later.
  const onEngagementUpdate = useCallback((clipId, field, value, countField, countValue) => {
    setItems((prev) => prev.map((it) =>
      it.id === clipId
        ? { ...it, [field]: value, [countField]: countValue }
        : it,
    ));
  }, []);

  return (
    <div className="bg-black text-white min-h-screen" data-testid="clips-feed-page">
      <CategoryRail
        items={categories}
        active={activeCat}
        onSelect={setActiveCat}
      />

      <div
        className="relative w-full h-[calc(100vh-128px)] md:h-[calc(100vh-72px)] overflow-y-auto snap-y snap-mandatory scroll-smooth scrollbar-thin"
        data-testid="clips-scroll-container"
      >
        {/* Initial loading state — full-bleed shimmer card */}
        {loading && items.length === 0 && (
          <div className="h-full w-full grid place-items-center" data-testid="clips-loading">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-muted">
              ◇ Loading clips…
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && (
          <div className="h-full w-full grid place-items-center px-6 text-center" data-testid="clips-empty">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-3">
                ◇ Nothing here yet
              </div>
              <h2 className="font-display text-3xl md:text-5xl uppercase mb-4">
                The feed is warming up.
              </h2>
              <p className="font-mono text-sm text-ink-muted max-w-md mx-auto">
                {activeCat
                  ? "No clips in this category yet — try another tab or check back soon."
                  : "Makers are uploading their first craft clips — pottery wheels turning, looms clicking, sparks flying. Are you a maker? Share yours."}
              </p>
              <Link
                to="/maker/dashboard?tab=settings"
                className="btn-industrial btn-primary inline-flex mt-6 text-xs uppercase tracking-[0.22em]"
                data-testid="clips-empty-maker-cta"
              >
                Share a clip →
              </Link>
              <div className="mt-8 max-w-md mx-auto">
                <IncentiveBanner variant="feed" />
              </div>
            </div>
          </div>
        )}

        {items.map((clip) => (
          <ClipPlayer
            key={clip.id}
            clip={clip}
            muted={muted}
            onMuteToggle={() => setMuted((m) => !m)}
            onEngagementUpdate={onEngagementUpdate}
          />
        ))}

        <div ref={sentinelRef} className="h-1 w-full" data-testid="clips-feed-sentinel" />

        {done && items.length > 0 && (
          <div className="h-32 grid place-items-center font-mono text-[10px] uppercase tracking-[0.3em] text-ink-muted" data-testid="clips-end">
            ◆ End of feed
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Category strip — sticky under nav, horizontal scroll on mobile.
// ───────────────────────────────────────────────────────────────────────────
function CategoryRail({ items, active, onSelect }) {
  return (
    <div
      className="border-b border-line bg-black sticky top-0 z-30"
      data-testid="clips-category-rail"
    >
      <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-thin">
        {items.map((c) => {
          const isActive = (active || null) === (c.id || null);
          return (
            <button
              key={c.id || "all"}
              onClick={() => onSelect(c.id || null)}
              data-testid={`clip-cat-${c.id || "all"}`}
              className={`whitespace-nowrap px-3 py-1.5 border font-mono text-[11px] uppercase tracking-[0.22em] transition shrink-0 ${
                isActive
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-line text-ink-muted hover:border-line hover:text-ink"
              }`}
            >
              <span className="mr-1.5">{c.emoji}</span>
              {c.label}
              {typeof c.count === "number" && c.count > 0 && (
                <span className={`ml-2 text-[9px] ${isActive ? "text-brand" : "text-ink-muted"}`}>
                  {c.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Single clip — full-bleed 9:16 (max 640px wide on desktop), side overlay.
// ───────────────────────────────────────────────────────────────────────────
function ClipPlayer({ clip, muted, onMuteToggle, onEngagementUpdate }) {
  const wrapRef = useRef(null);
  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const [paused, setPaused] = useState(true);
  const [viewed, setViewed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const isEmbed = clip.source_type === "youtube" || clip.source_type === "vimeo";

  // Only autoplay when this clip is the one mostly-in-view. Pause every
  // off-screen <video> so the browser doesn't burn CPU/network.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
        if (videoRef.current) {
          videoRef.current.play().catch(() => {});
          setPaused(false);
        }
        if (!viewed) {
          recordClipView(clip.id).catch(() => {});
          setViewed(true);
        }
      } else {
        if (videoRef.current) {
          videoRef.current.pause();
        }
        setPaused(true);
      }
    }, { threshold: [0, 0.6, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, [clip.id, viewed]);

  // Keep <video> muted-prop in sync so the global mute toggle works.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const togglePause = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      setPaused(false);
    } else {
      videoRef.current.pause();
      setPaused(true);
    }
  };

  const onLike = async () => {
    try {
      const r = await toggleClipLike(clip.id);
      onEngagementUpdate(clip.id, "i_liked", r.on, "likes", r.count);
    } catch (e) {
      if (e?.response?.status === 401) {
        toast.error("Sign in to like clips.");
      } else { toast.error("Couldn't update like."); }
    }
  };
  const onSave = async () => {
    try {
      const r = await toggleClipSave(clip.id);
      onEngagementUpdate(clip.id, "i_saved", r.on, "saves", r.count);
    } catch (e) {
      if (e?.response?.status === 401) {
        toast.error("Sign in to save clips.");
      } else { toast.error("Couldn't save."); }
    }
  };
  const onShareRecord = () => {
    recordClipShare(clip.id).catch(() => {});
    onEngagementUpdate(clip.id, "i_liked", clip.i_liked, "shares", (clip.shares || 0) + 1);
  };

  const shareUrl = typeof window !== "undefined"
    ? `${window.location.origin}/clips/${clip.slug}`
    : `/clips/${clip.slug}`;

  return (
    <div
      ref={wrapRef}
      className="snap-start relative w-full grid place-items-center bg-black"
      style={{ minHeight: "calc(100vh - 128px)" }}
      data-testid={`clip-${clip.slug}`}
    >
      <div
        className="relative w-full h-full md:w-auto md:h-[88vh] md:aspect-[9/16] md:max-h-[850px] bg-paper overflow-hidden"
        style={{ aspectRatio: "9 / 16" }}
      >
        {isEmbed ? (
          <iframe
            ref={iframeRef}
            src={`${clip.video_url}?autoplay=1&mute=1&loop=1&playlist=${clip.source_id}&controls=0&playsinline=1&rel=0`}
            title={clip.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
            data-testid={`clip-iframe-${clip.slug}`}
          />
        ) : (
          <video
            ref={videoRef}
            src={clip.video_url}
            poster={clip.poster_url || undefined}
            muted={muted}
            loop
            playsInline
            preload="metadata"
            onClick={togglePause}
            className="absolute inset-0 w-full h-full object-cover cursor-pointer"
            data-testid={`clip-video-${clip.slug}`}
          />
        )}

        {/* Pause overlay — only for native videos (embeds have their own
            built-in pause). Shows when the user manually pauses. */}
        {!isEmbed && paused && (
          <button
            onClick={togglePause}
            className="absolute inset-0 grid place-items-center bg-black/30"
            data-testid={`clip-play-${clip.slug}`}
            aria-label="Play"
          >
            <div className="w-16 h-16 rounded-full border border-white/40 bg-black/40 grid place-items-center">
              <Play className="text-white" size={28} />
            </div>
          </button>
        )}

        {/* Gradient veil for legibility of the bottom text */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black via-black/60 to-transparent" />

        {/* Mute toggle — top-right, global */}
        <button
          onClick={onMuteToggle}
          className="absolute top-3 right-3 z-10 w-9 h-9 grid place-items-center bg-black/50 border border-white/15 text-white"
          data-testid={`clip-mute-${clip.slug}`}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>

        {/* Right-rail engagement stack */}
        <div className="absolute right-3 bottom-28 z-10 flex flex-col items-center gap-5">
          <StackButton
            icon={<Heart size={22} className={clip.i_liked ? "fill-[#ff4500] text-brand" : ""} />}
            count={clip.likes}
            onClick={onLike}
            testId={`clip-like-${clip.slug}`}
            label={clip.i_liked ? "Liked" : "Like"}
          />
          <StackButton
            icon={<Bookmark size={22} className={clip.i_saved ? "fill-[#ff4500] text-brand" : ""} />}
            count={clip.saves}
            onClick={onSave}
            testId={`clip-save-${clip.slug}`}
            label={clip.i_saved ? "Saved" : "Save"}
          />
          <StackButton
            icon={<Share2 size={22} />}
            count={clip.shares}
            onClick={() => setShareOpen(true)}
            testId={`clip-share-${clip.slug}`}
            label="Share"
          />
          {(clip.maker_slug || clip.product_slug) && (
            <Link
              to={clip.product_slug ? `/listing/${clip.product_slug}` : `/maker/${clip.maker_slug}`}
              className="grid place-items-center w-12 h-12 border border-brand bg-brand text-black"
              data-testid={`clip-shop-${clip.slug}`}
              aria-label={clip.product_slug ? "Shop this listing" : "Shop the maker"}
            >
              <ShoppingBag size={20} />
            </Link>
          )}
        </div>

        {/* Bottom-left caption */}
        <div className="absolute left-4 right-20 bottom-6 z-10">
          <div className="flex items-center gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand">
              ◆ {clip.category}
            </div>
            {clip.featured && (
              <span
                className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.22em] text-amber-300 border border-amber-400/60 bg-amber-400/10 px-1.5 py-0.5"
                data-testid={`clip-featured-${clip.slug}`}
                title="Founding Featured Clip — among the first 50 organic uploads"
              >
                <Star size={9} className="fill-amber-300" /> Featured
              </span>
            )}
          </div>
          <h2 className="font-display text-2xl md:text-3xl uppercase mt-1 leading-tight line-clamp-2">
            {clip.title}
          </h2>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted mt-2">
            BY{" "}
            {clip.maker_slug ? (
              <Link to={`/maker/${clip.maker_slug}`} className="text-ink hover:text-brand underline-offset-2 hover:underline">
                {clip.maker_name}
              </Link>
            ) : (
              <span className="text-ink">{clip.maker_name}</span>
            )}
          </div>
          {clip.description && (
            <p className="font-mono text-xs text-ink/80 mt-2 max-w-[80%] line-clamp-2">
              {clip.description}
            </p>
          )}
          {clip.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {clip.tags.slice(0, 4).map((t) => (
                <span key={t} className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>

        {shareOpen && (
          <ShareSheet
            clip={clip}
            shareUrl={shareUrl}
            onClose={() => setShareOpen(false)}
            onShare={onShareRecord}
          />
        )}
      </div>
    </div>
  );
}

function StackButton({ icon, count, onClick, label, testId }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 text-white/90 hover:text-white"
      data-testid={testId}
      aria-label={label}
    >
      <div className="w-12 h-12 grid place-items-center bg-black/50 border border-white/15">
        {icon}
      </div>
      <span className="font-mono text-[10px]">{count ?? 0}</span>
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Bottom share sheet — copy link + 4 socials, all of them bump the counter.
// ───────────────────────────────────────────────────────────────────────────
function ShareSheet({ clip, shareUrl, onClose, onShare }) {
  const t = useMemo(() => encodeURIComponent(`${clip.title} · ${clip.maker_name}`), [clip]);
  const u = useMemo(() => encodeURIComponent(shareUrl), [shareUrl]);
  const targets = useMemo(() => [
    { id: "pinterest", label: "Pin it",   href: `https://pinterest.com/pin/create/button/?url=${u}&description=${t}` },
    { id: "x",         label: "Post on X",href: `https://twitter.com/intent/tweet?text=${t}&url=${u}` },
    { id: "facebook",  label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { id: "whatsapp",  label: "WhatsApp", href: `https://wa.me/?text=${t}%20${u}` },
  ], [t, u]);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied.");
      onShare();
    } catch { toast.error("Couldn't copy link."); }
  };
  return (
    <div
      className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm grid place-items-end md:place-items-center"
      onClick={onClose}
      data-testid={`clip-share-sheet-${clip.slug}`}
    >
      <div
        className="bg-paper border-t border-line md:border md:border-line w-full md:max-w-md p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand">
            ◆ Share this clip
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <button
          onClick={onCopy}
          className="w-full text-left px-3 py-2.5 border border-line hover:border-brand font-mono text-[11px] uppercase tracking-[0.22em] flex items-center justify-between"
          data-testid={`clip-share-copy-${clip.slug}`}
        >
          <span>Copy link</span>
          <ExternalLink size={14} />
        </button>
        <div className="grid grid-cols-2 gap-2">
          {targets.map((s) => (
            <a
              key={s.id}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onShare}
              className="px-3 py-2.5 border border-line hover:border-brand font-mono text-[11px] uppercase tracking-[0.22em] text-center"
              data-testid={`clip-share-${s.id}-${clip.slug}`}
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
