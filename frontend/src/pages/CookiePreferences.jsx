/**
 * iter449 — Cookie Preference Center (P1 compliance).
 * Full-page granular consent manager at /cookie-preferences. Reads/writes
 * the same `cm_consent` record as the banner (lib/consent.js) so choices
 * stay in sync everywhere: GA4 + Google Ads (Consent Mode v2), Microsoft
 * UET, TikTok Pixel (Consent API).
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ShieldCheck, BarChart3, Megaphone } from "lucide-react";
import { readConsent, writeConsent, acceptAll, rejectAll } from "../lib/consent";

const COOKIE_TABLE = {
  necessary: [
    ["cm_consent", "Crafters Market", "Stores your cookie choices", "12 months"],
    ["cm_cart / session", "Crafters Market", "Cart contents, sign-in session", "Session"],
    ["cm_maker_jwt / cm_admin_jwt", "Crafters Market", "Maker / admin authentication", "7 days"],
  ],
  analytics: [
    ["_ga, _ga_*", "Google Analytics 4", "Anonymous page views, clicks, traffic sources", "14 months"],
  ],
  advertising: [
    ["_gcl_*", "Google Ads", "Conversion tracking + remarketing", "90 days"],
    ["_uetsid, _uetvid, MUID", "Microsoft Ads (Bing)", "Conversion tracking + remarketing", "13 months"],
    ["_ttp, ttclid", "TikTok Pixel", "Conversion tracking + audience building", "13 months"],
  ],
};

function CategoryCard({ icon: Icon, title, always, checked, onChange, blurb, rows, testId }) {
  return (
    <div className="border border-line" data-testid={testId}>
      <div className="p-4 flex items-start gap-3">
        <Icon size={18} className="text-brand shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-mono text-xs uppercase tracking-[0.22em] text-ink">{title}</h2>
            {always ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-green-600 border border-green-500/40 px-2 py-0.5"
                    data-testid={`${testId}-always-on`}>
                Always active
              </span>
            ) : (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
                       className="w-4 h-4 accent-[#ff4500] cursor-pointer" data-testid={`${testId}-toggle`} />
                <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${checked ? "text-green-600" : "text-ink-muted"}`}>
                  {checked ? "Allowed" : "Blocked"}
                </span>
              </label>
            )}
          </div>
          <p className="font-mono text-[11px] text-ink-muted leading-relaxed mt-1.5">{blurb}</p>
        </div>
      </div>
      <div className="border-t border-line overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-ink-muted uppercase tracking-[0.14em] border-b border-line">
              <th className="text-left px-3 py-1.5">Cookie</th>
              <th className="text-left px-3 py-1.5">Provider</th>
              <th className="text-left px-3 py-1.5">Purpose</th>
              <th className="text-left px-3 py-1.5">Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([c, p, u, d]) => (
              <tr key={c} className="border-t border-line/50 text-ink-muted">
                <td className="px-3 py-1.5 text-ink">{c}</td>
                <td className="px-3 py-1.5">{p}</td>
                <td className="px-3 py-1.5">{u}</td>
                <td className="px-3 py-1.5">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CookiePreferences() {
  const [analyticsOn, setAnalyticsOn] = useState(false);
  const [adsOn, setAdsOn] = useState(false);
  const [record, setRecord] = useState(null);

  useEffect(() => {
    document.title = "Cookie Preferences · Crafters Market";
    const c = readConsent();
    setRecord(c);
    if (c) {
      setAnalyticsOn(c.analytics_storage === "granted");
      setAdsOn(c.ad_storage === "granted");
    }
    window.scrollTo(0, 0);
  }, []);

  const save = () => {
    const r = writeConsent(adsOn ? "granted" : "denied", analyticsOn ? "granted" : "denied");
    setRecord(r);
    toast.success("Cookie preferences saved.");
  };
  const onAcceptAll = () => {
    const r = acceptAll(); setRecord(r); setAnalyticsOn(true); setAdsOn(true);
    toast.success("All cookies allowed.");
  };
  const onRejectAll = () => {
    const r = rejectAll(); setRecord(r); setAnalyticsOn(false); setAdsOn(false);
    toast.success("Non-essential cookies blocked.");
  };

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-6 py-10 md:py-14" data-testid="cookie-preferences-page">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand">◆ Privacy controls</p>
      <h1 className="font-display text-4xl sm:text-5xl text-ink mt-2">Cookie Preferences</h1>
      <p className="font-mono text-xs text-ink-muted leading-relaxed mt-3 max-w-[620px]">
        Choose which cookies Crafters Market may use. Strictly necessary cookies keep the site
        working (cart, sign-in, this very preference) and can't be switched off. Everything else
        is up to you — your choice applies immediately and is remembered on this device. Details
        in our{" "}
        <Link to="/policies/privacy" className="text-brand hover:underline" data-testid="cookie-prefs-privacy-link">
          Privacy Policy
        </Link>.
      </p>

      {record && (
        <div className="border border-line bg-surface px-3 py-2 mt-4 font-mono text-[10px] text-ink-muted"
             data-testid="cookie-prefs-current-record">
          Current choice saved {new Date(record.decided_at).toLocaleString()} · analytics{" "}
          <span className={record.analytics_storage === "granted" ? "text-green-600" : "text-red-400"}>
            {record.analytics_storage}
          </span>{" "}· advertising{" "}
          <span className={record.ad_storage === "granted" ? "text-green-600" : "text-red-400"}>
            {record.ad_storage}
          </span>
        </div>
      )}

      <div className="space-y-4 mt-6">
        <CategoryCard icon={ShieldCheck} title="Strictly necessary" always
                      blurb="Required for core functionality: keeping your cart, signing you in, remembering this consent choice, and site security. These never track you across other sites."
                      rows={COOKIE_TABLE.necessary} testId="cookie-cat-necessary" />
        <CategoryCard icon={BarChart3} title="Analytics" checked={analyticsOn} onChange={setAnalyticsOn}
                      blurb="Helps us understand which pages are useful so we can improve the marketplace. Anonymous usage statistics only — no ad targeting."
                      rows={COOKIE_TABLE.analytics} testId="cookie-cat-analytics" />
        <CategoryCard icon={Megaphone} title="Advertising" checked={adsOn} onChange={setAdsOn}
                      blurb="Lets our ad partners measure whether their ads brought you here and show you relevant ads elsewhere. Blocking this never affects what you can buy."
                      rows={COOKIE_TABLE.advertising} testId="cookie-cat-advertising" />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-6">
        <button onClick={save}
                className="px-5 py-2.5 bg-brand hover:bg-brand-hover text-[#0a0a0a] font-mono text-[11px] uppercase tracking-[0.18em] font-bold transition"
                data-testid="cookie-prefs-save">
          Save preferences
        </button>
        <button onClick={onAcceptAll}
                className="px-5 py-2.5 border border-line hover:border-brand text-ink font-mono text-[11px] uppercase tracking-[0.18em] transition"
                data-testid="cookie-prefs-accept-all">
          Accept all
        </button>
        <button onClick={onRejectAll}
                className="px-5 py-2.5 border border-line hover:border-brand text-ink-muted hover:text-ink font-mono text-[11px] uppercase tracking-[0.18em] transition"
                data-testid="cookie-prefs-reject-all">
          Reject non-essential
        </button>
      </div>

      <p className="font-mono text-[10px] text-ink-muted leading-relaxed mt-6">
        Rejecting non-essential cookies stops Google Analytics, Google Ads, Microsoft Ads and the
        TikTok Pixel from storing anything on this device (Google services switch to cookieless
        "consent mode" pings; TikTok tracking is revoked entirely). You can change your mind here
        any time — this page is linked in the footer of every page.
      </p>
    </main>
  );
}
