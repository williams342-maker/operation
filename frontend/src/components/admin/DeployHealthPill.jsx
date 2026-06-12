import React, { useEffect, useState } from "react";
import { fetchAdminProdHealth } from "../../lib/api";

/**
 * Compact deploy-health pill for the top of AdminDashboard.
 *
 * Born from the iter224 production outage where craftersmarket.org was
 * silently returning Cloudflare 520 for hours before an admin tried to
 * sign in. The big sticky red ProdHealthBanner only fires when the
 * watchdog has flipped a critical endpoint into the *alerted* state
 * (after `consecutive_failures >= 2`). That's two whole 5-min polls
 * before any UI feedback — and zero feedback when prod is just *slow*
 * or has a single transient blip.
 *
 * This pill closes that gap: it's always visible in the header, polls
 * every 60s, and shows a glanceable color the moment any check comes
 * back non-200. Click to jump to the full Prod Health tab.
 *
 * States:
 *  - ok       (emerald) — every watched endpoint passed last check
 *  - degraded (yellow)  — at least one endpoint failing, but watchdog
 *                         hasn't crossed the alert threshold yet (so
 *                         no email/banner — but you should still know)
 *  - down     (red)     — at least one endpoint in alerted state
 *  - paused   (gray)    — PROD_WATCHDOG_ENABLED=false on the pod
 *  - unknown  (gray)    — fetch failed (token expired / network blip)
 */
const PALETTE = {
  ok:       { dot: "bg-emerald-500", text: "text-emerald-700", border: "border-emerald-700/60", bg: "bg-emerald-900/20" },
  degraded: { dot: "bg-yellow-500",  text: "text-brand",  border: "border-yellow-700/60",  bg: "bg-yellow-900/20" },
  down:     { dot: "bg-red-500",     text: "text-red-600",     border: "border-red-700/60",     bg: "bg-red-900/20" },
  paused:   { dot: "bg-ink-muted",   text: "text-ink-muted",   border: "border-line",      bg: "bg-paper" },
  unknown:  { dot: "bg-ink-muted",   text: "text-ink-muted",   border: "border-line",      bg: "bg-paper" },
};

const LABEL = {
  ok: "Prod · OK",
  degraded: "Prod · Degraded",
  down: "Prod · Down",
  paused: "Prod · Paused",
  unknown: "Prod · ?",
};

/**
 * Reduce the watchdog snapshot into one of the five UI states above.
 * Pulled out of the component for testability.
 */
export function deriveDeployStatus(snap) {
  if (!snap) return "unknown";
  if (!snap.enabled) return "paused";
  const eps = snap.endpoints || [];
  if (eps.length === 0) return "paused"; // watchdog on, but no checks yet
  if (snap.any_alerted) return "down";
  const anyFailing = eps.some((e) => e.last_ok === false || (e.consecutive_failures || 0) > 0);
  if (anyFailing) return "degraded";
  return "ok";
}

export default function DeployHealthPill({ onJumpToTab }) {
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchAdminProdHealth();
        if (!cancelled) { setSnap(data); setErr(false); }
      } catch {
        if (!cancelled) setErr(true);
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const status = err ? "unknown" : deriveDeployStatus(snap);
  const palette = PALETTE[status];

  // Tooltip: surface the most actionable info per state.
  const title = (() => {
    if (status === "unknown") return "Couldn't fetch prod health (token may have expired)";
    if (status === "paused")  return "Watchdog disabled (PROD_WATCHDOG_ENABLED=false on the pod)";
    if (!snap) return "Loading…";
    const failing = (snap.endpoints || []).filter((e) => !e.last_ok);
    if (status === "down" && failing[0]) {
      return `${failing[0].endpoint} · HTTP ${failing[0].last_status || "?"} · ${failing.length} failing — click to view`;
    }
    if (status === "degraded" && failing[0]) {
      return `${failing[0].endpoint} flaky · HTTP ${failing[0].last_status || "?"} — click to view`;
    }
    return `All ${snap.endpoints?.length || 0} endpoints OK · target ${snap.target || "—"}`;
  })();

  // Failing-count badge (shown only when degraded/down).
  const failingCount = snap?.endpoints?.filter((e) => !e.last_ok).length || 0;

  return (
    <button
      type="button"
      onClick={() => onJumpToTab?.("prod-health")}
      className={`inline-flex items-center gap-2 px-3 py-2 border ${palette.border} ${palette.bg} font-mono text-[10px] uppercase tracking-[0.22em] ${palette.text} hover:brightness-125 transition cursor-pointer`}
      title={title}
      data-testid="deploy-health-pill"
      data-status={status}
    >
      <span
        className={`w-2 h-2 rounded-full ${palette.dot} ${status === "degraded" || status === "down" ? "animate-pulse" : ""}`}
        aria-hidden
      />
      <span>{LABEL[status]}</span>
      {failingCount > 0 && (
        <span className="text-ink-muted" data-testid="deploy-health-failing-count">
          · {failingCount} failing
        </span>
      )}
    </button>
  );
}
