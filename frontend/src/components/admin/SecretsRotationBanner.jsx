import React, { useEffect, useState } from "react";
import { Key, AlertTriangle, ChevronRight, ShieldCheck, Clock } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * Admin-dashboard hero strip that surfaces "days since last rotation"
 * for every tracked credential without forcing the operator to click
 * into the dedicated Secrets tab. Drift you can spot at a glance.
 *
 * Render rules:
 *   - If ANY secret is overdue → red banner with "N overdue" + the 3
 *     worst offenders inline.
 *   - Otherwise if any is due_soon (< 30 days) → yellow nudge with the
 *     most-urgent one named.
 *   - Otherwise → small green "All credentials fresh" pill.
 *
 * Entire row is clickable → jumps to the Secrets tab via `onJumpToTab`,
 * mirroring the ProdHealthBanner pattern. Self-noops while loading
 * and on fetch error so a flaky API call never blocks dashboard load.
 */
export default function SecretsRotationBanner({ onJumpToTab }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const headers = {
      Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}`,
      "Content-Type": "application/json",
    };
    fetch(`${API}/api/admin/secrets/status`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  if (!data?.secrets) return null;

  const configured = data.secrets.filter((s) => s.is_set);
  if (!configured.length) return null;

  // Compute days-since-rotation per secret for inline display
  const withAge = configured.map((s) => {
    let daysSince = null;
    if (s.last_rotated_at) {
      const ms = Date.now() - new Date(s.last_rotated_at).getTime();
      daysSince = Math.floor(ms / (1000 * 60 * 60 * 24));
    }
    return { ...s, daysSince };
  });

  const overdue = withAge.filter((s) => s.status === "overdue");
  const dueSoon = withAge.filter((s) => s.status === "due_soon");

  // ───────── overdue banner (red, attention-grabbing) ─────────
  if (overdue.length) {
    const worst = [...overdue]
      .sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0))
      .slice(0, 3);
    return (
      <button
        type="button"
        onClick={() => onJumpToTab && onJumpToTab("secrets")}
        className="w-full mb-8 border border-red-500/60 bg-red-500/10 hover:bg-red-500/15 px-4 md:px-5 py-3 flex flex-col md:flex-row md:items-center gap-3 md:gap-4 text-left transition"
        data-testid="secrets-rotation-banner-overdue"
      >
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 shrink-0">
          <AlertTriangle size={14} /> {overdue.length} overdue
        </div>
        <div className="flex-1 font-mono text-xs text-[#e5e5e5] flex flex-wrap items-center gap-2">
          {worst.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-red-500/40 bg-[#1a0a0a] text-red-300"
              data-testid={`secrets-rotation-overdue-${s.id}`}
            >
              <Key size={10} /> {s.label}
              <span className="text-[#a3a3a3]">·</span>
              <span className="tabular-nums">
                {s.daysSince !== null ? `${s.daysSince}d since rotation` : "never rotated"}
              </span>
            </span>
          ))}
          {overdue.length > worst.length && (
            <span className="text-red-300 font-mono text-[10px]">
              +{overdue.length - worst.length} more
            </span>
          )}
        </div>
        <ChevronRight size={16} className="text-red-400 shrink-0" />
      </button>
    );
  }

  // ───────── due-soon nudge (yellow) ─────────
  if (dueSoon.length) {
    const next = [...dueSoon].sort((a, b) => (a.days_until_due ?? 99) - (b.days_until_due ?? 99))[0];
    return (
      <button
        type="button"
        onClick={() => onJumpToTab && onJumpToTab("secrets")}
        className="w-full mb-8 border border-yellow-600/50 bg-yellow-600/8 hover:bg-yellow-600/12 px-4 md:px-5 py-3 flex flex-col md:flex-row md:items-center gap-3 md:gap-4 text-left transition"
        data-testid="secrets-rotation-banner-due-soon"
      >
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-yellow-400 shrink-0">
          <Clock size={14} /> Rotation due
        </div>
        <div className="flex-1 font-mono text-xs text-[#e5e5e5]">
          <b className="text-yellow-300">{next.label}</b> rotates in{" "}
          <span className="tabular-nums text-yellow-300">{next.days_until_due}d</span>
          {dueSoon.length > 1 && (
            <span className="text-[#a3a3a3]"> · {dueSoon.length - 1} more in the next 30d</span>
          )}
        </div>
        <ChevronRight size={16} className="text-yellow-400 shrink-0" />
      </button>
    );
  }

  // ───────── all-clear pill ─────────
  // Derive freshest + oldest for the at-a-glance summary
  const ages = withAge.map((s) => s.daysSince).filter((n) => n !== null);
  const oldest = ages.length ? Math.max(...ages) : null;
  return (
    <button
      type="button"
      onClick={() => onJumpToTab && onJumpToTab("secrets")}
      className="w-full mb-8 border border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10 px-4 md:px-5 py-3 flex items-center gap-3 text-left transition"
      data-testid="secrets-rotation-banner-ok"
    >
      <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
      <div className="flex-1 font-mono text-xs text-[#e5e5e5]">
        All <b className="text-emerald-300">{configured.length}</b> credentials within rotation cadence
        {oldest !== null && (
          <span className="text-[#a3a3a3]">
            {" "}· oldest is <span className="tabular-nums">{oldest}d</span> since last rotation
          </span>
        )}
      </div>
      <ChevronRight size={14} className="text-[#525252] shrink-0" />
    </button>
  );
}
