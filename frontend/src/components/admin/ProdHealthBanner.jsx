import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { fetchAdminProdHealth } from "../../lib/api";

/**
 * Sticky red banner shown above the admin dashboard grid when the prod
 * health watchdog has at least one endpoint in the alerted state. Polls
 * every 60s so a recovery clears it without a page refresh. Clicking
 * "View" jumps to the Prod Health tab.
 */
export default function ProdHealthBanner({ onJumpToTab }) {
  const [snap, setSnap] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchAdminProdHealth();
        if (!cancelled) setSnap(data);
      } catch {
        /* swallow; banner is best-effort */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!snap?.any_alerted) return null;
  const failing = (snap.endpoints || []).filter((e) => e.alerted);
  const first = failing[0];

  return (
    <div
      className="mb-6 border-2 border-red-600 bg-red-950/40 px-4 md:px-5 py-3 flex flex-col md:flex-row md:items-center gap-3 md:gap-4"
      data-testid="prod-health-banner"
    >
      <div className="flex items-center gap-2 text-red-600 font-mono text-[10px] uppercase tracking-[0.22em] shrink-0">
        <AlertTriangle size={14} className="animate-pulse" />
        ◆ Prod outage
      </div>
      <div className="flex-1 font-mono text-xs text-[#fca5a5] leading-relaxed">
        <b className="text-red-600">{failing.length}</b>{" "}
        {failing.length === 1 ? "endpoint is" : "endpoints are"} failing:{" "}
        <code className="text-red-600">{first?.endpoint}</code>
        {failing.length > 1 && ` +${failing.length - 1} more`}
        {first?.last_status ? ` · HTTP ${first.last_status}` : ""}
      </div>
      <button
        onClick={() => onJumpToTab?.("prod-health")}
        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-ink border border-red-700 font-mono text-[10px] uppercase tracking-[0.22em] shrink-0 transition"
        data-testid="prod-health-banner-view-btn"
      >
        View →
      </button>
    </div>
  );
}
