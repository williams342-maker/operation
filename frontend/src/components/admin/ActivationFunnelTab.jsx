import React, { useEffect, useMemo, useState } from "react";
import { http } from "../../lib/api";

// iter413dh-evidence — Founder Activation Funnel (read-only admin report).
//
// Single tab that consumes GET /api/admin/activation-funnel and renders:
//   1. The 8-stage activation funnel (Approved → … → First Sale).
//   2. Time-to-First-Listing (TTFL) distribution.
//   3. Early-promotion trigger status (welcome delivered, no login, ≥14d idle).
//   4. Top-5 stalled / dormant founders (sortable: days since approval).
//
// This is evidence-only for Phase D. No writes, no mutations, no founder-
// facing surface. We just unpack the JSON payload the backend already
// computes and lay it out in Aged-Canvas semantic tokens.

const STAGE_LABELS = {
  approved: "Approved",
  welcome_delivered: "Welcome delivered",
  first_login: "First login",
  profile_completed: "Profile completed",
  first_listing_created: "First listing created",
  first_listing_published: "First listing published",
  first_buyer_inquiry: "First buyer inquiry",
  first_sale: "First sale",
};
const STAGE_ORDER = [
  "approved",
  "welcome_delivered",
  "first_login",
  "profile_completed",
  "first_listing_created",
  "first_listing_published",
  "first_buyer_inquiry",
  "first_sale",
];

const COHORTS = [
  { id: "founder", label: "Founders" },
  { id: "all_approved", label: "All approved" },
];

const STATUS_TONE = {
  active: "text-emerald-700",
  drafting: "text-brand",
  onboarding: "text-ink",
  new: "text-ink-muted",
  stalled: "text-amber-600",
  dormant: "text-red-500",
};

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return String(iso).slice(0, 10);
  }
}

