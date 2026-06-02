/**
 * iter316 — Admin tab: Lead Magnet Inbox + Drip Monitor.
 *
 * Surfaces every subscriber from `db.lead_magnet_subscribers` (populated
 * by `/api/lead-magnet/starter-pack/subscribe` on the public landing
 * page) plus the funnel state of the 3-touch nurture drip sequence
 * defined in `backend/lead_magnet_drip.py`.
 *
 * Three sections:
 *   1. Stats strip — total / new in 7d / new in 30d / consented audience.
 *   2. Drip funnel card — per-step counts + Run-now (dry-run by default).
 *   3. Subscriber table — latest 200 signups, click-to-load-more,
 *      "Export full CSV" button for offline CRM import.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchAdminLeadMagnetSummary,
  fetchAdminLeadMagnetSubscribers,
  downloadAdminLeadMagnetCsv,
  adminLeadMagnetDripRun,
} from "../../lib/api";

export default function LeadMagnetTab() {
  const [summary, setSummary] = useState(null);
  const [subs, setSubs] = useState({ subscribers: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [dripBusy, setDripBusy] = useState(false);
  const [dripResult, setDripResult] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const [s, list] = await Promise.all([
        fetchAdminLeadMagnetSummary(),
        fetchAdminLeadMagnetSubscribers(200, 0),
      ]);
      setSummary(s);
      setSubs(list);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load lead-magnet data.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const runDrip = async (dryRun) => {
    setDripBusy(true);
    try {
      const r = await adminLeadMagnetDripRun(dryRun);
      setDripResult({ ...r, _ran: new Date().toISOString() });
      toast.success(
        dryRun
          ? `Dry run · ${r.step1.candidates + r.step2.candidates} candidate${r.step1.candidates + r.step2.candidates === 1 ? "" : "s"}`
          : `Drip sent · ${r.step1.sent + r.step2.sent} email${r.step1.sent + r.step2.sent === 1 ? "" : "s"}`,
      );
      if (!dryRun) await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Drip tick failed.");
    } finally {
      setDripBusy(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadAdminLeadMagnetCsv();
      toast.success("CSV downloaded.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div data-testid="lead-magnet-tab-loading" className="font-mono text-xs text-[#a3a3a3] py-8">
        Loading lead-magnet inbox…
      </div>
    );
  }
  if (err) {
    return (
      <div data-testid="lead-magnet-tab-err" className="font-mono text-xs text-red-400 py-8">
        {err}
      </div>
    );
  }

  return (
    <div data-testid="lead-magnet-tab" className="space-y-8">
      {/* ── Section 1: Stats strip ── */}
      <section className="space-y-3" data-testid="lead-magnet-stats">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <h2 className="font-display text-2xl uppercase tracking-[0.04em]">
            Free CNC Starter Pack · Inbox
          </h2>
          <div className="flex gap-2">
            <button
              onClick={load}
              className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition"
              data-testid="lead-magnet-refresh"
            >
              ↻ Refresh
            </button>
            <button
              onClick={exportCsv}
              disabled={exporting}
              className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition disabled:opacity-50"
              data-testid="lead-magnet-export-csv"
            >
              {exporting ? "Exporting…" : "↓ Export CSV"}
            </button>
          </div>
        </div>
        <p className="font-mono text-xs text-[#a3a3a3] max-w-2xl leading-relaxed">
          Captures the email address of every visitor who downloads the free CNC starter pack at
          <span className="text-[#e5e5e5]"> /free-svg-pack</span>. Use the CSV export to import into Kit.com / Mailchimp,
          or run the built-in 3-touch drip below to email opted-in subscribers automatically.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <Stat label="Total" value={summary.total} testid="stat-total" />
          <Stat label="New · 7d" value={summary.new_7d} accent="emerald" testid="stat-7d" />
          <Stat label="New · 30d" value={summary.new_30d} testid="stat-30d" />
          <Stat label="Consented" value={summary.consented_to_marketing} accent="cyan" testid="stat-consented" />
        </div>
        {(summary.top_sources || []).length > 0 && (
          <div className="mt-3" data-testid="lead-magnet-sources">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">◆ Top sources</div>
            <div className="flex flex-wrap gap-2">
              {summary.top_sources.map((s) => (
                <span key={s.source} className="px-2 py-1 border border-[#262626] font-mono text-[10px] text-[#e5e5e5]">
                  {s.source} <span className="text-[#525252]">· {s.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Section 2: Drip funnel ── */}
      <section
        className="border border-cyan-900/40 bg-cyan-500/[0.02] p-5 space-y-4"
        data-testid="lead-magnet-drip-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-400">
              ◆ Drip · 3-touch nurture sequence
            </div>
            <h3 className="font-display text-lg uppercase mt-1">Day 0 → Day 3 → Day 7</h3>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => runDrip(true)}
              disabled={dripBusy}
              className="px-3 py-1.5 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid="lead-magnet-drip-dryrun"
            >
              {dripBusy ? "Running…" : "Dry run"}
            </button>
            <button
              onClick={() => {
                if (window.confirm("This will actually send drip emails to eligible subscribers. Continue?")) {
                  runDrip(false);
                }
              }}
              disabled={dripBusy}
              className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid="lead-magnet-drip-send"
            >
              {dripBusy ? "Sending…" : "Send now ↗"}
            </button>
          </div>
        </div>
        <p className="font-mono text-[11px] text-[#a3a3a3] leading-relaxed max-w-3xl">
          Cron runs daily at <span className="text-[#e5e5e5]">14:30 UTC</span>. Only sends to subscribers with
          <span className="text-cyan-300"> consent_marketing=true</span>. Skips subscribers whose email already matches an approved maker or a pending application.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Eligible audience" value={summary.drip?.eligible_audience ?? 0} accent="cyan" testid="drip-eligible" />
          <Stat label="Step 0 only" value={summary.drip?.step_0_only ?? 0} testid="drip-step0" />
          <Stat label="Day-3 sent" value={summary.drip?.step_1_day3_sent ?? 0} accent="emerald" testid="drip-step1" />
          <Stat label="Day-7 sent" value={summary.drip?.step_2_day7_sent ?? 0} accent="emerald" testid="drip-step2" />
        </div>
        {summary.drip?.suppressed > 0 && (
          <p className="font-mono text-[10px] text-amber-400" data-testid="drip-suppressed">
            ⚠ {summary.drip.suppressed} subscriber{summary.drip.suppressed === 1 ? "" : "s"} suppressed (became a maker or unsubscribed).
          </p>
        )}
        {summary.drip?.last_tick_at?.last_run_at && (
          <p className="font-mono text-[10px] text-[#525252]" data-testid="drip-last-run">
            Last automatic tick · {new Date(summary.drip.last_tick_at.last_run_at).toLocaleString()}
          </p>
        )}
        {dripResult && (
          <pre
            className="mt-2 border border-cyan-900/40 bg-[#0a0a0a] p-3 font-mono text-[10px] text-[#a3a3a3] overflow-x-auto"
            data-testid="drip-result"
          >
{JSON.stringify({ step1: dripResult.step1, step2: dripResult.step2, dry_run: dripResult.dry_run }, null, 2)}
          </pre>
        )}
      </section>

      {/* ── Section 3: Subscriber table ── */}
      <section data-testid="lead-magnet-subscribers">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-lg uppercase">Subscribers · latest {subs.subscribers.length} of {subs.total}</h3>
        </div>
        <div className="border border-[#262626] overflow-x-auto">
          <table className="w-full font-mono text-[11px]">
            <thead className="bg-[#0d0d0d] text-[#a3a3a3] uppercase tracking-[0.18em] text-[10px]">
              <tr>
                <th className="text-left px-3 py-2.5">Email</th>
                <th className="text-left px-3 py-2.5">When</th>
                <th className="text-left px-3 py-2.5">Source</th>
                <th className="text-left px-3 py-2.5">Consent</th>
                <th className="text-right px-3 py-2.5">Drip</th>
                <th className="text-right px-3 py-2.5">Downloads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1a1a]">
              {subs.subscribers.map((s) => (
                <tr key={s.email} className="hover:bg-[#0d0d0d] transition" data-testid={`lead-magnet-row-${s.email}`}>
                  <td className="px-3 py-2.5 text-[#fafafa]">{s.email}</td>
                  <td className="px-3 py-2.5 text-[#a3a3a3]">{s.first_seen_at ? new Date(s.first_seen_at).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2.5 text-[#a3a3a3]">
                    {s.source || "direct"}
                    {s.campaign && <span className="text-[#525252]"> · {s.campaign}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {s.consent_marketing
                      ? <span className="text-emerald-400">✓ yes</span>
                      : <span className="text-[#525252]">no</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <DripStepBadge step={s.drip_step ?? 0} />
                  </td>
                  <td className="px-3 py-2.5 text-right text-[#a3a3a3]">{s.download_count ?? 0}</td>
                </tr>
              ))}
              {subs.subscribers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center font-mono text-xs text-[#525252]" data-testid="lead-magnet-empty">
                    No subscribers yet — share /free-svg-pack on socials to start the funnel.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────

function Stat({ label, value, accent, testid }) {
  const tones = {
    emerald: "text-emerald-400 border-emerald-500/30",
    cyan: "text-cyan-300 border-cyan-500/30",
    amber: "text-amber-400 border-amber-500/30",
  };
  const tone = tones[accent] || "text-[#fafafa] border-[#262626]";
  return (
    <div className={`border bg-[#0d0d0d] p-4 ${tone.split(" ")[1]}`} data-testid={testid}>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</div>
      <div className={`font-display text-3xl mt-1 ${tone.split(" ")[0]}`}>{(value ?? 0).toLocaleString()}</div>
    </div>
  );
}

function DripStepBadge({ step }) {
  if (step === -1) {
    return <span className="text-amber-400 font-mono text-[10px]">suppressed</span>;
  }
  const labels = ["Step 0", "Day 3 ✓", "Day 7 ✓"];
  const tones = ["text-[#525252]", "text-emerald-400", "text-emerald-300"];
  const s = Math.max(0, Math.min(2, step));
  return <span className={`font-mono text-[10px] ${tones[s]}`}>{labels[s]}</span>;
}
