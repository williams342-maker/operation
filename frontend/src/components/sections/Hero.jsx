/**
 * iter354 — Crafters Market rotating homepage hero.
 *
 * Cycles through 4 craft-themed "sets" every 6s. Each set has:
 *   - a 3-line headline (line 1 + line 2 with a `highlight` word
 *     rendered in brand-orange, optionally a leading word)
 *   - 4 photo panels rendered with the same diagonal clip-path
 *
 * Implementation notes
 * --------------------
 * - All photo URLs are pre-loaded on mount (`Image()` warming) so the
 *   first crossfade isn't blocky.
 * - Crossfade is just an opacity transition between two stacked
 *   `<HeroPanels>` — the outgoing set fades out while the incoming
 *   fades in.
 * - Headline uses framer-motion AnimatePresence so each set's H1
 *   slides up + fades.
 * - Reduced-motion users get a static first set with no rotation.
 * - Hover/focus inside the hero pauses the timer (so users can read).
 * - Tiny dot pager below the trust strip lets users click to jump.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Users, Hammer, HandHeart, HeartHandshake, Wrench, ShoppingBag, ArrowRight } from "lucide-react";
import SitePromo from "../SitePromo";

const SETS = [
  {
    name: "small-shops",
    promo_placement: "hero_set_0",
    eyebrow: "Built by Makers · Real Workshops",
    headline: {
      line1: "Built by Makers.",
      pre: null,
      highlight: "Crafted",
      post: "to Last.",
    },
    body: "Real workshops. Real makers. Handmade goods with stories behind every piece. From woodworkers and fiber artists to jewelers, potters, leatherworkers, glass artists, and metal makers — no mass production, no drop shipping. Just independent creators doing exceptional work.",
    photos: [
      { src: "/hero-photos/0-0.jpg", alt: "Woodworking plane curling fresh shavings" },
      { src: "/hero-photos/0-1.jpg", alt: "Leather worker hand-tooling a stitched piece" },
      { src: "/hero-photos/0-2.jpg", alt: "Metal grinder throwing sparks" },
      { src: "/hero-photos/0-3.jpg", alt: "Hands shaping a ceramic mug on a potter's wheel" },
    ],
  },
  {
    name: "real-people",
    promo_placement: "hero_set_1",
    eyebrow: "Real Hands · Real Workshops",
    headline: {
      line1: "Made by",
      pre: "Real",
      highlight: "People.",
      post: null,
    },
    body: "Every piece on Crafters Market is touched by a human — measured, cut, hammered, stitched, fired, finished. Behind each listing is one person (or a small crew) sweating over the details. You're not buying a product. You're buying their decade of practice.",
    photos: [
      { src: "/hero-photos/1-0.jpg", alt: "Hands at work in a busy artisan workshop" },
      { src: "/hero-photos/1-1.jpg", alt: "Weaver working colored threads on a loom" },
      { src: "/hero-photos/1-2.jpg", alt: "Blacksmith hammering hot iron on an anvil" },
      { src: "/hero-photos/1-3.jpg", alt: "Glassblower shaping molten glass" },
    ],
  },
  {
    name: "american-made",
    promo_placement: "hero_set_2",
    eyebrow: "American-Made · Built to Last",
    headline: {
      line1: "Made in America.",
      pre: "Made to",
      highlight: "Last.",
      post: null,
    },
    body: "Heirloom-grade joinery. Full-grain leather that breaks in instead of breaking down. Hand-forged steel that holds an edge for a decade. The makers on this site aren't competing on price with overseas fast goods — they're competing on whether their work outlives them.",
    photos: [
      { src: "/hero-photos/2-0.jpg", alt: "Handcrafted wooden workbench with hand tools" },
      { src: "/hero-photos/2-1.jpg", alt: "Hand-stitched leather wallet with brass details" },
      { src: "/hero-photos/2-2.jpg", alt: "Hand-forged knife on a wooden surface" },
      { src: "/hero-photos/2-3.jpg", alt: "Stacked stoneware bowls fresh from the kiln" },
    ],
  },
  {
    name: "one-of-a-kind",
    promo_placement: "hero_set_3",
    eyebrow: "Tactile · Unique · Yours",
    headline: {
      line1: "One of a kind.",
      pre: "Every",
      highlight: "Time.",
      post: null,
    },
    body: "No two pieces ever come out exactly alike. The grain runs different. The hammer marks land different. The glaze pools different. That's not a defect — that's a fingerprint. Pick a maker whose fingerprint you love.",
    photos: [
      { src: "/hero-photos/3-0.jpg", alt: "Live-edge wood slab showing dramatic grain" },
      { src: "/hero-photos/3-1.jpg", alt: "Handwoven textile with bold geometric pattern" },
      { src: "/hero-photos/3-2.jpg", alt: "Hand-thrown ceramic with reactive glaze" },
      { src: "/hero-photos/3-3.jpg", alt: "Hand-stamped silver jewelry on linen" },
    ],
  },
];

const ROTATE_MS = 6000;

const TRUST_ITEMS = [
  { Icon: HandHeart,    label: "Support Small",        body: "Every purchase supports independent makers." },
  { Icon: Users,        label: "Made by Real People",  body: "Products crafted in workshops, studios, and home shops across the US." },
  { Icon: Wrench,       label: "Quality Craftsmanship", body: "Carefully made, sourced, and selected with care." },
  { Icon: Hammer,       label: "Maker First",          body: "Fair fees, real support, built for makers." },
  { Icon: HeartHandshake, label: "Real Community",     body: "Join a community that creates and inspires." },
];

export default function Hero() {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // Preload every image after first paint so crossfades are smooth.
  useEffect(() => {
    SETS.forEach((s) => s.photos.forEach((p) => {
      const im = new Image();
      im.src = p.src;
    }));
  }, []);

  // Auto-advance unless reduced-motion or paused.
  const timerRef = useRef(null);
  useEffect(() => {
    if (reduce || paused) return;
    timerRef.current = setTimeout(() => {
      setIdx((i) => (i + 1) % SETS.length);
    }, ROTATE_MS);
    return () => clearTimeout(timerRef.current);
  }, [idx, reduce, paused]);

  const set = SETS[idx];

  // Staggered intro on first paint (no exit/re-enter on rotation —
  // headline crossfade uses AnimatePresence below).
  const stagger = (delay) => (reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] },
      });

  return (
    <section
      className="relative cm-hero-wash bg-paper text-ink overflow-hidden"
      data-testid="home-hero"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-texture-grain opacity-[0.04] mix-blend-multiply dark:opacity-[0.06] dark:mix-blend-screen"
      />

      <div className="relative max-w-[1500px] mx-auto px-6 md:px-10 lg:px-14 pt-12 md:pt-20 pb-12 md:pb-20">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* LEFT — Copy block (cross-fades on rotation) */}
          <div className="relative z-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={`set-${idx}`}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="flex items-center gap-3 mb-6">
                  <span className="h-px w-8 bg-brand" />
                  <span className="font-mono text-xs sm:text-sm font-bold tracking-[0.22em] uppercase text-brand">
                    {set.eyebrow}
                  </span>
                  <span className="h-px w-8 bg-brand" />
                </div>

                <h1
                  className="font-heading text-5xl sm:text-7xl lg:text-8xl uppercase leading-[0.92] tracking-tight text-ink"
                  data-testid="home-hero-h1"
                  aria-live="polite"
                >
                  {set.headline.line1}
                  <br />
                  {set.headline.pre && (<><span className="text-ink">{set.headline.pre}</span>{" "}</>)}
                  <span className="text-brand">{set.headline.highlight}</span>
                  {set.headline.post && (<>{" "}<span className="text-ink">{set.headline.post}</span></>)}
                </h1>

                <p className="mt-7 font-body text-base sm:text-lg leading-relaxed text-ink-muted max-w-xl">
                  {set.body}
                </p>
              </motion.div>
            </AnimatePresence>

            <motion.div
              {...stagger(0.3)}
              className="mt-9 flex flex-wrap gap-3"
            >
              {/* iter384 — user-requested lineup: SHOP leads (filled brand),
                  Browse Makers steps down to a soft tint, Sell Your Work
                  stays the outlined tertiary. */}
              <Link
                to="/shop"
                className="inline-flex items-center gap-2 px-6 py-3 bg-brand hover:bg-brand-hover text-white font-mono text-xs uppercase tracking-[0.22em] transition-colors"
                data-testid="home-hero-cta-shop"
              >
                <ShoppingBag size={14} />
                Shop
              </Link>
              <Link
                to="/makers"
                className="inline-flex items-center gap-2 px-6 py-3 border-2 border-ink bg-[color-mix(in_srgb,var(--brand)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--brand)_55%,transparent)] text-ink font-mono text-xs uppercase tracking-[0.22em] transition-colors"
                data-testid="home-hero-cta-browse"
              >
                <Users size={14} />
                Browse Makers
              </Link>
              <Link
                to="/apply"
                className="group inline-flex items-center gap-2 px-6 py-3 border-[3px] border-ink hover:border-brand bg-paper hover:bg-ink hover:text-paper text-ink font-mono text-xs uppercase tracking-[0.22em] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_var(--brand)]"
                data-testid="home-hero-cta-sell"
              >
                <Hammer size={14} />
                Sell Your Work
                <ArrowRight
                  size={14}
                  className="transition-transform duration-200 group-hover:translate-x-1"
                />
              </Link>
            </motion.div>

            {/* Pager dots — click to jump to a set */}
            <div
              className="mt-8 flex items-center gap-2"
              role="tablist"
              aria-label="Hero featured craft"
              data-testid="home-hero-pager"
            >
              {SETS.map((s, i) => {
                const active = i === idx;
                return (
                  <button
                    key={s.eyebrow}
                    role="tab"
                    aria-selected={active}
                    aria-label={`Show featured craft ${i + 1}: ${s.eyebrow}`}
                    onClick={() => setIdx(i)}
                    className={`h-[3px] transition-all duration-500 ${active ? "w-10 bg-brand" : "w-5 bg-line hover:bg-ink-muted"}`}
                    data-testid={`home-hero-pager-${i}`}
                    data-active={active}
                  />
                );
              })}
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted tabular-nums">
                {String(idx + 1).padStart(2, "0")} / {String(SETS.length).padStart(2, "0")}
              </span>
            </div>
          </div>

          {/* RIGHT — Photo collage with crossfade between sets */}
          <div
            className="relative w-full aspect-[6/5] lg:aspect-[7/5]"
            data-testid="home-hero-collage"
          >
            <AnimatePresence>
              <motion.div
                key={`collage-${idx}`}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: "easeInOut" }}
                className="absolute inset-0 grid grid-cols-4 gap-0"
              >
                {set.photos.map((p, i) => (
                  <div
                    key={p.src}
                    className="relative overflow-hidden border-x border-paper"
                    style={{
                      clipPath: "polygon(15% 0, 100% 0, 85% 100%, 0 100%)",
                      marginLeft: i === 0 ? "0" : "-12%",
                      zIndex: 4 - i,
                    }}
                  >
                    <img
                      src={p.src}
                      alt={p.alt}
                      className="w-full h-full object-cover"
                      loading={idx === 0 && i < 2 ? "eager" : "lazy"}
                    />
                  </div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Trust strip (static — does not rotate) */}
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

      {/* iter356 — Per-set SitePromo banner. When admin schedules a promo
          for placement `hero_set_{N}`, it surfaces here ONLY while that
          hero set is active. Keyed by idx so it re-mounts (refetches +
          re-evaluates dismissal) when the rotation advances. Renders
          nothing if no active promo exists for the current placement. */}
      <SitePromo
        key={set.promo_placement}
        placement={set.promo_placement}
        data-testid={`hero-promo-${set.promo_placement}`}
      />
    </section>
  );
}
