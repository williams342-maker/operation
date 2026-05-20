import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Mail, ExternalLink } from "lucide-react";

/**
 * PressPage — /press
 * -------------------
 * Lightweight press kit. Designed for journalists landing here from a
 * pitch email or a "Press" link in the footer.
 *
 * Sections (top-to-bottom):
 *   1. Hero with pull quote
 *   2. Fact sheet (live numbers from /api/founders/slots + /api/policy/fee-policy)
 *   3. Story angles (3 pitch hooks they can grab)
 *   4. Founder spotlight (1-3 makers with backstory)
 *   5. Brand assets (logo + colors)
 *   6. Contact card
 *
 * No backend changes required — everything reads from existing public
 * endpoints. The brand assets section links to /downloads/cnc-garage-builders.png
 * which already lives in /app/frontend/public.
 */
const API = process.env.REACT_APP_BACKEND_URL;

export default function PressPage() {
  const [stats, setStats] = useState({ founders: 0, total: 100 });

  useEffect(() => {
    fetch(`${API}/api/founders/slots`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setStats({
            founders: d.inaugural_taken ?? 0,
            total: d.inaugural_total ?? 100,
          });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <main className="bg-black text-[#fafafa] min-h-screen" data-testid="press-page">
      <div className="max-w-6xl mx-auto px-4 md:px-8 pt-32 pb-24">
        {/* HERO */}
        <header className="mb-16">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ Press Kit
          </div>
          <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl leading-[0.95]">
            For journalists,<br />podcasts, and<br />newsletter writers.
          </h1>
          <p className="text-[#a3a3a3] mt-6 text-base md:text-lg max-w-2xl leading-relaxed">
            Everything you need to write about CraftersMarket — the independent
            marketplace built for CNC, woodworking, and laser-cut makers leaving
            Etsy behind.
          </p>
        </header>

        {/* PULL QUOTE */}
        <blockquote className="border-l-4 border-[#ff4500] pl-6 my-12">
          <p className="font-display text-2xl md:text-3xl leading-tight text-[#fafafa]">
            "I built this because makers shouldn't have to choose between $1,250
            a year in Etsy fees and not selling online at all."
          </p>
          <footer className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#525252] mt-4">
            — Mike Williams, Founder, CraftersMarket
          </footer>
        </blockquote>

        {/* FACT SHEET */}
        <section className="my-16" data-testid="press-facts">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ Fact Sheet
          </div>
          <h2 className="font-display text-3xl md:text-4xl mb-8">By the numbers.</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { num: "3%", label: "Founder Commission" },
              { num: "6.5%", label: "Etsy Commission" },
              { num: "100", label: "Lifetime Founder Slots" },
              { num: `${stats.founders}`, label: "Founders Approved" },
              { num: "50/mo", label: "Free Listings as Founder" },
              { num: "$0", label: "Monthly Subscription" },
              { num: "$0.30", label: "Stripe Flat (per order)" },
              { num: "Veteran-Owned", label: "Platform Ownership" },
            ].map((s) => (
              <div key={s.label} className="border border-[#262626] bg-[#0a0a0a] p-5">
                <div className="font-display text-3xl md:text-4xl text-[#ff4500]">{s.num}</div>
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-2">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* STORY ANGLES */}
        <section className="my-16" data-testid="press-angles">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ Story Angles
          </div>
          <h2 className="font-display text-3xl md:text-4xl mb-8">Three ways to tell it.</h2>
          <div className="space-y-5">
            {[
              {
                tag: "Anti-Etsy",
                hook: "A new marketplace that pays makers more",
                body:
                  "Etsy's fee creep — now 6.5% commission + listing/renewal/ad fees stacking to ~12.5% effective rate — pushed an entire generation of small makers to look for alternatives. CraftersMarket charges 3% as a Founder, no subscription, no listing fees.",
              },
              {
                tag: "Maker-First",
                hook: "Built by a maker, for makers",
                body:
                  "Veteran-owned. No VC money. The product is curated for CNC, woodworking, and laser-cut categories — not a horizontal e-commerce platform that tolerates handmade.",
              },
              {
                tag: "Founding 100",
                hook: "Limited to 100 lifetime Founders",
                body:
                  "The platform is recruiting exactly 100 inaugural Founders who lock in lifetime rates. After #100, the offer closes forever. Real scarcity, real lifetime locked-in pricing.",
              },
            ].map((a) => (
              <div key={a.tag} className="border border-[#262626] bg-[#0a0a0a] p-6">
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
                  ◆ {a.tag}
                </div>
                <h3 className="font-display text-xl md:text-2xl text-[#fafafa] mb-2">{a.hook}</h3>
                <p className="text-sm text-[#a3a3a3] leading-relaxed">{a.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* BRAND ASSETS */}
        <section className="my-16" data-testid="press-assets">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ Brand Assets
          </div>
          <h2 className="font-display text-3xl md:text-4xl mb-8">Logos · colors.</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="border border-[#262626] bg-[#0a0a0a] p-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-4">
                ◆ Primary Mark
              </div>
              <div className="bg-black border border-[#262626] py-8 flex items-center justify-center">
                <img src="/downloads/cnc-garage-builders.png" alt="CraftersMarket logo" className="max-h-24" />
              </div>
              <a
                href="/downloads/cnc-garage-builders.png"
                download
                className="inline-flex items-center gap-2 mt-4 text-sm text-[#ff4500] hover:underline font-mono text-[11px] uppercase tracking-[0.22em]"
                data-testid="press-download-logo"
              >
                <Download size={12} /> Download PNG
              </a>
            </div>
            <div className="border border-[#262626] bg-[#0a0a0a] p-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-4">
                ◆ Brand Colors
              </div>
              <div className="space-y-3">
                {[
                  { hex: "#ff4500", name: "Orange (Primary)" },
                  { hex: "#0a0a0a", name: "Near-Black (Background)" },
                  { hex: "#fafafa", name: "Cream (Body Text)" },
                  { hex: "#a3a3a3", name: "Muted Grey (Secondary)" },
                ].map((c) => (
                  <div key={c.hex} className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 border border-[#262626] shrink-0"
                      style={{ background: c.hex }}
                    />
                    <div className="flex-1">
                      <div className="font-mono text-[12px] text-[#fafafa]">{c.hex}</div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">{c.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* CONTACT */}
        <section className="my-16" data-testid="press-contact">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ Press Contact
          </div>
          <div className="border-2 border-[#ff4500] bg-[#0a0a0a] p-6 md:p-8">
            <div className="grid md:grid-cols-[2fr_1fr] gap-6 items-center">
              <div>
                <div className="font-display text-2xl md:text-3xl text-[#fafafa] mb-1">Mike Williams</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#a3a3a3] mb-3">
                  Founder · CraftersMarket
                </div>
                <p className="text-sm text-[#a3a3a3]">
                  Available for interviews, podcasts, and quotes. Response within 24 hours.
                </p>
              </div>
              <a
                href="mailto:team@craftersmarket.org?subject=Press%20Inquiry"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#ff4500] hover:bg-[#ff5722] text-black font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
                data-testid="press-email-cta"
              >
                <Mail size={14} /> team@craftersmarket.org
              </a>
            </div>
          </div>
        </section>

        <div className="text-center mt-12">
          <Link
            to="/founders"
            className="inline-flex items-center gap-1 text-sm text-[#a3a3a3] hover:text-[#ff4500] font-mono uppercase tracking-[0.22em]"
            data-testid="press-founders-link"
          >
            View the Founders page <ExternalLink size={12} />
          </Link>
        </div>
      </div>
    </main>
  );
}
