import React, { useEffect, useState } from "react";
import { http } from "../../lib/api";

/**
 * Compact email health pill for the top of AdminDashboard.
 *
 * Polls `/api/admin/email-health` every 60s. Renders a single colored dot +
 * status label + tooltip hint. Designed to be glanceable — if the dot is
 * green, emails are flowing; any other color means "open the Email tab".
 *
 * States:
 *  - ok       (emerald)  — sends succeeding, no issues
 *  - degraded (yellow)   — fallback catching failures, or partial failures
 *  - down     (red)      — all sends failing, or provider not configured
 *  - idle     (gray)     — no activity in 24h (fresh deploy)
 *  - unknown  (gray)     — fetch failed (most likely the endpoint 401'd; rare)
 */
const PALETTE = {
  ok:       { dot: "bg-emerald-500", text: "text-emerald-300", border: "border-emerald-700/60", bg: "bg-emerald-900/20" },
  degraded: { dot: "bg-yellow-500",  text: "text-yellow-300",  border: "border-yellow-700/60",  bg: "bg-yellow-900/20" },
  down:     { dot: "bg-red-500",     text: "text-red-300",     border: "border-red-700/60",     bg: "bg-red-900/20" },
  idle:     { dot: "bg-[#525252]",   text: "text-[#a3a3a3]",   border: "border-[#262626]",      bg: "bg-[#0a0a0a]" },
  unknown:  { dot: "bg-[#525252]",   text: "text-[#a3a3a3]",   border: "border-[#262626]",      bg: "bg-[#0a0a0a]" },
};

const LABEL = {
  ok: "Email · OK",
  degraded: "Email · Degraded",
  down: "Email · Down",
  idle: "Email · Idle",
  unknown: "Email · ?",
};

export default function EmailHealthBadge() {
  const [health, setHealth] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const token = localStorage.getItem("cm_admin_jwt");
        const { data } = await http.get("/admin/email-health", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) { setHealth(data); setErr(false); }
      } catch {
        if (!cancelled) setErr(true);
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const status = err ? "unknown" : (health?.status || "idle");
  const palette = PALETTE[status] || PALETTE.unknown;
  const title = health?.hint || "Loading email health…";

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-2 border ${palette.border} ${palette.bg} font-mono text-[10px] uppercase tracking-[0.22em] ${palette.text}`}
      title={title}
      data-testid="email-health-badge"
      data-status={status}
    >
      <span
        className={`w-2 h-2 rounded-full ${palette.dot} ${status === "degraded" || status === "down" ? "animate-pulse" : ""}`}
        aria-hidden
      />
      <span>{LABEL[status]}</span>
      {health?.sent_24h !== undefined && status !== "idle" && status !== "unknown" && (
        <span className="text-[#525252]" data-testid="email-health-counts">
          · {health.sent_24h}/{health.sent_24h + (health.failed_24h || 0)} 24h
        </span>
      )}
    </div>
  );
}
