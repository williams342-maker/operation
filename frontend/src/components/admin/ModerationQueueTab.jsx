/**
 * Admin moderation queue — Google Play UGC compliance surface.
 *
 * Shows every open content report with:
 *   • reporter (email + role)
 *   • what was reported (kind + target_id + reason + detail)
 *   • when submitted
 *   • current status (open / resolved)
 *   • four moderator actions:
 *       - Dismiss             → no violation
 *       - Remove content      → hide the underlying row + close report
 *       - Warn user           → log warning against offender + close report
 *       - Suspend user        → suspend account + invalidate sessions + close report
 *
 * Every action writes to `admin_audit` and updates the report row's
 * `resolved_at` / `resolved_by` / `action_taken` fields.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const API = process.env.REACT_APP_BACKEND_URL;

const _adminAuth = () => {
  const t = localStorage.getItem("cm_admin_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const KINDS  = ["", "listing", "review", "journal", "showcase", "message", "maker", "buyer"];
const STATUSES = ["open", "resolved", ""];

function fmt(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

export default function ModerationQueueTab() {
  const [data, setData]     = useState({ reports: [], open_count: 0, total: 0 });
  const [status, setStatus] = useState("open");
  const [kind, setKind]     = useState("");
  const [busy, setBusy]     = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (kind)   params.set("kind", kind);
      const r = await fetch(`${API}/api/admin/reports?${params.toString()}`, {
        headers: _adminAuth(),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setData(d);
    } catch (e) { toast.error(`Load failed: ${e.message}`); }
    finally { setLoading(false); }
  }, [status, kind]);

  useEffect(() => { load(); }, [load]);

  async function act(reportId, action) {
    setBusy(`${reportId}:${action}`);
    try {
      const r = await fetch(`${API}/api/admin/reports/${reportId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ..._adminAuth() },
        body: action === "warn-user" ? JSON.stringify({ message: null }) : "{}",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      toast.success(`Action recorded: ${action}`);
      await load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4" data-testid="moderation-queue-tab">
      {/* Filter row + open-count badge */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand" data-testid="mq-open-badge">
          ◆ Open · <span className="text-ink">{data.open_count}</span>
          <span className="text-ink-muted ml-2">/ {data.total} total</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="ml-2 border border-line bg-paper px-2 py-1 font-mono text-xs"
              data-testid="mq-filter-status"
            >
              {STATUSES.map(s => (
                <option key={s || "all"} value={s}>{s || "all"}</option>
              ))}
            </select>
          </label>
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Kind
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="ml-2 border border-line bg-paper px-2 py-1 font-mono text-xs"
              data-testid="mq-filter-kind"
            >
              {KINDS.map(k => (
                <option key={k || "all"} value={k}>{k || "all"}</option>
              ))}
            </select>
          </label>
          <button
            onClick={load}
            className="border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] hover:bg-surface-2"
            data-testid="mq-refresh-btn"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="border border-line overflow-x-auto">
        <table className="w-full text-xs font-mono" data-testid="mq-table">
          <thead>
            <tr className="bg-surface-2 text-ink-muted uppercase tracking-[0.18em] text-[10px]">
              <th className="text-left px-3 py-2">When</th>
              <th className="text-left px-3 py-2">Reporter</th>
              <th className="text-left px-3 py-2">Kind</th>
              <th className="text-left px-3 py-2">Target</th>
              <th className="text-left px-3 py-2">Reason</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data.reports || []).length === 0 && (
              <tr><td colSpan={7} className="text-center py-6 text-ink-muted">No reports match.</td></tr>
            )}
            {(data.reports || []).map(r => (
              <tr key={r.id} className="border-t border-line align-top" data-testid={`mq-row-${r.id}`}>
                <td className="px-3 py-3 whitespace-nowrap">{fmt(r.created_at)}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div>{r.reporter_email || "—"}</div>
                  <div className="text-ink-muted text-[10px]">{r.reporter_role}</div>
                </td>
                <td className="px-3 py-3">{r.kind}</td>
                <td className="px-3 py-3 max-w-[220px] break-all">{r.target_id}</td>
                <td className="px-3 py-3">
                  <div className="text-red-500">{r.reason}</div>
                  {r.detail && <div className="text-ink-muted text-[10px] mt-1 max-w-[280px] break-words">{r.detail}</div>}
                </td>
                <td className="px-3 py-3">
                  <div>{r.status}</div>
                  {r.action_taken && (
                    <div className="text-ink-muted text-[10px]">
                      {r.action_taken} · {fmt(r.resolved_at)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3">
                  {r.status === "open" ? (
                    <div className="flex flex-wrap gap-1">
                      <button onClick={() => act(r.id, "dismiss")}
                              disabled={busy?.startsWith(r.id)}
                              className="border border-line px-2 py-1 text-[10px] hover:bg-surface-2"
                              data-testid={`mq-dismiss-${r.id}`}>
                        Dismiss
                      </button>
                      <button onClick={() => act(r.id, "remove-content")}
                              disabled={busy?.startsWith(r.id)}
                              className="border border-amber-500 text-amber-500 px-2 py-1 text-[10px] hover:bg-amber-500/10"
                              data-testid={`mq-remove-${r.id}`}>
                        Remove
                      </button>
                      <button onClick={() => act(r.id, "warn-user")}
                              disabled={busy?.startsWith(r.id)}
                              className="border border-orange-500 text-orange-500 px-2 py-1 text-[10px] hover:bg-orange-500/10"
                              data-testid={`mq-warn-${r.id}`}>
                        Warn
                      </button>
                      <button onClick={() => {
                                if (window.confirm("Suspend this user's account and invalidate all their sessions?")) {
                                  act(r.id, "suspend-user");
                                }
                              }}
                              disabled={busy?.startsWith(r.id)}
                              className="border border-red-500 text-red-500 px-2 py-1 text-[10px] hover:bg-red-500/10"
                              data-testid={`mq-suspend-${r.id}`}>
                        Suspend
                      </button>
                    </div>
                  ) : (
                    <span className="text-ink-muted text-[10px]">Closed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
