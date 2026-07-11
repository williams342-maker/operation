/**
 * iter453 — Admin → Maker Agreement acceptance audit view.
 * Who accepted which agreement version, when, from where.
 */
import React, { useEffect, useState } from "react";
import { fetchAgreementAcceptances } from "../../lib/api";

export default function MakerAgreementTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    fetchAgreementAcceptances({ version })
      .then(setData)
      .catch(() => setErr("Could not load acceptances."));
  }, [version]);

  return (
    <div className="space-y-5" data-testid="maker-agreement-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Maker Agreement</h2>
          {data && (
            <p className="font-mono text-[10px] text-ink-muted mt-1">
              Current version v{data.current_version} ·{" "}
              {data.total_makers - data.pending_current}/{data.total_makers} makers accepted ·{" "}
              <span className={data.pending_current ? "text-amber-400" : "text-green-500"}>
                {data.pending_current} pending
              </span>
            </p>
          )}
        </div>
        <input value={version} onChange={(e) => setVersion(e.target.value)}
               placeholder="Filter by version (e.g. 1.0)"
               className="bg-paper border border-line px-3 py-2 font-mono text-xs text-ink focus:border-brand outline-none"
               data-testid="agreement-version-filter" />
      </div>

      {err && <p className="font-mono text-xs text-red-400">{err}</p>}
      {!data && !err && <p className="font-mono text-xs text-ink-muted">Loading…</p>}

      {data && (
        <div className="overflow-x-auto border border-line" data-testid="agreement-acceptances-table">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line">
                {["Maker", "Email", "Version", "Accepted at", "IP", "User agent"].map((h) => (
                  <th key={h} className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {data.acceptances.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 font-mono text-xs text-ink-muted text-center">
                  No acceptances recorded yet.
                </td></tr>
              )}
              {data.acceptances.map((a) => (
                <tr key={a.id} data-testid={`acceptance-row-${a.id}`}>
                  <td className="px-3 py-2 font-mono text-xs text-ink whitespace-nowrap">{a.maker_slug}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-ink-muted">{a.maker_email || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-brand">v{a.version}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-ink whitespace-nowrap">
                    {(a.accepted_at || "").replace("T", " ").slice(0, 16)}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-ink-muted">{a.ip || "—"}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-muted max-w-[220px] truncate">{a.user_agent || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
