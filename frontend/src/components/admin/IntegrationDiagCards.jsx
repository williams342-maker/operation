import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchShippoDiag,
  fetchMailgunDiag,
  fetchR2Diag,
} from "../../lib/api";
import { listConversionStatus } from "../../lib/googleAdsConversions";

/**
 * iter226 — Shippo / Mailgun / R2 diagnostic cards.
 *
 * Mirrors the iter222 StripeDiagCard pattern: one card per integration,
 * each shows a colored pill (emerald = reachable, red = broken) + 4
 * tiles of relevant context (mode, key prefix, etc.) + a "↻ Re-check"
 * button. When the upstream rejects us, the friendly-error string from
 * the backend renders inline so the operator can act in one read.
 */

function DiagTile({ label, value, highlight }) {
  return (
    <div className={`border px-2 py-1.5 ${highlight ? "border-emerald-500/50 bg-emerald-950/30" : "border-line bg-paper"}`}>
      <div className={`uppercase tracking-[0.22em] text-[9px] ${highlight ? "text-emerald-700" : "text-ink-muted"}`}>{label}</div>
      <div className={`text-base ${highlight ? "text-emerald-700" : "text-ink"} truncate`} title={String(value)}>{value}</div>
    </div>
  );
}

function DiagShell({ title, blurb, testId, ok, data, busy, onRefresh, children, reason }) {
  return (
    <div
      className={`border ${ok ? "border-emerald-700/40 bg-emerald-950/15" : "border-red-700/40 bg-red-950/15"} p-5`}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <div className={`font-mono text-[10px] uppercase tracking-[0.28em] mb-1 ${ok ? "text-emerald-700" : "text-red-600"}`}>
            ◆ {title} · Health
          </div>
          <h3 className={`font-display text-xl ${ok ? "text-emerald-700" : "text-red-600"}`}>
            {data === null ? "Checking…" : ok ? "Reachable" : "Unreachable"}
          </h3>
          <p className="font-mono text-[11px] text-ink-muted mt-1 max-w-[68ch] leading-relaxed">
            {blurb}
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={busy}
          className="px-3 py-1.5 border border-amber-700/60 hover:border-amber-400 hover:text-brand font-mono text-[11px] uppercase tracking-[0.22em] text-brand disabled:opacity-50"
          data-testid={`${testId}-refresh`}
        >
          {busy ? "Checking…" : "↻ Re-check"}
        </button>
      </div>

      {data && children}

      {!ok && reason && (
        <div className="mt-3 font-mono text-[11px] text-red-600 bg-paper/30 border border-red-900/60 p-3 leading-relaxed" data-testid={`${testId}-reason`}>
          <strong className="text-red-600">Reason:</strong> {/^https?:\/\//.test(reason.split(" ").pop()) ? (
            // Render the trailing URL as a clickable link (GA4 enable URL pattern).
            <>
              {reason.split(/\bhttps?:\/\/\S+/)[0]}
              <a href={reason.match(/\bhttps?:\/\/\S+/)?.[0]} target="_blank" rel="noopener noreferrer"
                 className="text-emerald-700 underline break-all hover:text-emerald-700">
                {reason.match(/\bhttps?:\/\/\S+/)?.[0]}
              </a>
            </>
          ) : reason}
        </div>
      )}
    </div>
  );
}


export function ShippoDiagCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try { setData(await fetchShippoDiag()); }
    catch (e) { toast.error(e?.response?.data?.detail || "Shippo diag failed."); }
    finally { setBusy(false); }
  };
  useEffect(() => { refresh(); }, []);
  const ok = !!data?.ok;
  return (
    <DiagShell
      title="Shippo · Shipping"
      blurb="Probes /api/admin/shippo/diag. If this says Unreachable, makers can't pull live rates or buy labels — usually a SHIPPO_API_KEY swap or the wrong test/live mode."
      testId="shippo-diag-card"
      ok={ok}
      data={data}
      busy={busy}
      onRefresh={refresh}
      reason={data?.reason}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]" data-testid="shippo-diag-tiles">
        <DiagTile label="Mode" value={data?.mode || "—"} highlight={data?.mode === "live"} />
        <DiagTile label="Key prefix" value={data?.key_prefix || "—"} />
        <DiagTile label="Carriers" value={data?.carriers_count ?? "—"} highlight={(data?.carriers_count || 0) > 0} />
        <DiagTile label="First" value={data?.first_carrier || "—"} />
      </div>
    </DiagShell>
  );
}


