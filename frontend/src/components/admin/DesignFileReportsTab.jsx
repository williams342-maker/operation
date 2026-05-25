import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import {
  fetchAdminDesignFileReports,
  resolveDesignFileReport,
  unquarantineDesignFile,
} from "../../lib/api";
import { formatDate } from "./_shared";
import { RowsSkeleton } from "../Skeleton";
import EmptyState from "../EmptyState";

// Moderation queue for design-file reports. When a community user clicks
// ⚑ Report on a file card, a row lands here. Admin can:
//   - Quarantine the file (soft-deletes from public list, rolls up all
//     open reports for that file to "resolved")
//   - Dismiss the report (keeps the file public, closes just that row)
//   - Unquarantine later from the file card if we mis-moderated.
const STATUS_TABS = [
  { id: "open",      label: "Open" },
  { id: "resolved",  label: "Resolved" },
  { id: "dismissed", label: "Dismissed" },
];

export default function DesignFileReportsTab() {
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const refresh = async () => {
    setLoading(true);
    setErr("");
    try {
      setRows(await fetchAdminDesignFileReports(status));
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [status]);

  const counts = useMemo(() => {
    // We only have the current-tab count without hitting the server for
    // every status, but that's fine — the pills are illustrative, not
    // exact totals. Accurate count shown for the active tab.
    return { [status]: rows.length };
  }, [rows, status]);

  return (
    <div className="space-y-5" data-testid="file-reports-tab">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400">◆ Moderation Queue</div>
        <h2 className="font-display text-3xl md:text-4xl mt-1">Design-file reports</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl">
          Flags from community users on uploaded design files. Quarantine hides
          the file platform-wide and marks every open report for that file
          as resolved. Dismiss closes just this row.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pb-3 border-b border-[#262626]">
        {STATUS_TABS.map((t) => {
          const active = status === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setStatus(t.id)}
              data-testid={`file-reports-filter-${t.id}`}
              className={`px-2.5 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2 transition ${
                active
                  ? "border-red-500 text-red-400 bg-red-500/5"
                  : "border-[#262626] text-[#a3a3a3] hover:border-[#525252] hover:text-[#e5e5e5]"
              }`}
            >
              {t.label}
              {active && <span className="text-[9px] text-red-400">{counts[t.id] ?? 0}</span>}
            </button>
          );
        })}
      </div>

      {loading && <div data-testid="file-reports-loading" className="py-2"><RowsSkeleton count={4} /></div>}
      {err && <div className="font-mono text-xs text-red-400 py-6">{err}</div>}
      {!loading && rows.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          eyebrow={status === "open" ? "◆ All clear" : "◆ Archive"}
          title={status === "open" ? "No open reports." : `No ${status} reports.`}
          body={
            status === "open"
              ? "Community moderation is quiet. New flags from users will appear here within seconds of being filed."
              : `Switch back to "Open" to triage active reports.`
          }
          testId="file-reports-empty"
        />
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <ReportRow key={r.id} report={r} onChange={refresh} />
        ))}
      </div>
    </div>
  );
}

