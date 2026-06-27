import React, { useEffect, useState, useMemo } from "react";
import { Loader2, Compass, ArrowRight, Star, TrendingUp, ExternalLink } from "lucide-react";
import {
  fetchListingsCoachingRollup,
  fetchListingCoaching,
  fetchListingCoachingTimeline,
} from "../../lib/api";

/**
 * iter413dg — Seller Success Dashboard ("Coach" tab).
 *
 * Coaching-first surface. Consumes the SAME `/coaching` payload that
 * Compass injects into its system prompt — single source of truth so
 * the dashboard hero matches Compass's reply pixel-for-pixel.
 *
 * Two-pane layout:
 *   • LEFT — Roll-up of every listing ranked worst-first, with Score
 *     pill + 5★ Sales Opportunity + the one-line next-action preview.
 *   • RIGHT — Drill-down for the selected listing:
 *       - Score hero (X/100) + opportunity gauge + summary
 *       - "Biggest next win" card (verbatim recommendation + +pts + deep-link)
 *       - Ranked actions (with effort + impact + points + deep-link)
 *       - Progress Timeline (snapshots + per-rule deltas)
 *
 * No standalone "Quality Score" or "Sales Opportunity" floating
 * numerics — every metric is in service of a recommendation.
 */
export default function CoachTab({ maker }) {
  const [rollup, setRollup] = useState(null);
  const [loadingRollup, setLoadingRollup] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadingRollup(true);
    fetchListingsCoachingRollup()
      .then((data) => {
        if (cancelled) return;
        setRollup(data);
        if (data.rows.length > 0 && !selectedSlug) {
          setSelectedSlug(data.rows[0].slug);  // auto-pick worst-first
        }
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || "Failed to load coaching."))
      .finally(() => !cancelled && setLoadingRollup(false));
    return () => { cancelled = true; };
  }, []);  // run once on mount; selectedSlug handled internally

  if (error) {
    return (
      <div className="p-6 border border-line bg-paper text-ink-muted text-sm font-mono" data-testid="coach-error">
        {error}
      </div>
    );
  }
  if (loadingRollup) {
    return (
      <div className="p-12 flex items-center justify-center text-ink-muted" data-testid="coach-loading">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading your coaching plan…
      </div>
    );
  }
  if (!rollup || rollup.count === 0) {
    return (
      <div className="p-12 border border-dashed border-line text-ink-muted text-sm" data-testid="coach-empty">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-brand mb-3">◆ COMPASS COACH</p>
        <p className="text-base">No listings yet. Create your first listing and Compass will start coaching you toward your first sale.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="coach-tab">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-brand font-mono text-[10px] uppercase tracking-[0.3em]">
          <Compass size={12} />
          <span>Compass Coach · {rollup.algorithm}@{rollup.version}</span>
        </div>
        <h1 className="font-display text-4xl uppercase leading-none">
          What to do next
        </h1>
        <p className="text-ink-muted text-sm font-mono">
          Listings ranked worst-first. The lower the score, the bigger the opportunity.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        <ListingRollup
          rows={rollup.rows}
          selectedSlug={selectedSlug}
          onSelect={setSelectedSlug}
        />
        {selectedSlug ? (
          <ListingCoachingPanel slug={selectedSlug} maker={maker} />
        ) : (
          <div className="p-8 border border-dashed border-line text-ink-muted text-sm">
            Select a listing on the left to see its coaching plan.
          </div>
        )}
      </div>
    </div>
  );
}

