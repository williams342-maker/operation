import React, { useEffect, useState } from "react";
import { fetchFollowersList } from "../lib/api";

const PALETTE = [
  "bg-brand/20 text-brand border-brand/40",
  "bg-emerald-500/15 text-emerald-300 border-emerald-700/40",
  "bg-yellow-500/15 text-yellow-300 border-yellow-700/40",
  "bg-purple-500/15 text-purple-300 border-purple-700/40",
  "bg-cyan-500/15 text-cyan-300 border-cyan-700/40",
];

/**
 * FollowersList — public follower roster for /makers/:slug. Anchored at
 * #followers so the FollowButton's "N followers" chip can deep-link here.
 * Renders an avatar grid with first-letter pucks (no email leakage).
 */
export default function FollowersList({ makerSlug }) {
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!makerSlug) return;
    let cancel = false;
    setLoading(true);
    fetchFollowersList(makerSlug, 30)
      .then((d) => { if (!cancel) setData(d); })
      .catch(() => { if (!cancel) setData({ items: [], total: 0 }); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [makerSlug]);

  // Auto-scroll to #followers when arriving via the FollowButton chip.
  useEffect(() => {
    if (window.location.hash !== "#followers") return;
    const el = document.getElementById("followers");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (loading) return null;

  return (
    <section id="followers" className="mt-20 pt-12 border-t border-line scroll-mt-32" data-testid="followers-section">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
        ◆ Followers
      </div>
      <h2 className="font-display text-3xl md:text-5xl uppercase mb-8">
        {data.total === 0
          ? "Be the first to follow."
          : data.total === 1
          ? "1 buyer is watching."
          : `${data.total} buyers are watching.`}
      </h2>

      {data.items.length === 0 ? (
        <p className="font-mono text-sm text-ink-muted" data-testid="followers-empty">
          No followers yet. Hit the <span className="text-brand">+ Follow</span> button up top to get an email every time this maker drops a new piece.
        </p>
      ) : (
        <div className="flex flex-wrap gap-3" data-testid="followers-grid">
          {data.items.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="flex items-center gap-3 px-3 py-2 border border-line hover:border-brand/40 transition"
              data-testid={`follower-${i}`}
              title={`Following since ${f.since}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-mono text-xs font-bold border ${PALETTE[i % PALETTE.length]}`}
              >
                {f.initial}
              </div>
              <div className="font-mono text-xs text-ink truncate max-w-[140px]">{f.name}</div>
            </div>
          ))}
          {data.total > data.items.length && (
            <div className="flex items-center px-3 py-2 border border-line font-mono text-xs text-ink-muted">
              +{data.total - data.items.length} more
            </div>
          )}
        </div>
      )}
    </section>
  );
}
