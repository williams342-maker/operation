// iter413bp — Operations Dashboard (admin landing layer).
// Pinned above the tab content when no `?tab=` query is set. Hidden
// once admin drills into a specific tab. Six sections:
//   1. Executive Summary (4 big counts)
//   2. Action Queue (CRITICAL / REVIEW / GROWTH)
//   3. Marketplace Health (7 KPIs with traffic-light status)
//   4. Founder Funnel (6-stage pipeline)
//   5. Daily Operations Brief (static rule engine output)
//   6. Recent Activity Rail (newest-first, big-5 sources only)
//
// All cards deep-link via `onJumpToTab(tabId)` — never duplicate
// functionality from the tab they link to.

import { useEffect, useMemo, useState } from "react";
import { fetchOpsDashboardOverview } from "../../lib/api";

const STATUS_COLOUR = {
  green:  "text-emerald-700",
  yellow: "text-amber-700",
  red:    "text-danger",
};

const STATUS_DOT = {
  green:  "bg-emerald-600",
  yellow: "bg-amber-500",
  red:    "bg-danger",
};

const formatValue = (m) => {
  if (m.format === "usd") {
    return `$${Number(m.value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  return m.value;
};

const fmtAgo = (iso) => {
  if (!iso) return "—";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
    return `${Math.floor(ms / 86_400_000)}d`;
  } catch {
    return "—";
  }
};

const ACTIVITY_KIND_LABEL = {
  application_submitted: "Application",
  order_placed:          "Order",
  custom_request:        "Custom",
  seller_approved:       "Approved",
  automation_failed:     "Failed",
};

export default function OperationsDashboard({ onJumpToTab }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const load = async () => {
    setBusy(true); setErr("");
    try {
      setData(await fetchOpsDashboardOverview());
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Failed to load dashboard");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); }, []);

  const jump = (tab) => (onJumpToTab ? onJumpToTab(tab) : null);

  const summaryCards = useMemo(() => {
    if (!data) return [];
    return [
      {
        id: "critical",
        label: "Critical Issues",
        value: data.summary.critical,
        tone: data.summary.critical > 0 ? "red" : "green",
        glyph: "●",
        cta_tab: data.action_queue.critical?.[0]?.cta_tab || "prod-health",
      },
      {
        id: "review",
        label: "Needs Review",
        value: data.summary.needs_review,
        tone: data.summary.needs_review > 0 ? "yellow" : "green",
        glyph: "◐",
        cta_tab: data.action_queue.review?.[0]?.cta_tab || "applications",
      },
      {
        id: "healthy",
        label: "Healthy Systems",
        value: data.summary.healthy,
        tone: "green",
        glyph: "◆",
        cta_tab: "prod-health",
      },
      {
        id: "activity",
        label: "Marketplace Activity",
        value: data.summary.activity,
        tone: "green",
        glyph: "★",
        cta_tab: "analytics",
      },
    ];
  }, [data]);

  if (err) {
    return (
      <section className="border border-line bg-paper p-4 mb-6" data-testid="ops-dashboard-error">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-danger">◆ Operations dashboard</div>
        <p className="text-sm text-ink-muted mt-1">{err}</p>
        <button onClick={load} className="mt-3 px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em]" data-testid="ops-dashboard-retry">
          Retry
        </button>
      </section>
    );
  }

  if (!data && busy) {
    return (
      <section className="border border-line bg-paper p-6 mb-6 animate-pulse" data-testid="ops-dashboard-loading">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">◆ Loading operations dashboard…</div>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section
      className="mb-6 space-y-5"
      data-testid="ops-dashboard"
      aria-label="Operations dashboard"
    >
      {/* ─────────────── Header bar ─────────────── */}
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">◆ Admin landing</div>
          <h2 className="font-display text-2xl text-ink mt-0.5" data-testid="ops-dashboard-title">Operations</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-ink-muted" data-testid="ops-dashboard-generated">
            Refreshed {fmtAgo(data.generated_at)} ago
          </span>
          <button
            onClick={load}
            disabled={busy}
            data-testid="ops-dashboard-refresh"
            className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          >
            {busy ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </header>

      {/* ─────────────── Section 1 · Executive Summary ─────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="ops-summary">
        {summaryCards.map((c) => (
          <button
            key={c.id}
            onClick={() => jump(c.cta_tab)}
            data-testid={`ops-summary-${c.id}`}
            className="text-left border border-line bg-paper hover:border-brand transition p-4 group"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">{c.label}</span>
              <span className={STATUS_COLOUR[c.tone]} aria-hidden>{c.glyph}</span>
            </div>
            <div className="font-display text-4xl text-ink mt-2 tabular-nums">{c.value}</div>
            <div className="font-mono text-[10px] text-ink-muted mt-2 opacity-0 group-hover:opacity-100 transition">
              → Open
            </div>
          </button>
        ))}
      </div>

      {/* ─────────────── Section 5 · Daily Operations Brief ─────────────── */}
      {!dismissed && (
        <article
          className="border border-line bg-paper p-4 md:p-5"
          data-testid="ops-daily-brief"
        >
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">◆ Daily brief</div>
            <button
              onClick={() => setDismissed(true)}
              data-testid="ops-daily-brief-dismiss"
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink"
            >
              Dismiss
            </button>
          </div>
          <div className="grid md:grid-cols-2 gap-4 mt-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-700">Opportunity</div>
              <p className="text-sm text-ink mt-1" data-testid="ops-brief-opportunity">{data.daily_brief.opportunity}</p>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-danger">Risk</div>
              <p className="text-sm text-ink mt-1" data-testid="ops-brief-risk">{data.daily_brief.risk}</p>
            </div>
          </div>
          {data.daily_brief.actions?.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2" data-testid="ops-brief-actions">
              {data.daily_brief.actions.map((a, i) => (
                <button
                  key={i}
                  onClick={() => jump(a.cta_tab)}
                  data-testid={`ops-brief-action-${i}`}
                  className="px-3 py-1.5 border border-brand text-brand hover:bg-brand hover:text-paper font-mono text-[10px] uppercase tracking-[0.22em] transition"
                >
                  {i + 1}. {a.label} →
                </button>
              ))}
            </div>
          )}
        </article>
      )}

      {/* ─────────────── Two-column layout: Action Queue + Activity Rail ─────────────── */}
      <div className="grid lg:grid-cols-[1fr_280px] gap-4">

        {/* Action Queue (Section 2) */}
        <div className="space-y-4" data-testid="ops-action-queue">
          {[
            { id: "critical", label: "Critical",     accent: "text-danger",       items: data.action_queue.critical },
            { id: "review",   label: "Needs Review", accent: "text-amber-700",    items: data.action_queue.review },
            { id: "growth",   label: "Growth",       accent: "text-emerald-700",  items: data.action_queue.growth },
          ].map((group) => (
            <section
              key={group.id}
              data-testid={`ops-queue-group-${group.id}`}
              className="border border-line bg-paper p-3 md:p-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-line">
                <h3 className={`font-mono text-[10px] uppercase tracking-[0.22em] ${group.accent}`}>
                  ◆ {group.label}
                </h3>
                <span className="font-mono text-[10px] text-ink-muted">
                  {group.items.length} item{group.items.length === 1 ? "" : "s"}
                </span>
              </div>
              {group.items.length === 0 ? (
                <p className="font-mono text-xs text-ink-muted py-3" data-testid={`ops-queue-empty-${group.id}`}>
                  {group.id === "critical"
                    ? "✓ No critical issues."
                    : group.id === "review"
                    ? "✓ Nothing waiting for review."
                    : "All sellers active — no growth gaps detected."}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {group.items.map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                      data-testid={`ops-queue-item-${it.id}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-ink truncate">{it.title}</div>
                        <div className="font-mono text-[10px] text-ink-muted truncate">
                          {it.desc}{it.age && it.age !== "—" ? ` · ${it.age}` : ""}
                        </div>
                      </div>
                      <button
                        onClick={() => jump(it.cta_tab)}
                        data-testid={`ops-queue-cta-${it.id}`}
                        className="shrink-0 px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
                      >
                        {it.cta_label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {/* Section 3 · Marketplace Health */}
          <section
            className="border border-line bg-paper p-3 md:p-4"
            data-testid="ops-marketplace-health"
          >
            <div className="flex items-center justify-between pb-2 border-b border-line">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                ◆ Marketplace health · last 7d
              </h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mt-3">
              {data.marketplace_health.metrics.map((m) => (
                <button
                  key={m.id}
                  onClick={() => jump(m.cta_tab)}
                  data-testid={`ops-health-${m.id}`}
                  className="text-left border border-line p-3 hover:border-brand transition"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[m.status]}`} aria-hidden />
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted truncate">
                      {m.label}
                    </span>
                  </div>
                  <div className="font-display text-xl text-ink mt-1 tabular-nums">{formatValue(m)}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Section 4 · Founder Funnel */}
          <section
            className="border border-line bg-paper p-3 md:p-4"
            data-testid="ops-founder-funnel"
          >
            <div className="flex items-center justify-between pb-2 border-b border-line">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                ◆ Founder funnel · last {data.founder_funnel.window}
              </h3>
              <button
                onClick={() => jump("founder-funnel")}
                data-testid="ops-founder-funnel-open"
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand"
              >
                Open full funnel →
              </button>
            </div>
            <ol className="mt-3 space-y-1.5">
              {data.founder_funnel.stages.map((s, i) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 text-sm"
                  data-testid={`ops-funnel-stage-${s.id}`}
                >
                  <span className="font-mono text-[10px] text-ink-muted w-4">{i + 1}.</span>
                  <span className="text-ink min-w-[110px]">{s.label}</span>
                  <span className="font-display text-lg text-ink tabular-nums min-w-[60px]">{s.count}</span>
                  {s.conversion_pct !== null && (
                    <span className="font-mono text-[10px] text-ink-muted">
                      {s.conversion_pct}% conv
                      {s.dropoff_pct > 0 && ` · ${s.dropoff_pct}% drop`}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* Section 6 · Recent Activity Rail */}
        <aside
          className="border border-line bg-paper p-3 md:p-4 lg:max-h-[640px] lg:overflow-y-auto"
          data-testid="ops-activity-rail"
        >
          <div className="flex items-center justify-between pb-2 border-b border-line">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              ◆ Recent activity
            </h3>
            <span className="font-mono text-[10px] text-ink-muted">{data.recent_activity.items.length}</span>
          </div>
          {data.recent_activity.items.length === 0 ? (
            <p className="font-mono text-xs text-ink-muted py-3" data-testid="ops-activity-empty">
              No activity yet today.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {data.recent_activity.items.map((it, i) => (
                <li
                  key={`${it.kind}-${i}`}
                  className="py-2 cursor-pointer hover:bg-paper-soft"
                  onClick={() => jump(it.cta_tab)}
                  data-testid={`ops-activity-item-${i}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                      {ACTIVITY_KIND_LABEL[it.kind] || it.kind}
                    </span>
                    <span className="font-mono text-[9px] text-ink-muted shrink-0">
                      {fmtAgo(it.ts)}
                    </span>
                  </div>
                  <div className="text-xs text-ink mt-0.5 truncate">{it.label}</div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
