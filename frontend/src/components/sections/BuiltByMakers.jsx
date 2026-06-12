/**
 * iter277 — "Built by Makers. Powered by Innovation."
 *
 * Bottom-of-homepage trust-strip linking out to our sister brands:
 *   • Williams CNC      → the original CNC studio (typographic wordmark)
 *   • Crafters Market   → the marketplace you're already on (icon logo)
 *   • CortexViral       → the AI growth engine behind the platform
 *
 * Each card is a self-contained <a> so the whole tile is one big tap
 * target. Visual hierarchy: card border → logo (image or wordmark) →
 * brand name → one-line descriptor → "Visit →" affordance.
 *
 * Rendered as the LAST child of the homepage Home component (above the
 * global <Footer />). Lives in its own file so adding/removing brands
 * later is a one-component diff.
 */
import React from "react";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";


const BRANDS = [
  {
    name: "Williams CNC",
    href: "https://williamscnc.com",
    descriptor: "Precision CNC art · 30+ years · the studio behind it all",
    accent: "#c97b3c",  // copper, matching williamscnc.com's brand
    // No public logo PNG on williamscnc.com — render a typographic
    // wordmark in their copper accent so the card still feels "branded"
    // without hot-linking an asset that might 404 later.
    wordmark: "WILLIAMS / CNC",
  },
  {
    name: "Crafters Market",
    href: "https://craftersmarket.org",
    descriptor: "The maker marketplace — vetted American crafters, fair payouts",
    accent: "#ff4500",
    logo: "/icons/icon-512.png",
  },
  {
    name: "CortexViral",
    href: "https://cortexviral.com",
    descriptor: "AI growth team — content, distribution, scale on autopilot",
    accent: "#7c3aed",
    logo: "https://cortexviral.com/cortex-logo.png",
  },
];


export default function BuiltByMakers() {
  return (
    <section
      data-testid="built-by-makers"
      className="relative border-t border-line bg-paper py-20 md:py-24 px-6"
    >
      {/* Subtle radial glow centered behind the title — never distracting */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-brand/[0.04] blur-[120px]" />
      </div>

      <div className="relative max-w-6xl mx-auto">
        {/* Eyebrow + title */}
        <div className="text-center mb-12 md:mb-16">
          <div
            className="font-mono text-[10px] uppercase tracking-[0.35em] text-brand mb-4"
            data-testid="built-by-makers-eyebrow"
          >
            ◆ The Network
          </div>
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5 }}
            className="font-display text-3xl sm:text-4xl md:text-5xl leading-tight text-ink"
            data-testid="built-by-makers-title"
          >
            Built by Makers.{" "}
            <span className="text-brand">Powered by Innovation.</span>
          </motion.h2>
          <p className="mt-4 max-w-xl mx-auto text-sm md:text-base text-ink-muted">
            Three sister brands. One mission — give independent fabricators
            the tools, marketplace, and audience to compete with anyone.
          </p>
        </div>

        {/* Three brand cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
          {BRANDS.map((b, i) => (
            <motion.a
              key={b.name}
              href={b.href}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="group relative block border border-line bg-paper p-6 md:p-7 transition-all duration-300 hover:bg-surface-2 hover:border-line"
              style={{ "--accent": b.accent }}
              data-testid={`built-by-makers-card-${b.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {/* Hover accent line on the top edge */}
              <span
                className="absolute top-0 left-0 h-px w-0 transition-all duration-500 group-hover:w-full"
                style={{ backgroundColor: b.accent }}
                aria-hidden="true"
              />

              {/* Logo / wordmark slot — fixed height so all three align */}
              <div className="h-20 flex items-center mb-5">
                {b.logo ? (
                  <img
                    src={b.logo}
                    alt={`${b.name} logo`}
                    loading="lazy"
                    decoding="async"
                    className="h-16 w-auto max-w-[140px] object-contain"
                  />
                ) : (
                  <span
                    className="font-display text-2xl md:text-3xl tracking-tight"
                    style={{ color: b.accent }}
                  >
                    {b.wordmark}
                  </span>
                )}
              </div>

              {/* Brand name + descriptor */}
              <div className="font-display text-xl md:text-2xl text-ink mb-2">
                {b.name}
              </div>
              <p className="font-mono text-[11px] leading-relaxed text-ink-muted mb-6 min-h-[2.5rem]">
                {b.descriptor}
              </p>

              {/* Visit affordance */}
              <div
                className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors duration-300"
                style={{ color: b.accent }}
              >
                Visit
                <ArrowUpRight
                  size={14}
                  className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  aria-hidden="true"
                />
              </div>
            </motion.a>
          ))}
        </div>

        {/* iter382 — Shop CTA closing the homepage scroll. A buyer who read
            this far gets one last, unmissable path back into the catalog. */}
        <div className="mt-12 md:mt-14 text-center">
          <a
            href="/shop"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-brand hover:bg-brand-hover text-ink font-mono text-[12px] font-bold uppercase tracking-[0.3em] transition shadow-[0_0_0_2px_rgba(255,69,0,0.18)]"
            data-testid="built-by-makers-shop-btn"
          >
            ◆ Shop the marketplace →
          </a>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Handcrafted goods from vetted American makers
          </p>
        </div>
      </div>
    </section>
  );
}
