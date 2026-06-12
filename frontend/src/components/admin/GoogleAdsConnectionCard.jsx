import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Unplug, Copy, History } from "lucide-react";
import {
  fetchGoogleAdsStatus, startGoogleAdsOauth, disconnectGoogleAds,
  triggerGoogleAdsSync, backfillGoogleAds,
} from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";

/**
 * Google Ads OAuth + daily-sync connection card.
 *
 * Lives at the top of `AdsTab` — gives the admin a single place to:
 *   • See whether the integration is configured (env vars present),
 *     connected (refresh_token persisted), and last-synced.
 *   • Start the OAuth handshake (window.location.assign — same window
 *     so Google's consent screen redirects cleanly back to us).
 *   • Trigger a manual backfill sync for any date (defaults to
 *     yesterday on first connection so the dashboard isn't empty
 *     until the 03:30 UTC cron fires).
 *   • Disconnect (clears the persisted refresh_token).
 *
 * Status logic is intentionally explicit rather than inferred:
 *   - `config_ready` false → show "Configure env vars" hint
 *   - `connected` false but config_ready → show "Connect"
 *   - `connected` true → show last sync + manual sync + disconnect
 */
export default function GoogleAdsConnectionCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [confirm, confirmModal] = useConfirm();

  const refresh = async () => {
    try {
      const s = await fetchGoogleAdsStatus();
      setStatus(s);
    } catch (e) {
      toast.error("Could not load Google Ads status.");
    }
  };

  useEffect(() => {
    refresh();
    // After OAuth callback we land on /admin/dashboard?tab=ads&google_ads=connected
    // Surface a toast based on that flag, then strip from the URL so a
    // page refresh doesn't re-fire the toast.
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("google_ads");
    if (flag) {
      if (flag === "connected") {
        toast.success("Google Ads connected. Run a manual sync to backfill yesterday's metrics.");
      } else if (flag === "error") {
        toast.error(`Google Ads connect failed: ${params.get("reason") || "unknown"}`);
      }
      params.delete("google_ads");
      params.delete("reason");
      const newUrl = window.location.pathname +
        (params.toString() ? `?${params}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  const onConnect = async () => {
    setBusy("connect");
    try {
      const { authorization_url } = await startGoogleAdsOauth();
      window.location.assign(authorization_url);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start OAuth.");
      setBusy("");
    }
  };

  const onSync = async () => {
    setBusy("sync");
    try {
      const r = await triggerGoogleAdsSync();
      if (r.status === "ok") {
        toast.success(`Synced ${r.rows} campaign rows for ${r.date}.`);
      } else if (r.status === "skipped") {
        toast.info(`Sync skipped — reason: ${r.reason}`);
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
      body: "Walks day-by-day through the Google Ads API. Each day takes ~2–5s so the whole batch runs 1–3 min. Leave the tab open. Already-synced days are upserted (no duplicates).",
      confirmLabel: "Run 30-day backfill",
      tone: "info",
      testId: "confirm-google-ads-backfill",
    });
    if (!ok) return;
    setBusy("backfill");
    const t = toast.loading("Backfilling 30 days of Google Ads spend…", { duration: Infinity });
    try {
      const r = await backfillGoogleAds(30);
      toast.dismiss(t);
      if (r.status === "ok") {
        toast.success(`Backfill complete · ${r.days_ok}/${r.days_requested} days · ${r.total_rows} campaign rows.`);
      } else {
        toast.warning(`Backfill partial · ${r.days_ok} ok · ${r.days_skipped} skipped · ${r.days_error} error · ${r.total_rows} rows.`);
      }
      await refresh();
    } catch (e) {
      toast.dismiss(t);
      toast.error(e?.response?.data?.detail || "Backfill failed. The Google Ads API may be rate-limiting — retry in a few minutes.");
    } finally {
      setBusy("");
    }
  };

  const onDisconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Google Ads?",
      body: "Daily sync stops immediately. Already-synced rows in the ad_spend ledger stay intact. Reconnecting later requires going through Google's consent screen again.",
      confirmLabel: "Disconnect",
      tone: "warn",
      testId: "confirm-google-ads-disconnect",
    });
    if (!ok) return;
    setBusy("disconnect");
    try {
      await disconnectGoogleAds();
      toast.success("Google Ads disconnected.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Disconnect failed.");
    } finally {
      setBusy("");
    }
  };

  if (!status) {
    return (
      <div className="border border-line p-4 md:p-5" data-testid="google-ads-card-loading">
        <p className="font-mono text-xs text-ink-muted">Loading Google Ads status…</p>
      </div>
    );
  }

  // Pick a status pill tone. Three states:
  //   1. connected & syncing → emerald
  //   2. config_ready but not connected → amber
  //   3. env vars missing → grey/red
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
    <div className="border border-line p-4 md:p-5" data-testid="google-ads-card">
      {confirmModal}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-2">
            ◆ Google Ads · live integration
          </div>
          <h3 className="font-display text-xl uppercase mb-1">Connect your Ads account</h3>
          <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
            Pulls daily campaign-level spend, clicks, impressions, and conversions into the ad_spend ledger. Daily sync runs at 03:30 UTC. Read-only — we never modify your campaigns or bidding.
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] ${toneCls}`}
          data-testid="google-ads-status-pill">
          <pill.Icon size={11} /> {pill.label}
        </span>
      </div>

      {!status.config_ready && (
        // Pre-OAuth state: the env vars themselves aren't filled in.
        // Walk the operator through exactly which keys are missing.
        <div className="mt-4 border border-amber-900/60 bg-amber-950/20 p-3" data-testid="google-ads-missing-env">
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
            Get the developer token from your Google Ads MCC → API Center. Get the OAuth client ID + secret from Google Cloud Console → APIs &amp; Services → Credentials.
          </p>
        </div>
      )}

      {status.config_ready && !status.connected && (
        <div className="mt-4 space-y-3">
          {/* iter269 — Show the EXACT redirect URI Google needs to
              whitelist. This is the #1 cause of `Error 400:
              redirect_uri_mismatch` and copying the URL by hand from
              the address bar after the fact is awful UX. */}
          {status.redirect_uri && (
            <div
              className="border border-cyan-900/60 bg-cyan-950/20 p-3"
              data-testid="google-ads-redirect-uri-callout"
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand mb-1">
                ◆ Whitelist this URL first
              </p>
              <p className="font-mono text-[11px] text-brand leading-relaxed mb-2">
                Cloud Console → APIs &amp; Services → Credentials → your OAuth client
                ({(process.env.REACT_APP_GOOGLE_ADS_CLIENT_HINT || "GOOGLE_ADS_CLIENT_ID")})
                → <b>Authorized redirect URIs</b> → <b>+ Add URI</b> → paste:
              </p>
              <div className="flex items-stretch gap-2">
                <code
                  className="flex-1 bg-paper border border-line px-2 py-1.5 font-mono text-[11px] text-ink break-all"
                  data-testid="google-ads-redirect-uri-value"
                >
                  {status.redirect_uri}
                </code>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(status.redirect_uri);
                      toast.success("Redirect URI copied. Paste into Cloud Console.");
                    } catch {
                      toast.error("Couldn't copy. Select + copy manually.");
                    }
                  }}
                  className="px-3 py-1.5 border border-cyan-400/50 text-brand hover:bg-cyan-400/10 font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-1.5"
                  data-testid="google-ads-redirect-uri-copy"
                >
                  <Copy size={12} /> Copy
                </button>
              </div>
              <p className="font-mono text-[10px] text-brand mt-2 leading-relaxed">
                After saving in Cloud Console, wait ~30s for Google to propagate the change,
                then click "Connect Google Ads" below.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onConnect}
              disabled={busy === "connect"}
              className="px-4 py-2 border border-brand text-brand hover:bg-brand hover:text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50 flex items-center gap-2"
              data-testid="google-ads-connect-btn"
            >
              {busy === "connect" ? <Loader2 size={12} className="animate-spin" /> : null}
              Connect Google Ads
            </button>
            <span className="font-mono text-[10px] text-ink-muted">
              ↗ opens Google's consent screen
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
            sub={`MCC ${status.login_customer_id || "—"}`} />
        </div>
      )}

      {status.connected && status.last_sync_error && (
        <div className="mt-3 border border-red-900/60 bg-red-950/20 p-3 font-mono text-[10px] text-red-600"
          data-testid="google-ads-last-error">
          ⚠ Last sync error: {status.last_sync_error}
        </div>
      )}

      {status.connected && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={onSync}
            disabled={busy === "sync"}
            className="px-3 py-2 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
            data-testid="google-ads-sync-btn"
          >
            {busy === "sync" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Sync yesterday now
          </button>
          <button
            onClick={onBackfill}
            disabled={busy === "backfill"}
            className="px-3 py-2 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
            data-testid="google-ads-backfill-btn"
            title="Pull the last 30 days of spend into the ad_spend ledger. Takes 1–3 min."
          >
            {busy === "backfill" ? <Loader2 size={11} className="animate-spin" /> : <History size={11} />}
            Backfill 30 days
          </button>
          <button
            onClick={onDisconnect}
            disabled={busy === "disconnect"}
            className="px-3 py-2 border border-red-900/60 text-red-600 hover:border-red-500 hover:text-red-600 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
            data-testid="google-ads-disconnect-btn"
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
