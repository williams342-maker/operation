/**
 * iter457 — Admin · Workshop Floor migration console.
 * One-click conservative migration of legacy forum threads into the new
 * 10-category taxonomy + persisted report (auto-categorized / fallback /
 * needs-review). Re-runnable with force to re-classify everything.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Play } from "lucide-react";
import { http, adminAuthHeaders } from "../../lib/api";

const H = () => ({ headers: adminAuthHeaders() });

export default function WorkshopFloorTab() {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);

  const load = () =>
    http.get("/admin/forum/migration-report", H())
      .then((r) => setReport(r.data.report)).catch(() => {});
  useEffect(() => { load(); }, []);

  async function migrate() {
    setBusy(true);
    try {
      const r = await http.post(`/admin/forum/migrate?force=${force}`, {}, H());
      setReport(r.data);
      toast.success(`Migration complete — ${r.data.counts.total} threads processed.`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Migration failed."); }
    finally { setBusy(false); }
  }

  const c = report?.counts || {};

  return (
    <div className="space-y-8" data-testid="workshop-floor-tab">
      <div>
        <h2 className="font-display text-2xl text-ink">Workshop Floor · Thread Migration</h2>
        <p className="font-mono text-[11px] text-ink-muted mt-1 max-w-2xl">
          Conservative keyword classifier moves legacy forum threads into the 10-category
          taxonomy. High-confidence threads are auto-categorized, uncertain ones land in
          Community › General Discussion. Authors, timestamps, replies and attachments are untouched.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button onClick={migrate} disabled={busy}
                className="bg-brand hover:bg-brand-hover text-[#0a0a0a] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] font-bold transition disabled:opacity-40 inline-flex items-center gap-2"
                data-testid="wf-run-migration-btn">
          <Play size={12} /> {busy ? "Migrating…" : "Run migration"}
        </button>
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted cursor-pointer">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)}
                 data-testid="wf-force-checkbox" />
          Force re-classify already-migrated threads
        </label>
        <button onClick={load} className="text-ink-muted hover:text-brand" title="Reload report"
                data-testid="wf-reload-report">
          <RefreshCw size={14} />
        </button>
      </div>

      {!report ? (
        <p className="font-mono text-xs text-ink-muted border border-dashed border-line p-6"
           data-testid="wf-no-report">
          No migration has been run yet.
        </p>
      ) : (
        <div className="space-y-6" data-testid="wf-report">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-line border border-line">
            {[["Processed", c.total], ["High confidence", c.high], ["Medium", c.medium],
              ["→ General Discussion", c.low_fallback], ["Needs review", c.review]].map(([l, v]) => (
              <div key={l} className="bg-paper px-4 py-3">
                <div className="font-display text-2xl text-ink">{v ?? 0}</div>
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">{l}</div>
              </div>
            ))}
          </div>
          <p className="font-mono text-[10px] text-ink-muted">
            Last run {report.at?.slice(0, 16).replace("T", " ")} UTC
            {report.force ? " · forced re-run" : ""} · {c.skipped_already_migrated || 0} previously migrated threads skipped
          </p>

          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-2">◆ By category</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(report.by_category || {}).sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
                <span key={cat} className="border border-line px-3 py-1 font-mono text-[10px] text-ink">
                  {cat} <b className="text-brand">{n}</b>
                </span>
              ))}
            </div>
          </div>

          {(report.needs_review || []).length > 0 && (
            <div data-testid="wf-needs-review">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400 mb-2">
                ◆ Needs manual review ({report.needs_review.length})
              </h3>
              <ul className="divide-y divide-line border border-line">
                {report.needs_review.map((t) => (
                  <li key={t.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
                    <a href={`/community?tab=forum&open=${t.id}`} target="_blank" rel="noreferrer"
                       className="font-mono text-xs text-ink hover:text-brand flex-1 min-w-[200px] line-clamp-1">
                      {t.title}
                    </a>
                    <span className="font-mono text-[9px] text-ink-muted">
                      assigned <b className="text-brand">{t.assigned}</b>
                      {t.runner_up && <> · tied with {t.runner_up}</>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