function ListingRollup({ rows, selectedSlug, onSelect }) {
  return (
    <aside className="border border-line bg-paper" data-testid="coach-rollup">
      <div className="px-4 py-3 border-b border-line">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          Your listings · {rows.length}
        </div>
      </div>
      <ul className="divide-y divide-line max-h-[600px] overflow-y-auto">
        {rows.map((row) => {
          const active = row.slug === selectedSlug;
          return (
            <li key={row.slug}>
              <button
                onClick={() => onSelect(row.slug)}
                data-testid={`coach-rollup-row-${row.slug}`}
                className={`w-full text-left p-4 transition flex flex-col gap-1.5 ${
                  active ? "bg-brand/10 border-l-2 border-brand" : "hover:bg-brand/5 border-l-2 border-transparent"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-sm truncate" title={row.title}>{row.title || row.slug}</span>
                  <span className="font-mono text-xs text-ink-muted shrink-0">
                    <ScorePill score={row.score} max={row.max_score} />
                  </span>
                </div>
                <OpportunityStars opportunity={row.sales_opportunity} />
                {row.next_action_label && (
                  <div className="font-mono text-[10px] text-ink-muted truncate">
                    Next: <span className="text-brand">+{row.next_action_points} pts</span> · {row.next_action_label}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function ScorePill({ score, max }) {
  const pct = max ? (score / max) * 100 : 0;
  const color = pct >= 80 ? "text-emerald-500" : pct >= 50 ? "text-brand" : "text-red-500";
  return <span className={color}>{Math.round(score)}/{Math.round(max)}</span>;
}

function OpportunityStars({ opportunity }) {
  if (!opportunity) return null;
  const stars = opportunity.stars || 0;
  return (
    <div className="flex items-center gap-1.5" title={`Sales opportunity: ${opportunity.label}`}>
      <span className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            size={10}
            fill={n <= stars ? "currentColor" : "none"}
            className={n <= stars ? "text-brand" : "text-ink-muted/40"}
          />
        ))}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
        {opportunity.label}
      </span>
    </div>
  );
}

function ListingCoachingPanel({ slug, maker }) {
  const [plan, setPlan] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchListingCoaching(slug),
      fetchListingCoachingTimeline(slug, 10).catch(() => ({ entries: [] })),
    ])
      .then(([p, t]) => {
        if (cancelled) return;
        setPlan(p);
        setTimeline(t);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [slug]);

  // useMemo MUST run on every render — keep it BEFORE the early return.
  const visibleActions = useMemo(
    () => (plan && showAll ? plan.actions : (plan?.actions || []).slice(0, 4)),
    [plan, showAll]
  );

  if (loading || !plan) {
    return (
      <div className="p-12 border border-line bg-paper flex items-center justify-center text-ink-muted">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading coaching plan…
      </div>
    );
  }

  const next = plan.next_action;

  return (
    <section className="space-y-6" data-testid="coach-panel">
      {/* Hero: score + opportunity + summary */}
      <div className="border border-line bg-paper p-6 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand">
            Quality Score · {plan.algorithm}@{plan.version}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-7xl leading-none" data-testid="coach-hero-score">
              {Math.round(plan.score)}
            </span>
            <span className="font-mono text-2xl text-ink-muted">/ {Math.round(plan.max_score)}</span>
          </div>
          <p className="text-sm font-mono text-ink" data-testid="coach-hero-summary">
            {plan.summary}
          </p>
        </div>
        <div className="border-l-0 md:border-l border-line md:pl-6 space-y-2 min-w-[180px]">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Sales Opportunity
          </div>
          <OpportunityStars opportunity={plan.sales_opportunity} />
          <p className="font-display text-2xl uppercase leading-none">
            {plan.sales_opportunity?.label || "—"}
          </p>
          <p className="font-mono text-[10px] text-ink-muted">
            +{Math.round(plan.gap)} pts available
          </p>
        </div>
      </div>

      {/* Biggest next win */}
      {next && (
        <div className="border-2 border-brand bg-paper p-6 space-y-3" data-testid="coach-next-action">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand">
            ◆ Biggest next win
          </div>
          <h2 className="font-display text-3xl leading-tight">
            {next.recommendation}
          </h2>
          <div className="flex items-center gap-4 text-sm font-mono">
            <span className="text-brand font-bold">+{Math.round(next.points_gain)} points</span>
            <ImpactPill impact={next.estimated_impact} />
            <EffortPill effort={next.effort} />
          </div>
          {next.edit_link && (
            <a
              href={next.edit_link}
              data-testid="coach-next-action-cta"
              className="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-brand text-paper font-mono text-xs uppercase tracking-[0.22em] hover:opacity-90 transition"
            >
              Fix it now <ArrowRight size={14} />
            </a>
          )}
        </div>
      )}

      {/* Ranked actions */}
      {plan.actions.length > 0 && (
        <div className="border border-line bg-paper" data-testid="coach-action-list">
          <div className="px-5 py-3 border-b border-line flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Action plan · {plan.actions.length} ranked
            </span>
            {plan.actions.length > 4 && (
              <button
                onClick={() => setShowAll((s) => !s)}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand hover:underline"
                data-testid="coach-show-all-toggle"
              >
                {showAll ? "Show less" : `Show all ${plan.actions.length}`}
              </button>
            )}
          </div>
          <ol className="divide-y divide-line">
            {visibleActions.map((a, idx) => (
              <li key={a.rule_id} className="p-4 grid grid-cols-[auto_1fr_auto] gap-4 items-center"
                  data-testid={`coach-action-${a.rule_id}`}>
                <span className="font-display text-2xl text-ink-muted w-8 tabular-nums">
                  {idx + 1}
                </span>
                <div className="space-y-1 min-w-0">
                  <div className="font-display text-base">{a.label}</div>
                  <div className="text-sm text-ink-muted">{a.recommendation}</div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-brand font-mono text-xs font-bold">+{Math.round(a.points_gain)} pts</span>
                    <ImpactPill impact={a.estimated_impact} />
                    <EffortPill effort={a.effort} />
                  </div>
                </div>
                {a.edit_link && (
                  <a
                    href={a.edit_link}
                    data-testid={`coach-action-link-${a.rule_id}`}
                    className="px-3 py-1.5 border border-brand text-brand hover:bg-brand hover:text-paper font-mono text-[10px] uppercase tracking-[0.22em] transition inline-flex items-center gap-1 shrink-0"
                  >
                    Fix <ExternalLink size={10} />
                  </a>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Progress Timeline */}
      <ProgressTimeline timeline={timeline} />
    </section>
  );
}

function ImpactPill({ impact }) {
  if (!impact) return null;
  const colors = {
    high:   "border-red-500 text-red-500",
    medium: "border-brand text-brand",
    low:    "border-line text-ink-muted",
  };
  return (
    <span className={`px-1.5 py-0.5 border font-mono text-[9px] uppercase tracking-[0.18em] ${colors[impact] || colors.low}`}>
      {impact} impact
    </span>
  );
}

function EffortPill({ effort }) {
  if (!effort) return null;
  const colors = {
    low:    "border-emerald-500 text-emerald-500",
    medium: "border-ink-muted text-ink-muted",
    high:   "border-line text-ink-muted/60",
  };
  return (
    <span className={`px-1.5 py-0.5 border font-mono text-[9px] uppercase tracking-[0.18em] ${colors[effort] || colors.medium}`}>
      {effort} effort
    </span>
  );
}

function ProgressTimeline({ timeline }) {
  if (!timeline || !timeline.entries || timeline.entries.length < 2) {
    return null; // Don't render until there's actual history
  }
  return (
    <div className="border border-line bg-paper" data-testid="coach-timeline">
      <div className="px-5 py-3 border-b border-line">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted flex items-center gap-2">
          <TrendingUp size={12} />
          Progress timeline
        </div>
      </div>
      <ol className="divide-y divide-line">
        {timeline.entries.slice(0, 6).map((e, idx) => {
          const ts = new Date(e.taken_at).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
          });
          const delta = e.score_delta;
          return (
            <li key={e.taken_at} className="p-4 flex items-start gap-4" data-testid={`coach-timeline-entry-${idx}`}>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted w-32 shrink-0">
                {ts}
              </div>
              <div className="flex-1 space-y-1">
                <div className="font-mono text-sm">
                  Score: <span className="text-brand">{Math.round(e.score)}</span>
                  {delta != null && delta !== 0 && (
                    <span className={`ml-2 text-xs ${delta > 0 ? "text-emerald-500" : "text-red-500"}`}>
                      ({delta > 0 ? "+" : ""}{Math.round(delta)})
                    </span>
                  )}
                </div>
                {e.deltas && e.deltas.length > 0 && (
                  <ul className="text-xs text-ink-muted space-y-0.5">
                    {e.deltas.slice(0, 4).map((d) => (
                      <li key={d.rule_id}>
                        · {d.label}{" "}
                        <span className={d.delta > 0 ? "text-emerald-500" : "text-red-500"}>
                          ({d.delta > 0 ? "+" : ""}{Math.round(d.delta)})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
