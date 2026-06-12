import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Database, Download, Shield, AlertTriangle, Cloud, RefreshCw, Play, ShieldCheck } from "lucide-react";
import { timeAgo } from "../../lib/timeAgo";
import { useConfirm } from "../../hooks/useConfirm";

// Super-admin-only backup tab. Triggers GET /api/admin/db/backup which
// streams a `mongodump --archive --gzip` of the whole database straight
// to the browser as a download. Diag endpoint runs first so we render
// a green/red "ready" indicator before the operator commits.
//
// Also exposes the offsite-backup inventory (`/api/admin/db/backup/offsite`)
// and a manual-trigger button (`/api/admin/db/backup/offsite/run`) so
// ops can force a snapshot before a risky deploy without waiting for
// the 03:15 UTC nightly window.
const API = process.env.REACT_APP_BACKEND_URL;

function authHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}`,
  };
}

export default function BackupTab() {
  const [diag, setDiag] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [lastSize, setLastSize] = useState(null);
  const [offsite, setOffsite] = useState(null);
  const [offsiteLoading, setOffsiteLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [drillRunning, setDrillRunning] = useState(false);
  const [drillResult, setDrillResult] = useState(null);
  const [confirm, confirmModal] = useConfirm();

  const loadOffsite = async () => {
    setOffsiteLoading(true);
    try {
      const r = await fetch(`${API}/api/admin/db/backup/offsite`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setOffsite(await r.json());
    } catch (e) {
      setOffsite({ error: e.message || "Failed", backups: [], count: 0 });
    } finally {
      setOffsiteLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/admin/db/backup/diag`, { headers: authHeaders() });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        if (!cancelled) setDiag(body);
      } catch (e) {
        if (!cancelled) setDiag({ error: e.message || "Diag failed" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    loadOffsite();
    return () => { cancelled = true; };
  }, []);

  const ready = diag && !diag.error && diag.mongodump_present && diag.mongo_url_set;
  const r2Ready = !!diag?.r2_configured;

  const runOffsite = async () => {
    setRunning(true);
    try {
      const r = await fetch(`${API}/api/admin/db/backup/offsite/run`, {
        method: "POST", headers: authHeaders(),
      });
      const body = await r.json();
      if (!r.ok || body.ok === false) {
        throw new Error(body.error || body.detail || `HTTP ${r.status}`);
      }
      if (body.ran === false) {
        toast.error(`Backup did not run: ${body.reason || "unknown"}`);
      } else {
        toast.success(`Offsite backup complete · ${body.size_mb} MB · ${body.duration_s}s`);
        await loadOffsite();
      }
    } catch (e) {
      toast.error(e.message || "Offsite backup failed.");
    } finally {
      setRunning(false);
    }
  };

  const runDrill = async () => {
    const ok = await confirm({
      title: "Run a recovery drill now?",
      body: "Downloads the latest R2 archive, restores it into an isolated namespace on the same Mongo cluster (production collections are NEVER touched), counts records, drops the namespace, and posts the pass/fail to Slack. Takes ~30-60 seconds depending on archive size.",
      confirmLabel: "Run drill",
      tone: "primary",
      testId: "confirm-run-drill",
    });
    if (!ok) return;
    setDrillRunning(true);
    setDrillResult(null);
    try {
      const r = await fetch(`${API}/api/admin/db/backup/drill/run`, {
        method: "POST", headers: authHeaders(),
      });
      const body = await r.json();
      setDrillResult(body);
      if (body.ok) {
        const products = body.counts?.products ?? "?";
        toast.success(`Drill PASSED · ${products} products restored & verified · ${body.duration_s}s`);
      } else {
        toast.error(`Drill FAILED · ${body.error || "see audit log"}`);
      }
    } catch (e) {
      toast.error(e.message || "Drill failed to run.");
    } finally {
      setDrillRunning(false);
    }
  };

  const downloadBackup = async () => {
    setDownloading(true);
    try {
      const r = await fetch(`${API}/api/admin/db/backup`, { headers: authHeaders() });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`HTTP ${r.status}: ${txt}`);
      }
      const blob = await r.blob();
      // Filename comes from Content-Disposition; fall back to a stamped name.
      const disp = r.headers.get("Content-Disposition") || "";
      const m = disp.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : `crafters-backup-${new Date().toISOString().slice(0, 10)}.archive.gz`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setLastSize(blob.size);
      toast.success(`Backup downloaded: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (e) {
      toast.error(e.message || "Backup download failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl" data-testid="backup-tab">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-1 inline-flex items-center gap-2">
          <Shield size={12} /> Super admin only
        </div>
        <h2 className="font-display text-3xl uppercase">Database Backup.</h2>
        <p className="font-mono text-xs text-ink-muted mt-2 max-w-2xl leading-relaxed">
          Streams a full <code className="text-brand">mongodump --archive --gzip</code> of the production database
          straight to your browser. Nothing is persisted on disk. Every download is audit-logged.
          Restore with <code className="text-brand">mongorestore --gzip --archive=&lt;file&gt;</code>.
        </p>
      </header>

      {/* Diag panel — green/red light before the operator clicks */}
      <div className="border border-line p-4" data-testid="backup-diag-panel">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
          ◆ Pre-flight check
        </div>
        {loading ? (
          <p className="font-mono text-xs text-ink-muted">Checking backend…</p>
        ) : diag?.error ? (
          <p className="font-mono text-xs text-red-400" data-testid="backup-diag-error">
            ⊗ Diag failed: {diag.error}. (Are you a super admin?)
          </p>
        ) : (
          <ul className="font-mono text-xs space-y-1.5">
            <li className={diag.mongodump_present ? "text-emerald-700" : "text-red-400"}>
              {diag.mongodump_present ? "✓" : "⊗"} mongodump binary{" "}
              <span className="text-ink-muted">({diag.mongodump_path})</span>
            </li>
            <li className={diag.mongo_url_set ? "text-emerald-700" : "text-red-400"}>
              {diag.mongo_url_set ? "✓" : "⊗"} MONGO_URL set in backend env
            </li>
            <li className="text-ink-muted">
              ◆ Database: <span className="text-ink">{diag.db_name || "(unset)"}</span>
            </li>
          </ul>
        )}
      </div>

      {/* Action */}
      <div className="border border-brand/40 bg-brand/5 p-5 flex items-center justify-between gap-4 flex-wrap" data-testid="backup-action">
        <div className="flex items-center gap-3 min-w-0">
          <Database size={32} className="text-brand shrink-0" />
          <div className="min-w-0">
            <div className="font-display text-xl">Download full backup</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-1">
              Compressed binary archive · streamed · audit-logged
            </div>
          </div>
        </div>
        <button
          onClick={downloadBackup}
          disabled={!ready || downloading}
          className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          data-testid="backup-download-btn"
        >
          <Download size={14} /> {downloading ? "Streaming…" : "Download backup"}
        </button>
      </div>

      {lastSize !== null && (
        <div className="font-mono text-[11px] text-emerald-700" data-testid="backup-last-size">
          ✓ Last backup: {(lastSize / 1024 / 1024).toFixed(2)} MB downloaded successfully.
        </div>
      )}

      {/* Offsite backup — R2 inventory + manual trigger */}
      <div className="border border-line p-5 space-y-4" data-testid="offsite-backup-panel">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Cloud size={26} className="text-[#7c8de8] shrink-0" />
            <div className="min-w-0">
              <div className="font-display text-xl">Offsite (R2) backups</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-1">
                Nightly @ 03:15 UTC · gated on the <span className="text-brand">auto_offsite_backup_enabled</span> toggle in Settings
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadOffsite}
              disabled={offsiteLoading}
              className="px-3 py-2 border border-line hover:border-brand/40 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 disabled:opacity-50"
              data-testid="offsite-refresh-btn"
              title="Refresh inventory"
            >
              <RefreshCw size={12} className={offsiteLoading ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              onClick={runOffsite}
              disabled={!r2Ready || running}
              className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="offsite-run-btn"
              title="Manually trigger an offsite backup now (bypasses the toggle, super-admin only)"
            >
              <Play size={14} /> {running ? "Running…" : "Run now"}
            </button>
          </div>
        </div>

        {!r2Ready && (
          <p className="font-mono text-[11px] text-brand">
            ⚠ R2 storage is not configured (missing env). Offsite backups disabled until R2_* env vars are set.
          </p>
        )}

        {offsiteLoading ? (
          <p className="font-mono text-xs text-ink-muted" data-testid="offsite-loading">Loading R2 inventory…</p>
        ) : offsite?.error ? (
          <p className="font-mono text-xs text-red-400">⊗ {offsite.error}</p>
        ) : (
          <div data-testid="offsite-inventory">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
              ◆ {offsite?.count ?? 0} archive{(offsite?.count ?? 0) === 1 ? "" : "s"} in R2
            </div>
            {(offsite?.backups || []).length === 0 ? (
              <p className="font-mono text-xs text-ink-muted">
                No backups yet. Click "Run now" to seed the first one, or flip the Settings toggle ON to schedule the nightly cron.
              </p>
            ) : (
              <ul className="divide-y divide-[#1f1f1f] border border-line">
                {offsite.backups.slice(0, 10).map((row) => (
                  <li
                    key={row.key}
                    className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-3 py-2.5 font-mono text-[11px]"
                    data-testid={`offsite-row`}
                  >
                    <code className="text-ink truncate" title={row.key}>{row.key.replace("backups/mongo/", "")}</code>
                    <span className="text-ink-muted tabular-nums">{row.size_mb} MB</span>
                    <span
                      className="text-ink-muted uppercase tracking-[0.18em]"
                      title={row.created_at ? new Date(row.created_at).toLocaleString() : ""}
                    >
                      {row.created_at ? timeAgo(row.created_at) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Recovery drill — verify the latest archive is actually restorable */}
      <div className="border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-4" data-testid="recovery-drill-panel">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <ShieldCheck size={26} className="text-emerald-700 shrink-0" />
            <div className="min-w-0">
              <div className="font-display text-xl">Recovery drill</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-1">
                Quarterly @ Jan/Apr/Jul/Oct 1st 04:30 UTC · gated on the <span className="text-brand">auto_recovery_drill_enabled</span> toggle
              </div>
            </div>
          </div>
          <button
            onClick={runDrill}
            disabled={drillRunning || (offsite?.count || 0) === 0}
            className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="recovery-drill-run-btn"
            title={(offsite?.count || 0) === 0 ? "Need at least one R2 archive to drill against" : "Manually run the drill now (super-admin, audit-logged, posts to Slack)"}
          >
            <Play size={14} /> {drillRunning ? "Drilling…" : "Run drill"}
          </button>
        </div>
        <div className="font-mono text-[11px] text-ink-muted leading-relaxed">
          Downloads the latest R2 archive, restores it into an isolated{" "}
          <code className="text-emerald-700">_dr_drill_&lt;timestamp&gt;</code> namespace on the same Mongo cluster, runs integrity counts (products ≥ {drillResult?.min_products ?? 100}), drops the namespace, and posts the result to your team's Slack/Discord webhook.
          <strong className="text-ink"> Production collections are never touched.</strong>
        </div>
        {drillResult && (
          <div
            className={`p-4 border ${drillResult.ok ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700" : "border-red-500/50 bg-red-500/10 text-red-600"}`}
            data-testid="drill-result"
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] mb-2">
              {drillResult.ok ? "✓ PASS" : "⊗ FAIL"} · {drillResult.duration_s}s
            </div>
            {drillResult.error ? (
              <div className="font-mono text-xs whitespace-pre-wrap break-words">{drillResult.error}</div>
            ) : (
              <ul className="font-mono text-xs grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                {Object.entries(drillResult.counts || {}).map(([k, v]) => (
                  <li key={k} className="tabular-nums">
                    <span className="opacity-60">{k.replace(/_/g, " ")}:</span> {v?.toLocaleString?.() ?? v}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Safety reminders */}
      <div className="border border-amber-500/40 bg-amber-500/5 p-4 flex gap-3" data-testid="backup-safety">
        <AlertTriangle size={16} className="text-brand shrink-0 mt-0.5" />
        <div className="font-mono text-[11px] text-ink leading-relaxed">
          <div className="font-bold uppercase tracking-[0.22em] mb-1">Handle with care</div>
          <ul className="list-disc pl-4 space-y-1 text-ink-muted">
            <li>The archive contains every PII record in the marketplace — encrypt at rest after download.</li>
            <li>Delete the file from <code>~/Downloads</code> once you've moved it to encrypted storage.</li>
            <li>Run a quarterly restore drill against a throwaway Mongo container to verify the archive is usable. See <code className="text-ink">/app/docs/mongodb-backup.md</code>.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
