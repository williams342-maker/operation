/**
 * iter373 — Admin "SEO health" card (Settings tab).
 *
 * Shows the latest weekly crawl of our own public URLs (as Googlebot):
 * 404s, redirects, wrong canonicals, noindex leaks, soft-404 guard,
 * sitemap sanity. "Run check now" triggers an on-demand crawl.
 * The Monday cron alerts ops automatically when issues appear.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchSeoHealthLatest, fetchSeoWins, runSeoHealthAutofix, runSeoHealthCheck } from "../../lib/api";

const ISSUE_LABELS = {
  http_error: "HTTP error",
  redirect: "Unexpected redirect",
  wrong_canonical: "Wrong canonical",
  noindex_leak: "Noindex leak",
  soft_404_guard: "Soft-404 guard",
  sitemap_error: "Sitemap error",
  sitemap_thin: "Sitemap thin",
  fetch_error: "Fetch failed",
};

const fmtWhen = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
};

function WinStat({ label, value, prev, delta }) {
  const v = value == null ? "—" : value;
  const d = delta != null ? delta : (prev != null && value != null ? value - prev : null);
  return (
    <div>
      <div className="font-display text-2xl text-ink leading-none">{v}
        {d != null && d !== 0 && (
          <span className={`font-mono text-[11px] ml-2 ${d > 0 ? "text-emerald-700" : "text-red-400"}`}>
            {d > 0 ? "▲" : "▼"} {Math.abs(d)}
          </span>
        )}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted mt-1">{label}</div>
    </div>
  );
}

export default function SeoHealthCard() {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [wins, setWins] = useState(null);

  const load = async () => {
    try {
      const d = await fetchSeoHealthLatest();
      setLatest(d.latest);
      setHistory(d.history || []);
    } catch { /* card stays in empty state */ }
    finally { setLoading(false); }
    // Wins load independently — slow GSC calls must not block the card.
    fetchSeoWins().then(setWins).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const run = await runSeoHealthCheck();
      setLatest(run);
      setHistory((p) => [run, ...p].slice(0, 8));
      if (run.issue_count === 0) toast.success(`SEO health: all ${run.checked} checks green ✓`);
      else toast.warning(`SEO health: ${run.issue_count} issue(s) found`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "SEO health check failed to run.");
    } finally { setRunning(false); }
  };

  const autoFix = async () => {
    setFixing(true);
    try {
      const r = await runSeoHealthAutofix();
      if (r.run) {
        setLatest(r.run);
        setHistory((p) => p.map((h) => (h.id === r.run.id ? r.run : h)));
      }
      if (r.remaining === 0) toast.success(`✦ Auto-fix resolved all ${r.resolved} issue(s) — all green`);
      else if (r.resolved > 0) toast.success(`✦ ${r.resolved} transient issue(s) cleared · ${r.remaining} diagnosed by AI below`);
      else toast.warning(`✦ ${r.remaining} issue(s) persist — AI diagnosis added below`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Auto-fix failed to run.");
    } finally { setFixing(false); }
  };

  const green = latest && latest.issue_count === 0;

  return (
    <section className="border border-line p-5 md:p-6 space-y-4" data-testid="seo-health-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className={`font-mono text-[11px] uppercase tracking-[0.3em] ${green ? "text-emerald-700" : latest ? "text-brand" : "text-ink-muted"}`}>
            ◆ SEO health · {loading ? "loading…" : latest ? (green ? "all green" : `${latest.issue_count} issue${latest.issue_count === 1 ? "" : "s"}`) : "never run"}
          </div>
          <h3 className="font-display text-xl uppercase mt-1">Own-site crawl (as Googlebot)</h3>
        </div>
        <div className="flex items-center gap-2">
          {latest && latest.issue_count > 0 && (
            <button
              onClick={autoFix}
              disabled={fixing || running}
              className="px-3 py-1.5 border border-brand/40 text-brand hover:bg-brand/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid="seo-health-autofix-btn"
              title="Re-checks every flagged URL (transient failures clear themselves), then AI diagnoses anything still broken"
            >
              {fixing ? "✦ Fixing…" : "✦ AI auto-fix"}
            </button>
          )}
          <button
            onClick={runNow}
            disabled={running || fixing}
            className="px-3 py-1.5 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition disabled:opacity-50"
            data-testid="seo-health-run-btn"
          >
            {running ? "Crawling…" : "▶ Run check now"}
          </button>
        </div>
      </div>
      <p className="font-mono text-xs text-ink-muted max-w-3xl leading-relaxed">
        Crawls a sample of your live pages every Monday and flags what Google Search Console would
        eventually report: 404s, unexpected redirects, wrong canonicals, noindex leaks, soft-404
        regressions, and sitemap problems. Ops gets a webhook + email automatically when something breaks.
      </p>

      {latest && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-ink-muted" data-testid="seo-health-summary">
          <span>Last run: <span className="text-ink">{fmtWhen(latest.finished_at)}</span> ({latest.trigger})</span>
          <span>URLs checked: <span className="text-ink">{latest.checked}</span></span>
          <span>Sitemap URLs: <span className="text-ink">{latest.sitemap_urls}</span></span>
          <span>Site: <span className="text-ink">{latest.site}</span></span>
        </div>
      )}

      {wins && (wins.gsc_connected || wins.indexed?.now != null) && (
        <div className="border border-line p-4 space-y-3" data-testid="seo-wins-strip">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand">
            ◆ SEO wins · {wins.window?.start} → {wins.window?.end}
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <WinStat label="Clicks (7d)" value={wins.totals?.clicks} prev={wins.prev_totals?.clicks} />
            <WinStat label="Impressions (7d)" value={wins.totals?.impressions} prev={wins.prev_totals?.impressions} />
            <WinStat label="Pages indexed" value={wins.indexed?.now} delta={wins.indexed?.delta} />
          </div>
          {(wins.top_queries || []).length > 0 && (
            <div className="font-mono text-[11px] text-ink-muted" data-testid="seo-wins-queries">
              <span className="uppercase tracking-[0.18em] text-[10px]">Top queries: </span>
              {wins.top_queries.slice(0, 5).map((q, i) => (
                <span key={q.query} className="text-ink">
                  {i > 0 && <span className="text-ink-muted"> · </span>}
                  “{q.query}” <span className="text-ink-muted">({q.clicks})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {latest && latest.issue_count > 0 && (
        <div className="border border-line overflow-x-auto">
          <table className="w-full font-mono text-[11px]">
            <thead className="bg-paper text-ink-muted uppercase tracking-[0.18em] text-[10px]">
              <tr>
                <th className="text-left px-3 py-2.5">Issue</th>
                <th className="text-left px-3 py-2.5">URL</th>
                <th className="text-left px-3 py-2.5">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {latest.issues.map((i, idx) => (
                <tr key={idx} className="hover:bg-paper transition align-top" data-testid={`seo-health-issue-${idx}`}>
                  <td className="px-3 py-2.5">
                    <span className="px-2 py-0.5 border border-amber-500/30 text-brand text-[10px]">
                      {ISSUE_LABELS[i.type] || i.type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink break-all max-w-[360px]">{i.url}</td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {i.detail}
                    {(i.ai_root_cause || i.ai_fix) && (
                      <div className="mt-2 border-l-2 border-brand/40 pl-2 space-y-1" data-testid={`seo-health-ai-${idx}`}>
                        {i.ai_root_cause && (
                          <div><span className="text-brand">✦ Cause:</span> {i.ai_root_cause}</div>
                        )}
                        {i.ai_fix && (
                          <div><span className="text-brand">✦ Fix:</span> {i.ai_fix}</div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {green && (
        <p className="font-mono text-xs text-emerald-700" data-testid="seo-health-green">
          ✓ {latest.checked} checks passed — statuses, canonicals, robots metas, sitemap, and the soft-404 guard all look correct.
          {latest.autofix?.resolved > 0 && (
            <span className="text-ink-muted"> (✦ auto-fix cleared {latest.autofix.resolved} transient issue{latest.autofix.resolved === 1 ? "" : "s"})</span>
          )}
        </p>
      )}

      {history.length > 1 && (
        <div className="font-mono text-[10px] text-ink-muted uppercase tracking-[0.18em]" data-testid="seo-health-history">
          History:{" "}
          {history.map((h) => (
            <span key={h.id} className={`inline-block mr-3 ${h.issue_count === 0 ? "text-emerald-700" : "text-brand"}`}>
              {fmtWhen(h.started_at)} · {h.issue_count === 0 ? "✓" : `${h.issue_count}⚠`}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
