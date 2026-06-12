import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Unplug, Copy, History } from "lucide-react";
import {
  fetchMicrosoftAdsStatus, startMicrosoftAdsOauth, disconnectMicrosoftAds,
  triggerMicrosoftAdsSync, backfillMicrosoftAds,
} from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";

/**
 * Microsoft Ads (Bing) OAuth + daily-sync connection card.
 *
 * Sibling of `GoogleAdsConnectionCard` / `MetaAdsConnectionCard` — same
 * UI vocabulary so the admin learns the pattern once. Lives in the
 * AdsTab between Google and Meta.
 *
 * iter334w. The MS one differs slightly from Google in that:
 *   - We auto-discover Customer / Account IDs after OAuth (no manual env
 *     entry needed) and surface them in the status pill.
 *   - The redirect URL must be added to the Azure App Registration's
 *     "Web" platform (not Cloud Console) — copy-button surfaces it.
 */
export default function MicrosoftAdsConnectionCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [confirm, confirmModal] = useConfirm();

  const refresh = async () => {
    try {
      const s = await fetchMicrosoftAdsStatus();
      setStatus(s);
    } catch {
      toast.error("Could not load Microsoft Ads status.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchMicrosoftAdsStatus();
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) toast.error("Could not load Microsoft Ads status.");
      }
    })();
    // After OAuth callback we land on /admin/dashboard?tab=ads&microsoft_ads=connected
    // Surface a toast based on that flag, then strip from the URL so a
    // page refresh doesn't re-fire the toast.
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("microsoft_ads");
    if (flag) {
      if (flag === "connected") {
        toast.success("Microsoft Ads connected. Run a manual sync to backfill yesterday's metrics.");
      } else if (flag === "error") {
        toast.error(`Microsoft Ads connect failed: ${params.get("reason") || "unknown"}`);
      }
      params.delete("microsoft_ads");
      params.delete("reason");
      const newUrl = window.location.pathname +
        (params.toString() ? `?${params}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }
    return () => { cancelled = true; };
  }, []);

  const onConnect = async () => {
    setBusy("connect");
    try {
      const { authorization_url } = await startMicrosoftAdsOauth();
      window.location.assign(authorization_url);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start OAuth.");
      setBusy("");
    }
  };

  const onSync = async () => {
    setBusy("sync");
    try {
      const r = await triggerMicrosoftAdsSync();
      if (r.status === "ok") {
        toast.success(`Synced ${r.rows} campaign rows for ${r.date}.`);
      } else if (r.status === "skipped") {
        toast.info(`Sync skipped — reason: ${r.reason}${r.hint ? ` (${r.hint})` : ""}`);
      } else {
        toast.error(`Sync error: ${r.error || "unknown"}`);
      }
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Sync failed.");
    } finally {
      setBusy("");
    }
  };

  const onBackfill = async () => {
    const ok = await confirm({
      title: "Backfill the last 30 days?",
      body: "Walks day-by-day through the Microsoft Reporting API. Each day takes ~3–8s so the whole batch runs 2–4 min. The card will look unresponsive during the call — leave the tab open. Already-synced days are upserted (no duplicates).",
      confirmLabel: "Run 30-day backfill",
      tone: "info",
      testId: "confirm-microsoft-ads-backfill",
    });
    if (!ok) return;
    setBusy("backfill");
    const t = toast.loading("Backfilling 30 days of Microsoft Ads spend…", { duration: Infinity });
    try {
      const r = await backfillMicrosoftAds(30);
      toast.dismiss(t);
      if (r.status === "ok") {
        toast.success(`Backfill complete · ${r.days_ok}/${r.days_requested} days · ${r.total_rows} campaign rows.`);
      } else {
        toast.warning(`Backfill partial · ${r.days_ok} ok · ${r.days_skipped} skipped · ${r.days_error} error · ${r.total_rows} rows.`);
      }
      await refresh();
    } catch (e) {
      toast.dismiss(t);
      toast.error(e?.response?.data?.detail || "Backfill failed. The MS Reporting API may be throttling — retry in a few minutes.");
    } finally {
      setBusy("");
    }
  };

  const onDisconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Microsoft Ads?",
      body: "Daily sync stops immediately. Already-synced rows in the ad_spend ledger stay intact. Reconnecting later requires going through Microsoft's consent screen again.",
      confirmLabel: "Disconnect",
      tone: "warn",
      testId: "confirm-microsoft-ads-disconnect",
    });
    if (!ok) return;
    setBusy("disconnect");
    try {
      await disconnectMicrosoftAds();
      toast.success("Microsoft Ads disconnected.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Disconnect failed.");
    } finally {
      setBusy("");
    }
  };

  if (!status) {
    return (
      <div className="border border-line p-4 md:p-5" data-testid="microsoft-ads-card-loading">
        <p className="font-mono text-xs text-ink-muted">Loading Microsoft Ads status…</p>
      </div>
    );
  }

  const pill = status.connected
    ? { label: "Connected", tone: "emerald", Icon: CheckCircle2 }
    : status.config_ready
      ? { label: "Not connected", tone: "amber", Icon: AlertCircle }
      : { label: "Not configured", tone: "neutral", Icon: AlertCircle };
  const toneCls = {
    emerald: "border-emerald-700/50 text-emerald-700 bg-emerald-900/10",
    amber: "border-amber-700/50 text-brand bg-amber-900/10",
    neutral: "border-line text-ink-muted bg-paper",
  }[pill.tone];

  return (
    <div className="border border-line p-4 md:p-5" data-testid="microsoft-ads-card">
      {confirmModal}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-2">
            ◆ Microsoft Ads · live integration
          </div>
          <h3 className="font-display text-xl uppercase mb-1">Connect your Bing Ads account</h3>
          <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
            Pulls daily account-level spend, clicks, impressions, and conversions
            into the ad_spend ledger. Daily sync runs at 04:30 UTC. Read-only —
            we never modify your campaigns or bidding.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] ${toneCls}`}
          data-testid="microsoft-ads-status-pill"
        >
          <pill.Icon size={11} /> {pill.label}
        </span>
      </div>

      {!status.config_ready && (
        <div className="mt-4 border border-amber-900/60 bg-amber-950/20 p-3" data-testid="microsoft-ads-missing-env">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand mb-2">
            ⚠ Env vars required before connecting
          </p>
          <p className="font-mono text-[11px] text-ink leading-relaxed mb-2">
            Add these to <code className="text-brand">/app/backend/.env</code> (or your prod env), then redeploy:
          </p>
          <ul className="font-mono text-[10px] text-ink-muted space-y-0.5">
            {(status.missing_env || []).map((k) => (
              <li key={k}>· <code>{k}</code></li>
            ))}
          </ul>
          <p className="font-mono text-[10px] text-brand mt-2 leading-relaxed">
            Get the developer token from developers.ads.microsoft.com → Account.
            Get the OAuth client ID + secret from portal.azure.com → App registrations.
          </p>
        </div>
      )}

      {status.config_ready && !status.connected && (
        <div className="mt-4 space-y-3">
          {status.redirect_uri && (
            <div
              className="border border-cyan-900/60 bg-cyan-950/20 p-3"
              data-testid="microsoft-ads-redirect-uri-callout"
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand mb-1">
                ◆ Whitelist this URL first
              </p>
              <p className="font-mono text-[11px] text-brand leading-relaxed mb-2">
                Azure portal → App registrations → your app → <b>Authentication</b> →{" "}
                <b>+ Add a platform</b> → <b>Web</b> → <b>Redirect URIs</b> → paste:
              </p>
              <div className="flex items-stretch gap-2">
                <code
                  className="flex-1 bg-paper border border-line px-2 py-1.5 font-mono text-[11px] text-ink break-all"
                  data-testid="microsoft-ads-redirect-uri-value"
                >
                  {status.redirect_uri}
                </code>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(status.redirect_uri);
                      toast.success("Redirect URI copied. Paste into Azure portal.");
                    } catch {
                      toast.error("Couldn't copy. Select + copy manually.");
                    }
                  }}
                  className="px-3 py-1.5 border border-cyan-400/50 text-brand hover:bg-cyan-400/10 font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-1.5"
                  data-testid="microsoft-ads-redirect-uri-copy"
                >
                  <Copy size={12} /> Copy
                </button>
              </div>
              <p className="font-mono text-[10px] text-brand mt-2 leading-relaxed">
                After saving in Azure, wait ~30s for the change to propagate, then click &quot;Connect Microsoft Ads&quot; below.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onConnect}
              disabled={busy === "connect"}
              className="px-4 py-2 border border-cyan-400 text-brand hover:bg-cyan-400 hover:text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50 flex items-center gap-2"
              data-testid="microsoft-ads-connect-btn"
            >
              {busy === "connect" ? <Loader2 size={12} className="animate-spin" /> : null}
              Connect Microsoft Ads
            </button>
            <span className="font-mono text-[10px] text-ink-muted">
              ↗ opens Microsoft&apos;s consent screen
            </span>
          </div>
        </div>
      )}

      {status.connected && (
        <div className="mt-4 grid sm:grid-cols-3 gap-3">
          <Stat label="Connected at" value={fmtDate(status.connected_at)} />
          <Stat label="Last sync" value={fmtDate(status.last_sync_at) || "—"}
            sub={status.last_sync_status} />
          <Stat label="Rows · yesterday" value={String(status.rows_synced_yesterday)}
            sub={status.account_id ? `Account ${status.account_id}` : "—"} />
        </div>
      )}

      {status.connected && status.last_sync_error && (
        <div className="mt-3 border border-red-900/60 bg-red-950/20 p-3 font-mono text-[10px] text-red-600"
          data-testid="microsoft-ads-last-error">
          ⚠ Last sync error: {status.last_sync_error}
        </div>
      )}

      {status.connected && status.discovered_accounts?.length > 0 && (
        <div className="mt-3 border border-line p-3" data-testid="microsoft-ads-accounts">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted mb-2">
            Discovered accounts ({status.discovered_accounts.length})
          </div>
          <div className="space-y-1 font-mono text-[10px] text-ink-muted">
            {status.discovered_accounts.slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span className="truncate">{a.name || "—"}</span>
                <span className="text-ink-muted">cid {a.customer_id} · aid {a.account_id}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {status.connected && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={onSync}
            disabled={busy === "sync"}
            className="px-3 py-2 border border-line hover:border-cyan-400 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
            data-testid="microsoft-ads-sync-btn"
          >
            {busy === "sync" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Sync yesterday now
          </button>
          <button
            onClick={onBackfill}
            disabled={busy === "backfill"}
            className="px-3 py-2 border border-line hover:border-cyan-400 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
            data-testid="microsoft-ads-backfill-btn"
            title="Pull the last 30 days of spend into the ad_spend ledger. Takes 2–4 min."
          >
            {busy === "backfill" ? <Loader2 size={11} className="animate-spin" /> : <History size={11} />}
            Backfill 30 days
          </button>
          <button
            onClick={onDisconnect}
            disabled={busy === "disconnect"}
            className="px-3 py-2 border border-red-900/60 text-red-600 hover:border-red-500 hover:text-red-600 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
            data-testid="microsoft-ads-disconnect-btn"
          >
            <Unplug size={11} /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="border border-line p-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">{label}</div>
      <div className="font-display text-base text-ink mt-1 truncate">{value}</div>
      {sub && <div className="font-mono text-[10px] text-ink-muted mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
