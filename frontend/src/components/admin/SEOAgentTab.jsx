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
  ThumbsDown, ThumbsUp, Undo2, ChevronRight, Search, TrendingUp,
  Zap, Clock, ExternalLink, XCircle,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend,
} from "recharts";
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
  // Authority (iter413c)
  maker_no_bio:                "Maker profile missing bio",
  maker_no_cover:              "Maker missing cover photo",
  maker_no_portrait:           "Maker missing portrait",
  maker_no_social:             "Maker has no linked social accounts",
  maker_spotlight_opportunity: "Established maker — write a spotlight",
  landing_thin_relations:      "Few SEO landing pages — broaden category breadth",
};

const KIND_FIXABLE = new Set([
  "missing_meta_description",
  "meta_description_too_short",
  "meta_description_too_long",
  "missing_alt_text",
]);

// iter413g — Safe-to-bulk-approve kinds. MUST stay in sync with
// AUTOPILOT_AVAILABLE_KINDS in backend/routers/seo_agent.py. These are
// purely additive — they only fill EMPTY fields and never overwrite
// human-authored content. The backend re-validates this list on the
// bulk-approve endpoint regardless of what the UI sends.
const SAFE_BULK_KINDS = new Set([
  "missing_alt_text",
  "missing_meta_description",
]);

// iter413 — Impact / effort pill colors. Brand-aligned, never the
// generic Tailwind named shades that the contrast lint rejects.
const IMPACT_PILL = {
  high:   "border-brand text-brand",
  medium: "border-yellow-600 text-yellow-700",
  low:    "border-line text-ink-muted",
};
const EFFORT_PILL = {
  low:    "border-emerald-600 text-emerald-700",
  medium: "border-yellow-600 text-yellow-700",
  high:   "border-red-600 text-red-600",
};


