import React, { useEffect, useState } from "react";
import { Star, CheckCircle2 } from "lucide-react";
import { fetchClipsIncentiveStatus } from "../lib/api";

/**
 * Founding-50 Featured Clip incentive banner.
 *
 * Drops into:
 *   1. `/clips` empty-state — turn "no content here" into "first 50 makers
 *      get a free star badge + sticky top-of-feed billing for life".
 *   2. Maker dashboard → Settings → Workshop clips — same banner, surfaces
 *      the slot count just above the upload form so makers feel urgency
 *      to post their first clip.
 *
 * Pulls live counts from `/api/clips/incentive-status`. When all 50 slots
 * are claimed it switches to a success state. Silently hides itself if the
 * API errors (don't block the host UI on a soft feature).
 */
export default function IncentiveBanner({ variant = "feed", className = "" }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    fetchClipsIncentiveStatus()
      .then((r) => setStatus(r))
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;
  const { slots_total, slots_remaining, claimed } = status;

  if (claimed) {
    // All 50 claimed — pivot to a "thanks" state. Still useful as a
    // social-proof block ("50 makers got their free spot").
    return (
      <div
        className={`border border-emerald-700/60 bg-emerald-950/20 px-4 py-3 ${className}`}
        data-testid="clips-incentive-banner-claimed"
      >
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="text-emerald-400 shrink-0" size={18} />
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300">
              ◆ Founding 50 · all slots claimed
            </div>
            <div className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-0.5">
              All {slots_total} Featured slots claimed. New posts still
              welcome — they'll appear in the regular feed.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`border border-[#ff4500]/60 bg-[#ff4500]/5 px-4 py-3 ${className}`}
      data-testid="clips-incentive-banner"
    >
      <div className="flex items-start gap-2.5">
        <Star className="text-[#ff4500] shrink-0 fill-[#ff4500]/30" size={18} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
            ◆ Maker incentive · {slots_remaining} of {slots_total} Featured slots left
          </div>
          <div className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-1">
            {variant === "maker" ? (
              <>
                The first {slots_total} organic uploads to <span className="text-[#ff4500]">/clips</span> get
                a permanent <strong className="text-[#ff4500]">Featured</strong> star
                badge — free. Post a clip below to claim yours.
              </>
            ) : (
              <>
                The first {slots_total} organic uploads get a free
                <strong className="text-[#ff4500]"> Featured</strong> star badge — for life.
                Are you a maker? Share your first clip from the dashboard.
              </>
            )}
          </div>
        </div>
        <div
          className="hidden sm:block shrink-0 font-display text-3xl text-[#ff4500] leading-none ml-2"
          aria-hidden="true"
        >
          {slots_remaining}
        </div>
      </div>
    </div>
  );
}
