import React, { useEffect, useState } from "react";
import { http } from "../../lib/api";

// iter413ba — Founder Funnel Dashboard.
//
// Single-page view of the 8-stage seller-acquisition funnel:
//   Traffic → Qualified Lead → Application → Approved → Store Created
//          → First Listing → Featured Founder → First Sale
//
// All data comes from `GET /api/admin/founder-funnel?window=...`.
// This component is dumb presentation — every count, percentage, and
// warning is server-computed.

const WINDOWS = [
  { id: "7d",  label: "7d"  },
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
  { id: "all", label: "All time" },
];

export default function FounderFunnelTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [window, setWindow] = useState("30d");

  const load = async (w = window) => {
    setBusy(true); setErr("");
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      const r = await http.get(`/admin/founder-funnel?window=${w}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Load failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(window); /* eslint-disable-next-line */ }, [window]);

  return (
    <div className="space-y-6" data-testid="founder-funnel-tab">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Acquisition Funnel</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">Founder Funnel</h2>
          <p className="font-mono text-xs text-ink-muted mt-2 max-w-2xl">
            Lead → Apply → Approve → Activate → List → Feature → Sell. Adjacent-stage
            conversion percentages isolate exactly where the funnel leaks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              onClick={() => setWindow(w.id)}
              data-testid={`funnel-window-${w.id}`}
              className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                window === w.id
                  ? "border-brand text-brand bg-brand/5"
                  : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"
              }`}
            >
              {w.label}
            </button>
          ))}
          <button
            onClick={() => load(window)}
            disabled={busy}
            data-testid="funnel-refresh"
            className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {err && <div className="font-mono text-xs text-red-400 py-6">{err}</div>}
      {!data && busy && <div className="font-mono text-xs text-ink-muted py-6">Loading…</div>}

      {data && (
        <>
          <FunnelStages stages={data.stages} conversions={data.conversions} />
          <Warnings items={data.warnings} />
        </>
      )}
    </div>
  );
}

// ─── Funnel rendering ─────────────────────────────────────────────────
// Each stage is a row with a horizontal bar whose width is proportional
// to the value (against the largest stage). The adjacent-stage
// conversion sits to the right of the row that drove it.

function FunnelStages({ stages, conversions }) {
  const max = Math.max(...stages.map((s) => s.value || 0), 1);
  const convByFrom = Object.fromEntries(conversions.map((c) => [c.from, c]));

  return (
    <section className="border border-line p-4 md:p-5" data-testid="funnel-stages">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-4">
        ◆ Stages · adjacent conversion %
      </div>
      <div className="space-y-3">
        {stages.map((s, i) => {
          const pct = max ? Math.max(2, Math.round((s.value / max) * 100)) : 0;
          const drop = convByFrom[s.key]; // conversion to NEXT stage
          const next = stages[i + 1];
          return (
            <div key={s.key} data-testid={`funnel-stage-${s.key}`}>
              <div className="grid grid-cols-12 gap-3 items-center">
                <div className="col-span-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                    Stage {i}
                  </div>
                  <div className="font-display text-lg text-ink">{s.label}</div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                    {s.secondary}
                  </div>
                </div>
                <div className="col-span-7 relative">
                  <div className="h-9 border border-line bg-paper relative overflow-hidden">
                    <div
                      className="h-full bg-brand/30"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-3">
                      <span className="font-display text-2xl text-ink" data-testid={`funnel-stage-${s.key}-value`}>
                        {(s.value || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="col-span-2 text-right">
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                    source
                  </div>
                  <div className="font-mono text-[10px] text-ink-muted break-words">
                    {s.source}
                  </div>
                </div>
              </div>
              {drop && next && (
                <div className="grid grid-cols-12 gap-3 items-center py-1">
                  <div className="col-span-3" />
                  <div className="col-span-7 flex items-center gap-2 pl-1">
                    <span className="font-mono text-[10px] text-ink-muted">↓</span>
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.22em] ${
                        drop.pct >= 30 ? "text-emerald-700" :
                        drop.pct >= 10 ? "text-brand" : "text-red-500"
                      }`}
                      data-testid={`funnel-conv-${drop.from}-${drop.to}`}
                      title={
                        drop.pct > 100
                          ? "Seeded makers inflate this stage — counts include pre-existing makers that didn't go through the application flow."
                          : ""
                      }
                    >
                      {drop.pct > 100 ? ">100%" : `${drop.pct}%`} → {next.label.toLowerCase()}
                      {drop.pct > 100 && <span className="ml-1 text-ink-muted">(seeded)</span>}
                    </span>
                  </div>
                  <div className="col-span-2" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Warning cards ───────────────────────────────────────────────────
function Warnings({ items }) {
  if (!items || items.length === 0) {
    return (
      <section className="border border-line p-4" data-testid="funnel-warnings-empty">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">◆ Warnings</div>
        <div className="font-mono text-xs text-emerald-700 mt-2">
          ✓ All conversion thresholds healthy. No alerts.
        </div>
      </section>
    );
  }
  return (
    <section className="space-y-2" data-testid="funnel-warnings">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
        ◆ {items.length} warning{items.length === 1 ? "" : "s"}
      </div>
      {items.map((w) => {
        const tone = w.severity === "alert"
          ? { border: "border-red-500/50", bg: "bg-red-500/5", text: "text-red-500" }
          : { border: "border-amber-500/40", bg: "bg-amber-500/5", text: "text-brand" };
        return (
          <div
            key={w.key}
            className={`border ${tone.border} ${tone.bg} p-3`}
            data-testid={`funnel-warning-${w.key}`}
          >
            <div className={`font-mono text-[10px] uppercase tracking-[0.22em] ${tone.text}`}>
              {w.severity === "alert" ? "◆ Alert" : "◆ Warn"}
            </div>
            <div className="font-display text-base text-ink mt-1">{w.title}</div>
            <p className="font-mono text-[11px] text-ink-muted mt-1">{w.detail}</p>
            {w.examples?.length > 0 && (
              <details className="mt-2">
                <summary className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand cursor-pointer">
                  ▾ {w.examples.length} example{w.examples.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-2 space-y-1 max-h-40 overflow-auto">
                  {w.examples.map((m, i) => (
                    <li key={i} className="font-mono text-[10px] text-ink-muted border-l-2 border-line pl-2 py-0.5">
                      <span className="text-ink">{m.name || m.slug}</span>
                      {" · "}<span>/{m.slug}</span>
                      {m.email && <> · <a href={`mailto:${m.email}`} className="hover:text-brand">{m.email}</a></>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </section>
  );
}
