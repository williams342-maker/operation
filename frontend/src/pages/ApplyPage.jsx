import React, { useState } from "react";
import { submitMakerApplication } from "../lib/api";
import { useSiteSettings } from "../hooks/useSiteSettings";
import { useStructuredData } from "../lib/seo";
import MakerFeeTable from "../components/MakerFeeTable";

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
  const [f, setF] = useState({ name: "", email: "", studio_name: "", location: "", techniques: [], portfolio_url: "", about: "" });
  const [state, setState] = useState("idle");
  const [errMsg, setErrMsg] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (t) => setF((c) => ({ ...c, techniques: c.techniques.includes(t) ? c.techniques.filter((x) => x !== t) : [...c.techniques, t] }));

  const submit = async (e) => {
    e.preventDefault();
    setState("sending");
    setErrMsg("");
    try { await submitMakerApplication(f); setState("done"); }
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
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ Applications · Paused</div>
        <h1 className="font-display text-6xl md:text-8xl mb-6 leading-[0.9]">We're at <span className="text-outline-orange">capacity.</span></h1>
        <p className="font-mono text-sm text-[#a3a3a3] max-w-md mx-auto leading-relaxed">
          {settings.applications_closed_message || "We're at capacity for new makers right now. Applications will reopen soon."}
        </p>
      </div>
    );
  }

  if (state === "done") return (
    <div className="pt-40 pb-24 min-h-screen text-center grain px-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ Application Received</div>
      <h1 className="font-display text-6xl md:text-8xl mb-6">Welcome To The Roster.</h1>
      <p className="font-mono text-sm text-[#a3a3a3] max-w-md mx-auto">We review every application personally. Expect a reply in 3–5 business days.</p>
    </div>
  );

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="apply-page">
      <div className="w-full max-w-[1100px] mx-auto px-4 md:px-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ Maker Application</div>
        <h1 className="font-display text-[56px] md:text-[120px] leading-[0.88] mb-4">Apply To <span className="text-outline-orange">Sell</span></h1>
        <p className="font-mono text-sm text-[#a3a3a3] max-w-xl mb-8">Approved makers only. Tell us about your shop and what you build — we'll handle storefront, payouts, and audience.</p>

        {/* Transparent fee disclosure — every applicant sees exactly what
            they'll be charged BEFORE submitting. Cuts "I didn't know about
            the fee" support tickets and improves activation post-approval. */}
        <div className="mb-12">
          <MakerFeeTable title="What you'll pay if approved" />
        </div>

        <form onSubmit={submit} className="grid md:grid-cols-2 gap-6 border-y border-[#262626] py-8" data-testid="apply-form">
          {[["Your name", "name", true], ["Email", "email", true], ["Studio name", "studio_name", true], ["City, State", "location", true], ["Portfolio URL (optional)", "portfolio_url", false]].map(([label, k, req]) => (
            <label key={k} className={`block ${k === "portfolio_url" ? "md:col-span-2" : ""}`}>
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">{label}</span>
              <input required={req} type={k === "email" ? "email" : k === "portfolio_url" ? "url" : "text"}
                value={f[k]} onChange={set(k)} data-testid={`apply-${k}`}
                className="w-full mt-2 bg-transparent border-b border-[#262626] focus:border-[#ff4500] outline-none py-3 font-mono text-sm" />
            </label>
          ))}
          <div className="md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">Techniques</span>
            <div className="flex flex-wrap gap-2 mt-3" data-testid="apply-tech">
              {TECH.map((t) => (
                <button type="button" key={t} onClick={() => toggle(t)}
                  className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] border transition ${
                    f.techniques.includes(t) ? "bg-[#ff4500] border-[#ff4500] text-white" : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500]"
                  }`}>{t}</button>
              ))}
            </div>
          </div>
          <label className="md:col-span-2 block">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">About your shop</span>
            <textarea required rows={5} value={f.about} onChange={set("about")} data-testid="apply-about"
              className="w-full mt-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none p-4 font-mono text-sm resize-none" />
          </label>
          <div className="md:col-span-2 flex justify-end pt-4">
            <button type="submit" disabled={state === "sending"} data-testid="apply-submit" className="btn-industrial btn-primary">
              {state === "sending" ? "Submitting…" : "Submit Application →"}
            </button>
          </div>
          {state === "error" && <div className="md:col-span-2 text-[#ff4500] font-mono text-xs">{errMsg || "Something went wrong. Try again."}</div>}
        </form>
      </div>
    </div>
  );
}
