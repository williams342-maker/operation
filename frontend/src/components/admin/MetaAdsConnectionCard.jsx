import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Unplug, History } from "lucide-react";
import {
  fetchMetaAdsStatus, startMetaAdsOauth, disconnectMetaAds,
  triggerMetaAdsSync, backfillMetaAds,
} from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";

/**
 * Meta Ads OAuth + daily-sync connection card.
 *
 * Mirrors `GoogleAdsConnectionCard` exactly. Lives in the AdsTab
 * directly below the Google card so admins see both connection states
 * in a single glance.
 */
export default function MetaAdsConnectionCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [confirm, confirmModal] = useConfirm();

  const refresh = async () => {
    try {
      setStatus(await fetchMetaAdsStatus());
    } catch {
      toast.error("Could not load Meta Ads status.");
    }
  };

  useEffect(() => {
    refresh();
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("meta_ads");
    if (flag) {
      if (flag === "connected") toast.success("Meta Ads connected. Run a manual sync to backfill yesterday's metrics.");
      else if (flag === "error") toast.error(`Meta Ads connect failed: ${params.get("reason") || "unknown"}`);
      params.delete("meta_ads"); params.delete("reason");
      const newUrl = window.location.pathname +
        (params.toString() ? `?${params}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  const onConnect = async () => {
    setBusy("connect");
    try {
      const { authorization_url } = await startMetaAdsOauth();
      window.location.assign(authorization_url);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start OAuth.");
      setBusy("");
    }
  };

  const onSync = async () => {
    setBusy("sync");
    try {
      const r = await triggerMetaAdsSync();
      if (r.status === "ok") toast.success(`Synced ${r.rows} campaign rows for ${r.date}.`);
      else if (r.status === "skipped") toast.info(`Sync skipped — ${r.reason}`);
      else toast.error(`Sync error: ${r.error || "unknown"}`);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Sync failed.");
    } finally { setBusy(""); }
  };

  const onBackfill = async () => {
    const ok = await confirm({
      title: "Backfill the last 30 days?",
      body: "Walks day-by-day through Meta's Marketing API. Each day takes ~3–6s so the whole batch runs 2–4 min. Leave the tab open. Already-synced days are upserted (no duplicates).",
      confirmLabel: "Run 30-day backfill",
      tone: "info",
      testId: "confirm-meta-ads-backfill",
    });
    if (!ok) return;
    setBusy("backfill");
    const t = toast.loading("Backfilling 30 days of Meta Ads spend…", { duration: Infinity });
    try {
      const r = await backfillMetaAds(30);
      toast.dismiss(t);
      if (r.status === "ok") {
        toast.success(`Backfill complete · ${r.days_ok}/${r.days_requested} days · ${r.total_rows} campaign rows.`);
      } else {
        toast.warning(`Backfill partial · ${r.days_ok} ok · ${r.days_skipped} skipped · ${r.days_error} error · ${r.total_rows} rows.`);
      }
      await refresh();
    } catch (e) {
      toast.dismiss(t);
      toast.error(e?.response?.data?.detail || "Backfill failed. Meta's Marketing API may be throttling — retry in a few minutes.");
    } finally {
      setBusy("");
    }
  };

  const onDisconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Meta Ads?",
      body: "Daily sync stops immediately. Already-synced rows stay intact. Reconnecting later requires going through Meta's consent screen again.",
      confirmLabel: "Disconnect",
      tone: "warn",
      testId: "confirm-meta-ads-disconnect",
    });
    if (!ok) return;
    setBusy("disconnect");
    try {
      await disconnectMetaAds();
      toast.success("Meta Ads disconnected.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Disconnect failed.");
    } finally { setBusy(""); }
  };

  if (!status) {
    return (
      <div className="border border-[#262626] p-4 md:p-5" data-testid="meta-ads-card-loading">
        <p className="font-mono text-xs text-[#525252]">Loading Meta Ads status…</p>
      </div>
    );
  }

  const pill = status.connected
    ? { label: "Connected", tone: "emerald", Icon: CheckCircle2 }
    : status.config_ready
      ? { label: "Not connected", tone: "amber", Icon: AlertCircle }
      : { label: "Not configured", tone: "neutral", Icon: AlertCircle };
  const toneCls = {
    emerald: "border-emerald-700/50 text-emerald-300 bg-emerald-900/10",
    amber: "border-amber-700/50 text-amber-300 bg-amber-900/10",
    neutral: "border-[#404040] text-[#a3a3a3] bg-[#0d0d0d]",
  }[pill.tone];

  return (
    <div className="border border-[#262626] p-4 md:p-5" data-testid="meta-ads-card">
      {confirmModal}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#1877f2] mb-2">
            ◆ Meta Ads · live integration
          </div>
          <h3 className="font-display text-xl uppercase mb-1">Connect your Facebook / Instagram Ads</h3>
          <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed max-w-2xl">
            Pulls daily campaign-level spend, clicks, impressions, and purchase conversions from your Meta business account into the ad_spend ledger. Daily sync at 04:00 UTC. Read-only — we never modify your campaigns.
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] ${toneCls}`}
          data-testid="meta-ads-status-pill">
          <pill.Icon size={11} /> {pill.label}
        </span>
      </div>

      {!status.config_ready && (
        <div className="mt-4 border border-amber-900/60 bg-amber-950/20 p-3" data-testid="meta-ads-missing-env">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-amber-300 mb-2">
            ⚠ Env vars required before connecting
          </p>
          <p className="font-mono text-[11px] text-amber-100 leading-relaxed mb-2">
            Add to <code className="text-[#1877f2]">/app/backend/.env</code>:
          </p>
          <ul className="font-mono text-[10px] text-amber-200/90 space-y-0.5">
            {(status.missing_env || []).map((k) => (<li key={k}>· <code>{k}</code></li>))}
          </ul>
        </div>
      )}

      {status.config_ready && !status.connected && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={onConnect}
            disabled={busy === "connect"}
            className="px-4 py-2 border border-[#1877f2] text-[#1877f2] hover:bg-[#1877f2] hover:text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50 flex items-center gap-2"
            data-testid="meta-ads-connect-btn"
          >
            {busy === "connect" ? <Loader2 size={12} className="animate-spin" /> : null}
            Connect Meta Ads
          </button>
          <span className="font-mono text-[10px] text-[#525252]">↗ opens Facebook's consent screen</span>
        </div>
      )}

      {status.connected && (
        <div className="mt-4 grid sm:grid-cols-3 gap-3">
          <Stat label="Connected" value={fmtDate(status.connected_at)} sub={status.user_email || status.user_name || ""} />
          <Stat label="Last sync" value={fmtDate(status.last_sync_at) || "—"} sub={status.last_sync_status} />
          <Stat label="Rows · yesterday" value={String(status.rows_synced_yesterday)} sub={status.ad_account_id || "—"} />
        </div>
      )}

      {status.connected && status.last_sync_error && (
        <div className="mt-3 border border-red-900/60 bg-red-950/20 p-3 font-mono text-[10px] text-red-300" data-testid="meta-ads-last-error">
          ⚠ Last sync error: {status.last_sync_error}
        </div>
      )}

      {status.connected && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={onSync} disabled={busy === "sync"}
            className="px-3 py-2 border border-[#262626] hover:border-[#1877f2] font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
            data-testid="meta-ads-sync-btn">
            {busy === "sync" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Sync yesterday now
          </button>
          <button onClick={onBackfill} disabled={busy === "backfill"}
            className="px-3 py-2 border border-[#262626] hover:border-[#1877f2] font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
            data-testid="meta-ads-backfill-btn"
            title="Pull the last 30 days of spend into the ad_spend ledger. Takes 2–4 min.">
            {busy === "backfill" ? <Loader2 size={11} className="animate-spin" /> : <History size={11} />}
            Backfill 30 days
          </button>
          <button onClick={onDisconnect} disabled={busy === "disconnect"}
            className="px-3 py-2 border border-red-900/60 text-red-300 hover:border-red-500 hover:text-red-200 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
            data-testid="meta-ads-disconnect-btn">
            <Unplug size={11} /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="border border-[#1f1f1f] p-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">{label}</div>
      <div className="font-display text-base text-[#e5e5e5] mt-1 truncate">{value}</div>
      {sub && <div className="font-mono text-[10px] text-[#525252] mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch { return iso; }
}
