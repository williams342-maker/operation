import React from "react";
import { motion } from "framer-motion";
import { Hammer, ShieldCheck, Workflow, Sparkles } from "lucide-react";

/**
 * SEO content block for the homepage.
 *
 * Two roles in one component:
 *   1. Visible UX — answers a real question for first-time buyers:
 *      "what is this site? how is it different from Etsy/Amazon?"
 *   2. Search engine signal — pushes the homepage past the 800-word
 *      threshold flagged by SEO Check, while echoing the H1 keywords
 *      ("Find · Built · Hand · Maker · CNC") in body copy. Crawlers
 *      reward keyword consistency between H1 and content.
 *
 * Designed to feel intentional, not stuffed: each section answers a
 * common pre-purchase question independent makers can't answer
 * individually on their own product pages.
 */
export default function WhyHandcrafted() {
  return (
    <section
      className="w-full py-20 md:py-28 bg-[#0a0a0a] border-b border-[#262626]"
      data-testid="why-handcrafted"
    >
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        {/* Eyebrow + section H2 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mb-10"
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ Why find something built by hand?
          </div>
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[0.95] mb-5">
            Built by makers,<br />not factories.
          </h2>
          <p className="font-mono text-sm text-[#d4d4d4] leading-relaxed max-w-2xl">
            Crafters Market is a curated marketplace for precision CNC
            artisans, plasma-cutting metalworkers, and small woodshops
            shipping handcrafted goods directly from the maker's bench
            to your door. Every shop is independently owned, hand-vetted,
            and paid out through Stripe — no middlemen, no warehouses,
            no race-to-the-bottom marketplace pricing.
          </p>
        </motion.div>

        {/* Three-column "differentiators" */}
        <div className="grid md:grid-cols-3 gap-6 mb-14">
          <Pillar
            icon={Hammer}
            eyebrow="01 · Hand-built"
            title="Real makers, real shops"
            body="Every listing on Crafters Market is built by an approved CNC artist or woodworker we've personally vetted. You can read each maker's story, see their workshop, and message them directly before you buy. No drop-shippers. No printing-on-demand. No factories overseas pretending to be small."
            testId="why-hand-built"
          />
          <Pillar
            icon={Workflow}
            eyebrow="02 · Precision CNC"
            title="Plasma, laser & router"
            body="Our makers run plasma cutters, fiber lasers, CO₂ engravers, and CNC routers — the same machines used in industrial fabrication, scaled down for one-off custom work. The result is something a 3D printer can't touch: heirloom-grade signage, wall art, and made-to-order signs cut from real steel and hardwood."
            testId="why-precision-cnc"
          />
          <Pillar
            icon={ShieldCheck}
            eyebrow="03 · Built to last"
            title="Stripe-secured, maker-owned"
            body="Checkout runs through Stripe Connect, so payment goes straight to the maker's bank — minus a flat 5% platform fee that keeps the lights on. You get buyer protection, the maker keeps 95% of the sale, and we never resell your data or surface your purchase history to third parties."
            testId="why-built-to-last"
          />
        </div>

        {/* "How it works" — 4 numbered steps adds another ~200 words */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="border-t border-[#262626] pt-12"
        >
          <div className="flex items-center gap-2 mb-6">
            <Sparkles size={14} className="text-[#ff4500]" />
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
              ◆ How a Crafters Market order works
            </div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Step
              n="01"
              title="Find your piece"
              body="Browse handcrafted wall art, custom signs, address numbers, business signage, and made-to-order CNC pieces. Filter by technique (plasma, laser, router), category, or price. Save favorites to revisit later."
              testId="step-find"
            />
            <Step
              n="02"
              title="Talk to the maker"
              body="Want a custom size, a different finish, or your family name on it? Message the maker directly from the listing page. Most reply within 24 hours and can quote a custom build in a single thread."
              testId="step-talk"
            />
            <Step
              n="03"
              title="Pay safely"
              body="Checkout uses Stripe — the same processor Shopify and Substack use. Every transaction is encrypted, and your card is never stored on our servers. Apple Pay, Google Pay, and standard card payments all supported."
              testId="step-pay"
            />
            <Step
              n="04"
              title="Track to your door"
              body="The moment your maker drops off the package, tracking auto-fires to your inbox and (if you opt in) as a browser push notification. We never spam — just shipping updates and a delivery confirmation."
              testId="step-track"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Pillar({ icon: Icon, eyebrow, title, body, testId }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6 }}
      className="bg-[#121212] border border-[#262626] hover:border-[#ff4500]/60 transition-colors p-7"
      data-testid={testId}
    >
      <div className="w-10 h-10 border border-[#ff4500] bg-[#1a0a05] flex items-center justify-center mb-5">
        <Icon size={18} className="text-[#ff4500]" />
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#a3a3a3] mb-2">
        {eyebrow}
      </div>
      <h3 className="font-display text-2xl md:text-3xl leading-tight mb-3">{title}</h3>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">{body}</p>
    </motion.div>
  );
}

function Step({ n, title, body, testId }) {
  return (
    <div className="relative pl-1" data-testid={testId}>
      <div className="font-display text-5xl text-[#ff4500]/70 leading-none mb-3">{n}</div>
      <h4 className="font-display text-xl mb-2">{title}</h4>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">{body}</p>
    </div>
  );
}