export default function ActivationFunnelTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [cohort, setCohort] = useState("founder");

  const load = async (c = cohort) => {
    setBusy(true);
    setErr("");
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      const r = await http.get(
        `/admin/activation-funnel?tier=${c}&include_rows=true`,
        { headers: { Authorization: `Bearer ${tok}` } },
      );
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Load failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load(cohort);
  }, [cohort]);

  const stalledRows = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows
      .filter((r) => r.activation_status === "stalled" || r.activation_status === "dormant")
      .sort((a, b) => (b.days_since_approval || 0) - (a.days_since_approval || 0))
      .slice(0, 5);
  }, [data]);

  return (
    <div className="space-y-6" data-testid="activation-funnel-tab">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
            ◆ Phase D · evidence
          </div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">Activation Funnel</h2>
          <p className="font-mono text-xs text-ink-muted mt-2 max-w-2xl">
            Read-only Phase-D dashboard. Where do approved founders actually stall on the way to
            their first published listing and first sale? No reminders are sent from this tab — it
            exists to gather the evidence that determines whether a magic-link nudge is worth
            building.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {COHORTS.map((c) => (
            <button
              key={c.id}
              onClick={() => setCohort(c.id)}
              data-testid={`activation-cohort-${c.id}`}
              className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                cohort === c.id
                  ? "border-brand text-brand bg-brand/5"
                  : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"
              }`}
            >
              {c.label}
            </button>
          ))}
          <button
            onClick={() => load(cohort)}
            disabled={busy}
            data-testid="activation-refresh"
            className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {err && (
        <div className="font-mono text-xs text-red-400 py-6" data-testid="activation-error">
          {err}
        </div>
      )}
      {!data && busy && (
        <div className="font-mono text-xs text-ink-muted py-6">Loading…</div>
      )}

      {data && (
        <>
          <BuildStrip build={data.build} generatedAt={data.generated_at} />
          <FunnelStages funnel={data.funnel} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TtflCard ttfl={data.ttfl} />
            <TriggerCard trigger={data.early_promotion_trigger} />
          </div>
          <StalledTable rows={stalledRows} totalRows={data.rows?.length || 0} />
          <div
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted pt-2"
            data-testid="activation-generated-at"
          >
            Generated at {data.generated_at}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Build provenance strip ─────────────────────────────────────────
// iter413dh-evidence · 2026-06-28 — gives every screenshot a traceable
// code baseline so observations made during multi-week Phase D
// validation can be tied back to the exact pod build that produced
// them. All five fields come straight from the backend response.
function BuildStrip({ build, generatedAt }) {
  if (!build) return null;
  const previewLabel = (() => {
    if (!build.preview_host || build.preview_host === "unknown") return "unknown";
    try {
      return new URL(build.preview_host).host;
    } catch {
      return build.preview_host;
    }
  })();
  return (
    <section
      className="border border-line bg-surface/30 px-4 md:px-5 py-3"
      data-testid="activation-build-strip"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
        ◆ Build provenance
      </div>
      <dl className="grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-2 font-mono text-[10px]">
        <div>
          <dt className="uppercase tracking-[0.18em] text-ink-muted">Git SHA</dt>
          <dd
            className="text-brand"
            title={build.git_full_sha || ""}
            data-testid="activation-build-sha"
          >
            {build.git_short_sha || "unknown"}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-[0.18em] text-ink-muted">Commit</dt>
          <dd
            className="text-ink truncate"
            title={build.commit_subject || ""}
            data-testid="activation-build-commit"
          >
            {build.commit_iso ? build.commit_iso.slice(0, 19).replace("T", " ") : "—"}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-[0.18em] text-ink-muted">Backend started</dt>
          <dd className="text-ink" data-testid="activation-build-backend-started">
            {build.backend_started_at
              ? build.backend_started_at.slice(0, 19).replace("T", " ")
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-[0.18em] text-ink-muted">Preview deploy</dt>
          <dd
            className="text-ink truncate"
            title={build.preview_host || ""}
            data-testid="activation-build-preview"
          >
            {previewLabel}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-[0.18em] text-ink-muted">Data generated</dt>
          <dd className="text-ink" data-testid="activation-build-generated-at">
            {generatedAt ? generatedAt.slice(0, 19).replace("T", " ") : "—"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ─── Funnel stages ──────────────────────────────────────────────────
function FunnelStages({ funnel }) {
  const approvedCount = funnel?.approved?.count || 0;
  const stages = STAGE_ORDER.map((k) => ({
    key: k,
    label: STAGE_LABELS[k],
    count: funnel?.[k]?.count ?? 0,
    pct: funnel?.[k]?.pct ?? 0,
  }));
  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <section className="border border-line p-4 md:p-5" data-testid="activation-funnel-stages">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-4">
        ◆ 8-stage activation funnel · % of approved cohort
      </div>
      {approvedCount === 0 && (
        <div
          className="font-mono text-xs text-ink-muted py-4"
          data-testid="activation-empty-cohort"
        >
          No approved makers in this cohort yet.
        </div>
      )}
      <div className="space-y-3">
        {stages.map((s, i) => {
          const widthPct = max ? Math.max(2, Math.round((s.count / max) * 100)) : 0;
          const dropFromPrev =
            i > 0 && stages[i - 1].count > 0
              ? Math.round((s.count / stages[i - 1].count) * 100)
              : null;
          return (
            <div key={s.key} data-testid={`activation-stage-${s.key}`}>
              <div className="grid grid-cols-12 gap-3 items-center">
                <div className="col-span-4 md:col-span-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                    Stage {i + 1}
                  </div>
                  <div className="font-display text-base md:text-lg text-ink">{s.label}</div>
                </div>
                <div className="col-span-6 md:col-span-7 relative">
                  <div className="h-9 border border-line bg-paper relative overflow-hidden">
                    <div className="h-full bg-brand/30" style={{ width: `${widthPct}%` }} />
                    <div className="absolute inset-0 flex items-center px-3">
                      <span
                        className="font-display text-xl md:text-2xl text-ink"
                        data-testid={`activation-stage-${s.key}-count`}
                      >
                        {s.count.toLocaleString()}
                      </span>
                      <span
                        className="ml-2 font-mono text-[10px] text-ink-muted"
                        data-testid={`activation-stage-${s.key}-pct`}
                      >
                        {s.pct}% of approved
                      </span>
                    </div>
                  </div>
                </div>
                <div className="col-span-2 text-right">
                  {dropFromPrev !== null ? (
                    <>
                      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                        vs prev
                      </div>
                      <div
                        className={`font-mono text-[11px] ${
                          dropFromPrev >= 70
                            ? "text-emerald-700"
                            : dropFromPrev >= 40
                              ? "text-brand"
                              : "text-red-500"
                        }`}
                        data-testid={`activation-stage-${s.key}-conv`}
                      >
                        {dropFromPrev}%
                      </div>
                    </>
                  ) : (
                    <div className="font-mono text-[10px] text-ink-muted">—</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── TTFL stats card ────────────────────────────────────────────────
function TtflCard({ ttfl }) {
  const has = (ttfl?.count_with_listing || 0) > 0;
  return (
    <section className="border border-line p-4 md:p-5" data-testid="activation-ttfl-card">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
        ◆ Time to first listing (TTFL)
      </div>
      {!has ? (
        <div
          className="font-mono text-xs text-ink-muted py-3"
          data-testid="activation-ttfl-empty"
        >
          No founders have published their first listing yet in this cohort.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
              p25
            </div>
            <div
              className="font-display text-2xl text-ink"
              data-testid="activation-ttfl-p25"
            >
              {ttfl.p25_days}
              <span className="font-mono text-xs text-ink-muted ml-1">d</span>
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
              Median
            </div>
            <div
              className="font-display text-2xl text-brand"
              data-testid="activation-ttfl-median"
            >
              {ttfl.median_days}
              <span className="font-mono text-xs text-ink-muted ml-1">d</span>
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
              p75
            </div>
            <div
              className="font-display text-2xl text-ink"
              data-testid="activation-ttfl-p75"
            >
              {ttfl.p75_days}
              <span className="font-mono text-xs text-ink-muted ml-1">d</span>
            </div>
          </div>
        </div>
      )}
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-3">
        From approved → first published listing · n=
        <span data-testid="activation-ttfl-n">{ttfl?.count_with_listing ?? 0}</span>
      </div>
    </section>
  );
}

// ─── Early-promotion trigger card ───────────────────────────────────
function TriggerCard({ trigger }) {
  if (!trigger) return null;
  const active = !!trigger.active;
  const tone = active
    ? { border: "border-amber-500/60", bg: "bg-amber-500/10", text: "text-brand" }
    : { border: "border-line", bg: "", text: "text-ink-muted" };
  return (
    <section
      className={`border ${tone.border} ${tone.bg} p-4 md:p-5`}
      data-testid="activation-trigger-card"
    >
      <div className={`font-mono text-[10px] uppercase tracking-[0.22em] ${tone.text}`}>
        ◆ Early-promotion trigger {active ? "· active" : "· standby"}
      </div>
      <div className="font-display text-base md:text-lg text-ink mt-2">
        {trigger.matching_count} founder
        {trigger.matching_count === 1 ? "" : "s"} match the stall pattern
      </div>
      <p className="font-mono text-[11px] text-ink-muted mt-2">{trigger.condition}</p>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-3">
        Fires at <span className="text-ink">{trigger.fires_at}</span> ·
        currently{" "}
        <span
          className={active ? "text-brand" : "text-ink"}
          data-testid="activation-trigger-state"
        >
          {active ? "ACTIVE" : "below threshold"}
        </span>
      </div>
    </section>
  );
}

// ─── Top stalled founders ───────────────────────────────────────────
function StalledTable({ rows, totalRows }) {
  return (
    <section className="border border-line" data-testid="activation-stalled-table">
      <div className="px-4 md:px-5 py-3 border-b border-line flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          ◆ Top {rows.length} stalled · sorted by days since approval
        </div>
        <div className="font-mono text-[10px] text-ink-muted">
          {totalRows} total in cohort
        </div>
      </div>
      {rows.length === 0 ? (
        <div
          className="px-4 md:px-5 py-6 font-mono text-xs text-emerald-700"
          data-testid="activation-stalled-empty"
        >
          ✓ No founders currently classified as stalled or dormant in this cohort.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line">
                {["Founder", "Status", "Days idle", "Welcome", "First login", "Profile", "First listing", "Published"].map((h) => (
                  <th
                    key={h}
                    className="px-3 md:px-4 py-2 font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.slug}
                  className="border-b border-line/60 last:border-b-0"
                  data-testid={`activation-stalled-row-${r.slug}`}
                >
                  <td className="px-3 md:px-4 py-2 align-top">
                    <div className="font-display text-base text-ink">
                      {r.name || r.slug}
                    </div>
                    <div className="font-mono text-[10px] text-ink-muted">
                      /{r.slug}
                      {r.founder_number ? ` · #${r.founder_number}` : ""}
                    </div>
                    {r.email && (
                      <div className="font-mono text-[10px] text-ink-muted">
                        <a href={`mailto:${r.email}`} className="hover:text-brand">
                          {r.email}
                        </a>
                      </div>
                    )}
                  </td>
                  <td className="px-3 md:px-4 py-2 align-top">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.22em] ${
                        STATUS_TONE[r.activation_status] || "text-ink-muted"
                      }`}
                      data-testid={`activation-stalled-row-${r.slug}-status`}
                    >
                      {r.activation_status}
                    </span>
                  </td>
                  <td
                    className="px-3 md:px-4 py-2 align-top font-mono text-[11px] text-ink whitespace-nowrap"
                    data-testid={`activation-stalled-row-${r.slug}-days`}
                  >
                    {r.days_since_approval} d
                  </td>
                  <td className="px-3 md:px-4 py-2 align-top font-mono text-[11px] text-ink-muted whitespace-nowrap">
                    {fmtDate(r.welcome_delivered_at)}
                  </td>
                  <td className="px-3 md:px-4 py-2 align-top font-mono text-[11px] text-ink-muted whitespace-nowrap">
                    {fmtDate(r.first_login_at)}
                  </td>
                  <td className="px-3 md:px-4 py-2 align-top font-mono text-[11px] text-ink-muted whitespace-nowrap">
                    {r.profile_completed ? "✓" : "—"}
                  </td>
                  <td className="px-3 md:px-4 py-2 align-top font-mono text-[11px] text-ink-muted whitespace-nowrap">
                    {fmtDate(r.first_listing_created_at)}
                  </td>
                  <td className="px-3 md:px-4 py-2 align-top font-mono text-[11px] text-ink-muted whitespace-nowrap">
                    {fmtDate(r.first_listing_published_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