export function MailgunDiagCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try { setData(await fetchMailgunDiag()); }
    catch (e) { toast.error(e?.response?.data?.detail || "Mailgun diag failed."); }
    finally { setBusy(false); }
  };
  useEffect(() => { refresh(); }, []);
  const ok = !!data?.ok;
  return (
    <DiagShell
      title="Mailgun · Email"
      blurb="Probes /api/admin/mailgun/diag. Verifies the API key, sending domain, and region. If this says Unreachable, no transactional emails (magic links, order confirmations) are going out — the EMAIL_FALLBACK_PROVIDER chain may still catch them."
      testId="mailgun-diag-card"
      ok={ok}
      data={data}
      busy={busy}
      onRefresh={refresh}
      reason={data?.reason}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]" data-testid="mailgun-diag-tiles">
        <DiagTile label="Region" value={data?.region?.toUpperCase() || "—"} />
        <DiagTile label="Domain" value={data?.domain || "—"} />
        <DiagTile label="State" value={data?.state || "—"} highlight={data?.state === "active"} />
        <DiagTile label="Verified" value={data?.verified ? "YES" : "no"} highlight={!!data?.verified} />
      </div>
    </DiagShell>
  );
}


export function R2DiagCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try { setData(await fetchR2Diag()); }
    catch (e) { toast.error(e?.response?.data?.detail || "R2 diag failed."); }
    finally { setBusy(false); }
  };
  useEffect(() => { refresh(); }, []);
  const ok = !!data?.ok;
  return (
    <DiagShell
      title="R2 · Storage"
      blurb="Probes /api/admin/r2/diag. Verifies the access key + bucket exists + read perms. If this says Unreachable, every image / video / design file upload is broken — buyer purchases, maker uploads, clip seeding all fail."
      testId="r2-diag-card"
      ok={ok}
      data={data}
      busy={busy}
      onRefresh={refresh}
      reason={data?.reason}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]" data-testid="r2-diag-tiles">
        <DiagTile label="Bucket" value={data?.bucket || "—"} highlight={!!data?.bucket} />
        <DiagTile label="CDN" value={data?.public_url ? new URL(data.public_url).host : "—"} />
        <DiagTile label="Read perms" value={data?.ok ? "OK" : "—"} highlight={!!data?.ok} />
        <DiagTile label="Sample objs" value={data?.object_count_sample ?? "—"} />
      </div>
    </DiagShell>
  );
}


// iter413aw — Bing UET Enhanced Conversions health card.
// Unlike the other cards (which probe a backend endpoint), this one
// reads CLIENT-SIDE state because Enhanced Conversions live entirely
// in the browser: the UET pixel + the pid.em/pid.ph push happen in JS.
//
// Health = (UET pixel loaded) AND (consent granted) AND (PII pushed
// in the current session). The freshness timestamp lets the admin see
// "last push 12 min ago" so they know the pipeline is firing.
export function UetEnhancedConversionsCard() {
  const [snapshot, setSnapshot] = useState({
    uetLoaded: false,
    consentGranted: null,
    lastPushTs: null,
    lastPushFields: null,
  });
  const refresh = () => {
    let consentGranted = null;
    try {
      const c = JSON.parse(localStorage.getItem("cm_consent_v1") || "null");
      if (c && c.ad_storage) consentGranted = c.ad_storage === "granted";
    } catch { /* noop */ }
    let lastPushTs = null;
    let lastPushFields = null;
    try {
      const ts = localStorage.getItem("uet_pii_last_push");
      if (ts) lastPushTs = parseInt(ts, 10);
      lastPushFields = localStorage.getItem("uet_pii_last_fields");
    } catch { /* noop */ }
    setSnapshot({
      uetLoaded: typeof window !== "undefined" && !!window.uetq && typeof window.uetq.push === "function",
      consentGranted,
      lastPushTs,
      lastPushFields,
    });
  };
  useEffect(() => { refresh(); }, []);
  const ok = snapshot.uetLoaded && snapshot.consentGranted === true && !!snapshot.lastPushTs;
  let ageStr = "—";
  if (snapshot.lastPushTs) {
    const ageMs = Date.now() - snapshot.lastPushTs;
    const ageMin = Math.floor(ageMs / 60000);
    if (ageMin < 1) ageStr = "just now";
    else if (ageMin < 60) ageStr = `${ageMin} min ago`;
    else if (ageMin < 1440) ageStr = `${Math.floor(ageMin / 60)} hr ago`;
    else ageStr = `${Math.floor(ageMin / 1440)} d ago`;
  }
  const data = ok ? { ok: true } : null;
  return (
    <DiagShell
      title="Bing UET · Enhanced Conversions"
      blurb="Reads client-side telemetry: UET pixel loaded + consent granted + a PII push happened recently. Each successful pid.em / pid.ph push lets Microsoft Ads match an offline conversion back to a Bing ad click — even when cookies expire or the buyer switches browsers."
      testId="uet-enhanced-conversions-card"
      ok={ok}
      data={ok ? data : (snapshot.uetLoaded ? data : null)}
      busy={false}
      onRefresh={refresh}
      reason={
        !snapshot.uetLoaded
          ? "UET pixel hasn't loaded on this page (script blocked or load failure)."
          : snapshot.consentGranted === false
            ? "Consent banner: ad_storage='denied'. Visitors who reject ad cookies are skipped."
            : !snapshot.lastPushTs
              ? "No PII push recorded yet in this session. Submit any lead form (Contact, Apply, Custom Order) to fire one."
              : null
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]" data-testid="uet-pii-tiles">
        <DiagTile label="UET Pixel" value={snapshot.uetLoaded ? "LOADED" : "missing"} highlight={snapshot.uetLoaded} />
        <DiagTile label="Consent" value={snapshot.consentGranted === true ? "GRANTED" : snapshot.consentGranted === false ? "denied" : "—"} highlight={snapshot.consentGranted === true} />
        <DiagTile label="Last push" value={ageStr} highlight={!!snapshot.lastPushTs} />
        <DiagTile label="Fields" value={snapshot.lastPushFields || "—"} highlight={!!snapshot.lastPushFields} />
      </div>
    </DiagShell>
  );
}


