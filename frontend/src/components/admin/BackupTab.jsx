import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Database, Download, Shield, AlertTriangle } from "lucide-react";

// Super-admin-only backup tab. Triggers GET /api/admin/db/backup which
// streams a `mongodump --archive --gzip` of the whole database straight
// to the browser as a download. Diag endpoint runs first so we render
// a green/red "ready" indicator before the operator commits.
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
    return () => { cancelled = true; };
  }, []);

  const ready = diag && !diag.error && diag.mongodump_present && diag.mongo_url_set;

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
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-1 inline-flex items-center gap-2">
          <Shield size={12} /> Super admin only
        </div>
        <h2 className="font-display text-3xl uppercase">Database Backup.</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl leading-relaxed">
          Streams a full <code className="text-[#ff4500]">mongodump --archive --gzip</code> of the production database
          straight to your browser. Nothing is persisted on disk. Every download is audit-logged.
          Restore with <code className="text-[#ff4500]">mongorestore --gzip --archive=&lt;file&gt;</code>.
        </p>
      </header>

      {/* Diag panel — green/red light before the operator clicks */}
      <div className="border border-[#262626] p-4" data-testid="backup-diag-panel">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
          ◆ Pre-flight check
        </div>
        {loading ? (
          <p className="font-mono text-xs text-[#737373]">Checking backend…</p>
        ) : diag?.error ? (
          <p className="font-mono text-xs text-red-400" data-testid="backup-diag-error">
            ⊗ Diag failed: {diag.error}. (Are you a super admin?)
          </p>
        ) : (
          <ul className="font-mono text-xs space-y-1.5">
            <li className={diag.mongodump_present ? "text-emerald-400" : "text-red-400"}>
              {diag.mongodump_present ? "✓" : "⊗"} mongodump binary{" "}
              <span className="text-[#525252]">({diag.mongodump_path})</span>
            </li>
            <li className={diag.mongo_url_set ? "text-emerald-400" : "text-red-400"}>
              {diag.mongo_url_set ? "✓" : "⊗"} MONGO_URL set in backend env
            </li>
            <li className="text-[#a3a3a3]">
              ◆ Database: <span className="text-[#e5e5e5]">{diag.db_name || "(unset)"}</span>
            </li>
          </ul>
        )}
      </div>

      {/* Action */}
      <div className="border border-[#ff4500]/40 bg-[#ff4500]/5 p-5 flex items-center justify-between gap-4 flex-wrap" data-testid="backup-action">
        <div className="flex items-center gap-3 min-w-0">
          <Database size={32} className="text-[#ff4500] shrink-0" />
          <div className="min-w-0">
            <div className="font-display text-xl">Download full backup</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-1">
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
        <div className="font-mono text-[11px] text-emerald-400" data-testid="backup-last-size">
          ✓ Last backup: {(lastSize / 1024 / 1024).toFixed(2)} MB downloaded successfully.
        </div>
      )}

      {/* Safety reminders */}
      <div className="border border-amber-500/40 bg-amber-500/5 p-4 flex gap-3" data-testid="backup-safety">
        <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="font-mono text-[11px] text-amber-200 leading-relaxed">
          <div className="font-bold uppercase tracking-[0.22em] mb-1">Handle with care</div>
          <ul className="list-disc pl-4 space-y-1 text-amber-200/80">
            <li>The archive contains every PII record in the marketplace — encrypt at rest after download.</li>
            <li>Delete the file from <code>~/Downloads</code> once you've moved it to encrypted storage.</li>
            <li>Run a quarterly restore drill against a throwaway Mongo container to verify the archive is usable. See <code className="text-amber-100">/app/docs/mongodb-backup.md</code>.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