function ScoreCard({ label, value, sub }) {
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



function RecommendationRow({ rec, onGenerateAll, generating }) {
  const sev = SEVERITY_STYLES[rec.severity] || SEVERITY_STYLES.low;
  const impactCls = IMPACT_PILL[rec.impact_label] || IMPACT_PILL.low;
  const effortCls = EFFORT_PILL[rec.effort_label] || EFFORT_PILL.medium;
  const mins = rec.effort_minutes;
  const eta = mins < 60 ? `~${mins}m` : `~${Math.round(mins / 60)}h`;

  return (
    <div
      data-testid={`seo-agent-rec-${rec.id}`}
      className={`border ${sev.border} ${sev.bg} p-4`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className={`font-mono text-[10px] uppercase tracking-[0.18em] border px-1.5 py-0.5 ${impactCls}`}>
              {rec.impact_label} impact
            </span>
            <span className={`font-mono text-[10px] uppercase tracking-[0.18em] border px-1.5 py-0.5 ${effortCls}`}>
              {rec.effort_label} effort
            </span>
            {rec.fixable_via_ai && (
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] border border-brand/40 text-brand px-1.5 py-0.5 inline-flex items-center gap-1">
                <Sparkles size={10} /> AI fixable
              </span>
            )}
          </div>
          <div className="text-base font-medium text-ink">{rec.title}</div>
          <div className="text-xs text-ink-muted mt-1 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Search size={11} /> {rec.affected_count} affected
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock size={11} /> {eta} est.
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <TrendingUp size={11} /> +{rec.expected_traffic_pct}% expected traffic
            </span>
          </div>
        </div>
        {rec.fixable_via_ai && (
          <button
            type="button"
            onClick={() => onGenerateAll(rec)}
            disabled={generating === rec.id}
            data-testid={`seo-agent-rec-generate-all-${rec.id}`}
            className="text-xs font-mono uppercase tracking-[0.18em] border border-brand text-brand px-3 py-1.5 hover:bg-brand hover:text-paper transition-colors disabled:opacity-50 whitespace-nowrap inline-flex items-center gap-1.5"
          >
            {generating === rec.id ? (
              <><Loader2 size={11} className="animate-spin" /> Queuing {rec.affected_count}…</>
            ) : (
              <><Zap size={11} /> Fix all ({rec.affected_count})</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}


function ModeSelector({ currentMode, onChange, autopilotWhitelist, autopilotAvailableKinds, onWhitelistChange }) {
  // iter413c — Autopilot mode selector. observe ⇢ scan only · assist ⇢
  // recommendations · approve ⇢ AI generation queue (default) · autopilot
  // ⇢ assist+approve+auto-apply LOW-RISK fixes on the daily cron.
  // iter413d — When autopilot is selected, show per-kind checkboxes so
  // the admin opts in granularly. High-risk kinds (meta rewrites,
  // descriptions, titles) are not in the available set, period.
  const modes = [
    { id: "observe",   label: "Observe",   desc: "Scan only · no AI generation" },
    { id: "assist",    label: "Assist",    desc: "Scan + ranked recommendations" },
    { id: "approve",   label: "Approve",   desc: "Default · AI rewrites stage in queue", recommended: true },
    { id: "autopilot", label: "Autopilot", desc: "Auto-apply selected fixes on cron · high-risk always needs approval" },
  ];
  const KIND_BLURBS = {
    missing_alt_text:         { label: "Generate missing alt text", risk: "Purely additive — never visible to buyers." },
    missing_meta_description: { label: "Fill empty meta descriptions", risk: "Only fires when meta is empty — never overwrites human copy." },
  };
  const wl = new Set(autopilotWhitelist || []);
  const toggle = (kind) => {
    const next = new Set(wl);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    onWhitelistChange(Array.from(next));
  };
  return (
    <div className="border border-line bg-surface p-4" data-testid="seo-agent-mode-selector">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Operating mode</div>
        <div className="text-xs text-ink-muted">Current: <strong className="text-brand font-mono uppercase tracking-[0.18em]">{currentMode || "approve"}</strong></div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {modes.map((m) => {
          const isActive = currentMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => !isActive && onChange(m.id)}
              data-testid={`seo-agent-mode-${m.id}`}
              className={`text-left p-3 border transition-colors ${
                isActive
                  ? "border-brand bg-brand/5"
                  : "border-line hover:border-brand"
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className={`font-mono text-xs uppercase tracking-[0.18em] ${isActive ? "text-brand" : "text-ink"}`}>
                  {m.label}
                </span>
                {m.recommended && !isActive && (
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">recommended</span>
                )}
              </div>
              <div className="text-xs text-ink-muted">{m.desc}</div>
            </button>
          );
        })}
      </div>
      {currentMode === "autopilot" && (
        <div className="mt-4 pt-4 border-t border-line" data-testid="seo-agent-autopilot-whitelist">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
            Autopilot whitelist · pick which kinds auto-apply on the daily cron
          </div>
          <div className="space-y-2">
            {(autopilotAvailableKinds || []).map((k) => {
              const meta = KIND_BLURBS[k] || { label: k, risk: "" };
              const on = wl.has(k);
              return (
                <label
                  key={k}
                  data-testid={`seo-agent-autopilot-kind-${k}`}
                  className={`flex items-start gap-3 p-2.5 border cursor-pointer transition-colors ${
                    on ? "border-brand bg-brand/5" : "border-line hover:border-brand"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(k)}
                    className="mt-0.5 accent-brand"
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-ink">{meta.label}</div>
                    <div className="text-xs text-ink-muted mt-0.5">{meta.risk}</div>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-ink-muted">
            High-risk rewrites (descriptions, titles, replacing existing meta) <strong>never</strong> appear here — they always require manual approval.
          </div>
        </div>
      )}
    </div>
  );
}


function ReportingPanel({ history, queueActivity, latestScores }) {
  const data = (history || []).map((h) => {
    const d = new Date(h.finished_at);
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      Overall:   h.scores?.overall ?? 0,
      Technical: h.scores?.technical ?? 0,
      Content:   h.scores?.content ?? 0,
      Authority: h.scores?.authority ?? 0,
      issues:    h.counts?.total ?? 0,
    };
  });

  return (
    <div className="space-y-4" data-testid="seo-agent-reporting-panel">
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="border border-line bg-surface p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Applied this window</div>
          <div className="text-2xl font-anton text-emerald-700 mt-1" data-testid="seo-agent-applied-count">
            {queueActivity?.applied ?? 0}
          </div>
        </div>
        <div className="border border-line bg-surface p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Rejected</div>
          <div className="text-2xl font-anton text-ink mt-1">
            {queueActivity?.rejected ?? 0}
          </div>
        </div>
        <div className="border border-line bg-surface p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Rolled back</div>
          <div className="text-2xl font-anton text-red-600 mt-1">
            {queueActivity?.rolled_back ?? 0}
          </div>
        </div>
      </div>

      <div className="border border-line bg-surface p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
          Score trend · last 30 days
        </div>
        {data.length < 2 ? (
          <div className="py-12 text-center text-ink-muted text-sm">
            Need at least two scans to draw a trend. The cron runs nightly at 02:00 UTC —
            tomorrow&apos;s scan unlocks this chart.
          </div>
        ) : (
          <div style={{ width: "100%", height: 260 }} data-testid="seo-agent-trend-chart">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--color-ink-muted)" }}
                       axisLine={{ stroke: "var(--color-line)" }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--color-ink-muted)" }}
                       axisLine={{ stroke: "var(--color-line)" }} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-line)",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Overall"   stroke="var(--color-brand)" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Technical" stroke="#16a34a" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Content"   stroke="#dc2626" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Authority" stroke="#7c3aed" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="border border-line bg-surface p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
          Latest scores
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {["overall", "technical", "content", "authority"].map((k) => (
            <div key={k} className="border border-line p-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">{k}</div>
              <div className="text-xl font-anton text-ink mt-0.5">{latestScores?.[k] ?? 0}</div>
            </div>
          ))}
        </div>
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


function QueueRow({ entry, onApprove, onReject, onRollback, busy, selected, onToggleSelect }) {
  const isPending = entry.status === "pending";
  const isApplied = entry.status === "applied";
  const beforeVal = entry.before?.[entry.field];
  const afterVal = entry.after?.[entry.field];
  const renderVal = (v) => Array.isArray(v) ? v.join(" · ") : (v || <span className="text-ink-muted">∅ (empty)</span>);

  return (
    <div
      data-testid={`seo-agent-queue-${entry.id}`}
      className={`border bg-surface p-3 ${selected ? "border-brand" : "border-line"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-start gap-2">
          {isPending && onToggleSelect && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelect(entry.id)}
              data-testid={`seo-agent-queue-select-${entry.id}`}
              className="mt-1 accent-brand flex-shrink-0"
              aria-label="Select for bulk approve"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink truncate">{entry.target_label || entry.target_slug}</div>
            <div className="text-xs text-ink-muted mt-0.5">
              {KIND_LABELS[entry.issue_kind] || entry.issue_kind} · {timeAgo(entry.generated_at)}
            </div>
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


// iter413ad — Pinterest Rich Pin validator panel.
//
// Pinterest doesn't expose a public Rich Pins validator API, so the
// backend fetches the page itself, parses the OG + article:* meta tags,
// and reports what Pinterest WOULD see. Admin can then click through to
// Pinterest's own URL Debugger for a final visual confirmation.
const PIN_QUICK_PAGES = [
  { label: "Homepage",         path: "/" },
  { label: "Shop",             path: "/shop" },
  { label: "Custom Orders",    path: "/custom" },
  { label: "Free SVG Pack",    path: "/free-svg-pack" },
  { label: "How Custom Works", path: "/how-custom-orders-work" },
  { label: "Journal",          path: "/journal" },
];

function PinterestRichPinValidator() {
  const SITE = "https://craftersmarket.org";
  const [url, setUrl] = useState(`${SITE}/`);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const validate = useCallback(async (target) => {
    const toCheck = (target || url || "").trim();
    if (!toCheck) {
      toast.error("Enter a URL to validate.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch(`${API}/api/admin/seo-agent/pinterest-validate`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ url: toCheck }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(data?.detail || "Validation failed.");
        return;
      }
      setResult(data);
      if (data.fetch_error) {
        toast.error("Could not fetch the URL.");
      } else if (data.all_required_present) {
        toast.success("Rich Pin ready — all required tags present.");
      } else {
        toast.error(`Missing ${data.missing_required.length} required tag${data.missing_required.length === 1 ? "" : "s"}.`);
      }
    } catch {
      toast.error("Network error while validating.");
    } finally {
      setBusy(false);
    }
  }, [url]);

  return (
    <div
      className="border border-line bg-surface p-4"
      data-testid="seo-agent-pinterest-validator"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
            ◆ Pinterest Rich Pins
          </div>
          <h3 className="text-base font-medium text-ink mt-1">
            Validate Rich Pin metadata
          </h3>
          <p className="text-xs text-ink-muted mt-1 max-w-prose">
            Fetches the page as Pinterest&rsquo;s crawler would, then reports which
            Open Graph + <code className="font-mono text-[11px] text-brand">article:*</code> tags
            are present. Pinterest&rsquo;s official URL Debugger link appears below the
            result for a final visual confirmation.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {PIN_QUICK_PAGES.map((p) => (
          <button
            type="button"
            key={p.path}
            onClick={() => {
              const next = `${SITE}${p.path}`;
              setUrl(next);
              validate(next);
            }}
            disabled={busy}
            data-testid={`seo-agent-pin-quick-${p.path.replace(/\//g, "-") || "home"}`}
            className="font-mono text-[10px] uppercase tracking-[0.18em] border border-line px-2.5 py-1 hover:border-brand hover:text-brand transition-colors disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); validate(); }}
        className="flex flex-wrap items-stretch gap-2 mb-3"
      >
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://craftersmarket.org/..."
          data-testid="seo-agent-pin-url-input"
          className="flex-1 min-w-[260px] font-mono text-sm bg-surface border border-line text-ink px-3 py-2 focus:outline-none focus:border-brand placeholder:text-ink-muted/60"
        />
        <button
          type="submit"
          disabled={busy}
          data-testid="seo-agent-pin-validate"
          className="font-mono text-xs uppercase tracking-[0.22em] border border-brand text-brand px-4 py-2 hover:bg-brand hover:text-paper transition-colors disabled:opacity-50 inline-flex items-center gap-2"
        >
          {busy
            ? <><Loader2 size={12} className="animate-spin" /> Checking…</>
            : <><Search size={12} /> Validate</>}
        </button>
      </form>

      {result && (
        <div data-testid="seo-agent-pin-result">
          {/* Status banner */}
          {result.fetch_error ? (
            <div className="border border-red-600 bg-red-600/5 p-3 mb-3 flex items-start gap-2">
              <AlertCircle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-ink">
                <strong>Could not fetch the URL.</strong>
                <div className="text-xs text-ink-muted mt-1 font-mono break-all">{result.fetch_error}</div>
              </div>
            </div>
          ) : result.all_required_present ? (
            <div className="border border-emerald-600/40 bg-emerald-600/5 p-3 mb-3 flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-700 flex-shrink-0" />
              <div className="text-sm text-ink">
                <strong>Rich Pin ready.</strong> All required tags present
                {result.og_type ? <> · <code className="font-mono text-[11px] text-brand">og:type = {result.og_type}</code></> : null}
                {result.rules_applied ? <> · rules: <strong className="text-brand">{result.rules_applied}</strong></> : null}
              </div>
            </div>
          ) : (
            <div className="border border-yellow-600/40 bg-yellow-600/5 p-3 mb-3 flex items-start gap-2">
              <AlertCircle size={14} className="text-yellow-700 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-ink">
                <strong>Missing {result.missing_required.length} required tag{result.missing_required.length === 1 ? "" : "s"}.</strong>
                {result.status_code && result.status_code !== 200 && (
                  <> · HTTP <strong>{result.status_code}</strong></>
                )}
                <div className="text-xs text-ink-muted mt-1">
                  Add the missing tags below to your page meta, then re-validate.
                </div>
              </div>
            </div>
          )}

          {/* Per-tag checklist */}
          {result.checks.length > 0 && (
            <div className="border border-line">
              {result.checks.map((c, idx) => {
                const ok = c.present;
                const cls = ok
                  ? "text-emerald-700"
                  : c.required ? "text-red-600" : "text-ink-muted";
                const Icon = ok ? CheckCircle2 : c.required ? XCircle : AlertCircle;
                return (
                  <div
                    key={c.tag}
                    data-testid={`seo-agent-pin-check-${c.tag.replace(/:/g, "_")}`}
                    className={`flex items-start gap-3 px-3 py-2 ${idx === 0 ? "" : "border-t border-line"} ${ok ? "" : "bg-surface"}`}
                  >
                    <Icon size={14} className={`${cls} flex-shrink-0 mt-1`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="font-mono text-xs text-ink">{c.tag}</code>
                        {c.required ? (
                          <span className="font-mono text-[9px] uppercase tracking-[0.18em] border border-brand/40 text-brand px-1 py-0.5">
                            required
                          </span>
                        ) : (
                          <span className="font-mono text-[9px] uppercase tracking-[0.18em] border border-line text-ink-muted px-1 py-0.5">
                            recommended
                          </span>
                        )}
                      </div>
                      {c.value
                        ? <div className="text-xs text-ink-muted mt-0.5 break-words font-mono">{c.value}</div>
                        : <div className="text-xs text-ink-muted mt-0.5 italic">— not set —</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pinterest URL Debugger link */}
          <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-ink-muted">
              Final visual check on Pinterest&rsquo;s side:
            </div>
            <a
              href={result.debugger_url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="seo-agent-pin-debugger-link"
              className="font-mono text-xs uppercase tracking-[0.22em] border border-line text-ink px-3 py-1.5 hover:border-brand hover:text-brand transition-colors inline-flex items-center gap-2"
            >
              Open Pinterest URL Debugger <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}


export default function SEOAgentTab() {
  const [overview, setOverview] = useState(null);
  const [issues, setIssues] = useState([]);
  const [queue, setQueue] = useState([]);
  const [queueStatus, setQueueStatus] = useState("pending");
  const [recommendations, setRecommendations] = useState([]);
  const [history, setHistory] = useState(null); // { history, queue_activity }
  const [config, setConfig] = useState(null);   // iter413d — mode + whitelist + available kinds
  const [active, setActive] = useState("overview"); // overview | recommendations | technical | content | authority | reporting | queue
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(null);    // issue id being processed
  const [generatingRec, setGeneratingRec] = useState(null); // rec id being processed
  const [busy, setBusy] = useState(null);                // queue id being processed
  const [bulkBusy, setBulkBusy] = useState(false);       // iter413g — bulk-approve in flight
  const [selected, setSelected] = useState(() => new Set()); // iter413g — multi-select queue ids
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [ovrRes, issRes, qRes, recRes, histRes, cfgRes] = await Promise.all([
        fetch(`${API}/api/admin/seo-agent/overview`, { headers: authHeaders() }),
        fetch(`${API}/api/admin/seo-agent/issues`, { headers: authHeaders() }),
        fetch(`${API}/api/admin/seo-agent/queue?status=${queueStatus}`, { headers: authHeaders() }),
        fetch(`${API}/api/admin/seo-agent/recommendations`, { headers: authHeaders() }),
        fetch(`${API}/api/admin/seo-agent/history?days=30`, { headers: authHeaders() }),
        fetch(`${API}/api/admin/seo-agent/config`, { headers: authHeaders() }),
      ]);
      if (ovrRes.ok)  setOverview(await ovrRes.json());
      if (issRes.ok)  setIssues((await issRes.json()).issues || []);
      if (qRes.ok)    setQueue((await qRes.json()).items || []);
      if (recRes.ok)  setRecommendations((await recRes.json()).recommendations || []);
      if (histRes.ok) setHistory(await histRes.json());
      if (cfgRes.ok)  setConfig(await cfgRes.json());
    } catch (e) {
      toast.error("Could not load SEO Agent data");
    } finally {
      setLoaded(true);
    }
  }, [queueStatus]);

  useEffect(() => { refresh(); }, [refresh]);

  // iter413g — Clear selection whenever the queue filter changes so
  // we don't accidentally apply selected-from-pending ids to a different
  // status filter. Also clear after every successful refresh.
  useEffect(() => { setSelected(new Set()); }, [queueStatus]);

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllOnPage = (entries) => {
    const ids = entries.filter((e) => e.status === "pending").map((e) => e.id);
    setSelected(new Set(ids));
  };

  const clearSelection = () => setSelected(new Set());

  // iter413h — Keyboard shortcuts on the Queue tab. Bound at the
  // document level but bails when focus is in an editable field so
  // typing in admin search/forms is never hijacked. Active only when
  // the Queue + Pending sub-tab is visible.
  //   • Shift + A   → Approve all safe
  //   • ⌘/Ctrl + A → Select every pending row on page (overrides
  //                  browser native select-all while in this view)
  //   • Esc         → Clear selection
  useEffect(() => {
    if (active !== "queue" || queueStatus !== "pending") return undefined;
    const isEditable = (el) => {
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = (el.tagName || "").toUpperCase();
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };
    const onKey = (e) => {
      if (bulkBusy) return;
      if (isEditable(e.target)) return;
      // Shift+A — approve all safe. Plain `a` would clobber too much.
      if (e.key === "A" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        bulkApprove({ all_safe: true }, "Approved all safe (alt text + empty meta)");
        return;
      }
      // ⌘/Ctrl + A — select all on page (override browser native).
      if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        selectAllOnPage(queue);
        return;
      }
      if (e.key === "Escape" && selected.size > 0) {
        e.preventDefault();
        clearSelection();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, queueStatus, queue, selected.size, bulkBusy]);

  const bulkApprove = async (payload, successMsg) => {
    setBulkBusy(true);
    try {
      const r = await fetch(`${API}/api/admin/seo-agent/queue/bulk-approve`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Bulk approve failed");
      const applied = d.applied_count || 0;
      const failed = d.failed_count || 0;
      const appliedIds = d.applied_ids || [];
      if (applied > 0) {
        // iter413i — Undo snackbar. The toast itself stays for 5s with
        // a single-click "Undo" action that fires bulk-rollback against
        // exactly the ids that were just applied. After 5s the toast
        // auto-dismisses and the change is committed for good (the
        // per-entry Roll back button still works from the Applied
        // sub-tab indefinitely — Undo is just the fast path).
        toast.success(
          `${successMsg}: ${applied} applied${failed ? ` · ${failed} failed` : ""}`,
          {
            duration: 5000,
            action: {
              label: "Undo",
              onClick: () => bulkRollback(appliedIds),
            },
          },
        );
      } else if (failed > 0) {
        toast.error(`Bulk approve failed for all ${failed} entries`);
      } else {
        toast.message("Nothing to approve");
      }
      clearSelection();
      await refresh();
    } catch (e) {
      toast.error(e.message || "Bulk approve failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkRollback = async (ids) => {
    if (!ids || ids.length === 0) return;
    const toastId = toast.loading(`Rolling back ${ids.length}…`);
    try {
      const r = await fetch(`${API}/api/admin/seo-agent/queue/bulk-rollback`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ ids }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Undo failed");
      const rolled = d.rolled_back_count || 0;
      const failed = d.failed_count || 0;
      if (rolled > 0) {
        toast.success(
          `Reverted ${rolled}${failed ? ` · ${failed} failed` : ""}`,
          { id: toastId },
        );
      } else {
        toast.error("Undo failed — nothing rolled back", { id: toastId });
      }
      await refresh();
    } catch (e) {
      toast.error(e.message || "Undo failed", { id: toastId });
    }
  };

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

  // iter413 — Bulk-generate from the Recommendations tab.
  // For each affected issue_id in the recommendation, fire /generate-fix.
  // Run with a small concurrency cap (3) so we don't slam the LLM.
  const generateAllForRecommendation = async (rec) => {
    setGeneratingRec(rec.id);
    const ids = rec.issue_ids || [];
    let success = 0, fail = 0;
    const CONCURRENCY = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const idx = cursor++;
        const issue_id = ids[idx];
        try {
          const r = await fetch(`${API}/api/admin/seo-agent/generate-fix`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({ issue_id }),
          });
          if (r.ok) success++; else fail++;
        } catch { fail++; }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (success) {
      toast.success(`${success} AI fix${success === 1 ? "" : "es"} queued · ${fail} failed`);
      setActive("queue");
      await refresh();
    } else {
      toast.error(`All ${fail} generations failed — check logs`);
    }
    setGeneratingRec(null);
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
  const authorityIssues = issues.filter((i) => i.pillar === "authority");

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
        <ScoreCard label="Authority" value={scores.authority} sub={`${counts.authority ?? 0} issues`} />
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
            { id: "overview",        label: "Overview" },
            { id: "recommendations", label: `Recommendations (${recommendations.length})` },
            { id: "technical",       label: `Technical (${counts.technical})` },
            { id: "content",         label: `Content (${counts.content})` },
            { id: "authority",       label: `Authority (${counts.authority ?? 0})` },
            { id: "reporting",       label: "Reporting" },
            { id: "queue",           label: `Auto-Fix Queue (${overview?.queue_pending ?? 0})` },
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
          <ModeSelector
            currentMode={overview?.mode}
            autopilotWhitelist={config?.autopilot_whitelist}
            autopilotAvailableKinds={config?.autopilot_available_kinds}
            onChange={async (mode) => {
              try {
                const r = await fetch(`${API}/api/admin/seo-agent/config`, {
                  method: "POST", headers: authHeaders(),
                  body: JSON.stringify({ mode }),
                });
                if (!r.ok) throw new Error();
                toast.success(`Mode set to ${mode}`);
                await refresh();
              } catch {
                toast.error("Could not update mode");
              }
            }}
            onWhitelistChange={async (whitelist) => {
              try {
                const r = await fetch(`${API}/api/admin/seo-agent/config`, {
                  method: "POST", headers: authHeaders(),
                  body: JSON.stringify({ autopilot_whitelist: whitelist }),
                });
                if (!r.ok) throw new Error();
                const d = await r.json();
                setConfig(d);
                toast.success(`Autopilot whitelist updated (${d.autopilot_whitelist.length} kind${d.autopilot_whitelist.length === 1 ? "" : "s"})`);
              } catch {
                toast.error("Could not update whitelist");
              }
            }}
          />
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
          <PinterestRichPinValidator />
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
      ) : active === "recommendations" ? (
        <div className="space-y-2" data-testid="seo-agent-recommendations-panel">
          {recommendations.length === 0 ? (
            <div className="border border-line p-6 text-center text-ink-muted">
              <CheckCircle2 size={20} className="mx-auto text-emerald-600 mb-2" />
              <div className="text-sm">
                No recommendations — clean sweep. The agent ranks fixes by impact / effort whenever the next scan surfaces issues.
              </div>
            </div>
          ) : (
            <>
              <div className="text-xs text-ink-muted mb-1">
                Ranked by impact ÷ effort. <Zap size={11} className="inline mb-0.5" /> Fix all queues AI rewrites for every affected item in one click — they still need your approval before going live.
              </div>
              {recommendations.map((r) => (
                <RecommendationRow
                  key={r.id}
                  rec={r}
                  onGenerateAll={generateAllForRecommendation}
                  generating={generatingRec}
                />
              ))}
            </>
          )}
        </div>
      ) : active === "reporting" ? (
        <ReportingPanel
          history={history?.history}
          queueActivity={history?.queue_activity}
          latestScores={scores}
        />
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
      ) : active === "authority" ? (
        <div className="space-y-2" data-testid="seo-agent-authority-panel">
          {authorityIssues.length === 0 ? (
            <div className="border border-line p-6 text-center text-ink-muted">
              <CheckCircle2 size={20} className="mx-auto text-emerald-600 mb-2" />
              <div className="text-sm">No authority issues. Maker profiles, social readiness, and internal links all healthy.</div>
            </div>
          ) : (
            <>
              <div className="text-xs text-ink-muted flex items-center gap-1.5 mb-1">
                <TrendingUp size={11} />
                {authorityIssues.length} authority signal{authorityIssues.length === 1 ? "" : "s"} — fixing these strengthens off-page authority (maker profile depth, social readiness, journal coverage).
              </div>
              {authorityIssues.slice(0, 100).map((i) => (
                <IssueRow key={i.id} issue={i} onGenerateFix={generateFix} generating={generating} />
              ))}
              {authorityIssues.length > 100 && (
                <div className="text-xs text-ink-muted text-center pt-2">
                  Showing first 100 of {authorityIssues.length}.
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

          {/* iter413g — Bulk approve toolbar. Only visible on the Pending
              tab when at least one entry exists. "Approve all safe" filters
              server-side to AUTOPILOT_AVAILABLE_KINDS (alt text + empty
              meta — additive only) so a slip never overwrites human copy.
              "Approve selected" applies the multi-select set without any
              safety filter — admin already eyeballed those rows. */}
          {queueStatus === "pending" && queue.length > 0 && (() => {
            const safeOnPage = queue.filter((e) => SAFE_BULK_KINDS.has(e.issue_kind));
            const selectedCount = selected.size;
            return (
              <div
                className="border border-line bg-surface p-3 flex flex-wrap items-center gap-2"
                data-testid="seo-agent-queue-bulk-toolbar"
              >
                <button
                  type="button"
                  onClick={() => bulkApprove(
                    { all_safe: true },
                    "Approved all safe (alt text + empty meta)",
                  )}
                  disabled={bulkBusy || safeOnPage.length === 0}
                  data-testid="seo-agent-bulk-approve-safe"
                  className="text-xs font-mono uppercase tracking-[0.18em] border border-emerald-600 text-emerald-700 px-3 py-1.5 hover:bg-emerald-600 hover:text-paper transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  {bulkBusy
                    ? <><Loader2 size={11} className="animate-spin" /> Approving…</>
                    : <><ThumbsUp size={11} /> Approve all safe ({safeOnPage.length})</>}
                </button>
                <button
                  type="button"
                  onClick={() => bulkApprove(
                    { ids: Array.from(selected) },
                    "Approved selected",
                  )}
                  disabled={bulkBusy || selectedCount === 0}
                  data-testid="seo-agent-bulk-approve-selected"
                  className="text-xs font-mono uppercase tracking-[0.18em] border border-brand text-brand px-3 py-1.5 hover:bg-brand hover:text-paper transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  <ThumbsUp size={11} /> Approve selected ({selectedCount})
                </button>
                <button
                  type="button"
                  onClick={() => selectAllOnPage(queue)}
                  disabled={bulkBusy}
                  data-testid="seo-agent-bulk-select-page"
                  className="text-xs font-mono uppercase tracking-[0.18em] border border-line text-ink-muted px-3 py-1.5 hover:border-ink hover:text-ink transition-colors disabled:opacity-40"
                >
                  Select page ({queue.length})
                </button>
                {selectedCount > 0 && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    disabled={bulkBusy}
                    data-testid="seo-agent-bulk-clear"
                    className="text-xs font-mono uppercase tracking-[0.18em] text-ink-muted px-2 py-1.5 hover:text-ink transition-colors disabled:opacity-40"
                  >
                    Clear
                  </button>
                )}
                <span className="ml-auto text-xs text-ink-muted flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] border border-line px-2 py-0.5 inline-flex items-center gap-1" data-testid="seo-agent-bulk-shortcuts-hint">
                    <span className="text-ink">⇧A</span> safe ·
                    <span className="text-ink">⌘A</span> all ·
                    <span className="text-ink">esc</span> clear
                  </span>
                  <span>
                    <strong className="text-ink">Safe</strong> = additive only (alt text · empty meta) — never overwrites human copy.
                  </span>
                </span>
              </div>
            );
          })()}

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
                selected={selected.has(entry.id)}
                onToggleSelect={queueStatus === "pending" ? toggleSelected : null}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
