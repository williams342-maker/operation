/**
 * iter349 — Crafters Market homepage hero (light-theme redesign).
 *
 * Matches the mockup blueprint:
 *   - Eyebrow ("BUILT BY INDEPENDENT MAKERS · US") in orange small-caps
 *   - H1 "SMALL SHOPS. BIG POTENTIAL." with "BIG" highlighted in brand
 *   - Body copy in ink-muted
 *   - Dual CTAs: solid orange "Browse Makers" + outline "Sell Your Work"
 *   - 4 diagonal photo panels on the right (clip-path slant)
 *   - Trust strip beneath with 5 monoline icons
 *
 * Staggered fade-up entrance per the design brief.
 */
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Users, Hammer, HandHeart, HeartHandshake, Wrench, Leaf } from "lucide-react";

const HERO_PHOTOS = [
  {
    src: "https://images.unsplash.com/photo-1470342495351-a5f90c5011cd?crop=entropy&cs=srgb&fm=jpg&w=900&q=80",
    alt: "Woodworking plane curling fresh shavings on a workbench",
  },
  {
    src: "https://images.unsplash.com/photo-1628483211662-9bcc692c46dc?crop=entropy&cs=srgb&fm=jpg&w=900&q=80",
    alt: "Leather worker tooling a hand-stitched piece",
  },
  {
    src: "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?crop=entropy&cs=srgb&fm=jpg&w=900&q=80",
    alt: "Metal grinder throwing sparks in a small fabrication shop",
  },
  {
    src: "https://images.unsplash.com/photo-1595351298020-038700609878?crop=entropy&cs=srgb&fm=jpg&w=900&q=80",
    alt: "Hands shaping a ceramic mug on a potter's wheel",
  },
];

const TRUST_ITEMS = [
  { Icon: HandHeart,    label: "Support Small",       body: "Every purchase supports independent makers." },
  { Icon: Users,        label: "Made by Real People", body: "Products crafted in workshops, studios, and home shops across the US." },
  { Icon: Wrench,       label: "Quality Craftsmanship", body: "Carefully made, sourced, and selected with care." },
  { Icon: Hammer,       label: "Maker First",         body: "Fair fees, real support, built for makers." },
  { Icon: HeartHandshake, label: "Real Community",    body: "Join a community that creates and inspires." },
];

export default function Hero() {
  const reduce = useReducedMotion();

  // Fade-up choreography: eyebrow → H1 → body → CTAs.
  const stagger = (delay) => (reduce
    ? {}
    : {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
      });

  return (
    <section
      className="relative bg-paper text-ink overflow-hidden"
      data-testid="home-hero"
    >
      {/* Subtle paper grain overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-texture-grain opacity-[0.04] mix-blend-multiply dark:opacity-[0.06] dark:mix-blend-screen"
      />

      <div className="relative max-w-[1500px] mx-auto px-6 md:px-10 lg:px-14 pt-12 md:pt-20 pb-12 md:pb-20">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* LEFT — Copy block */}
          <div className="relative z-10">
            <motion.div
              {...stagger(0.0)}
              className="flex items-center gap-3 mb-6"
            >
              <span className="h-px w-8 bg-brand" />
              <span className="font-mono text-xs sm:text-sm font-bold tracking-[0.22em] uppercase text-brand">
                Built by Independent Makers · US
              </span>
              <span className="h-px w-8 bg-brand" />
            </motion.div>

            <motion.h1
              {...stagger(0.12)}
              className="font-heading text-5xl sm:text-7xl lg:text-8xl uppercase leading-[0.92] tracking-tight text-ink"
              data-testid="home-hero-h1"
            >
              Small Shops.
              <br />
              <span className="text-brand">Big</span>{" "}
              <span className="text-ink">Potential.</span>
            </motion.h1>

            <motion.p
              {...stagger(0.24)}
              className="mt-7 font-body text-base sm:text-lg leading-relaxed text-ink-muted max-w-xl"
            >
              Built for independent makers, woodworkers, leather workers, metal crafters, and creators — from workshops and studios to garages and small shops. Real products from real people. No mass production. No drop-shipping. Just small businesses with stories behind what they make.
            </motion.p>

            <motion.div
              {...stagger(0.36)}
              className="mt-9 flex flex-wrap gap-3"
            >
              <Link
                to="/makers"
                className="inline-flex items-center gap-2 px-6 py-3 bg-brand hover:bg-brand-hover text-ink font-mono text-xs uppercase tracking-[0.22em] transition-colors"
                data-testid="home-hero-cta-browse"
              >
                <Users size={14} />
                Browse Makers
              </Link>
              <Link
                to="/apply"
                className="inline-flex items-center gap-2 px-6 py-3 border-2 border-ink hover:bg-ink hover:text-paper text-ink font-mono text-xs uppercase tracking-[0.22em] transition-colors"
                data-testid="home-hero-cta-sell"
              >
                <Hammer size={14} />
                Sell Your Work
              </Link>
            </motion.div>
          </div>

          {/* RIGHT — Diagonal photo collage */}
          <motion.div
            initial={reduce ? {} : { opacity: 0, x: 40 }}
            animate={reduce ? {} : { opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full aspect-[6/5] lg:aspect-[7/5]"
            data-testid="home-hero-collage"
          >
            <div className="absolute inset-0 grid grid-cols-4 gap-0">
              {HERO_PHOTOS.map((p, i) => (
                <div
                  key={p.src}
                  className="relative overflow-hidden border-x border-paper"
                  style={{
                    clipPath: "polygon(15% 0, 100% 0, 85% 100%, 0 100%)",
                    marginLeft: i === 0 ? "0" : "-12%",
                    zIndex: HERO_PHOTOS.length - i,
                  }}
                >
                  <img
                    src={p.src}
                    alt={p.alt}
                    className="w-full h-full object-cover"
                    loading={i < 2 ? "eager" : "lazy"}
                  />
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Trust strip */}
      <div className="border-t border-line bg-paper relative z-10">
        <div className="max-w-[1500px] mx-auto px-6 md:px-10 lg:px-14 py-8 md:py-10">
          <ul
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-6 lg:divide-x lg:divide-line"
            data-testid="home-hero-trust"
          >
            {TRUST_ITEMS.map(({ Icon, label, body }, i) => (
              <li
                key={label}
                className="flex items-start gap-3 px-0 lg:px-6 first:lg:pl-0 last:lg:pr-0"
                data-testid={`home-hero-trust-${i}`}
              >
                <Icon size={22} strokeWidth={1.4} className="text-ink shrink-0 mt-0.5" />
                <div>
                  <div className="font-heading text-sm uppercase tracking-wide text-ink leading-snug">
                    {label}
                  </div>
                  <div className="font-body text-xs text-ink-muted leading-snug mt-0.5">
                    {body}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