// iter413bi — Google Ads conversion coverage card.
//
// Reads the static `CONVERSION_LABELS` map via `listConversionStatus()`
// and surfaces which funnel events are actually live vs. dev-only
// no-ops. The 6 keys (purchase, signup_buyer, signup_maker,
// add_to_cart, lead_custom_order, lead_contact) are pasted from the
// Google Ads admin UI; until they're set, gtag fires nothing. This
// card makes that visible at a glance instead of buried in source.
//
// Label-paste path:
//   Google Ads → Tools → Measurement → Conversions →
//   <click action> → Tag setup → copy the substring AFTER
//   "AW-11257134570/" → paste into `CONVERSION_LABELS`
//   in /app/frontend/src/lib/googleAdsConversions.js.

const ACTION_DESCRIPTIONS = {
  purchase:          "Checkout success — `purchase` event on /checkout/success",
  signup_buyer:      "Buyer / community account created",
  signup_maker:      "Maker application submitted (/apply + /beta)",
  add_to_cart:       "Add-to-cart click on a product detail page",
  lead_custom_order: "Custom-order request submitted",
  lead_contact:      "Public contact form submission",
};

export function GoogleAdsCoverageCard() {
  // listConversionStatus is sync + cheap — recompute on each render
  // (the underlying map is static module-scope state).
  const status = listConversionStatus();
  const wiredCount = status.filter((s) => s.wired).length;
  const total = status.length;
  const ok = wiredCount > 0;
  const allWired = wiredCount === total;

  return (
    <DiagShell
      title="Google Ads · Conversion coverage"
      blurb="Which funnel actions actually fire a gtag conversion vs. dev-only no-op (labels missing). Paste labels into googleAdsConversions.js to activate."
      testId="google-ads-coverage"
      ok={ok}
      data={{ ok, wired: wiredCount, total }}
      busy={false}
      onRefresh={() => {}}
      reason={
        !ok
          ? "Zero conversion labels are configured — every trackConversion() call is currently a no-op in production."
          : !allWired
            ? `${total - wiredCount} of ${total} actions still missing labels.`
            : undefined
      }
    >
      <div className="space-y-1.5" data-testid="google-ads-coverage-rows">
        {status.map((row) => {
          const desc = ACTION_DESCRIPTIONS[row.action] || row.action;
          return (
            <div
              key={row.action}
              className={`flex items-center justify-between gap-3 border px-2 py-1.5 ${
                row.wired
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-line bg-paper"
              }`}
              data-testid={`google-ads-coverage-${row.action}`}
            >
              <div className="min-w-0">
                <div className={`font-mono text-[11px] ${row.wired ? "text-emerald-700" : "text-ink"}`}>
                  {row.action}
                </div>
                <div className="font-mono text-[10px] text-ink-muted">{desc}</div>
              </div>
              <span
                className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-0.5 border ${
                  row.wired
                    ? "border-emerald-500/50 text-emerald-700"
                    : "border-amber-500/40 text-brand"
                }`}
              >
                {row.wired ? `✓ wired · ${row.label_preview}` : "◇ missing"}
              </span>
            </div>
          );
        })}
      </div>
    </DiagShell>
  );
}
