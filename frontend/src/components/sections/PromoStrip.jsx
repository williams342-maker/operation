import React from "react";
import { Link } from "react-router-dom";

const PROMOS = [
  { eyebrow: "Under $100", title: "Gifts That\nDon't Suck.", desc: "Quick-ship pieces from $59. Wedding monograms, address numbers, name signs.", cta: "Shop under $100", href: "/shop", accent: "#ff4500" },
  { eyebrow: "Made to order", title: "Bring Your\nVision To Life.", desc: "Free quote in 24h. No commitment. Ships nationwide. Built to your spec.", cta: "Start a brief", href: "/custom-order", accent: "#e5e5e5" },
];

export default function PromoStrip() {
  return (
    <section className="w-full py-12 md:py-16 bg-[#0a0a0a] border-b border-[#262626]" data-testid="promo-strip">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 grid md:grid-cols-2 gap-6">
        {PROMOS.map((p, i) => (
          <Link key={p.title} to={p.href} data-testid={`promo-${i}`}
            className="group relative overflow-hidden bg-[#121212] border border-[#262626] hover:border-[#ff4500] transition p-8 md:p-12 min-h-[260px] flex flex-col justify-between">
            <div className="absolute -top-12 -right-12 w-64 h-64 rounded-full opacity-20 blur-3xl transition group-hover:opacity-40"
              style={{ background: p.accent }} />
            <div className="relative">
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] mb-3" style={{ color: p.accent }}>◆ {p.eyebrow}</div>
              <h3 className="font-display text-4xl md:text-6xl leading-[0.92] whitespace-pre-line">{p.title}</h3>
              <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-4 max-w-sm">{p.desc}</p>
            </div>
            <div className="relative mt-6 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] group-hover:translate-x-1 transition" style={{ color: p.accent }}>
              {p.cta} →
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
