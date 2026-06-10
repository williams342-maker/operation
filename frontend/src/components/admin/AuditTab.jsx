import React, { useEffect, useMemo, useState } from "react";
import { fetchAdminAuditLog, fetchAdminAIModLog } from "../../lib/api";
import { formatDate } from "./_shared";
import { RowsSkeleton } from "../Skeleton";

const ACTION_TONE = {
  banned: "bg-red-900/40 text-red-300 border-red-800",
  frozen: "bg-yellow-900/40 text-yellow-300 border-yellow-800",
  active: "bg-emerald-900/30 text-emerald-300 border-emerald-800",
};

const AI_TONE = {
  block: "bg-red-900/40 text-red-300 border-red-800",
  warn: "bg-yellow-900/40 text-yellow-300 border-yellow-800",
};

export default function AuditTab() {
  const [view, setView] = useState("moderation"); // moderation | ai
  return (
    <div data-testid="audit-tab" className="space-y-4">
      <div className="flex border border-line" role="tablist">
        {[
          { id: "moderation", label: "User Moderation" },
          { id: "ai", label: "AI Moderator" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] border-r border-line last:border-r-0 ${
              view === t.id ? "bg-brand text-[#0a0a0a]" : "text-ink-muted hover:text-ink"
            }`}
            data-testid={`audit-view-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {view === "moderation" ? <ModerationLog /> : <AIModLog />}
    </div>
  );
}

function AIModLog() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | block | warn

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchAdminAIModLog(200);
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((r) => r.action === filter);
  }, [items, filter]);

  return (
    <div className="space-y-4" data-testid="ai-mod-log">
      <div className="border border-line p-4 md:p-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-2">
          ◆ AI Moderator
        </div>
        <h3 className="font-display text-2xl uppercase mb-1">Live-chat decisions</h3>
        <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
          Every chat message that triggered a WARN or BLOCK by the auto-moderator. Use this to tune the prompt and catch false-positives. Source = "heuristic" (slur/spam regex pre-pass) or "llm" (Claude-haiku decision).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-line">
        <div className="flex border border-line">
          {["all", "block", "warn"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] border-r border-line last:border-r-0 ${
                filter === f ? "bg-brand text-[#0a0a0a]" : "text-ink-muted hover:text-ink"
              }`}
              data-testid={`ai-mod-filter-${f}`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          className="px-3 py-2 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em]"
          data-testid="ai-mod-refresh"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div data-testid="ai-mod-loading"><RowsSkeleton count={5} /></div>
      ) : !visible.length ? (
        <p className="font-mono text-sm text-ink-muted" data-testid="ai-mod-empty">
          {items.length === 0
            ? "No moderator decisions logged yet. Toggle 'AI Moderator (live chat)' on Settings to start classifying messages."
            : "No entries match the current filter."}
        </p>
      ) : (
        <div className="space-y-2" data-testid="ai-mod-list">
          {visible.map((r) => (
            <div
              key={r.id}
              className="border border-line hover:border-brand/40 transition p-3"
              data-testid={`ai-mod-row-${r.id}`}
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className={`px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.22em] ${AI_TONE[r.action] || "border-line text-ink-muted"}`}
                >
                  {r.action}
                </span>
                <span className="font-mono text-[10px] text-ink-muted uppercase tracking-[0.22em]">
                  #{r.channel} · {formatDate(r.created_at)} · via {r.source}
                </span>
              </div>
              <div className="mt-2 grid md:grid-cols-2 gap-2 text-xs">
                <div className="font-mono text-ink min-w-0 truncate">
                  <span className="text-ink-muted">User:</span> {r.user_name || r.user_email}
                  <span className="text-ink-muted"> · {r.user_email}</span>
                </div>
                <div className="font-mono text-ink-muted min-w-0 italic truncate">
                  {r.reason}
                </div>
              </div>
              <p className="font-mono text-xs text-ink mt-2 leading-relaxed border-l-2 border-brand pl-3 [overflow-wrap:anywhere]">
                {r.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModerationLog() {
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
    <div className="space-y-4" data-testid="moderation-log">
      <div className="border border-line p-4 md:p-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-2">
          ◆ Audit Log
        </div>
        <h3 className="font-display text-2xl uppercase mb-1">Moderation history</h3>
        <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
          Every Freeze / Ban / Restore action across all users — newest first.
          Use this for compliance and EUA enforcement audits. Hard-deletes
          remove the record from this log (deleted users carry no history).
        </p>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3 pb-4 border-b border-line">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by user, operator, or reason…"
          className="flex-1 bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
          data-testid="audit-search"
        />
        <div className="flex border border-line">
          {["all", "banned", "frozen", "active"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] border-r border-line last:border-r-0 ${
                filter === f ? "bg-brand text-[#0a0a0a]" : "text-ink-muted hover:text-ink"
              }`}
              data-testid={`audit-filter-${f}`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          className="px-3 py-2 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em]"
          data-testid="audit-refresh"
        >
          Refresh
        </button>
      </div>

      {err && <p className="font-mono text-xs text-red-400" data-testid="audit-error">{err}</p>}

      {loading ? (
        <div data-testid="audit-loading"><RowsSkeleton count={6} /></div>
      ) : !visible.length ? (
        <p className="font-mono text-sm text-ink-muted" data-testid="audit-empty">
          {items.length === 0
            ? "No moderation actions on file yet."
            : "No entries match the current filter."}
        </p>
      ) : (
        <div className="space-y-2" data-testid="audit-list">
          <p className="font-mono text-xs text-ink-muted" data-testid="audit-count">
            {visible.length} action{visible.length === 1 ? "" : "s"}
          </p>
          {visible.map((r, i) => (
            <div
              key={`${r.user_id}-${r.at}-${i}`}
              className="border border-line hover:border-brand/40 transition p-3"
              data-testid={`audit-row-${r.user_id}-${i}`}
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className={`px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.22em] ${ACTION_TONE[r.to] || "border-line text-ink-muted"}`}
                >
                  {r.from || "active"} → {r.to}
                </span>
                <span className="font-mono text-[10px] text-ink-muted uppercase tracking-[0.22em]">
                  {formatDate(r.at)}
                </span>
              </div>
              <div className="mt-2 grid md:grid-cols-2 gap-2 text-xs">
                <div className="font-mono text-ink min-w-0 truncate">
                  <span className="text-ink-muted">User:</span> {r.user_name || r.user_email}
                  <span className="text-ink-muted"> · {r.user_email}</span>
                </div>
                <div className="font-mono text-ink-muted min-w-0 truncate">
                  <span className="text-ink-muted">By:</span> {r.by}
                </div>
              </div>
              {r.reason && (
                <p className="font-mono text-xs text-ink mt-2 leading-relaxed border-l-2 border-brand pl-3">
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
