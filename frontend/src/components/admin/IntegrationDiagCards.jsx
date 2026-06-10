import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchShippoDiag,
  fetchMailgunDiag,
  fetchR2Diag,
} from "../../lib/api";

/**
 * iter226 — Shippo / Mailgun / R2 diagnostic cards.
 *
 * Mirrors the iter222 StripeDiagCard pattern: one card per integration,
 * each shows a colored pill (emerald = reachable, red = broken) + 4
 * tiles of relevant context (mode, key prefix, etc.) + a "↻ Re-check"
 * button. When the upstream rejects us, the friendly-error string from
 * the backend renders inline so the operator can act in one read.
 */

function DiagTile({ label, value, highlight }) {
  return (
    <div className={`border px-2 py-1.5 ${highlight ? "border-emerald-500/50 bg-emerald-950/30" : "border-line bg-paper"}`}>
      <div className={`uppercase tracking-[0.22em] text-[9px] ${highlight ? "text-emerald-300" : "text-ink-muted"}`}>{label}</div>
      <div className={`text-base ${highlight ? "text-emerald-200" : "text-zinc-200"} truncate`} title={String(value)}>{value}</div>
    </div>
  );
}

function DiagShell({ title, blurb, testId, ok, data, busy, onRefresh, children, reason }) {
  return (
    <div
      className={`border ${ok ? "border-emerald-700/40 bg-emerald-950/15" : "border-red-700/40 bg-red-950/15"} p-5`}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <div className={`font-mono text-[10px] uppercase tracking-[0.28em] mb-1 ${ok ? "text-emerald-300" : "text-red-300"}`}>
            ◆ {title} · Health
          </div>
          <h3 className={`font-display text-xl ${ok ? "text-emerald-200" : "text-red-200"}`}>
            {data === null ? "Checking…" : ok ? "Reachable" : "Unreachable"}
          </h3>
          <p className="font-mono text-[11px] text-ink-muted mt-1 max-w-[68ch] leading-relaxed">
            {blurb}
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={busy}
          className="px-3 py-1.5 border border-amber-700/60 hover:border-amber-400 hover:text-amber-300 font-mono text-[11px] uppercase tracking-[0.22em] text-amber-300 disabled:opacity-50"
          data-testid={`${testId}-refresh`}
        >
          {busy ? "Checking…" : "↻ Re-check"}
        </button>
      </div>

      {data && children}

      {!ok && reason && (
        <div className="mt-3 font-mono text-[11px] text-red-200 bg-paper/30 border border-red-900/60 p-3 leading-relaxed" data-testid={`${testId}-reason`}>
          <strong className="text-red-300">Reason:</strong> {/^https?:\/\//.test(reason.split(" ").pop()) ? (
            // Render the trailing URL as a clickable link (GA4 enable URL pattern).
            <>
              {reason.split(/\bhttps?:\/\/\S+/)[0]}
              <a href={reason.match(/\bhttps?:\/\/\S+/)?.[0]} target="_blank" rel="noopener noreferrer"
                 className="text-emerald-300 underline break-all hover:text-emerald-200">
                {reason.match(/\bhttps?:\/\/\S+/)?.[0]}
              </a>
            </>
          ) : reason}
        </div>
      )}
    </div>
  );
}


export function ShippoDiagCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try { setData(await fetchShippoDiag()); }
    catch (e) { toast.error(e?.response?.data?.detail || "Shippo diag failed."); }
    finally { setBusy(false); }
  };
  useEffect(() => { refresh(); }, []);
  const ok = !!data?.ok;
  return (
    <DiagShell
      title="Shippo · Shipping"
      blurb="Probes /api/admin/shippo/diag. If this says Unreachable, makers can't pull live rates or buy labels — usually a SHIPPO_API_KEY swap or the wrong test/live mode."
      testId="shippo-diag-card"
      ok={ok}
      data={data}
      busy={busy}
      onRefresh={refresh}
      reason={data?.reason}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]" data-testid="shippo-diag-tiles">
        <DiagTile label="Mode" value={data?.mode || "—"} highlight={data?.mode === "live"} />
        <DiagTile label="Key prefix" value={data?.key_prefix || "—"} />
        <DiagTile label="Carriers" value={data?.carriers_count ?? "—"} highlight={(data?.carriers_count || 0) > 0} />
        <DiagTile label="First" value={data?.first_carrier || "—"} />
      </div>
    </DiagShell>
  );
}


export function MailgunDiagCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try { setData(await fetchMailgunDiag()); }
    catch (e) { toast.error(e?.response?.data?.detail || "Mailgun diag failed."); }
    finally { setBusy(false); }
  };
  useEffect(() => { refresh(); }, []);
  const ok = !!data?.ok;
  return (
    <DiagShell
      title="Mailgun · Email"
      blurb="Probes /api/admin/mailgun/diag. Verifies the API key, sending domain, and region. If this says Unreachable, no transactional emails (magic links, order confirmations) are going out — the EMAIL_FALLBACK_PROVIDER chain may still catch them."
      testId="mailgun-diag-card"
      ok={ok}
      data={data}
      busy={busy}
      onRefresh={refresh}
      reason={data?.reason}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]" data-testid="mailgun-diag-tiles">
        <DiagTile label="Region" value={data?.region?.toUpperCase() || "—"} />
        <DiagTile label="Domain" value={data?.domain || "—"} />
        <DiagTile label="State" value={data?.state || "—"} highlight={data?.state === "active"} />
        <DiagTile label="Verified" value={data?.verified ? "YES" : "no"} highlight={!!data?.verified} />
      </div>
    </DiagShell>
  );
}


export function R2DiagCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try { setData(await fetchR2Diag()); }
    catch (e) { toast.error(e?.response?.data?.detail || "R2 diag failed."); }
    finally { setBusy(false); }
  };
  useEffect(() => { refresh(); }, []);
  const ok = !!data?.ok;
  return (
    <DiagShell
      title="R2 · Storage"
      blurb="Probes /api/admin/r2/diag. Verifies the access key + bucket exists + read perms. If this says Unreachable, every image / video / design file upload is broken — buyer purchases, maker uploads, clip seeding all fail."
      testId="r2-diag-card"
      ok={ok}
      data={data}
      busy={busy}
      onRefresh={refresh}
      reason={data?.reason}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]" data-testid="r2-diag-tiles">
        <DiagTile label="Bucket" value={data?.bucket || "—"} highlight={!!data?.bucket} />
        <DiagTile label="CDN" value={data?.public_url ? new URL(data.public_url).host : "—"} />
        <DiagTile label="Read perms" value={data?.ok ? "OK" : "—"} highlight={!!data?.ok} />
        <DiagTile label="Sample objs" value={data?.object_count_sample ?? "—"} />
      </div>
    </DiagShell>
  );
}
