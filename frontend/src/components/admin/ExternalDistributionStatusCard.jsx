/**
 * iter317b — External Distribution Status card.
 *
 * Surfaces readiness probes for the two parked external-distribution
 * tasks:
 *   • Cloudflare prerender Worker — is it active on craftersmarket.org?
 *   • Meta Commerce Manager       — is the CSV feed reachable + non-empty?
 *
 * Backed by `/api/admin/distribution/status` which hits the live site
 * with a Googlebot user-agent and confirms the prerender HTML marker
 * is present (vs the SPA shell), and pings the Meta CSV feed.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CF_VERDICT_LABELS = {
  active: { label: "Active", tone: "emerald" },
  not_deployed: { label: "Not deployed", tone: "amber" },
  partial: { label: "Partial (one host bound)", tone: "amber" },
  unknown: { label: "Unknown", tone: "red" },
};
const META_VERDICT_LABELS = {
  live: { label: "Feed live", tone: "emerald" },
  empty: { label: "Feed empty", tone: "amber" },
  broken: { label: "Feed broken", tone: "red" },
  unreachable: { label: "Unreachable", tone: "red" },
};

const TONE_CLASSES = {
  emerald: "border-emerald-500/30 text-emerald-300",
  amber: "border-amber-500/30 text-amber-300",
  red: "border-red-500/30 text-red-400",
};

export default function ExternalDistributionStatusCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const jwt = localStorage.getItem("cm_admin_jwt") || "";
      const r = await axios.get(`${API}/admin/distribution/status`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load distribution status.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const copyFeedUrl = async () => {
    try {
      await navigator.clipboard.writeText(data?.meta_commerce?.feed_url || "");
      toast.success("Feed URL copied.");
    } catch { /* noop */ }
  };

  if (loading) {
    return (
      <div data-testid="distribution-card-loading" className="font-mono text-xs text-ink-muted py-3">
        Probing Cloudflare Worker + Meta feed (3s timeout)…
      </div>
    );
  }
  if (err) {
    return (
      <div data-testid="distribution-card-err" className="font-mono text-xs text-red-400 py-3">
        {err}
      </div>
    );
  }
  if (!data) return null;

  const cf = data.cloudflare_worker;
  const meta = data.meta_commerce;
  const cfVerdict = CF_VERDICT_LABELS[cf.verdict] || CF_VERDICT_LABELS.unknown;
  const metaVerdict = META_VERDICT_LABELS[meta.verdict] || META_VERDICT_LABELS.unreachable;

  return (
    <section className="border border-line p-5 md:p-6 space-y-5" data-testid="distribution-status-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-400">
            ◆ External distribution · readiness
          </div>
          <h3 className="font-display text-xl uppercase mt-1">Cloudflare Worker + Meta Commerce</h3>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 border border-line hover:border-cyan-400 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-cyan-300 transition"
          data-testid="distribution-refresh"
        >
          ↻ Re-probe
        </button>
      </div>

      {/* Cloudflare Worker ─────────────────────────────────────── */}
      <div className="border border-line p-4 space-y-3" data-testid="distribution-cloudflare">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink">
              Cloudflare prerender Worker
            </span>
            <span
              className={`px-2 py-0.5 border font-mono text-[10px] uppercase tracking-[0.18em] ${TONE_CLASSES[cfVerdict.tone]}`}
              data-testid="distribution-cf-verdict"
            >
              {cfVerdict.label}
            </span>
          </div>
        </div>
        <p className="font-mono text-[11px] text-ink-muted leading-relaxed">
          Probed {cf.probes.length} URLs with Googlebot UA. Active = response contains the
          <code className="text-[#fafafa] mx-1">og-prerender</code> marker; Not deployed = SPA shell returned.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-[10px]">
            <thead className="text-ink-muted uppercase tracking-[0.18em]">
              <tr>
                <th className="text-left py-1.5">URL</th>
                <th className="text-right py-1.5">Status</th>
                <th className="text-right py-1.5">Prerender</th>
                <th className="text-right py-1.5">SPA shell</th>
                <th className="text-right py-1.5">Bytes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cf.probes.map((p) => (
                <tr key={p.url} className="hover:bg-paper transition">
                  <td className="py-1.5 text-ink truncate max-w-[320px]">{p.url}</td>
                  <td className="py-1.5 text-right text-ink-muted">{p.status || p.error || "—"}</td>
                  <td className="py-1.5 text-right">
                    {p.has_prerender_marker
                      ? <span className="text-emerald-400">✓</span>
                      : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="py-1.5 text-right">
                    {p.is_spa_shell
                      ? <span className="text-amber-400">⚠</span>
                      : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="py-1.5 text-right text-ink-muted">{p.bytes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cf.verdict !== "active" && (
          <div className="border-l-2 border-amber-500/40 pl-3 py-1.5 text-[11px] text-ink-muted font-mono space-y-1.5" data-testid="distribution-cf-runbook">
            <div className="text-amber-300">Deploy steps:</div>
            <ol className="list-decimal pl-5 leading-relaxed text-[10px]">
              <li>Cloudflare dashboard → <span className="text-ink">craftersmarket.org</span> → Workers Routes → Create</li>
              <li>Add <span className="text-ink">two</span> routes: <code className="text-[#fafafa]">craftersmarket.org/*</code> and <code className="text-[#fafafa]">www.craftersmarket.org/*</code> (NOT the wildcard subdomain — it breaks R2 image delivery)</li>
              <li>Workers → Create application → paste contents of <code className="text-[#fafafa]">/app/cloudflare/prerender-router.worker.js</code></li>
              <li>Save and deploy, then click <span className="text-cyan-300">Re-probe</span> above</li>
            </ol>
          </div>
        )}
      </div>

      {/* Meta Commerce Manager ─────────────────────────────────── */}
      <div className="border border-line p-4 space-y-3" data-testid="distribution-meta">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink">
              Meta Commerce Manager
            </span>
            <span
              className={`px-2 py-0.5 border font-mono text-[10px] uppercase tracking-[0.18em] ${TONE_CLASSES[metaVerdict.tone]}`}
              data-testid="distribution-meta-verdict"
            >
              {metaVerdict.label}
            </span>
            {meta.row_count != null && (
              <span className="font-mono text-[10px] text-ink-muted">
                {meta.row_count} row{meta.row_count === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <a
            href={meta.meta_dashboard_url}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition"
            data-testid="distribution-meta-dashboard"
          >
            Open Meta Catalog ↗
          </a>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-[10px] text-ink bg-paper border border-line px-2 py-1 truncate max-w-[420px]" data-testid="distribution-meta-feed-url">
            {meta.feed_url}
          </code>
          <button
            onClick={copyFeedUrl}
            className="px-2.5 py-1 border border-line hover:border-cyan-400 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-cyan-300 transition"
            data-testid="distribution-meta-copy"
          >
            Copy URL
          </button>
        </div>
        {meta.next_step && (
          <p className="font-mono text-[11px] text-ink-muted leading-relaxed">
            <span className="text-cyan-300">→ </span>{meta.next_step}
          </p>
        )}
      </div>

      <p className="font-mono text-[10px] text-ink-muted">
        Snapshot · {data.as_of ? new Date(data.as_of).toLocaleString() : "—"}
      </p>
    </section>
  );
}
