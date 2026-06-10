import React, { useEffect, useState } from "react";
import { fetchActivity } from "../../lib/api";

export default function ActivityTicker() {
  const [events, setEvents] = useState([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => fetchActivity(12).then((d) => { if (alive) setEvents(d); }).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (events.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % events.length), 3500);
    return () => clearInterval(t);
  }, [events.length]);

  if (!events.length) return null;
  const e = events[idx];
  const colors = {
    sold: "#ff4500", shipped: "#4ade80", listed: "#60a5fa",
    applied: "#facc15", drop: "#ff4500", founder_joined: "#ff4500",
  };
  const isDrop = e.kind === "drop";

  return (
    <div
      className={`w-full border-b font-mono uppercase tracking-[0.22em] py-2.5 px-4 flex items-center gap-3 overflow-hidden ${
        isDrop
          ? "bg-surface border-brand/40 text-brand text-[11px] md:text-[12px]"
          : "bg-paper border-line text-ink-muted text-[10px] md:text-[11px]"
      }`}
      data-testid="activity-ticker"
    >
      <span
        className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
        style={{ background: colors[e.kind] || "#fff" }}
      />
      {isDrop && (
        <span
          className="font-display text-[10px] md:text-[11px] tracking-[0.3em] text-brand flex-shrink-0"
          data-testid="activity-ticker-drop-badge"
        >
          ◆ DROP
        </span>
      )}
      <span
        className={`truncate ${isDrop ? "text-ink font-bold" : "text-ink"}`}
      >
        {e.text}
      </span>
      <span className="hidden sm:inline">·</span>
      <span className="hidden sm:inline truncate">{e.location}</span>
      <span className="ml-auto hidden md:inline" style={{ color: colors[e.kind] || "#fff" }}>
        {e.kind.toUpperCase()}
      </span>
    </div>
  );
}
