import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Star, X, Film } from "lucide-react";
import { fetchClipsIncentiveStatus } from "../../lib/api";

/**
 * Founding-50 Featured Clip incentive — dashboard card.
 *
 * Mounts at the top of the maker dashboard above the Plus-upgrade nudge.
 * Pulls live slot status. Auto-hides itself when:
 *   1. The cap is reached (`claimed: true`)
 *   2. The maker dismissed it (localStorage `cm:clips-incentive-dismissed`)
 *   3. The endpoint errors (soft feature — never block the dashboard)
 *
 * Kept deliberately small + non-busy: a single short call-to-action so it
 * doesn't compete with the Plus nudge or the Today alerts. The full
 * pitch lives on /clips and inside the Settings → Workshop clips panel.
 */
const DISMISS_KEY = "cm:clips-incentive-dismissed";

export default function ClipsIncentiveCard() {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch { return false; }
  });

  useEffect(() => {
    if (dismissed) return;
    fetchClipsIncentiveStatus()
      .then((r) => setStatus(r))
      .catch(() => setStatus(null));
  }, [dismissed]);

  if (dismissed || !status || status.claimed) return null;

  const onDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* no-op */ }
    setDismissed(true);
  };

  return (
    <section
      className="relative border border-[#ff4500]/60 bg-[#ff4500]/5 p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4 md:gap-5"
      data-testid="dashboard-clips-incentive"
      aria-label="Founding 50 Featured Clip incentive"
    >
      <button
        onClick={onDismiss}
        className="absolute top-2 right-2 w-7 h-7 grid place-items-center text-[#a3a3a3] hover:text-white"
        data-testid="dashboard-clips-incentive-dismiss"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
      <div className="hidden md:grid place-items-center w-12 h-12 border border-[#ff4500] bg-[#ff4500]/10 shrink-0">
        <Star className="text-[#ff4500] fill-[#ff4500]/30" size={22} />
      </div>
      <div className="min-w-0 flex-1 pr-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-1">
          ◆ New · Founding 50 Featured slots — {status.slots_remaining} left
        </div>
        <h2 className="font-display text-xl md:text-2xl uppercase leading-tight">
          Claim a free ★ Featured slot on the new Clips feed.
        </h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl leading-relaxed">
          The first 50 organic uploads to <Link to="/clips" className="text-[#ff4500] hover:underline">/clips</Link>{" "}
          get a permanent star badge — for life. Drop a YouTube Shorts link or a 9:16 MP4
          from Settings → Workshop clips. ~2 minutes to claim.
        </p>
      </div>
      <Link
        to="/maker/dashboard?tab=settings&section=clips"
        className="btn-industrial btn-primary inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] shrink-0"
        data-testid="dashboard-clips-incentive-cta"
      >
        <Film size={14} /> Claim slot
      </Link>
    </section>
  );
}