function ReportRow({ report, onChange }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const f = report.file;

  const doAction = async (action) => {
    setBusy(action);
    try {
      await resolveDesignFileReport(report.id, { action, note });
      toast.success(action === "quarantine" ? "File quarantined." : "Report dismissed.");
      await onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Action failed.");
    } finally {
      setBusy("");
    }
  };

  const restore = async () => {
    if (!f) return;
    setBusy("restore");
    try {
      await unquarantineDesignFile(f.id);
      toast.success("File restored to public list.");
      await onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Restore failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div
      className="border border-[#262626] hover:border-red-500/40 transition p-4 md:p-5"
      data-testid={`file-report-row-${report.id}`}
    >
      <div className="flex flex-col md:flex-row md:items-start gap-4">
        {/* Thumbnail */}
        {f?.thumbnail_url ? (
          <img
            src={f.thumbnail_url}
            alt=""
            className="w-20 h-20 object-cover border border-[#262626] shrink-0"
          />
        ) : (
          <div className="w-20 h-20 border border-[#262626] flex items-center justify-center font-mono text-[10px] text-[#a3a3a3] shrink-0">
            {f?.file_type || "?"}
          </div>
        )}

        {/* Details */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block px-1.5 py-0.5 border border-red-500/60 text-red-400 text-[9px] font-bold uppercase tracking-[0.22em]">
              {report.reason_label}
            </span>
            {f?.quarantined_at && (
              <span className="inline-block px-1.5 py-0.5 bg-red-600 text-white text-[9px] font-bold uppercase tracking-[0.22em]">
                Quarantined
              </span>
            )}
            {f && f.open_reports > 1 && report.status === "open" && (
              <span className="inline-block px-1.5 py-0.5 bg-amber-600/80 text-black text-[9px] font-bold uppercase tracking-[0.22em]">
                {f.open_reports}× reports
              </span>
            )}
            <span className="font-mono text-[10px] text-[#525252]">
              {formatDate(report.created_at)}
            </span>
          </div>
          <div className="font-display text-lg text-[#e5e5e5] break-words">
            {report.file_title || "(file removed)"}
          </div>
          <div className="font-mono text-[11px] text-[#a3a3a3]">
            Uploader: <span className="text-[#e5e5e5]">{report.file_uploader || "—"}</span>
            &nbsp;·&nbsp;
            Reporter: <span className="text-[#e5e5e5]">{report.reported_by}</span>
            &nbsp;·&nbsp;
            Role: <span className="text-[#e5e5e5]">{report.reported_role}</span>
          </div>
          {report.details && (
            <div className="font-mono text-[11px] text-[#a3a3a3] border-l-2 border-red-500/60 pl-3 leading-relaxed">
              "{report.details}"
            </div>
          )}
          {report.resolver_note && report.status !== "open" && (
            <div className="font-mono text-[10px] text-[#525252]">
              {report.resolution_action === "quarantine" ? "✕ Quarantined" : "◇ Dismissed"} by {report.resolver} · {formatDate(report.resolved_at)}
              {report.resolver_note && <> · <span className="text-[#a3a3a3]">"{report.resolver_note}"</span></>}
            </div>
          )}

          {f?.download_url && (
            <a
              href={f.download_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] hover:underline"
              data-testid={`file-report-preview-${report.id}`}
            >
              → Preview file
            </a>
          )}
        </div>
      </div>

      {/* Actions */}
      {report.status === "open" && (
        <div className="mt-4 pt-3 border-t border-[#262626] space-y-2">
          {showNote && (
            <textarea
              placeholder="Optional note (logged to audit trail)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              data-testid={`file-report-note-${report.id}`}
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-2 py-1.5 font-mono text-[11px] text-[#e5e5e5] resize-none"
            />
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => doAction("quarantine")}
              disabled={!!busy}
              data-testid={`file-report-quarantine-${report.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white font-mono text-[10px] uppercase tracking-[0.22em] font-bold disabled:opacity-50"
            >
              {busy === "quarantine" ? "…" : "✕ Quarantine file"}
            </button>
            <button
              onClick={() => doAction("dismiss")}
              disabled={!!busy}
              data-testid={`file-report-dismiss-${report.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#262626] hover:border-emerald-500 hover:text-emerald-400 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
            >
              {busy === "dismiss" ? "…" : "◇ Dismiss"}
            </button>
            <button
              onClick={() => setShowNote((v) => !v)}
              disabled={!!busy}
              data-testid={`file-report-toggle-note-${report.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#262626] hover:border-[#525252] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
            >
              {showNote ? "− Note" : "+ Note"}
            </button>
          </div>
        </div>
      )}

      {/* Restore control — shown only on resolved reports whose file is
          still quarantined. Lets admin undo mis-moderation. */}
      {report.status === "resolved" && f?.quarantined_at && (
        <div className="mt-3 pt-3 border-t border-[#262626]">
          <button
            onClick={restore}
            disabled={!!busy}
            data-testid={`file-report-restore-${report.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-emerald-500/60 hover:bg-emerald-500/10 text-emerald-400 font-mono text-[10px] uppercase tracking-[0.22em] font-bold disabled:opacity-50"
          >
            {busy === "restore" ? "…" : "↺ Restore file"}
          </button>
        </div>
      )}
    </div>
  );
}
