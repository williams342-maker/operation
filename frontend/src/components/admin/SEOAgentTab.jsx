/**
 * iter412 — AI SEO Growth Agent admin tab.
 *
 * Surfaces the daily 02:00 UTC scan results from /api/admin/seo-agent.
 * Lets admin:
 *   • See overall, technical, content, authority sub-scores
 *   • Browse prioritized issues across products + maker + landing pages
 *   • Generate AI rewrites (Claude Sonnet 4.5) for content issues
 *   • Approve / reject queued rewrites — nothing publishes until approved
 *   • Roll back applied changes using the stored before-snapshot
 *
 * Modes are baked in: the cron runs daily (Observe + Assist auto). The
 * "Approve" step requires explicit admin click. Autopilot is reserved
 * for v2.
 */
import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Activity, AlertCircle, CheckCircle2, Loader2, RefreshCw, Sparkles,
  ThumbsDown, ThumbsUp, Undo2, ChevronRight, Search,
} from "lucide-react";
import { timeAgo } from "../../lib/timeAgo";

const API = process.env.REACT_APP_BACKEND_URL;

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}`,
  "Content-Type": "application/json",
});

const SEVERITY_STYLES = {
  critical: { border: "border-red-600/50",     bg: "bg-red-600/5",     text: "text-red-600",     label: "Critical" },
  high:     { border: "border-brand/50",       bg: "bg-brand/5",       text: "text-brand",       label: "High" },
  medium:   { border: "border-yellow-500/40",  bg: "bg-yellow-500/5",  text: "text-yellow-700",  label: "Medium" },
  low:      { border: "border-line",           bg: "bg-surface",       text: "text-ink-muted",   label: "Low" },
};

const KIND_LABELS = {
  missing_meta_description:   "Missing meta description",
  meta_description_too_short: "Meta description too short",
  meta_description_too_long:  "Meta description too long (truncated in SERP)",
  missing_product_description:"Missing product description",
  thin_product_description:   "Thin product description",
  missing_alt_text:           "Missing image alt text",
  missing_product_image:      "Missing product image",
  // Technical
  sitemap_error:    "Sitemap fetch error",
  sitemap_thin:     "Sitemap has too few URLs",
  http_error:       "Page returned non-200",
  redirect:         "Canonical URL redirects",
  wrong_canonical:  "Page declares wrong canonical",
  noindex_leak:     "Page sends noindex",
  soft_404_guard:   "Dead slug returned 200 (soft-404)",
  fetch_error:      "Network failure during crawl",
};

const KIND_FIXABLE = new Set([
  "missing_meta_description",
  "meta_description_too_short",
  "meta_description_too_long",
  "missing_alt_text",
]);


function ScoreCard({ label, value, sub, tone = "default" }) {
  const ringColor = value >= 80 ? "stroke-emerald-600"
                  : value >= 60 ? "stroke-yellow-600"
                  : "stroke-red-600";
  const numColor =  value >= 80 ? "text-emerald-700"
                  : value >= 60 ? "text-yellow-700"
                  : "text-red-600";
  const r = 28, c = 2 * Math.PI * r, off = c - (value / 100) * c;
  return (
    <div
      data-testid={`seo-agent-score-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className="border border-line bg-surface p-4 flex items-center gap-4"
    >
      <div className="relative w-[68px] h-[68px] flex-shrink-0">
        <svg viewBox="0 0 68 68" className="w-full h-full -rotate-90">
          <circle cx="34" cy="34" r={r} className="stroke-line" strokeWidth="4" fill="none" />
          <circle
            cx="34" cy="34" r={r}
            className={ringColor}
            strokeWidth="4"
            fill="none"
            strokeDasharray={c}
            strokeDashoffset={off}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className={`absolute inset-0 flex items-center justify-center font-mono font-semibold ${numColor}`}>
          {value}
        </div>
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">{label}</div>
        {sub && <div className="text-sm text-ink mt-1 truncate">{sub}</div>}
      </div>
    </div>
  );
}


