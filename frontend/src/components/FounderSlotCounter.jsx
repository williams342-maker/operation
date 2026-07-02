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
    const load = () =>
      fetch(`${API}/api/founders/slots`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setData(d))
        .catch(() => {});
    // Fetch on mount, then keep in sync with server: poll every 60s
    // (approvals are sporadic but should never lag more than a minute
    // behind the admin dashboard) + revalidate whenever the tab regains
    // focus so people returning from another tab see fresh numbers.
    load();
    const interval = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
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
        className="border border-line bg-paper p-6 md:p-7"
        data-testid={testId}
      >
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-muted mb-1">
              ◆ Inaugural Founder Slots
            </div>
            <div className="font-display text-5xl md:text-6xl leading-none text-brand">
              {remaining}
              <span className="text-ink-muted text-3xl"> / {total}</span>
            </div>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-right">
            <div className={urgent ? "text-brand" : "text-ink-muted"}>
              {urgent ? "Closing soon" : "Spots remaining"}
            </div>
            <div className="text-ink-muted mt-1">
              {taken} taken · lifetime perks
            </div>
          </div>
        </div>
        <div
          className="h-1 bg-surface overflow-hidden"
          role="progressbar"
          aria-valuenow={taken}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <div
            className="h-full bg-brand transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-3 leading-relaxed">
          The first 100 makers ever approved get <span className="text-ink">lifetime</span> Founder
          rates (3% commission · 50 free listings/mo). After #100, applications still
          accepted as 12-month Founder, but inaugural status closes <span className="text-ink">forever</span>.
        </p>
      </div>
    );
  }

  // compact
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 border border-line bg-paper font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted"
      data-testid={testId}
    >
      <span className={urgent ? "text-brand" : "text-ink"}>
        ◆ {remaining}/{total}
      </span>
      <span>Inaugural spots left</span>
    </div>
  );
}
