import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, ShieldCheck } from "lucide-react";
import {
  adminFetchInformAct, adminInformScan, adminInformVerify,
  adminInformReject, adminInformSuspend, adminInformReinstate,
} from "../../lib/api";

const STATUS_CLS = {
  collection_required: "text-red-400 border-red-800 bg-red-950/30",
  pending_verification: "text-brand border-amber-700 bg-amber-950/30",
  verified: "text-emerald-500 border-emerald-800 bg-emerald-950/30",
  suspended: "text-red-400 border-red-700 bg-red-950/50",
  monitoring: "text-ink-muted border-line bg-surface",
};

function Badge({ status }) {
  return (
    <span className={`inline-block px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.18em] ${STATUS_CLS[status] || STATUS_CLS.monitoring}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SubmissionDetail({ sub }) {
  if (!sub) return <div className="font-mono text-xs text-ink-muted">No submission yet.</div>;
  const rows = [
    ["Legal name", sub.full_name],
    ["Business", sub.is_business ? (sub.business_name || "Yes") : "Individual"],
    ["Address", `${sub.street}, ${sub.city}, ${sub.state} ${sub.zip_code} ${sub.country || ""}`],
    ["Email", sub.contact_email],
    ["Phone", sub.contact_phone],
    ["Tax ID", `${(sub.tax_id_type || "").toUpperCase()} ····${sub.tax_id_last4}`],
    ["Gov ID type", (sub.gov_id_type || "").replace(/_/g, " ")],
    ["Bank", `${sub.bank_name} · ${sub.bank_account_name} · ····${sub.bank_last4}`],
    ["Submitted", sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : "—"],
  ];
  return (
    <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-ink-muted uppercase tracking-[0.18em] text-[9px]">{k}</dt>
          <dd className="text-ink break-words">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function Row({ row, onChange }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);

  const act = async (name, fn) => {
    setBusy(name);
    try {
      await fn(row.slug);
      toast.success(`${row.slug}: ${name} done.`);
      onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || `Couldn't ${name}.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <tr className="border-b border-line hover:bg-surface/50" data-testid={`inform-row-${row.slug}`}>
        <td className="py-2.5 pr-3 font-mono text-xs text-ink">
          {row.name}
          <span className="text-ink-muted"> /{row.slug}</span>
        </td>
        <td className="py-2.5 pr-3 font-mono text-xs text-ink text-right">{row.window?.tx_count ?? 0}</td>
        <td className="py-2.5 pr-3 font-mono text-xs text-ink text-right">
          ${Number(row.window?.revenue || 0).toLocaleString()}
        </td>
        <td className="py-2.5 pr-3"><Badge status={row.status} /></td>
        <td className="py-2.5 pr-3 font-mono text-[10px] text-ink-muted">
          {row.disclosure_required ? "◆ $20k+ disclosure" : "—"}
          {row.certification_overdue ? " · recert due" : ""}
        </td>
        <td className="py-2.5 text-right">
          <button onClick={() => setOpen((o) => !o)}
            className="px-2 py-1 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-brand transition"
            data-testid={`inform-expand-${row.slug}`}>
            {open ? "Close" : "Review"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-surface/30">
          <td colSpan={6} className="p-4">
            <SubmissionDetail sub={row.submission} />
            {row.deadline_at && row.status === "collection_required" && (
              <div className="font-mono text-[10px] text-red-400 mt-3">
                Collection deadline: {new Date(row.deadline_at).toLocaleString()}
              </div>
            )}
            {row.rejection_note && (
              <div className="font-mono text-[10px] text-brand mt-2">Last rejection note: {row.rejection_note}</div>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {row.submission && row.status !== "verified" && (
                <button onClick={() => act("verify", adminInformVerify)} disabled={!!busy}
                  className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-white font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50"
                  data-testid={`inform-verify-${row.slug}`}>
                  {busy === "verify" ? "…" : "✓ Verify"}
                </button>
              )}
              {row.submission && (
                <div className="flex items-center gap-1">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Rejection note…"
                    className="px-2 py-1.5 bg-paper border border-line font-mono text-[11px] text-ink w-52"
                    data-testid={`inform-reject-note-${row.slug}`} />
                  <button onClick={() => note.trim().length >= 3 && act("reject", (s) => adminInformReject(s, note.trim()))}
                    disabled={!!busy || note.trim().length < 3}
                    className="px-3 py-1.5 border border-amber-700 text-brand hover:bg-amber-950/40 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-40"
                    data-testid={`inform-reject-${row.slug}`}>
                    Reject
                  </button>
                </div>
              )}
              {row.status !== "suspended" ? (
                <button onClick={() => act("suspend", adminInformSuspend)} disabled={!!busy}
                  className="px-3 py-1.5 border border-red-800 text-red-400 hover:bg-red-950/40 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50"
                  data-testid={`inform-suspend-${row.slug}`}>
                  Suspend
                </button>
              ) : (
                <button onClick={() => act("reinstate", adminInformReinstate)} disabled={!!busy}
                  className="px-3 py-1.5 border border-emerald-800 text-emerald-500 hover:bg-emerald-950/40 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-50"
                  data-testid={`inform-reinstate-${row.slug}`}>
                  Reinstate
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function InformActTab() {
  const [data, setData] = useState(null);
  const [scanning, setScanning] = useState(false);

  const load = () => adminFetchInformAct().then(setData).catch(() => toast.error("Couldn't load INFORM Act data."));
  useEffect(() => { load(); }, []);

  const runScan = async () => {
    setScanning(true);
    try {
      const r = await adminInformScan();
      toast.success(`Scan done — ${r.newly_flagged?.length || 0} flagged, ${r.auto_suspended?.length || 0} suspended.`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Scan failed.");
    } finally {
      setScanning(false);
    }
  };

  if (!data) return <div className="font-mono text-xs text-ink-muted p-6">Loading…</div>;
  const t = data.thresholds || {};

  return (
    <div data-testid="inform-act-tab">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2 flex items-center gap-2">
            <ShieldCheck size={12} /> INFORM Consumers Act
          </div>
          <h2 className="font-display text-3xl uppercase leading-none">High-volume seller compliance.</h2>
          <p className="font-mono text-xs text-ink-muted mt-2 max-w-xl leading-relaxed">
            Sellers crossing <b className="text-ink">{t.tx}+ orders</b> and{" "}
            <b className="text-ink">${Number(t.revenue || 0).toLocaleString()}+</b> in any rolling 12 months must
            verify identity within {t.deadline_days} days; ${Number(t.disclosure_revenue || 0).toLocaleString()}+/yr
            sellers also get a public shop-page disclosure. A daily scan runs automatically at 07:10 UTC.
          </p>
          {data.last_scan && (
            <div className="font-mono text-[10px] text-ink-muted mt-2" data-testid="inform-last-scan">
              Last scan: {new Date(data.last_scan.at).toLocaleString()} ({data.last_scan.trigger}) ·
              flagged {data.last_scan.newly_flagged?.length || 0} · suspended {data.last_scan.auto_suspended?.length || 0}
            </div>
          )}
        </div>
        <button onClick={runScan} disabled={scanning}
          className="btn-industrial btn-primary text-xs inline-flex items-center gap-2 disabled:opacity-50"
          data-testid="inform-run-scan-btn">
          <RefreshCw size={12} className={scanning ? "animate-spin" : ""} />
          {scanning ? "Scanning…" : "Run scan now"}
        </button>
      </div>

      {data.rows.length === 0 ? (
        <div className="border border-dashed border-line p-8 font-mono text-xs text-ink-muted text-center" data-testid="inform-empty">
          No makers near the high-volume threshold yet. The daily scan will flag them automatically.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]" data-testid="inform-act-table">
            <thead>
              <tr className="border-b-2 border-line font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted text-left">
                <th className="py-2 pr-3">Maker</th>
                <th className="py-2 pr-3 text-right">Orders · 12mo</th>
                <th className="py-2 pr-3 text-right">Revenue · 12mo</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Flags</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => <Row key={r.slug} row={r} onChange={load} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
