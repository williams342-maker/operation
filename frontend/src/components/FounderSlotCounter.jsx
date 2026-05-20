import React, { useEffect, useState } from "react";

/**
 * FounderSlotCounter
 * -------------------
 * Live "X of 100 spots remaining" pill that scares people into applying.
 * Polls `/api/founders/slots` once on mount — number changes rarely
 * enough that we don't need live-polling unless an admin is monitoring
 * (and the admin dashboard has its own surfacing for that).
 *
 * Two visual variants:
 *   - "hero"      Big chunky pill for the top of the /founders page
 *   - "compact"   Small strip suitable for embedding in the home-page CTA
 *
 * Falls back gracefully (null render) if the endpoint errors so we
 * never break the page on a flaky network.
 */
const API = process.env.REACT_APP_BACKEND_URL;

export default function FounderSlotCounter({
  variant = "compact",
  testId = "founder-slot-counter",
}) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/founders/slots`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return null;
  const remaining = Math.max(0, Number(data.inaugural_remaining ?? 0));
  const total = Number(data.inaugural_total ?? 100);
  const taken = total - remaining;
  const pct = Math.min(100, Math.round((taken / total) * 100));
  const urgent = remaining <= 25;

  if (variant === "hero") {
    return (
      <div
        className="border border-[#262626] bg-[#0a0a0a] p-6 md:p-7"
        data-testid={testId}
      >
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#a3a3a3] mb-1">
              ◆ Inaugural Founder Slots
            </div>
            <div className="font-display text-5xl md:text-6xl leading-none text-[#ff4500]">
              {remaining}
              <span className="text-[#525252] text-3xl"> / {total}</span>
            </div>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-right">
            <div className={urgent ? "text-[#ff4500]" : "text-[#a3a3a3]"}>
              {urgent ? "Closing soon" : "Spots remaining"}
            </div>
            <div className="text-[#525252] mt-1">
              {taken} taken · lifetime perks
            </div>
          </div>
        </div>
        <div
          className="h-1 bg-[#262626] overflow-hidden"
          role="progressbar"
          aria-valuenow={taken}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <div
            className="h-full bg-[#ff4500] transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mt-3 leading-relaxed">
          The first 100 makers ever approved get <span className="text-[#fafafa]">lifetime</span> Founder
          rates (3% commission · 50 free listings/mo). After #100, applications still
          accepted as 12-month Founder, but inaugural status closes <span className="text-[#fafafa]">forever</span>.
        </p>
      </div>
    );
  }

  // compact
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#262626] bg-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]"
      data-testid={testId}
    >
      <span className={urgent ? "text-[#ff4500]" : "text-[#fafafa]"}>
        ◆ {remaining}/{total}
      </span>
      <span>Inaugural spots left</span>
    </div>
  );
}
