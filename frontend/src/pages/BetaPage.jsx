import React, { useState } from "react";
import { Link } from "react-router-dom";
import { submitMakerApplication } from "../lib/api";
import { useSiteSettings } from "../hooks/useSiteSettings";
import { useStructuredData } from "../lib/seo";

// Founding Seller Beta program landing page.
// Reuses the existing /api/maker-applications endpoint so beta signups land
// in the same admin review queue as regular maker applications. We tag the
// submission with a "[FOUNDING SELLER BETA]" marker in the about field so
// admins can triage beta applicants quickly.
const TECH = ["PLASMA", "LASER", "ROUTER", "WOOD", "METAL", "CUSTOM"];

export default function BetaPage() {
  useStructuredData({
    title: "Founding Seller Beta · Crafters Market",
    description:
      "Become a Founding Seller on Crafters Market. Limited beta spots: $0 listing fees, priority placement, founding-seller badge, and direct input on the roadmap.",
    url: "https://craftersmarket.org/beta",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Founding Seller Beta Program",
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
  });
  const [state, setState] = useState("idle");
  const [errMsg, setErrMsg] = useState("");
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
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
          ◆ Beta Application Received
        </div>
        <h1 className="font-display text-6xl md:text-8xl mb-6 leading-[0.9]">
          You're On The <span className="text-outline-orange">Shortlist.</span>
        </h1>
        <p className="font-mono text-sm text-[#a3a3a3] max-w-md mx-auto leading-relaxed">
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
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
          ◆ Founding Seller Program · Paused
        </div>
        <h1 className="font-display text-6xl md:text-8xl mb-6 leading-[0.9]">
          Beta Spots Are <span className="text-outline-orange">Closed.</span>
        </h1>
        <p className="font-mono text-sm text-[#a3a3a3] max-w-md mx-auto leading-relaxed mb-8">
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
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-10 pb-5 border-b border-[#262626]"
          data-testid="beta-founding-login-strip"
        >
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              Already a Founding Seller?
            </div>
            <div className="font-mono text-xs text-[#e5e5e5] mt-1">
              Sign in with the email on your approved application.
            </div>
          </div>
          <Link
            to="/maker/login"
            data-testid="beta-founding-login-btn"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 border-2 border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500] hover:text-black font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
          >
            ◆ Founding Member Login →
          </Link>
        </div>

        {/* Hero */}
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
          ◆ Founding Seller Program
        </div>
        <h1 className="font-display text-[56px] md:text-[120px] leading-[0.88] mb-6">
          Become A <span className="text-outline-orange">Founding</span> Seller
        </h1>
        <p className="font-mono text-sm md:text-base text-[#d4d4d4] max-w-2xl mb-4 leading-relaxed">
          We're building the go-to marketplace for CNC creators — laser, plasma, wood, metal, and more.
        </p>
        <p className="font-mono text-sm md:text-base text-[#a3a3a3] max-w-2xl mb-12 leading-relaxed">
          Right now we're opening a limited number of Founding Seller spots. This is your chance to get in early,
          shape the platform, and grow with us.
        </p>

        {/* Benefits */}
        <div className="border border-[#262626] p-6 md:p-8 mb-12" data-testid="beta-benefits">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-5">
            ◆ What You Get
          </div>
          <h2 className="font-display text-3xl md:text-4xl mb-6 uppercase">Beta Access Perks</h2>
          <ul className="grid md:grid-cols-2 gap-4 font-mono text-sm text-[#e5e5e5]">
            {[
              "$0 listing fees during beta",
              "Reduced commission locked in after launch",
              "Priority placement in search & homepage",
              "Founding Seller badge on your store",
              "Direct input on features & tools",
              "Early access to new marketplace tools",
            ].map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="text-[#ff4500] font-bold mt-0.5">✓</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Requirements */}
        <div className="border border-[#ff4500]/40 bg-[#ff4500]/5 p-6 md:p-8 mb-12" data-testid="beta-requirements">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
            ⚠ This Isn't For Everyone
          </div>
          <h2 className="font-display text-3xl md:text-4xl mb-4 uppercase">
            Serious Makers Only
          </h2>
          <p className="font-mono text-sm text-[#a3a3a3] mb-5 max-w-2xl">
            We're looking for makers who want to help build something real. To join, you must:
          </p>
          <ul className="space-y-3 font-mono text-sm text-[#e5e5e5]">
            <li className="flex items-start gap-3">
              <span className="text-[#ff4500] font-bold">01</span>
              <span>Upload at least <strong>3 products</strong> within your first 14 days</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[#ff4500] font-bold">02</span>
              <span>Complete your <strong>seller profile</strong> (bio, portfolio, shipping, payouts)</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[#ff4500] font-bold">03</span>
              <span>Provide <strong>occasional feedback</strong> on new features & UX</span>
            </li>
          </ul>
        </div>

        {/* Beta details */}
        <div className="grid md:grid-cols-3 gap-4 mb-12" data-testid="beta-details">
          {[
            { k: "Spots", v: "100", sub: "Limited sellers" },
            { k: "Duration", v: "90 Days", sub: "Free beta access" },
            { k: "After Beta", v: "Discount", sub: "Founding Seller plan" },
          ].map((s) => (
            <div key={s.k} className="border border-[#262626] p-6 hover:border-[#ff4500] transition">
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#a3a3a3] mb-2">
                {s.k}
              </div>
              <div className="font-display text-4xl md:text-5xl text-[#ff4500] mb-2">{s.v}</div>
              <div className="font-mono text-xs text-[#e5e5e5]">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Why join early */}
        <div className="mb-14">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
            ◆ Why Join Early
          </div>
          <h2 className="font-display text-4xl md:text-6xl mb-4 uppercase leading-[0.95]">
            Build Your Shop Before The <span className="text-outline-orange">Crowd</span>.
          </h2>
          <p className="font-mono text-sm md:text-base text-[#a3a3a3] max-w-2xl leading-relaxed">
            Early sellers don't just save money — they gain visibility, build reputation, and establish
            their shop before the platform opens to everyone.
          </p>
        </div>

        {/* Application form */}
        <div id="apply" className="border-t border-[#262626] pt-10">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ Apply For Beta Access
          </div>
          <h2 className="font-display text-4xl md:text-6xl mb-3 uppercase">
            Join The Founding Sellers Program
          </h2>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[#ff4500] mb-8">
            Spots are limited. Once they're gone, they're gone.
          </p>

          <form onSubmit={submit} className="grid md:grid-cols-2 gap-6" data-testid="beta-form" autoComplete="on">
            {[
              ["Your name", "name", true, "name"],
              ["Email", "email", true, "email"],
              ["Studio / shop name", "studio_name", true, "organization"],
              ["City, State", "location", true, "address-level2"],
              ["Portfolio URL (Instagram, Etsy, site)", "portfolio_url", false, "url"],
            ].map(([label, k, req, autoComp]) => (
              <label key={k} className={`block ${k === "portfolio_url" ? "md:col-span-2" : ""}`}>
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">
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
                  className="w-full mt-2 bg-transparent border-b border-[#262626] focus:border-[#ff4500] outline-none py-3 font-mono text-sm"
                />
              </label>
            ))}

            <div className="md:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">
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
                        ? "bg-[#ff4500] border-[#ff4500] text-white"
                        : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500]"
                    }`}
                    data-testid={`beta-tech-${t}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <label className="md:col-span-2 block">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">
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
                className="w-full mt-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none p-4 font-mono text-sm resize-none"
              />
            </label>

            <div className="md:col-span-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-4">
              <Link
                to="/apply"
                className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition self-start"
                data-testid="beta-regular-apply-link"
              >
                ← Just apply to sell (not beta)
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
                className="md:col-span-2 text-[#ff4500] font-mono text-xs"
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
