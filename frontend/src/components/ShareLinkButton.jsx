/**
 * ShareLinkButton — drop-in pill next to "Add to cart" / "Save drop" that
 * copies a *share-friendly* URL (`/api/og/<kind>/<slug>`) to the clipboard.
 *
 * Why not just copy `window.location.href`?
 * The public canonical URL (e.g. `/shop/<slug>`) is an SPA route. Social
 * unfurlers that bypass our Cloudflare Worker (Slack mobile, iMessage,
 * many Discord servers) see the SPA shell HTML and unfurl with the
 * generic homepage og:image. The OG endpoint returns full server-rendered
 * prerender HTML (real og:title + og:image + JSON-LD) AND meta-refreshes
 * humans to the canonical SPA page in 0s — so it's transparent to the
 * person clicking.
 *
 * Social-proof badge (iter148): on mount we fetch the click count from
 * `/api/share/count/<kind>/<slug>` and render `SHARE · 47` when at
 * least one share has been recorded. Each click optimistically bumps
 * the local count + fires `/api/share/track`. Backend caps abuse via
 * IP-hash dedup (see `routers/share_counter.py`).
 *
 * Used on:
 *   • Maker dashboard product cards (small "⎘ Share link" pill — see
 *     ProductEditCard.jsx, doesn't show badge to keep grid compact)
 *   • Public product detail page (visible to ALL visitors, badge shown)
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link2 } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;

export default function ShareLinkButton({
  kind = "product",
  slug,
  label = "Share",
  testId,
  showCount = true,
}) {
  // null = still loading / unknown; we hide the badge until we have a
  // real number so the pill doesn't jump from `SHARE` → `SHARE · 0` →
  // `SHARE · 7` on slow connections.
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!slug || !showCount) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/share/count/${kind}/${encodeURIComponent(slug)}`);
        if (!r.ok) return;
        const body = await r.json();
        if (!cancelled) setCount(typeof body.count === "number" ? body.count : 0);
      } catch {/* silent — badge just stays hidden */}
    })();
    return () => { cancelled = true; };
  }, [kind, slug, showCount]);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    const origin = window.location.origin;
    const url = `${origin}/api/og/${kind}/${slug}`;

    // 1) Copy to clipboard (the actual feature). Fall back to a system
    // prompt if clipboard API is blocked (older browsers, embedded
    // webviews, locked-down corporate devices).
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied — paste anywhere for a rich preview.");
    } catch {
      window.prompt("Copy this share-friendly URL:", url);
    }

    // 2) Optimistic badge bump + server track (fire-and-forget). The
    // server enforces the real count (with dedup); we just sync once
    // the request lands so honest users see immediate feedback.
    if (showCount) {
      setCount((c) => (c == null ? 1 : c + 1));
      try {
        const r = await fetch(`${API}/api/share/track`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, slug }),
        });
        if (r.ok) {
          const body = await r.json();
          if (typeof body.count === "number") setCount(body.count);
        }
      } catch {/* silent — optimistic value sticks */}
    }
    setBusy(false);
  };

  // Render the badge only once we have a server-confirmed count > 0.
  // Avoids the empty-state visual noise on brand new listings.
  const showBadge = showCount && typeof count === "number" && count > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      title="Copy a share-friendly link. When you paste it in Slack / iMessage / Facebook / Discord, it unfurls with a rich card."
      className="px-4 py-3 border border-line hover:border-brand text-ink-muted hover:text-brand transition-colors flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em]"
      data-testid={testId || `share-link-${kind}-${slug}`}
    >
      <Link2 size={14} />
      <span>{label}</span>
      {showBadge && (
        <span
          className="text-ink-muted group-hover:text-brand"
          data-testid={`${testId || `share-link-${kind}-${slug}`}-count`}
        >
          · {count}
        </span>
      )}
    </button>
  );
}
