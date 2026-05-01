/**
 * Marketing landing page — funnels paid/social traffic into the /beta
 * signup flow. Accessible at 3 routes: /launch, /makers-beta, /for-makers
 * (same component — lets you A/B test URL variants in ad copy).
 *
 * Aesthetic: Crafters Market brand (dark #0a0a0a + orange #ff4500 accent,
 * Impact display font, JetBrains Mono labels, grain texture) — but
 * PUNCHIER than the main site: one message per viewport, big type,
 * bigger CTAs, no chrome. Optimized for conversion, not browsing.
 *
 * No form here by design — the CTAs all punch through to /beta where
 * the real signup form lives.
 */
import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { XCircle, CheckCircle2, ArrowRight, Flame } from "lucide-react";
import { useStructuredData } from "../lib/seo";

export default function LandingPage() {
  useStructuredData({
    title: "Stop Paying Fees. Start Owning Your Craft. · Crafters Market",
    description:
      "A marketplace built for CNC creators, woodworkers, and makers who are done with Etsy. Keep more of every sale. Built by makers, for makers. Free beta access open now.",
    url: "https://craftersmarket.org/launch",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] grain" data-testid="landing-page">
      {/* ============================================================
          HERO — single-viewport punch
       ============================================================ */}
      <section className="min-h-screen flex items-center justify-center px-6 pt-24 pb-16 relative overflow-hidden">
        {/* Orange glow behind the headline — sells "something's happening here" */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full bg-[#ff4500]/10 blur-[160px]" />
        </div>

        <div className="relative max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="font-mono text-[11px] uppercase tracking-[0.35em] text-[#ff4500] mb-8"
          >
            ◆ Crafters Market · Free Beta
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="font-display text-[56px] sm:text-[80px] md:text-[112px] lg:text-[140px] leading-[0.9] uppercase tracking-[-0.02em] mb-6"
            data-testid="landing-hero-headline"
          >
            Stop Paying<br />
            <span className="text-[#ff4500]">Fees.</span><br />
            Start Owning<br />
            Your Craft.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="font-mono text-sm md:text-base text-[#a3a3a3] max-w-2xl mx-auto mb-12 leading-relaxed"
          >
            A marketplace built for CNC creators, woodworkers, and makers who are done with Etsy.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="flex flex-col sm:flex-row gap-4 items-center justify-center"
          >
            <Link
              to="/beta"
              className="btn-industrial btn-primary inline-flex items-center gap-3 text-base px-10 py-5"
              data-testid="landing-hero-cta"
            >
              <Flame size={18} /> Join Free Beta <ArrowRight size={18} />
            </Link>
            <Link
              to="/shop"
              className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#a3a3a3] hover:text-[#ff4500] transition px-4 py-4"
              data-testid="landing-hero-secondary"
            >
              Or browse the catalog →
            </Link>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.75 }}
            className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#525252] mt-16"
          >
            Built by a CNC maker · Designed for real sellers · Launching now
          </motion.p>
        </div>
      </section>

      {/* ============================================================
          PROBLEM — why makers are leaving
       ============================================================ */}
      <section className="py-24 md:py-32 px-6 border-t border-[#1a1a1a]">
        <div className="max-w-6xl mx-auto">
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#525252] mb-4 text-center">
            ◆ The problem
          </div>
          <h2 className="font-display text-4xl sm:text-5xl md:text-6xl uppercase leading-[0.95] text-center mb-16 tracking-[-0.01em]">
            Why makers are<br />
            <span className="text-[#ff4500]">leaving marketplaces.</span>
          </h2>

          <div className="grid md:grid-cols-3 gap-6">
            <ProblemCard
              title="High fees eating your profits"
              body="15-20% off the top before you even count materials. You're funding someone else's yacht."
            />
            <ProblemCard
              title="Competing with mass-produced"
              body="Algorithms push drop-shippers to the top. Your hand-cut work buried on page 12."
            />
            <ProblemCard
              title="No control over customers"
              body="Can't email them. Can't build a list. Can't follow up. The platform owns the relationship."
            />
          </div>
        </div>
      </section>

      {/* ============================================================
          SOLUTION — what we do differently
       ============================================================ */}
      <section className="py-24 md:py-32 px-6 bg-[#0f0f0f] border-t border-[#1a1a1a]">
        <div className="max-w-6xl mx-auto">
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#ff4500] mb-4 text-center">
            ◆ The fix
          </div>
          <h2 className="font-display text-4xl sm:text-5xl md:text-6xl uppercase leading-[0.95] text-center mb-16 tracking-[-0.01em]">
            A platform that<br />
            actually works <span className="text-[#ff4500]">for you.</span>
          </h2>

          <div className="grid md:grid-cols-3 gap-6">
            <SolutionCard
              title="Keep more of every sale"
              body="Lower fees. Stripe-direct payouts. Own your margin. Period."
            />
            <SolutionCard
              title="Built for CNC & handmade"
              body="File-type aware (DXF, SVG, STL). Custom-order flow. Real maker tools."
            />
            <SolutionCard
              title="Direct connection with buyers"
              body="Your customer list is yours. DM makers. Restock notifications. Real relationships."
            />
          </div>
        </div>
      </section>

      {/* ============================================================
          CTA — final push
       ============================================================ */}
      <section className="py-32 px-6 border-t border-[#1a1a1a] text-center relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-[#ff4500]/10 blur-[140px]" />
        </div>
        <div className="relative max-w-3xl mx-auto">
          <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-[#ff4500] mb-6">
            ◆ Early Access · Free
          </div>
          <h2 className="font-display text-5xl sm:text-7xl md:text-8xl uppercase leading-[0.92] tracking-[-0.02em] mb-8">
            Claim Your<br /><span className="text-[#ff4500]">Spot.</span>
          </h2>
          <p className="font-mono text-sm text-[#a3a3a3] max-w-xl mx-auto mb-10 leading-relaxed">
            We're opening a limited number of beta spots for makers. No fees. No risk. Just early access.
          </p>
          <Link
            to="/beta"
            className="btn-industrial btn-primary inline-flex items-center gap-3 text-base px-12 py-5"
            data-testid="landing-final-cta"
          >
            Join the Beta <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* ============================================================
          FOUNDER NOTE — trust signal
       ============================================================ */}
      <section className="py-16 px-6 border-t border-[#1a1a1a] text-center">
        <p className="font-mono text-xs text-[#525252] max-w-xl mx-auto leading-relaxed italic">
          Built by a maker who got tired of platform fees.
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#525252] mt-4">
          ◇ craftersmarket.org
        </p>
      </section>
    </div>
  );
}

// -------------------- sub-components --------------------
function ProblemCard({ title, body }) {
  return (
    <div
      className="border border-[#1a1a1a] bg-[#0f0f0f] p-8 hover:border-[#ff4500]/40 transition-colors"
      data-testid="landing-problem-card"
    >
      <XCircle size={28} className="text-[#ff4500]/70 mb-5" />
      <h3 className="font-display text-2xl uppercase leading-tight mb-3">{title}</h3>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">{body}</p>
    </div>
  );
}

function SolutionCard({ title, body }) {
  return (
    <div
      className="border border-[#ff4500]/30 bg-gradient-to-br from-[#1a0a05] to-[#0f0f0f] p-8 hover:border-[#ff4500] transition-colors"
      data-testid="landing-solution-card"
    >
      <CheckCircle2 size={28} className="text-[#ff4500] mb-5" />
      <h3 className="font-display text-2xl uppercase leading-tight mb-3">{title}</h3>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">{body}</p>
    </div>
  );
}
