import React, { useEffect, useState } from "react";
import { submitMakerApplication } from "../lib/api";
import { useSiteSettings } from "../hooks/useSiteSettings";
import { useStructuredData } from "../lib/seo";
import { uetTrack, uetSetPII } from "../lib/consent";
import { trackConversion } from "../lib/googleAdsConversions";
import { readAttributionContext } from "../lib/attribution";
import MakerFeeTable from "../components/MakerFeeTable";
import PricingComparisonTable from "../components/PricingComparisonTable";

const TECH = ["PLASMA", "LASER", "ROUTER", "CUSTOM"];

export default function ApplyPage() {
  useStructuredData({
    title: "Apply to Sell · Maker Program · Crafters Market",
    description: "Independent CNC artist or signmaker? Apply to sell on Crafters Market. 5% commission, Stripe-direct payouts, 10 free listings, vetted buyer base.",
    url: "https://craftersmarket.org/apply",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Apply to Sell on Crafters Market",
      url: "https://craftersmarket.org/apply",
      isPartOf: { "@type": "WebSite", "@id": "https://craftersmarket.org/#website" },
    },
  });

  const settings = useSiteSettings();
  const [f, setF] = useState({ name: "", email: "", studio_name: "", location: "", techniques: [], portfolio_url: "", about: "", website: "" });
  const [state, setState] = useState("idle");
  const [errMsg, setErrMsg] = useState("");
  // Referral attribution — picks up `?ref=<code>` once on mount, same
  // mechanism as BetaPage so both maker entry points credit invites.
  const [refCode, setRefCode] = useState("");
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const r = (params.get("ref") || "").trim().toLowerCase();
      if (r && /^[a-z0-9]{4,40}$/.test(r)) setRefCode(r);
    } catch {/* search params unavailable in some preview contexts */}
  }, []);

  // iter413bb — Lead → Apply attribution. Fires once per page mount to
  // record this visitor as having reached /apply. Backend tries to
  // link it to a prior lead-magnet subscriber (by visitor_id cookie or
  // explicit email later). Fire-and-forget so analytics can't block UX.
  useEffect(() => {
    try {
      const ctx = readAttributionContext();
      if (!ctx.visitor_id) return;
      const API = process.env.REACT_APP_BACKEND_URL;
      fetch(`${API}/api/attribution/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ctx, kind: "apply_started" }),
        keepalive: true,
      }).catch(() => {});
    } catch {/* noop — analytics is non-critical */}
  }, []);
  // Functional updater + per-call snapshot of the new value. Fixes the
  // "typing in email bounces back to name" stale-closure bug: the old
  // form `const set = (k) => (e) => setF({ ...f, [k]: v })` captured a
  // stale `f` per render, so fast keystrokes overwrote each other with
  // old field values. `(c) => ({ ...c, [k]: v })` always reads the
  // latest state from React's reducer.
  const set = (k) => (e) => {
    const v = e.target.value;
    setF((c) => ({ ...c, [k]: v }));
  };
  const toggle = (t) => setF((c) => ({ ...c, techniques: c.techniques.includes(t) ? c.techniques.filter((x) => x !== t) : [...c.techniques, t] }));

  const submit = async (e) => {
    e.preventDefault();
    setState("sending");
    setErrMsg("");
    try {
      await submitMakerApplication({ ...f, referred_by_code: refCode || undefined });
      setState("done");
      // iter334f — Fire Microsoft Ads `submit_lead` conversion event on
      // successful application submission. Honors Consent Mode (denied
      // → UET drops it server-side). Wrapped in try so analytics can't
      // break the success UX. `event_label` lets the Bing Ads dashboard
      // filter maker leads from any future lead events (e.g. Founding Access).
      try {
        uetTrack("submit_lead", {
          event_label: "maker_application",
          event_value: 1,
        });
      } catch { /* noop */ }
      // iter413ac — mirror to Google Ads as `signup_maker` so the AW
      // pixel can attribute completed maker applications back to the
      // originating ad creative.
      try {
        trackConversion("signup_maker", { event_label: "maker_application" });
        // iter413av — Bing Enhanced Conversion: hand Microsoft the
        // applicant's email so the lead is matched to its origin click.
        uetSetPII({ email: (f.email || "").trim() });
      } catch { /* noop */ }
    }
    catch (e2) {
      const d = e2?.response?.data?.detail;
      setErrMsg(typeof d === "string" ? d : "Something went wrong. Try again.");
      setState("error");
    }
  };

  // Hard-gate when admin closes applications.
  if (settings && settings.allow_maker_applications === false) {
    return (
      <div className="pt-40 pb-24 min-h-screen text-center grain px-4" data-testid="apply-closed">
        <div className="inline-flex items-center gap-3 mb-4">
          <span className="h-px w-8 bg-brand" />
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">Applications · Paused</span>
          <span className="h-px w-8 bg-brand" />
        </div>
        <h1 className="font-heading uppercase text-5xl sm:text-7xl lg:text-8xl leading-[0.92] tracking-tight text-ink mb-6">
          We&rsquo;re at <span className="text-brand">capacity</span><span className="text-ink">.</span>
        </h1>
        <p className="font-body text-base sm:text-lg text-ink-muted max-w-md mx-auto leading-relaxed">
          {settings.applications_closed_message || "We're at capacity for new makers right now. Applications will reopen soon."}
        </p>
      </div>
    );
  }

  if (state === "done") return (
    <div className="pt-40 pb-24 min-h-screen text-center grain px-4">
      <div className="inline-flex items-center gap-3 mb-4">
        <span className="h-px w-8 bg-brand" />
        <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">Application Received</span>
        <span className="h-px w-8 bg-brand" />
      </div>
      <h1 className="font-heading uppercase text-5xl sm:text-7xl lg:text-8xl leading-[0.92] tracking-tight text-ink mb-6">
        Welcome to the <span className="text-brand">roster</span><span className="text-ink">.</span>
      </h1>
      <p className="font-body text-base sm:text-lg text-ink-muted max-w-md mx-auto">We review every application personally. Expect a reply in 3&ndash;5 business days.</p>
    </div>
  );

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="apply-page">
      <div className="w-full max-w-[1100px] mx-auto px-4 md:px-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="h-px w-8 bg-brand" />
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">Maker Application</span>
        </div>
        <h1 className="font-heading uppercase text-5xl sm:text-7xl lg:text-8xl leading-[0.92] tracking-tight text-ink mb-6" data-testid="apply-h1">
          Apply to <span className="text-brand">sell</span><span className="text-ink">.</span>
        </h1>
        <p className="font-body text-base sm:text-lg text-ink-muted max-w-2xl leading-relaxed mb-10">Approved makers only. Tell us about your shop and what you build &mdash; we&rsquo;ll handle storefront, payouts, and audience.</p>

        {/* Transparent fee disclosure — every applicant sees exactly what
            they'll be charged BEFORE submitting. Cuts "I didn't know about
            the fee" support tickets and improves activation post-approval. */}
        <div className="mb-12">
          <MakerFeeTable title="What you'll pay if approved" />
        </div>

        {/* iter345 — Side-by-side price comparison vs Etsy and Shopify.
            Sits right after the fee table so a prospective maker reads
            (1) our exact fees, then (2) how they compare to the two
            biggest alternatives. Honest, line-for-line, with citations. */}
        <div className="mb-12">
          <PricingComparisonTable />
        </div>

        <form onSubmit={submit} className="grid md:grid-cols-2 gap-6 border-y border-line py-8" data-testid="apply-form" autoComplete="on">
          {/* iter324 — Honeypot. Hidden from real users with tab/screen
              readers via aria-hidden + off-screen positioning + tabIndex=-1.
              Bots that scrape <form> elements fill everything; the server
              silently 200s without persisting when this is non-empty. */}
          <div
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", overflow: "hidden" }}
          >
            <label>
              Website (leave blank)
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={f.website}
                onChange={set("website")}
                data-testid="apply-honeypot"
              />
            </label>
          </div>
          {[["Your name", "name", true, "name"], ["Email", "email", true, "email"], ["Studio name", "studio_name", true, "organization"], ["City, State", "location", true, "address-level2"], ["Portfolio URL (optional)", "portfolio_url", false, "url"]].map(([label, k, req, autoComp]) => (
            <label key={k} className={`block ${k === "portfolio_url" ? "md:col-span-2" : ""}`}>
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-muted">{label}</span>
              <input required={req} type={k === "email" ? "email" : k === "portfolio_url" ? "url" : "text"}
                name={k} autoComplete={autoComp}
                value={f[k]} onChange={set(k)} data-testid={`apply-${k}`}
                className="w-full mt-2 bg-transparent border-b border-line focus:border-brand outline-none py-3 font-mono text-sm" />
            </label>
          ))}
          <div className="md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-muted">Techniques</span>
            <div className="flex flex-wrap gap-2 mt-3" data-testid="apply-tech">
              {TECH.map((t) => (
                <button type="button" key={t} onClick={() => toggle(t)}
                  className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] border transition ${
                    f.techniques.includes(t) ? "bg-brand border-brand text-ink" : "border-line text-ink-muted hover:border-brand"
                  }`}>{t}</button>
              ))}
            </div>
          </div>
          <label className="md:col-span-2 block">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-muted">About your shop</span>
            <textarea required rows={5} value={f.about} onChange={set("about")} data-testid="apply-about"
              name="about" autoComplete="off"
              className="w-full mt-2 bg-transparent border border-line focus:border-brand outline-none p-4 font-mono text-sm resize-none" />
          </label>
          <div className="md:col-span-2 flex justify-end pt-4">
            <button type="submit" disabled={state === "sending"} data-testid="apply-submit" className="btn-industrial btn-primary">
              {state === "sending" ? "Submitting…" : "Submit Application →"}
            </button>
          </div>
          {state === "error" && <div className="md:col-span-2 text-brand font-mono text-xs">{errMsg || "Something went wrong. Try again."}</div>}
        </form>
      </div>
    </div>
  );
}
