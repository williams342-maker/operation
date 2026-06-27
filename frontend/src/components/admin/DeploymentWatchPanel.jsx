// iter413cs — Deployment Watch Window + AI Operations Cards 2 & 6 +
// Release Timeline. Composed into a single admin panel mounted on the
// Operations Dashboard above the existing cards.
//
// Layout (top-down):
//   1. Watch Window banner — build id, elapsed/remaining, overall health
//   2. Deployment Health card (Card 6) — 4 signals vs baseline
//   3. Emerging Issues card (Card 2) — new-since-deploy clusters
//   4. Release Timeline panel — searchable history of past watches
//
// All deep-links use the contact-messages tab as the drilldown target
// (where AI-diagnosed bug rows live).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  fetchDeployWatchCurrent,
  startDeployWatch,
  closeDeployWatch,
  annotateDeployWatch,
  fetchAiEmerging,
  fetchReleaseTimeline,
} from "../../lib/api";

const HEALTH_COLOR = {
  green:   "text-emerald-700",
  yellow:  "text-amber-700",
  orange:  "text-orange-600",
  red:     "text-danger",
  unknown: "text-ink-muted",
};
const HEALTH_DOT = {
  green:   "bg-emerald-600",
  yellow:  "bg-amber-500",
  orange:  "bg-orange-500",
  red:     "bg-danger",
  unknown: "bg-ink-muted",
};
const HEALTH_LABEL = {
  green:   "Stable",
  yellow:  "Warning",
  orange:  "Elevated",
  red:     "Critical",
  unknown: "Unknown",
};

const fmtAgo = (iso) => {
  if (!iso) return "—";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
    return `${Math.floor(ms / 86_400_000)}d`;
  } catch { return "—"; }
};

