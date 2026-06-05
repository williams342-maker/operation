import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, RefreshCw, ExternalLink } from "lucide-react";
import { fetchAdminProdHealth, adminProdHealthCheckNow } from "../../lib/api";
import CacheStatsCard from "./CacheStatsCard";
import PricingLabelAbCard from "./PricingLabelAbCard";

/**
 * Prod health watchdog admin tab — surfaces the latest result from the
 * every-5-min cron on each critical prod endpoint, with a "Check Now"
 * button that fires an immediate probe. Alerts (with a red banner at
 * the top of the dashboard) are wired via ProdHealthBanner.
 */
export default function ProdHealthTab() {
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchAdminProdHealth();
      setSnap(data);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const checkNow = async () => {
    setChecking(true);
    try {
      await adminProdHealthCheckNow();
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Check failed.");
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return (
      <div className="font-mono text-xs text-[#525252] p-4" data-testid="prod-health-loading">
        Loading watchdog state…
      </div>
    );
  }

  if (err) {
    return (
      <div className="font-mono text-xs text-red-400 p-4" data-testid="prod-health-error">
        {err}
      </div>
    );
  }

  const endpoints = snap?.endpoints || [];
  const anyAlerted = !!snap?.any_alerted;
  const disabledNote = !snap?.enabled
    ? "Watchdog is disabled (PROD_WATCHDOG_ENABLED=false or running on prod host)."
    : null;

  return (
    <div className="space-y-6" data-testid="prod-health-tab">
      <header className="flex items-start md:items-center justify-between gap-3 flex-col md:flex-row">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
            ◆ Prod Health Watchdog
          </div>
          <h2 className="font-display text-2xl md:text-3xl uppercase leading-none mb-2">Uptime.</h2>
          <p className="font-mono text-[11px] text-[#a3a3a3] leading-relaxed max-w-2xl">
            Every 5 min we ping critical prod endpoints. After{" "}
            <b className="text-[#e5e5e5]">{snap?.threshold || 2}</b> consecutive failures we email{" "}
            <code className="text-[#ff4500]">OPS_EMAIL</code> with a one-shot outage alert, then again on recovery.
            Target:{" "}
            {snap?.target ? (
              <a
                href={snap.target}
                target="_blank"
                rel="noreferrer"
                className="text-[#ff4500] hover:underline inline-flex items-center gap-1"
                data-testid="prod-health-target"
              >
                {snap.target} <ExternalLink size={11} />
              </a>
            ) : (
              <span className="text-red-400">not configured</span>
            )}
          </p>
        </div>
        <button
          onClick={checkNow}
          disabled={checking}
          className="btn-industrial btn-primary inline-flex items-center gap-2 shrink-0 disabled:opacity-50"
          data-testid="prod-health-check-now"
        >
          <RefreshCw size={12} className={checking ? "animate-spin" : ""} />
          {checking ? "Checking…" : "Check Now"}
        </button>
      </header>

      {disabledNote && (
        <div
          className="border border-yellow-700/60 bg-yellow-900/20 px-4 py-3 font-mono text-[11px] text-yellow-300"
          data-testid="prod-health-disabled-note"
        >
          ⚠ {disabledNote}
        </div>
      )}

      {endpoints.length === 0 ? (
        <div className="border border-[#262626] bg-[#0a0a0a] px-4 py-8 text-center">
          <p className="font-mono text-[11px] text-[#525252]">
            No checks recorded yet. Click <b className="text-[#a3a3a3]">Check Now</b> to run the first probe.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2" data-testid="prod-health-grid">
          {endpoints.map((e) => (
            <EndpointCard key={e.endpoint} e={e} />
          ))}
        </div>
      )}

      {anyAlerted && (
        <div
          className="border border-red-700/60 bg-red-900/20 px-4 py-3 font-mono text-[11px] text-red-300"
          data-testid="prod-health-summary-alert"
        >
          ⚠ One or more endpoints are currently in the alerted state. The OPS inbox has already been notified.
        </div>
      )}

      {/* iter334o — Products cache stats. Lives at the bottom of Prod
          Health so ops can sanity-check cache hit rate alongside uptime. */}
      <CacheStatsCard />
      {/* iter334s — A/B status: pricing-label headline framing. */}
      <PricingLabelAbCard />
    </div>
  );
}

function EndpointCard({ e }) {
  const ok = e.last_ok;
  const alerted = e.alerted;
  const border = alerted
    ? "border-red-700/60 bg-red-900/10"
    : ok
    ? "border-emerald-700/50 bg-emerald-900/10"
    : "border-yellow-700/60 bg-yellow-900/10";
  const textColor = alerted ? "text-red-300" : ok ? "text-emerald-300" : "text-yellow-300";
  const Icon = ok ? CheckCircle2 : AlertTriangle;

  const timeAgo = (iso) => {
    if (!iso) return "—";
    const diffMs = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diffMs / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
  };

  return (
    <div
      className={`border ${border} px-4 py-3 font-mono text-[11px]`}
      data-testid={`prod-health-card-${e.endpoint}`}
      data-alerted={alerted ? "1" : "0"}
      data-ok={ok ? "1" : "0"}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={14} className={textColor} />
          <code className="text-[#e5e5e5] truncate">{e.endpoint}</code>
        </div>
        <span
          className={`px-2 py-0.5 border ${border} ${textColor} text-[10px] uppercase tracking-[0.18em] shrink-0`}
        >
          {alerted ? "Alerted" : ok ? "OK" : "Failing"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-y-1 text-[#a3a3a3]">
        <div>
          Status: <span className="text-[#e5e5e5]">{e.last_status || "—"}</span>
        </div>
        <div>
          Latency: <span className="text-[#e5e5e5]">{e.last_latency_ms || 0}ms</span>
        </div>
        <div>
          Fails: <span className="text-[#e5e5e5]">{e.consecutive_failures || 0}</span>
        </div>
        <div>
          Checked: <span className="text-[#e5e5e5]">{timeAgo(e.last_checked_at)}</span>
        </div>
      </div>
      {e.last_reason && (
        <div className="mt-2 text-red-300 text-[10px] truncate" title={e.last_reason}>
          {e.last_reason}
        </div>
      )}
    </div>
  );
}
