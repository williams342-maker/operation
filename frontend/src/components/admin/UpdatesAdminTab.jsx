import React, { useCallback, useEffect, useState } from "react";
import { Send, Eye, RefreshCw, Mail, AlertTriangle, Download, Clock } from "lucide-react";
import {
  fetchAdminUpdatesPreview,
  adminUpdatesDispatch,
} from "../../lib/api";
import { StatsSkeleton, RowsSkeleton } from "../Skeleton";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Updates digest control panel — iter97.
 *
 * Surfaces the current subscriber count, the last-dispatched pointer,
 * and the entries that WOULD be sent right now if you click Dispatch.
 * Two actions:
 *   - "Dry Run"  → server returns who'd get what without sending.
 *   - "Send Now" → fires the digest immediately (with double-confirm).
 */
export default function UpdatesAdminTab() {
  const [snap, setSnap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const load = useCallback(async () => {
    try {
      setSnap(await fetchAdminUpdatesPreview());
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load preview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dryRun = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await adminUpdatesDispatch({ dry_run: true });
      setLastResult({ ...r, kind: "dry-run" });
    } catch (e) {
      setErr(e?.response?.data?.detail || "Dry run failed.");
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await adminUpdatesDispatch({ dry_run: false });
      setLastResult({ ...r, kind: "live" });
      await load();  // refresh pointer state
    } catch (e) {
      setErr(e?.response?.data?.detail || "Dispatch failed.");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6" data-testid="updates-admin-loading">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-2">◆ Updates Digest</div>
          <h2 className="font-display text-2xl md:text-3xl uppercase leading-none mb-2">Dispatch.</h2>
        </div>
        <StatsSkeleton count={4} />
        <RowsSkeleton count={3} />
      </div>
    );
  }

  const queued = snap?.queued_entries || [];
  const wouldSend = snap?.would_send || 0;

  return (
    <div className="space-y-6" data-testid="updates-admin-tab">
      <header>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-2">
          ◆ Updates Digest
        </div>
        <h2 className="font-display text-2xl md:text-3xl uppercase leading-none mb-2">Dispatch.</h2>
        <p className="font-mono text-[11px] text-ink-muted leading-relaxed max-w-2xl">
          Manually fire the daily digest cron. Same logic, just on-demand. Idempotent — re-running with no new entries sends zero emails.
        </p>
      </header>

      {/* Stale warning — surfaces when no new entries have shipped in 30+
          days. Doesn't pause anything (the cron auto-no-ops); just nudges
          the operator that subscribers haven't heard from us. */}
      {snap?.stale?.is_stale && (
        <div
          className="border border-yellow-700/60 bg-yellow-900/20 px-4 py-3 font-mono text-[11px] text-brand flex items-start gap-3"
          data-testid="updates-stale-banner"
        >
          <Clock size={14} className="shrink-0 mt-0.5" />
          <div>
            <div className="text-brand mb-1">
              ⚠ {snap.stale.days_since_dispatch} days since last digest
            </div>
            <div className="text-ink-muted leading-relaxed">
              Subscribers haven't heard from us in over {snap.stale.threshold_days} days. Either ship a new CHANGELOG entry to re-engage them, or consider sending a status note via the broadcast tab.
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active Subs" value={snap?.active_subscribers ?? 0} testId="updates-stat-active" />
        <Stat label="Unsubscribed" value={snap?.unsubscribed_count ?? 0} testId="updates-stat-unsubscribed" />
        <Stat label="Queued" value={queued.length} highlight={queued.length > 0} testId="updates-stat-queued" />
        <Stat label="Would Send" value={wouldSend} highlight={wouldSend > 0} testId="updates-stat-would-send" />
      </div>

      {/* Pointer state */}
      <div className="border border-line bg-paper p-4 font-mono text-[11px] grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-ink-muted uppercase tracking-[0.22em] text-[10px] mb-1">Last dispatched iter</div>
          <code className="text-ink">{snap?.last_dispatched_iter || "—"}</code>
        </div>
        <div>
          <div className="text-ink-muted uppercase tracking-[0.22em] text-[10px] mb-1">Latest changelog iter</div>
          <code className="text-brand">{snap?.latest_changelog_iter || "—"}</code>
        </div>
        <div>
          <div className="text-ink-muted uppercase tracking-[0.22em] text-[10px] mb-1">Last dispatched at</div>
          <code className="text-ink">{snap?.last_dispatched_at?.slice(0, 19).replace("T", " ") || "never"}</code>
        </div>
      </div>

      {/* Queued entries preview */}
      {queued.length > 0 ? (
        <div data-testid="updates-queued-list">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted mb-3">
            ◆ Will send these {queued.length} {queued.length === 1 ? "entry" : "entries"}
          </div>
          <div className="space-y-3">
            {queued.map((e) => (
              <div key={`${e.date}-${e.iter}`} className="border-l-2 border-brand pl-4 py-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-1">
                  {e.date} · iter{e.iter}
                </div>
                <div className="font-display text-base uppercase leading-tight mb-1">{e.title}</div>
                {e.blurb && (
                  <p className="font-mono text-[11px] text-ink-muted leading-relaxed">{e.blurb}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border border-line bg-paper p-4 font-mono text-[11px] text-ink-muted">
          ◇ Nothing queued — last-dispatched pointer is at the latest changelog entry. Add a new CHANGELOG entry to queue work.
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-line">
        <button
          onClick={dryRun}
          disabled={busy}
          className="btn-industrial inline-flex items-center justify-center gap-2 disabled:opacity-50"
          data-testid="updates-dry-run-btn"
        >
          <Eye size={13} /> Dry Run
        </button>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={busy || wouldSend === 0}
          className="btn-industrial btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-50"
          data-testid="updates-send-now-btn"
        >
          <Send size={13} />
          {wouldSend > 0 ? `Send to ${wouldSend} subscriber${wouldSend === 1 ? "" : "s"}` : "Nothing to send"}
        </button>
        <button
          onClick={load}
          disabled={busy}
          className="btn-industrial inline-flex items-center justify-center gap-2 disabled:opacity-50"
          data-testid="updates-refresh-btn"
        >
          <RefreshCw size={13} /> Refresh
        </button>
        <a
          href={`${API}/admin/updates/subscribers.csv`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            // Inject the auth header by fetching the file with axios instead
            // of letting the anchor download (browsers don't send custom
            // headers on plain anchor downloads).
            e.preventDefault();
            const token = window.localStorage.getItem("cm_admin_jwt");
            fetch(`${API}/admin/updates/subscribers.csv`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            })
              .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.blob();
              })
              .then((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              })
              .catch((err) => setErr(`CSV export failed: ${err.message}`));
          }}
          className="btn-industrial inline-flex items-center justify-center gap-2 cursor-pointer"
          data-testid="updates-export-csv-btn"
        >
          <Download size={13} /> Export CSV
        </a>
      </div>

      {err && (
        <div className="border border-red-700/60 bg-red-900/20 px-4 py-3 font-mono text-[11px] text-red-600" data-testid="updates-admin-error">
          {err}
        </div>
      )}

      {lastResult && (
        <div
          className={`border px-4 py-3 font-mono text-[11px] ${
            lastResult.kind === "dry-run"
              ? "border-yellow-700/60 bg-yellow-900/20 text-brand"
              : "border-emerald-700/60 bg-emerald-900/20 text-emerald-700"
          }`}
          data-testid={`updates-result-${lastResult.kind}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Mail size={13} />
            {lastResult.kind === "dry-run" ? "Dry run · no emails sent" : "Dispatched"}
          </div>
          <div className="text-ink-muted">
            new_entries=<b>{lastResult.new_entries ?? 0}</b> · subscribers=<b>{lastResult.subscribers ?? 0}</b> · sent=<b>{lastResult.sent ?? 0}</b>
            {typeof lastResult.failed === "number" && lastResult.failed > 0 && (
              <> · failed=<b className="text-red-600">{lastResult.failed}</b></>
            )}
            {lastResult.advanced_to && <> · pointer→<b>iter{lastResult.advanced_to}</b></>}
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-paper/80 z-50 flex items-center justify-center p-6" data-testid="updates-confirm-modal">
          <div className="border-2 border-brand bg-paper max-w-md w-full p-6">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-3">
              <AlertTriangle size={12} /> Confirm dispatch
            </div>
            <h3 className="font-display text-2xl uppercase leading-tight mb-3">
              Send digest to {wouldSend} subscriber{wouldSend === 1 ? "" : "s"}?
            </h3>
            <p className="font-mono text-[11px] text-ink-muted leading-relaxed mb-5">
              This will fire {queued.length} {queued.length === 1 ? "entry" : "entries"} to every active subscriber. Cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="flex-1 btn-industrial disabled:opacity-50"
                data-testid="updates-confirm-cancel"
              >
                Cancel
              </button>
              <button
                onClick={sendNow}
                disabled={busy}
                className="flex-1 btn-industrial btn-primary disabled:opacity-50"
                data-testid="updates-confirm-send"
              >
                {busy ? "Sending…" : "Send Now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight, testId }) {
  return (
    <div
      className={`border ${highlight ? "border-brand bg-brand/10" : "border-line bg-paper"} p-4`}
      data-testid={testId}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">{label}</div>
      <div className={`font-display text-3xl ${highlight ? "text-brand" : "text-ink"}`}>{value}</div>
    </div>
  );
}