const fmtRemaining = (expiresIso) => {
  if (!expiresIso) return "—";
  const ms = new Date(expiresIso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
};

export default function DeploymentWatchPanel({ onJumpToTab }) {
  const [current, setCurrent] = useState(null);
  const [emerging, setEmerging] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  // Per-watch annotation editor state (keyed by watch_id).
  const [editing, setEditing] = useState(null); // {watch_id, features, notes}

  const load = async () => {
    setBusy(true);
    try {
      const [cur, emg, tl] = await Promise.all([
        fetchDeployWatchCurrent().catch(() => null),
        fetchAiEmerging(12).catch(() => null),
        fetchReleaseTimeline("", 25).catch(() => null),
      ]);
      setCurrent(cur);
      setEmerging(emg);
      setTimeline(tl);
    } finally { setBusy(false); }
  };

  useEffect(() => { load(); }, []);

  const runSearch = async (q) => {
    setSearch(q);
    try {
      const r = await fetchReleaseTimeline(q, 25);
      setTimeline(r);
    } catch { toast.error("Search failed"); }
  };

  const onManualStart = async () => {
    const build = prompt("Build identifier (e.g., iter413cs)? Leave blank to auto-detect.");
    if (build === null) return;
    try {
      await startDeployWatch(build || undefined, 48);
      toast.success("Watch window opened");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to start watch");
    }
  };

  const onCloseNow = async () => {
    if (!current?.watch?.id) return;
    if (!confirm("Close the active watch now? A release summary will be written.")) return;
    try {
      await closeDeployWatch(current.watch.id, "manual close");
      toast.success("Watch closed · summary written");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to close watch");
    }
  };

  const openAnnotate = (w) => {
    setEditing({
      watch_id: w.id,
      features: (w.features_shipped || []).join("\n"),
      notes: w.operator_notes || "",
    });
  };

  const saveAnnotate = async () => {
    if (!editing) return;
    const features = editing.features
      .split("\n").map((s) => s.trim()).filter(Boolean);
    try {
      await annotateDeployWatch(editing.watch_id, {
        features_shipped: features,
        notes: editing.notes,
      });
      toast.success("Annotated");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Annotate failed");
    }
  };

  const w = current?.watch;
  const h = current?.health;

  // Build identifier mismatch hint — if the env build differs from the
  // active watch's build_id, we missed an auto-open somewhere.
  const buildMismatch = useMemo(() => {
    if (!current?.build_id_current || !w?.build_id) return false;
    return current.build_id_current !== w.build_id;
  }, [current, w]);

  return (
    <div className="space-y-4" data-testid="deployment-watch-panel">
      {/* ── 1. Watch Window banner ────────────────────────────────── */}
      {w ? (
        <section
          className={`border-2 bg-paper p-3 md:p-4 ${
            h?.overall_health === "red" ? "border-danger" :
            h?.overall_health === "orange" ? "border-orange-500" :
            h?.overall_health === "yellow" ? "border-amber-500" :
            "border-emerald-600/60"
          }`}
          data-testid="deploy-watch-banner"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                ◆ Watching deployment
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="font-display text-2xl text-ink leading-none" data-testid="deploy-watch-build">
                  {w.build_id}
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] ${HEALTH_COLOR[h?.overall_health || "green"]}`}
                  data-testid="deploy-watch-health"
                >
                  <span className={`inline-block w-2 h-2 rounded-full ${HEALTH_DOT[h?.overall_health || "green"]}`} />
                  {HEALTH_LABEL[h?.overall_health || "green"]}
                </span>
              </div>
              <div className="font-mono text-[11px] text-ink-muted mt-1" data-testid="deploy-watch-timeline">
                Started {fmtAgo(w.started_at)} ago · {fmtRemaining(w.expires_at)}
                {w.started_by && <> · by {w.started_by}</>}
              </div>
              {buildMismatch && (
                <div className="font-mono text-[10px] text-amber-700 mt-1" data-testid="deploy-watch-build-mismatch">
                  ⚠ Env BUILD_SHA is <span className="text-ink">{current.build_id_current}</span> but watch is for <span className="text-ink">{w.build_id}</span>. Restart or start a new watch.
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={load}
                disabled={busy}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-brand border border-line px-2 py-1"
                data-testid="deploy-watch-refresh"
              >
                ↻ Refresh
              </button>
              <button
                onClick={onCloseNow}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand border border-brand hover:bg-brand hover:text-paper px-2 py-1 transition-colors"
                data-testid="deploy-watch-close"
              >
                Close & summarise
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="border border-line bg-paper p-3 md:p-4" data-testid="deploy-watch-banner-empty">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                ◆ Deployment Watch
              </div>
              <div className="font-mono text-[11px] text-ink mt-1">
                No active window. Start one to begin post-deploy monitoring.
              </div>
            </div>
            <button
              onClick={onManualStart}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand border border-brand hover:bg-brand hover:text-paper px-2 py-1 transition-colors"
              data-testid="deploy-watch-start"
            >
              Start Watch
            </button>
          </div>
        </section>
      )}

      {/* ── 2. Deployment Health (Card 6) ─────────────────────────── */}
      {h?.signals?.length > 0 && (
        <section className="border border-line bg-paper p-3 md:p-4" data-testid="deploy-health-card">
          <div className="flex items-center justify-between pb-2 border-b border-line">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              ◆ Deployment health · vs 7d baseline
            </h3>
            <span className="font-mono text-[10px] text-ink-muted">
              {h.elapsed_hours}h elapsed
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3">
            {h.signals.map((s) => (
              <div
                key={s.id}
                className="border border-line p-2"
                data-testid={`deploy-health-signal-${s.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${HEALTH_DOT[s.status]}`} />
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted truncate">
                    {s.label}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-display text-xl text-ink tabular-nums">{s.current}</span>
                  <span className="font-mono text-[10px] text-ink-muted truncate" title={s.delta_label}>
                    {s.delta_label}
                  </span>
                </div>
                <div className="font-mono text-[9px] text-ink-muted mt-0.5">
                  baseline: {s.baseline_daily_rate}/day
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 3. Emerging Issues (Card 2) ───────────────────────────── */}
      {emerging?.clusters?.length > 0 && (
        <section className="border border-line bg-paper p-3 md:p-4" data-testid="emerging-issues-card">
          <div className="flex items-center justify-between pb-2 border-b border-line">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              ◆ Emerging issues · since {emerging.anchor === "deploy_watch" ? "deploy" : "24h ago"}
            </h3>
            <span className="font-mono text-[10px] text-ink-muted">{emerging.clusters.length} new</span>
          </div>
          <ul className="divide-y divide-line">
            {emerging.clusters.map((c, i) => (
              <li
                key={c.key || i}
                className="py-2 cursor-pointer hover:bg-paper-soft"
                onClick={() => onJumpToTab?.("contact-messages")}
                data-testid={`emerging-row-${i}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-ink truncate" title={c.label}>{c.label}</div>
                    <div className="font-mono text-[10px] text-ink-muted truncate mt-0.5">
                      <span className={HEALTH_COLOR[
                        c.severity === "high" ? "red" :
                        c.severity === "medium" ? "orange" :
                        c.severity === "low" ? "yellow" : "green"
                      ]}>{c.severity}</span>
                      <span aria-hidden> · </span>
                      <span>★ new</span>
                      {c.sample_pages?.[0] && (<><span aria-hidden> · </span><span>{c.sample_pages[0]}</span></>)}
                      <span aria-hidden> · </span>
                      <span>{fmtAgo(c.last_seen)} ago</span>
                    </div>
                  </div>
                  <span className="font-display text-lg text-ink tabular-nums shrink-0">{c.count}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 4. Release Timeline ─────────────────────────────────────── */}
      <section className="border border-line bg-paper p-3 md:p-4" data-testid="release-timeline">
        <div className="flex items-center justify-between pb-2 border-b border-line gap-3 flex-wrap">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            ◆ Release timeline
          </h3>
          <input
            value={search}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Search builds, features, notes…"
            className="font-mono text-[11px] bg-surface border border-line px-2 py-1 text-ink focus:outline-none focus:border-brand w-full md:w-72"
            data-testid="release-timeline-search"
          />
        </div>
        {!timeline || timeline.rows.length === 0 ? (
          <p className="font-mono text-xs text-ink-muted py-3" data-testid="release-timeline-empty">
            No releases match this filter yet.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {timeline.rows.map((row) => {
              const health = row.summary?.health || (row.status === "active" ? (h?.overall_health || "green") : "unknown");
              return (
                <li
                  key={row.id}
                  className="py-3"
                  data-testid={`release-row-${row.build_id}`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display text-base text-ink leading-none" data-testid={`release-build-${row.build_id}`}>
                          {row.build_id}
                        </span>
                        <span className={`inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] ${HEALTH_COLOR[health]}`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${HEALTH_DOT[health]}`} />
                          {HEALTH_LABEL[health]}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                          {row.status}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-ink-muted mt-1">
                        Started {fmtAgo(row.started_at)} ago
                        {row.closed_at && <> · closed {fmtAgo(row.closed_at)} ago</>}
                        {row.started_by && <> · by {row.started_by}</>}
                      </div>
                      {row.features_shipped?.length > 0 && (
                        <ul className="mt-2 space-y-0.5" data-testid={`release-features-${row.build_id}`}>
                          {row.features_shipped.map((f, i) => (
                            <li key={i} className="font-mono text-[11px] text-ink">· {f}</li>
                          ))}
                        </ul>
                      )}
                      {row.operator_notes && (
                        <div className="font-mono text-[10px] text-ink-muted mt-1 whitespace-pre-wrap">
                          {row.operator_notes}
                        </div>
                      )}
                      {row.ai_issue_clusters?.length > 0 && (
                        <div className="mt-2">
                          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                            AI-diagnosed issues during window ({row.ai_issues_count})
                          </div>
                          <ul className="mt-1 space-y-0.5">
                            {row.ai_issue_clusters.slice(0, 3).map((c) => (
                              <li
                                key={c.key}
                                className="font-mono text-[10px] text-ink-muted truncate cursor-pointer hover:text-brand"
                                onClick={() => onJumpToTab?.("contact-messages")}
                                title={c.label}
                              >
                                · {c.label} <span className="text-ink">×{c.count}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="font-display text-lg text-ink tabular-nums">
                        {row.ai_issues_count}
                      </span>
                      <button
                        onClick={() => openAnnotate(row)}
                        className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted hover:text-brand border border-line px-2 py-0.5"
                        data-testid={`release-annotate-${row.build_id}`}
                      >
                        ◆ Edit
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Annotation modal */}
      {editing && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setEditing(null)}
          data-testid="release-annotate-modal-backdrop"
        >
          <div
            className="w-[min(96vw,560px)] bg-paper border border-line max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            data-testid="release-annotate-modal"
          >
            <div className="px-4 py-3 border-b border-line">
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand">
                Annotate release
              </div>
            </div>
            <div className="px-4 py-3 space-y-3">
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                  Features shipped (one per line)
                </span>
                <textarea
                  value={editing.features}
                  onChange={(e) => setEditing({ ...editing, features: e.target.value })}
                  rows={6}
                  className="mt-1 w-full bg-surface border border-line text-ink font-mono text-[12px] px-2 py-1.5 focus:outline-none focus:border-brand"
                  data-testid="release-annotate-features"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                  Operator notes
                </span>
                <textarea
                  value={editing.notes}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  rows={3}
                  maxLength={2000}
                  className="mt-1 w-full bg-surface border border-line text-ink font-mono text-[12px] px-2 py-1.5 focus:outline-none focus:border-brand"
                  data-testid="release-annotate-notes"
                />
              </label>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setEditing(null)}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-brand px-2 py-1"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAnnotate}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand border border-brand hover:bg-brand hover:text-paper px-3 py-1.5 transition-colors"
                  data-testid="release-annotate-save"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
