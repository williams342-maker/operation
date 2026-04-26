import React, { useEffect, useMemo, useState } from "react";
import { fetchAdminAuditLog } from "../../lib/api";
import { formatDate } from "./_shared";

const ACTION_TONE = {
  banned: "bg-red-900/40 text-red-300 border-red-800",
  frozen: "bg-yellow-900/40 text-yellow-300 border-yellow-800",
  active: "bg-emerald-900/30 text-emerald-300 border-emerald-800",
};

export default function AuditTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all"); // all | banned | frozen | active
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await fetchAdminAuditLog(500);
      setItems(data.items || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load audit log.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    let out = items;
    if (filter !== "all") out = out.filter((r) => r.to === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((r) =>
        (r.user_email || "").toLowerCase().includes(q) ||
        (r.user_name || "").toLowerCase().includes(q) ||
        (r.by || "").toLowerCase().includes(q) ||
        (r.reason || "").toLowerCase().includes(q),
      );
    }
    return out;
  }, [items, filter, search]);

  return (
    <div data-testid="audit-tab" className="space-y-4">
      <div className="border border-[#262626] p-4 md:p-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
          ◆ Audit Log
        </div>
        <h3 className="font-display text-2xl uppercase mb-1">Moderation history</h3>
        <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed max-w-2xl">
          Every Freeze / Ban / Restore action across all users — newest first.
          Use this for compliance and EUA enforcement audits. Hard-deletes
          remove the record from this log (deleted users carry no history).
        </p>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3 pb-4 border-b border-[#262626]">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by user, operator, or reason…"
          className="flex-1 bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
          data-testid="audit-search"
        />
        <div className="flex border border-[#262626]">
          {["all", "banned", "frozen", "active"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] border-r border-[#262626] last:border-r-0 ${
                filter === f ? "bg-[#ff4500] text-[#0a0a0a]" : "text-[#a3a3a3] hover:text-[#e5e5e5]"
              }`}
              data-testid={`audit-filter-${f}`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          className="px-3 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em]"
          data-testid="audit-refresh"
        >
          Refresh
        </button>
      </div>

      {err && <p className="font-mono text-xs text-red-400" data-testid="audit-error">{err}</p>}

      {loading ? (
        <p className="font-mono text-sm text-[#a3a3a3]" data-testid="audit-loading">Loading…</p>
      ) : !visible.length ? (
        <p className="font-mono text-sm text-[#a3a3a3]" data-testid="audit-empty">
          {items.length === 0
            ? "No moderation actions on file yet."
            : "No entries match the current filter."}
        </p>
      ) : (
        <div className="space-y-2" data-testid="audit-list">
          <p className="font-mono text-xs text-[#a3a3a3]" data-testid="audit-count">
            {visible.length} action{visible.length === 1 ? "" : "s"}
          </p>
          {visible.map((r, i) => (
            <div
              key={`${r.user_id}-${r.at}-${i}`}
              className="border border-[#262626] hover:border-[#ff4500]/40 transition p-3"
              data-testid={`audit-row-${r.user_id}-${i}`}
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className={`px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.22em] ${ACTION_TONE[r.to] || "border-[#262626] text-[#a3a3a3]"}`}
                >
                  {r.from || "active"} → {r.to}
                </span>
                <span className="font-mono text-[10px] text-[#525252] uppercase tracking-[0.22em]">
                  {formatDate(r.at)}
                </span>
              </div>
              <div className="mt-2 grid md:grid-cols-2 gap-2 text-xs">
                <div className="font-mono text-[#e5e5e5] min-w-0 truncate">
                  <span className="text-[#a3a3a3]">User:</span> {r.user_name || r.user_email}
                  <span className="text-[#525252]"> · {r.user_email}</span>
                </div>
                <div className="font-mono text-[#a3a3a3] min-w-0 truncate">
                  <span className="text-[#525252]">By:</span> {r.by}
                </div>
              </div>
              {r.reason && (
                <p className="font-mono text-xs text-[#e5e5e5] mt-2 leading-relaxed border-l-2 border-[#ff4500] pl-3">
                  {r.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