function IssueRow({ issue, onGenerateFix, generating }) {
  const sev = SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.low;
  const label = KIND_LABELS[issue.kind] || issue.kind;
  const fixable = KIND_FIXABLE.has(issue.kind);
  const target = issue.target || {};
  return (
    <div
      data-testid={`seo-agent-issue-${issue.id}`}
      className={`border ${sev.border} ${sev.bg} p-3 flex items-start gap-3`}
    >
      <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${sev.text} mt-0.5 whitespace-nowrap`}>
        {sev.label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink truncate">{label}</div>
        <div className="text-xs text-ink-muted mt-0.5 truncate">
          {target.label || target.slug || "—"}
          {issue.detail && <span className="ml-1.5">· {issue.detail}</span>}
        </div>
      </div>
      {fixable && (
        <button
          type="button"
          onClick={() => onGenerateFix(issue)}
          disabled={generating === issue.id}
          data-testid={`seo-agent-generate-fix-${issue.id}`}
          className="text-xs font-mono uppercase tracking-[0.18em] border border-brand text-brand px-2.5 py-1 hover:bg-brand hover:text-paper transition-colors disabled:opacity-50 whitespace-nowrap inline-flex items-center gap-1.5"
        >
          {generating === issue.id ? (
            <><Loader2 size={11} className="animate-spin" /> Generating…</>
          ) : (
            <><Sparkles size={11} /> Generate Fix</>
          )}
        </button>
      )}
    </div>
  );
}


function QueueRow({ entry, onApprove, onReject, onRollback, busy }) {
  const isPending = entry.status === "pending";
  const isApplied = entry.status === "applied";
  const beforeVal = entry.before?.[entry.field];
  const afterVal = entry.after?.[entry.field];
  const renderVal = (v) => Array.isArray(v) ? v.join(" · ") : (v || <span className="text-ink-muted">∅ (empty)</span>);

  return (
    <div
      data-testid={`seo-agent-queue-${entry.id}`}
      className="border border-line bg-surface p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink truncate">{entry.target_label || entry.target_slug}</div>
          <div className="text-xs text-ink-muted mt-0.5">
            {KIND_LABELS[entry.issue_kind] || entry.issue_kind} · {timeAgo(entry.generated_at)}
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted whitespace-nowrap">
          {entry.status}
        </span>
      </div>
      <div className="mt-3 grid sm:grid-cols-2 gap-3 text-xs">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">Before</div>
          <div className="border border-line p-2 text-ink whitespace-pre-wrap break-words">{renderVal(beforeVal)}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-1">After (AI)</div>
          <div className="border border-brand/50 bg-brand/5 p-2 text-ink whitespace-pre-wrap break-words">{renderVal(afterVal)}</div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {isPending && (
          <>
            <button
              type="button"
              onClick={() => onApprove(entry)}
              disabled={busy === entry.id}
              data-testid={`seo-agent-approve-${entry.id}`}
              className="text-xs font-mono uppercase tracking-[0.18em] border border-emerald-600 text-emerald-700 px-3 py-1.5 hover:bg-emerald-600 hover:text-paper transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <ThumbsUp size={11} /> Approve
            </button>
            <button
              type="button"
              onClick={() => onReject(entry)}
              disabled={busy === entry.id}
              data-testid={`seo-agent-reject-${entry.id}`}
              className="text-xs font-mono uppercase tracking-[0.18em] border border-line text-ink-muted px-3 py-1.5 hover:border-red-600 hover:text-red-600 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <ThumbsDown size={11} /> Reject
            </button>
          </>
        )}
        {isApplied && (
          <button
            type="button"
            onClick={() => onRollback(entry)}
            disabled={busy === entry.id}
            data-testid={`seo-agent-rollback-${entry.id}`}
            className="text-xs font-mono uppercase tracking-[0.18em] border border-line text-ink-muted px-3 py-1.5 hover:border-red-600 hover:text-red-600 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Undo2 size={11} /> Roll back
          </button>
        )}
      </div>
    </div>
  );
}


export default function SEOAgentTab() {
  const [overview, setOverview] = useState(null);
  const [issues, setIssues] = useState([]);
  const [queue, setQueue] = useState([]);
  const [queueStatus, setQueueStatus] = useState("pending");
  const [active, setActive] = useState("overview"); // overview | technical | content | queue
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(null); // issue id being processed
  const [busy, setBusy] = useState(null);             // queue id being processed
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [ovrRes, issRes, qRes] = await Promise.all([
        fetch(`${API}/api/admin/seo-agent/overview`, { headers: authHeaders() }),
        fetch(`${API}/api/admin/seo-agent/issues`, { headers: authHeaders() }),
        fetch(`${API}/api/admin/seo-agent/queue?status=${queueStatus}`, { headers: authHeaders() }),
      ]);
      if (ovrRes.ok) setOverview(await ovrRes.json());
      if (issRes.ok) setIssues((await issRes.json()).issues || []);
      if (qRes.ok)   setQueue((await qRes.json()).items || []);
    } catch (e) {
      toast.error("Could not load SEO Agent data");
    } finally {
      setLoaded(true);
    }
  }, [queueStatus]);

  useEffect(() => { refresh(); }, [refresh]);

  const runScan = async () => {
    setScanning(true);
    try {
      const r = await fetch(`${API}/api/admin/seo-agent/scan/run`, {
        method: "POST", headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Scan failed");
      toast.success("SEO scan complete");
      await refresh();
    } catch {
      toast.error("Scan failed — try again");
    } finally {
      setScanning(false);
    }
  };

  const generateFix = async (issue) => {
    setGenerating(issue.id);
    try {
      const r = await fetch(`${API}/api/admin/seo-agent/generate-fix`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ issue_id: issue.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Generation failed");
      toast.success("AI fix added to approval queue");
      setActive("queue");
      await refresh();
    } catch (e) {
      toast.error(e.message || "Generation failed");
    } finally {
      setGenerating(null);
    }
  };

  const approve = async (entry) => {
    setBusy(entry.id);
    try {
      const r = await fetch(`${API}/api/admin/seo-agent/queue/${entry.id}/approve`, {
        method: "POST", headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Approve failed");
      toast.success("Applied to live record");
      await refresh();
    } catch {
      toast.error("Approve failed");
    } finally {
      setBusy(null);
    }
  };

  const reject = async (entry) => {
    setBusy(entry.id);
    try {
      const r = await fetch(`${API}/api/admin/seo-agent/queue/${entry.id}/reject`, {
        method: "POST", headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Reject failed");
      toast.success("Rejected");
      await refresh();
    } catch {
      toast.error("Reject failed");
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (entry) => {
    if (!window.confirm(`Roll back the change to "${entry.target_label || entry.target_slug}"? The live record will revert to its previous value.`)) return;
    setBusy(entry.id);
    try {
      const r = await fetch(`${API}/api/admin/seo-agent/queue/${entry.id}/rollback`, {
        method: "POST", headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Rollback failed");
      toast.success("Rolled back");
      await refresh();
    } catch {
      toast.error("Rollback failed");
    } finally {
      setBusy(null);
    }
  };

  const latestRun = overview?.latest_run;
  const scores = latestRun?.scores || { overall: 0, technical: 0, content: 0, authority: 0 };
  const counts = latestRun?.counts || { total: 0, critical: 0, technical: 0, content: 0 };

  const technicalIssues = issues.filter((i) => i.pillar === "technical");
  const contentIssues = issues.filter((i) => i.pillar === "content");

  return (
    <div className="space-y-6" data-testid="seo-agent-tab">
      {/* Header + Run Scan */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-anton uppercase tracking-tight text-ink flex items-center gap-2">
            <Activity size={20} className="text-brand" />
            AI SEO Growth Agent
          </h2>
          <div className="text-xs font-mono uppercase tracking-[0.18em] text-ink-muted mt-1">
            {latestRun
              ? <>Last scan {timeAgo(latestRun.finished_at)} · next {overview?.next_scheduled_scan}</>
              : <>No scan yet · runs daily at {overview?.next_scheduled_scan || "02:00 UTC"}</>}
          </div>
        </div>
        <button
          type="button"
          onClick={runScan}
          disabled={scanning}
          data-testid="seo-agent-run-scan"
          className="font-mono text-xs uppercase tracking-[0.22em] border border-brand text-brand px-4 py-2 hover:bg-brand hover:text-paper transition-colors disabled:opacity-50 inline-flex items-center gap-2"
        >
          {scanning
            ? <><Loader2 size={12} className="animate-spin" /> Scanning…</>
            : <><RefreshCw size={12} /> Run Scan Now</>}
        </button>
      </div>

      {/* Score cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <ScoreCard label="Overall SEO" value={scores.overall} sub={`${counts.total} issues total`} />
        <ScoreCard label="Technical Health" value={scores.technical} sub={`${counts.technical} issues`} />
        <ScoreCard label="Content Quality" value={scores.content} sub={`${counts.content} issues`} />
        <ScoreCard label="Authority" value={scores.authority} sub="Rich Pins eligible" />
      </div>

      {/* Critical issues callout */}
      {counts.critical > 0 && (
        <div className="border border-red-600 bg-red-600/5 p-3 flex items-center gap-3" data-testid="seo-agent-critical-banner">
          <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
          <div className="text-sm text-ink">
            <strong>{counts.critical} critical issue{counts.critical === 1 ? "" : "s"}</strong>{" "}
            need attention — see the Technical tab.
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-line">
        <div className="flex gap-1 overflow-x-auto" data-testid="seo-agent-tabs">
          {[
            { id: "overview",  label: "Overview" },
            { id: "technical", label: `Technical (${counts.technical})` },
            { id: "content",   label: `Content (${counts.content})` },
            { id: "queue",     label: `Auto-Fix Queue (${overview?.queue_pending ?? 0})` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              data-testid={`seo-agent-tab-${t.id}`}
              className={`font-mono text-xs uppercase tracking-[0.18em] px-4 py-2 whitespace-nowrap border-b-2 transition-colors ${
                active === t.id
                  ? "border-brand text-brand"
                  : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {!loaded ? (
        <div className="text-center py-12 text-ink-muted">
          <Loader2 size={20} className="animate-spin mx-auto" />
        </div>
      ) : active === "overview" ? (
        <div className="space-y-3" data-testid="seo-agent-overview-panel">
          <div className="border border-line bg-surface p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">How the agent works</div>
            <ul className="text-sm text-ink space-y-1.5 list-disc list-inside">
              <li>Runs a full scan every day at <strong>{overview?.next_scheduled_scan || "02:00 UTC"}</strong> (off-peak). Click <strong>Run Scan Now</strong> for an immediate pass.</li>
              <li>Scans products, makers, SEO landing pages, sitemap, canonicals, and indexability signals.</li>
              <li>Generates AI rewrites with Claude Sonnet 4.5 for meta descriptions + alt text.</li>
              <li>Nothing publishes automatically — every AI rewrite stages in the <strong>Auto-Fix Queue</strong> until you click Approve.</li>
              <li>Every applied change keeps a before-snapshot, so <strong>Roll back</strong> is always one click away.</li>
            </ul>
          </div>
          {counts.total === 0 && loaded && (
            <div className="border border-line p-6 text-center text-ink-muted">
              <CheckCircle2 size={20} className="mx-auto text-emerald-600 mb-2" />
              <div className="text-sm">Clean sweep — zero issues in the latest scan.</div>
            </div>
          )}
          {counts.total > 0 && (
            <div className="border border-line bg-surface p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">Quick jump</div>
              <div className="flex flex-wrap gap-2">
                {counts.technical > 0 && (
                  <button onClick={() => setActive("technical")} className="text-xs font-mono uppercase tracking-[0.18em] border border-line px-3 py-1.5 hover:border-brand hover:text-brand transition-colors inline-flex items-center gap-1.5">
                    {counts.technical} technical issues <ChevronRight size={11} />
                  </button>
                )}
                {counts.content > 0 && (
                  <button onClick={() => setActive("content")} className="text-xs font-mono uppercase tracking-[0.18em] border border-line px-3 py-1.5 hover:border-brand hover:text-brand transition-colors inline-flex items-center gap-1.5">
                    {counts.content} content issues <ChevronRight size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : active === "technical" ? (
        <div className="space-y-2" data-testid="seo-agent-technical-panel">
          {technicalIssues.length === 0 ? (
            <div className="border border-line p-6 text-center text-ink-muted">
              <CheckCircle2 size={20} className="mx-auto text-emerald-600 mb-2" />
              <div className="text-sm">No technical issues. Sitemap, canonicals, and indexability all green.</div>
            </div>
          ) : technicalIssues.map((i) => (
            <IssueRow key={i.id} issue={i} onGenerateFix={generateFix} generating={generating} />
          ))}
        </div>
      ) : active === "content" ? (
        <div className="space-y-2" data-testid="seo-agent-content-panel">
          {contentIssues.length === 0 ? (
            <div className="border border-line p-6 text-center text-ink-muted">
              <CheckCircle2 size={20} className="mx-auto text-emerald-600 mb-2" />
              <div className="text-sm">No content issues. Every listing has metadata, descriptions, and alt text.</div>
            </div>
          ) : (
            <>
              <div className="text-xs text-ink-muted flex items-center gap-1.5 mb-1">
                <Search size={11} />
                Showing {contentIssues.length} content issue{contentIssues.length === 1 ? "" : "s"} · click <Sparkles size={11} className="inline" /> Generate Fix to stage an AI rewrite for approval.
              </div>
              {contentIssues.slice(0, 100).map((i) => (
                <IssueRow key={i.id} issue={i} onGenerateFix={generateFix} generating={generating} />
              ))}
              {contentIssues.length > 100 && (
                <div className="text-xs text-ink-muted text-center pt-2">
                  Showing first 100 of {contentIssues.length} · fix these and the next batch will surface on the next scan.
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3" data-testid="seo-agent-queue-panel">
          <div className="flex gap-1">
            {[
              { id: "pending",     label: "Pending" },
              { id: "applied",     label: "Applied" },
              { id: "rejected",    label: "Rejected" },
              { id: "rolled_back", label: "Rolled back" },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setQueueStatus(s.id)}
                data-testid={`seo-agent-queue-status-${s.id}`}
                className={`font-mono text-[10px] uppercase tracking-[0.18em] px-2.5 py-1 border transition-colors ${
                  queueStatus === s.id
                    ? "border-brand text-brand"
                    : "border-line text-ink-muted hover:border-ink hover:text-ink"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {queue.length === 0 ? (
            <div className="border border-line p-6 text-center text-ink-muted">
              <div className="text-sm">
                {queueStatus === "pending"
                  ? "No pending AI rewrites. Generate fixes from the Content or Technical tabs."
                  : `No ${queueStatus.replace("_", " ")} entries.`}
              </div>
            </div>
          ) : (
            queue.map((entry) => (
              <QueueRow
                key={entry.id}
                entry={entry}
                onApprove={approve}
                onReject={reject}
                onRollback={rollback}
                busy={busy}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
