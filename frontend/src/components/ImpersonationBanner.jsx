// iter413ca — Impersonation banner.
// ─────────────────────────────────
// Renders a high-contrast warning strip on every page when the current
// tab is operating under an admin-minted impersonation JWT. Clicking
// "Exit" wipes the impersonation JWT + meta and lands the admin back on
// the admin console.
import React, { useEffect, useState } from "react";
import { readImpersonation, stopImpersonation } from "../lib/impersonate";

export default function ImpersonationBanner() {
  const [meta, setMeta] = useState(() => readImpersonation());

  // Re-poll across tab focus + storage events so the banner appears in
  // a freshly opened impersonation tab and disappears when the admin
  // exits from any tab.
  useEffect(() => {
    const sync = () => setMeta(readImpersonation());
    const onStorage = (e) => { if (!e.key || e.key === "cm_impersonating") sync(); };
    const onFocus = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    const tick = setInterval(sync, 30_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      clearInterval(tick);
    };
  }, []);

  if (!meta) return null;

  const minsLeft = Math.max(0, Math.round((meta.expires_at - Date.now()) / 60_000));
  const onExit = () => {
    stopImpersonation();
    setMeta(null);
    // Land back on home (admin tab keeps its own admin JWT — this tab
    // closes the impersonation surface cleanly).
    window.location.href = "/";
  };

  return (
    <div
      role="alert"
      data-testid="impersonation-banner"
      className="sticky top-0 z-[60] w-full border-b-2 border-brand bg-brand text-[#0a0a0a] font-mono text-xs"
    >
      <div className="max-w-7xl mx-auto px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold uppercase tracking-[0.22em] text-[10px] shrink-0">◆ Impersonating</span>
          <span className="truncate">
            Viewing as <strong data-testid="impersonation-target-name">{meta.target_name || meta.target_email}</strong>
            <span className="opacity-70"> · {meta.target_type === "maker" ? `/${meta.target_sub}` : meta.target_email}</span>
            <span className="opacity-70"> · {minsLeft}m left</span>
            <span className="opacity-70"> · by {meta.imp_by}</span>
          </span>
        </div>
        <button
          onClick={onExit}
          data-testid="impersonation-exit"
          className="shrink-0 px-3 py-1 border border-[#0a0a0a] hover:bg-[#0a0a0a] hover:text-brand font-bold text-[10px] uppercase tracking-[0.22em] transition"
        >
          Exit Impersonation
        </button>
      </div>
    </div>
  );
}
