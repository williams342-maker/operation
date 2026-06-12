import React, { useEffect, useState } from "react";
import { fetchMakerViolations } from "../../lib/api";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { RowsSkeleton } from "../../components/Skeleton";

const SEVERITY_STYLE = {
  block: "border-red-700 bg-red-900/20 text-red-600",
  warn:  "border-yellow-700 bg-yellow-900/20 text-brand",
  info:  "border-line bg-paper text-ink-muted",
};

/** Violations tab — read-only audit trail for this maker. */
export default function ViolationsTab() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetchMakerViolations()
      .then((d) => setRows(d.violations || []))
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load violations."));
  }, []);

  if (err) return <p className="font-mono text-sm text-red-400" data-testid="violations-error">{err}</p>;
  if (!rows) return <RowsSkeleton count={3} />;

  return (
    <div className="space-y-6" data-testid="violations-tab">
      <header className="pb-6 border-b border-line">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Violations.</h2>
        <p className="font-mono text-xs text-ink-muted mt-2 max-w-xl">
          Anything our auto-moderator or admins flagged on your account. Repeated
          violations can trigger a freeze — see <a href="/policy#seller-misconduct" target="_blank" rel="noreferrer" className="text-brand hover:underline">site policy</a> for the full list.
        </p>
      </header>

      {!rows.length ? (
        <div className="border border-emerald-800 bg-emerald-900/10 p-8 text-center" data-testid="violations-empty">
          <ShieldCheck size={32} className="text-emerald-700 mx-auto mb-3" />
          <h3 className="font-display text-2xl uppercase mb-2">All clear.</h3>
          <p className="font-mono text-xs text-ink-muted">
            No warnings or blocks on your account. Keep building.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((v, idx) => (
            <div
              key={idx}
              className={`border p-4 flex items-start gap-3 ${SEVERITY_STYLE[v.severity] || SEVERITY_STYLE.info}`}
              data-testid={`violation-${idx}`}
            >
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em]">
                    {(v.kind || "").replace(/_/g, " ")}
                  </span>
                  <span className="font-mono text-[10px] text-ink-muted">·</span>
                  <span className="font-mono text-[10px] text-ink-muted uppercase tracking-[0.22em]">
                    {v.source}{v.channel ? ` · ${v.channel}` : ""}
                  </span>
                </div>
                <div className="font-mono text-xs leading-relaxed mt-1.5 text-ink">
                  {v.reason || "(no reason recorded)"}
                </div>
                <div className="font-mono text-[10px] text-ink-muted mt-1">
                  {(v.created_at || "").slice(0, 19).replace("T", " · ")}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
