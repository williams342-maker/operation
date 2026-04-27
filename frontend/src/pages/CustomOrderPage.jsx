import React, { useState } from "react";
import { submitCustomOrder } from "../lib/api";
import { useStructuredData } from "../lib/seo";

const PROJECTS = ["Wall Art", "Custom Sign", "Outdoor Piece", "Wedding / Gift", "Business Signage", "Other"];
const MATERIALS = ["Steel", "Oak", "Aluminum", "Mixed Media", "Other"];

export default function CustomOrderPage() {
  useStructuredData({
    title: "Custom CNC Orders · Bespoke Metal & Wood Signs · Crafters Market",
    description: "Get a free custom quote for one-of-a-kind CNC art, monograms, business signage, or wedding gifts. We route the brief to a vetted maker — quote in 24h, no commitment.",
    url: "https://craftersmarket.org/custom-order",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Custom CNC Order — Crafters Market",
      provider: { "@id": "https://craftersmarket.org/#org" },
      areaServed: { "@type": "Country", name: "United States" },
      serviceType: "Custom CNC fabrication and signage",
    },
  });

  const [f, setF] = useState({ name: "", email: "", phone: "", project_type: "Wall Art", material: "Steel", size: "", budget: "", description: "" });
  const [state, setState] = useState("idle"); // idle | sending | done | error
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setState("sending");
    try { await submitCustomOrder(f); setState("done"); }
    catch { setState("error"); }
  };

  if (state === "done") return (
    <div className="pt-40 pb-24 min-h-screen text-center grain px-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ Order Received</div>
      <h1 className="font-display text-6xl md:text-8xl mb-6">We've Got It.</h1>
      <p className="font-mono text-sm text-[#a3a3a3] max-w-md mx-auto">Expect a free quote in your inbox within 24 hours. Until then — keep dreaming up sharp things.</p>
    </div>
  );

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="custom-order-page">
      <div className="w-full max-w-[1100px] mx-auto px-4 md:px-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ Custom Order</div>
        <h1 className="font-display text-[56px] md:text-[120px] leading-[0.88] mb-4">Bring Your <span className="text-outline">Vision</span></h1>
        <p className="font-mono text-sm text-[#a3a3a3] max-w-xl mb-12">Tell us what you're building. We'll match you with a maker and send a free quote in under 24 hours. No commitment, ever.</p>

        <form onSubmit={submit} className="grid md:grid-cols-2 gap-6 border-y border-[#262626] py-8" data-testid="custom-order-form">
          {[
            ["Full name", "name", "text", true],
            ["Email", "email", "email", true],
            ["Phone (optional)", "phone", "tel", false],
            ["Approx. size", "size", "text", false],
          ].map(([label, k, type, req]) => (
            <Field key={k} label={label}>
              <input required={req} type={type} value={f[k]} onChange={set(k)} data-testid={`co-${k}`}
                className="w-full bg-transparent border-b border-[#262626] focus:border-[#ff4500] outline-none py-3 font-mono text-sm" />
            </Field>
          ))}
          <Field label="Project type">
            <select value={f.project_type} onChange={set("project_type")} data-testid="co-project_type"
              className="w-full bg-[#0a0a0a] border-b border-[#262626] focus:border-[#ff4500] outline-none py-3 font-mono text-sm">
              {PROJECTS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Primary material">
            <select value={f.material} onChange={set("material")} data-testid="co-material"
              className="w-full bg-[#0a0a0a] border-b border-[#262626] focus:border-[#ff4500] outline-none py-3 font-mono text-sm">
              {MATERIALS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Budget range (optional)" full>
            <input value={f.budget} onChange={set("budget")} placeholder="$200–$500" data-testid="co-budget"
              className="w-full bg-transparent border-b border-[#262626] focus:border-[#ff4500] outline-none py-3 font-mono text-sm" />
          </Field>
          <Field label="Tell us about it" full>
            <textarea required rows={5} value={f.description} onChange={set("description")} data-testid="co-description"
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none p-4 font-mono text-sm resize-none" />
          </Field>
          <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-4 pt-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">No commitment · Free quote · Ships nationwide</div>
            <button type="submit" disabled={state === "sending"} data-testid="co-submit" className="btn-industrial btn-primary">
              {state === "sending" ? "Sending…" : "Send Brief →"}
            </button>
          </div>
          {state === "error" && <div className="md:col-span-2 text-[#ff4500] font-mono text-xs">Something went wrong. Try again.</div>}
        </form>
      </div>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}
