import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { submitMakerApplication } from "../lib/api";
import { useSiteSettings } from "../hooks/useSiteSettings";
import { useStructuredData } from "../lib/seo";
import FounderSlotCounter from "../components/FounderSlotCounter";
import EtsyComparisonTable from "../components/EtsyComparisonTable";
import FoundersWall from "../components/FoundersWall";

// Founding Seller Beta program landing page.
// Reuses the existing /api/maker-applications endpoint so beta signups land
// in the same admin review queue as regular maker applications. We tag the
// submission with a "[FOUNDING SELLER BETA]" marker in the about field so
// admins can triage beta applicants quickly.
const TECH = ["PLASMA", "LASER", "ROUTER", "WOOD", "METAL", "CUSTOM"];

export default function BetaPage() {
  useStructuredData({
    title: "Founding Access · Crafters Market",
    description:
      "Become a Founding Seller on Crafters Market. Limited Founding Access spots: $0 listing fees, priority placement, founding-seller badge, and direct input on the roadmap.",
    url: "https://craftersmarket.org/beta",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Founding Access Program",
      url: "https://craftersmarket.org/beta",
      isPartOf: { "@type": "WebSite", "@id": "https://craftersmarket.org/#website" },
    },
  });

  const settings = useSiteSettings();
  const betaSignupEnabled = settings?.beta_signup_enabled !== false;

  const [f, setF] = useState({
    name: "",
    email: "",
    studio_name: "",
    location: "",
    techniques: [],
    portfolio_url: "",
    about: "",
    // iter325 — Honeypot field (matches iter324 on /apply). Hidden from
    // real users via aria-hidden + off-screen positioning. Bot scrapers
    // fill all form fields; server silently 200s without persisting
    // when this is non-empty.
    website: "",
  });
  const [state, setState] = useState("idle");
  const [errMsg, setErrMsg] = useState("");

  // Referral attribution — picks up `?ref=<code>` from the URL once on
  // mount and stashes it for submission. Survives field edits because
  // it lives in its own state slot.
  const [refCode, setRefCode] = useState("");
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const r = (params.get("ref") || "").trim().toLowerCase();
      if (r && /^[a-z0-9]{4,40}$/.test(r)) setRefCode(r);
    } catch {/* search params unavailable in some preview contexts */}
  }, []);
  // Functional updater — fixes the stale-closure bug where typing fast
  // in one field could overwrite another field's value with an old
  // snapshot of `f`. Each keystroke now reads the latest state.
  const set = (k) => (e) => {
    const v = e.target.value;
    setF((c) => ({ ...c, [k]: v }));
  };
  const toggle = (t) =>
    setF((c) => ({
      ...c,
      techniques: c.techniques.includes(t)
        ? c.techniques.filter((x) => x !== t)
        : [...c.techniques, t],
    }));

  const submit = async (e) => {
    e.preventDefault();
    setState("sending");
    setErrMsg("");
    try {
      await submitMakerApplication({
        ...f,
        about: `[FOUNDING SELLER BETA] ${f.about}`,
        referred_by_code: refCode || undefined,
      });
      setState("done");
      window.scrollTo(0, 0);
    } catch (e2) {
      const d = e2?.response?.data?.detail;
      setErrMsg(typeof d === "string" ? d : "Something went wrong. Try again.");
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <div className="pt-40 pb-24 min-h-screen text-center grain px-4" data-testid="beta-applied">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
          ◆ Founding Access Application Received
        </div>
        <h1 className="font-display text-6xl md:text-8xl mb-6 leading-[0.9]">
          You're On The <span className="text-outline-orange">Shortlist.</span>
        </h1>
        <p className="font-mono text-sm text-ink-muted max-w-md mx-auto leading-relaxed">
          We review every founding-seller application personally. Expect a reply within 3–5 business days.
        </p>
      </div>
    );
  }

  // Admin has turned the Founding Seller Beta signup off — show a "closed"
  // state instead of the form. Existing Founding Sellers keep their access;
  // this just stops new signups.
  if (settings && settings.beta_signup_enabled === false) {
    return (
      <div className="pt-40 pb-24 min-h-screen text-center grain px-4" data-testid="beta-closed">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
          ◆ Founding Seller Program · Paused
        </div>
        <h1 className="font-display text-6xl md:text-8xl mb-6 leading-[0.9]">
          Founding Access Is <span className="text-outline-orange">Closed.</span>
        </h1>
        <p className="font-mono text-sm text-ink-muted max-w-md mx-auto leading-relaxed mb-8">
          We're at capacity for our Founding Seller cohort. The program will
          reopen for a second wave — keep an eye on our journal, or apply as a
          regular maker below.
        </p>
        <Link
          to="/apply"
          className="btn-industrial btn-primary"
          data-testid="beta-closed-apply-link"
        >
          Apply to sell (regular) →
        </Link>
      </div>
    );
  }

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="beta-page">
      <div className="w-full max-w-[1100px] mx-auto px-4 md:px-8">
        {/* Founding Member Login — approved beta members sign in through
            the standard maker portal (magic-link). Prominent at the top so
            returning founders don't have to hunt for it. */}
        <div
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-10 pb-5 border-b border-line"
          data-testid="beta-founding-login-strip"
        >
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Already a Founding Seller?
            </div>
            <div className="font-mono text-xs text-ink mt-1">
              Sign in with the email on your approved application.
            </div>
          </div>
          <Link
            to="/maker/login"
            data-testid="beta-founding-login-btn"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 border-2 border-brand text-brand hover:bg-brand hover:text-black font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
          >
            ◆ Founding Member Login →
          </Link>
        </div>

        {/* Live inaugural-slot counter — creates urgency. Polls
            /api/founders/slots once and renders a progress band so
            applicants see "73 / 100 spots remaining" before they even
            scroll. Auto-hides if the endpoint errors. */}
        <div className="mb-10">
          <FounderSlotCounter variant="hero" testId="founders-page-slot-counter" />
        </div>

        {/* The killer recruiting math — Etsy fee comparison at 3 GMV
            tiers. Pulls live CraftersMarket fee data so a future fee
            change automatically propagates without us having to edit
            marketing copy. */}
        <EtsyComparisonTable testId="founders-etsy-comparison" />

        {/* Social proof — every current Founder linked to their shop.
            Empty-state fallback (zero Founders) hides the section. */}
        <FoundersWall testId="founders-wall" />

        {/* Hero */}
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
          ◆ Founding Seller Program
        </div>
        <h1 className="font-display text-[56px] md:text-[120px] leading-[0.88] mb-6">
          Become A <span className="text-outline-orange">Founding</span> Seller
        </h1>
        <p className="font-mono text-sm md:text-base text-ink max-w-2xl mb-4 leading-relaxed">
          We're building the go-to marketplace for CNC creators — laser, plasma, wood, metal, and more.
        </p>
        <p className="font-mono text-sm md:text-base text-ink-muted max-w-2xl mb-12 leading-relaxed">
          Right now we're opening a limited number of Founding Seller spots. This is your chance to get in early,
          shape the platform, and grow with us.
        </p>

        {/* Benefits */}
        <div className="border border-line p-6 md:p-8 mb-12" data-testid="beta-benefits">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-5">
            ◆ What You Get
          </div>
          <h2 className="font-display text-3xl md:text-4xl mb-6 uppercase">Founding Access Perks</h2>
          <ul className="grid md:grid-cols-2 gap-4 font-mono text-sm text-ink">
            {[
              "$0 listing fees during Founding Access",
              "Reduced commission locked in after launch",
              "Priority placement in search & homepage",
              "Founding Seller badge on your store",
              "Direct input on features & tools",
              "Early access to new marketplace tools",
            ].map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="text-brand font-bold mt-0.5">✓</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Requirements */}
        <div className="border border-brand/40 bg-brand/5 p-6 md:p-8 mb-12" data-testid="beta-requirements">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
            ⚠ This Isn't For Everyone
          </div>
          <h2 className="font-display text-3xl md:text-4xl mb-4 uppercase">
            Serious Makers Only
          </h2>
          <p className="font-mono text-sm text-ink-muted mb-5 max-w-2xl">
            We're looking for makers who want to help build something real. To join, you must:
          </p>
          <ul className="space-y-3 font-mono text-sm text-ink">
            <li className="flex items-start gap-3">
              <span className="text-brand font-bold">01</span>
              <span>Upload at least <strong>3 products</strong> within your first 14 days</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-brand font-bold">02</span>
              <span>Complete your <strong>seller profile</strong> (bio, portfolio, shipping, payouts)</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-brand font-bold">03</span>
              <span>Provide <strong>occasional feedback</strong> on new features & UX</span>
            </li>
          </ul>
        </div>

        {/* Beta details */}
        <div className="grid md:grid-cols-3 gap-4 mb-12" data-testid="beta-details">
          {[
            { k: "Spots", v: "100", sub: "Limited sellers" },
            { k: "Duration", v: "90 Days", sub: "Founding Access window" },
            { k: "After Founding Access", v: "Discount", sub: "Founding Seller plan" },
          ].map((s) => (
            <div key={s.k} className="border border-line p-6 hover:border-brand transition">
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-muted mb-2">
                {s.k}
              </div>
              <div className="font-display text-4xl md:text-5xl text-brand mb-2">{s.v}</div>
              <div className="font-mono text-xs text-ink">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Why join early */}
        <div className="mb-14">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
            ◆ Why Join Early
          </div>
          <h2 className="font-display text-4xl md:text-6xl mb-4 uppercase leading-[0.95]">
            Build Your Shop Before The <span className="text-outline-orange">Crowd</span>.
          </h2>
          <p className="font-mono text-sm md:text-base text-ink-muted max-w-2xl leading-relaxed">
            Early sellers don't just save money — they gain visibility, build reputation, and establish
            their shop before the platform opens to everyone.
          </p>
        </div>

        {/* iter314c — Marketing hero poster: same fee data as the
            cards below + the PDF, but in one share-friendly visual.
            Hidden on mobile (the cards below stay legible at any
            width); shown md+ where the image's high information
            density actually works. Click-to-open full-size in new tab. */}
        <a
          href="/marketing/maker-tiers-poster.png"
          target="_blank"
          rel="noopener"
          className="hidden md:block mb-8 group"
          data-testid="beta-pricing-poster-link"
        >
          <img
            src="/marketing/maker-tiers-poster.png"
            alt="Crafters Market maker tiers — Standard, Founder, and Crafters Plus side-by-side, with veteran bonus"
            className="w-full border border-line group-hover:border-brand transition-colors"
            data-testid="beta-pricing-poster"
            loading="lazy"
          />
          <div className="text-right font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted group-hover:text-brand mt-1 transition-colors">
            Click to view full-size · share with friends ↗
          </div>
        </a>

        {/* iter314 — Transparent pricing block, right before the
            apply form. Makers see exactly what they'll pay before
            committing. Links to the auto-generated PDF for the full
            side-by-side comparison + buyer-side fees. */}
        <div className="mb-14 border border-line bg-paper p-6 md:p-8" data-testid="beta-transparent-pricing">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ Transparent Pricing
          </div>
          <h2 className="font-display text-3xl md:text-4xl mb-3 uppercase leading-[0.95]">
            No hidden fees. Ever.
          </h2>
          <p className="font-mono text-sm text-ink-muted max-w-2xl leading-relaxed mb-6">
            What you pay is exactly what's listed below. Every fee is set by environment variable
            in the codebase — change one, and every page (including the PDF) reflects it instantly.
          </p>
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            {[
              {
                tier: "Standard",
                price: "$0 / mo",
                rate: "5% commission",
                bullets: [
                  "10 free listings (lifetime)",
                  "$0.20 per listing past quota",
                  "Keeps $91.80 on a $100 sale",
                ],
              },
              {
                tier: "Founder",
                price: "$0 / mo",
                rate: "3% commission",
                badge: "Lowest commission",
                bullets: [
                  "50 free listings / month",
                  "12-month window (lifetime for first 100)",
                  "Keeps $93.80 on a $100 sale",
                ],
              },
              {
                tier: "Plus",
                price: "$12 / mo",
                rate: "4% commission",
                badge: "Best for high-volume",
                bullets: [
                  "15 free listings / month",
                  "$15 boost credit included",
                  "AI Maker Studio · custom banner",
                ],
              },
            ].map((t) => (
              <div
                key={t.tier}
                className="border border-line hover:border-brand/50 transition-colors p-4 bg-surface"
                data-testid={`beta-pricing-${t.tier.toLowerCase()}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-display text-xl uppercase">{t.tier}</div>
                  {t.badge && (
                    <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-brand border border-brand/40 px-1.5 py-0.5">
                      {t.badge}
                    </div>
                  )}
                </div>
                <div className="font-mono text-[11px] text-ink-muted mb-1">{t.price}</div>
                <div className="font-mono text-[12px] text-ink mb-3">{t.rate}</div>
                <ul className="space-y-1.5">
                  {t.bullets.map((b) => (
                    <li key={b} className="font-mono text-[10px] text-ink-muted leading-relaxed flex gap-1.5">
                      <span className="text-brand mt-0.5">→</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-line">
            <a
              href="/fees.pdf"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 px-4 py-2 border border-brand text-brand hover:bg-brand hover:text-paper font-mono text-[10px] uppercase tracking-[0.22em] transition-colors"
              data-testid="beta-pricing-pdf"
            >
              ↓ Full pricing breakdown (PDF)
            </a>
            <p className="font-mono text-[10px] text-ink-muted flex-1 min-w-[200px]">
              Includes buyer fees, veteran-owned bonus, Stripe processing breakdown, and a side-by-side comparison.
            </p>
          </div>
        </div>

        {/* Application form */}
        <div id="apply" className="border-t border-line pt-10">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ Apply For Founding Access
          </div>
          <h2 className="font-display text-4xl md:text-6xl mb-3 uppercase">
            Join The Founding Sellers Program
          </h2>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-brand mb-8">
            Spots are limited. Once they're gone, they're gone.
          </p>

          <form onSubmit={submit} className="grid md:grid-cols-2 gap-6" data-testid="beta-form" autoComplete="on">
            {/* iter325 — Honeypot. Hidden from real users via aria-hidden
                + off-screen positioning. Bots fill everything; server
                silently 200s without persisting when this is non-empty.
                Identical pattern to /apply (iter324). */}
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
                  data-testid="beta-honeypot"
                />
              </label>
            </div>
            {[
              ["Your name", "name", true, "name"],
              ["Email", "email", true, "email"],
              ["Studio / shop name", "studio_name", true, "organization"],
              ["City, State", "location", true, "address-level2"],
              ["Portfolio URL (Instagram, Etsy, site)", "portfolio_url", false, "url"],
            ].map(([label, k, req, autoComp]) => (
              <label key={k} className={`block ${k === "portfolio_url" ? "md:col-span-2" : ""}`}>
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-muted">
                  {label}
                </span>
                <input
                  required={req}
                  type={k === "email" ? "email" : k === "portfolio_url" ? "url" : "text"}
                  name={k}
                  autoComplete={autoComp}
                  value={f[k]}
                  onChange={set(k)}
                  data-testid={`beta-${k}`}
                  className="w-full mt-2 bg-transparent border-b border-line focus:border-brand outline-none py-3 font-mono text-sm"
                />
              </label>
            ))}

            <div className="md:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-muted">
                Techniques you work in
              </span>
              <div className="flex flex-wrap gap-2 mt-3" data-testid="beta-tech">
                {TECH.map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => toggle(t)}
                    className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] border transition ${
                      f.techniques.includes(t)
                        ? "bg-brand border-brand text-white"
                        : "border-line text-ink-muted hover:border-brand"
                    }`}
                    data-testid={`beta-tech-${t}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <label className="md:col-span-2 block">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-muted">
                Tell us about your shop & why you want to be a Founding Seller
              </span>
              <textarea
                required
                rows={5}
                value={f.about}
                onChange={set("about")}
                name="about"
                autoComplete="off"
                data-testid="beta-about"
                className="w-full mt-2 bg-transparent border border-line focus:border-brand outline-none p-4 font-mono text-sm resize-none"
              />
            </label>

            <div className="md:col-span-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-4">
              <Link
                to="/apply"
                className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition self-start"
                data-testid="beta-regular-apply-link"
              >
                ← Just apply to sell (not Founding Access)
              </Link>
              <button
                type="submit"
                disabled={state === "sending"}
                data-testid="beta-submit"
                className="btn-industrial btn-primary"
              >
                {state === "sending" ? "Submitting…" : "Join The Founding Sellers →"}
              </button>
            </div>
            {state === "error" && (
              <div
                className="md:col-span-2 text-brand font-mono text-xs"
                data-testid="beta-error"
              >
                {errMsg || "Something went wrong. Try again."}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
