import React, { useEffect, useState } from "react";
import { fetchAdminLiveNow } from "../../lib/api";

// ===================== LIVE-NOW BADGE (admin nav real-time pulse) =====
export default function LiveNowBadge() {
  const [data, setData] = useState({ live_5m: 0, live_1m: 0 });
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetch = () => {
      fetchAdminLiveNow()
        .then((d) => { if (!cancelled) { setData(d); setErr(false); } })
        .catch(() => { if (!cancelled) setErr(true); });
    };
    fetch();
    const id = setInterval(() => {
      if (document.hidden) return;     // pause when tab hidden
      fetch();
    }, 30000);
    const onVis = () => { if (!document.hidden) fetch(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (err) return null;
  const pulse = data.live_1m > 0;
  const dotCls = pulse ? "bg-emerald-400 animate-pulse" : "bg-[#525252]";
  return (
    <div
      className="hidden md:flex items-center gap-2 px-3 py-2 border border-[#262626]"
      title={`${data.live_5m} visitors in last 5 min, ${data.live_1m} active in last 1 min`}
      data-testid="admin-live-now"
    >
      <span className={`inline-block w-2 h-2 rounded-full ${dotCls}`} />
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
        Live · <span className="text-[#e5e5e5]" data-testid="admin-live-now-count">{data.live_5m}</span>
      </span>
    </div>
  );
}

