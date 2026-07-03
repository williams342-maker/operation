import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, MapPin } from "lucide-react";
import { fetchHomepageMakers } from "../lib/api";

/**
 * "Meet Our Makers" — 9-slot fair-exposure showcase (iter331d).
 *
 * Layout: 1 Hero (big cinematic card, top-left) + 2 Featured (right column)
 * + 6 Grid (compact row underneath). Powered by
 * /api/community/homepage-makers which returns each maker tagged with
 * `position ∈ {hero, featured, grid}`. Selection is period-locked and
 * deterministic — see the admin panel's "Homepage rotation" card for
 * eligibility rules + the audit ledger.
 *
 * Section auto-hides when zero eligible makers exist so we never
 * render a lonely header with no cards.
 */

// Friendly craft labels — mirrors what MakerDetail shows.
const CRAFT_LABEL = {
  PLASMA: "Plasma",
  LASER: "Laser",
  ROUTER: "Router",
  FORGE: "Forge",
  CUSTOM: "Custom",
  "3D": "3D Print",
};
const primaryCraft = (m) => {
  const t = (m.techniques || [])[0];
  return CRAFT_LABEL[t] || t || m.featured_example || "Handcrafted";
};

export default function MeetTheMakers({ testId = "home-meet-makers" }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    fetchHomepageMakers()
      .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  const hero = items.filter((m) => m.position === "hero")[0] || null;
  const featured = items.filter((m) => m.position === "featured");
  const grid = items.filter((m) => m.position === "grid");

  return (
    <section
      className="relative w-full py-16 md:py-20 overflow-hidden bg-paper border-b border-line"
      data-testid={testId}
    >
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-[30%] right-[15%] w-[500px] h-[500px] copper-glow opacity-30" />
        <div className="absolute bottom-[10%] left-[12%] w-[420px] h-[420px] copper-glow copper-glow-warm opacity-20" />
      </div>
      <div className="absolute inset-0 blueprint-grid opacity-30 pointer-events-none" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="font-mono text-[11px] uppercase tracking-[0.32em] text-brand font-semibold mb-3">
            <span className="inline-block w-6 h-px bg-brand align-middle mr-2" />
            Meet Our Makers
            <span className="inline-block w-6 h-px bg-brand align-middle ml-2" />
          </div>
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl tracking-tighter leading-[0.95]">
            Real people.<br className="md:hidden" />{" "}
            <span className="text-outline-orange">Real craftsmanship.</span>
          </h2>
          <p className="font-mono text-[12px] text-ink-muted mt-5 max-w-2xl mx-auto leading-relaxed">
            Every maker on Crafters Market is application-vetted, location-verified,
            and reachable directly — no resellers, no dropshipping.
          </p>
        </div>

        {/* Top row: Hero (2/3) + Featured column (1/3, stacked) */}
        {hero && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 md:gap-6 mb-6 md:mb-8">
            <div className="xl:col-span-2">
              <HeroCard m={hero} testId={`${testId}-hero-${hero.slug}`} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-5 md:gap-6">
              {featured.map((m) => (
                <FeaturedCard
                  key={m.id || m.slug}
                  m={m}
                  testId={`${testId}-featured-${m.slug}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Bottom grid: 6 compact cards */}
        {grid.length > 0 && (
          <>
            <div className="flex items-center gap-3 mb-5 md:mb-6">
              <span className="h-px flex-1 bg-line" />
              <div className="font-display text-lg md:text-xl tracking-tight text-ink-muted">
                More Amazing Makers
              </div>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 md:gap-5">
              {grid.map((m) => (
                <GridCard
                  key={m.id || m.slug}
                  m={m}
                  testId={`${testId}-grid-${m.slug}`}
                />
              ))}
            </div>
          </>
        )}

        {/* Browse-all footer button */}
        <div className="mt-10 md:mt-12 flex justify-center">
          <Link
            to="/makers"
            className="inline-flex items-center gap-2 px-6 py-3 border border-line bg-surface hover:bg-brand hover:text-white hover:border-brand transition-colors font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid={`${testId}-view-all`}
          >
            Browse All Makers <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Hero card ────────────────────────────────────────────────────────
// Large, cinematic. Cover fills the frame with a dark gradient scrim
// so the copy (location + name + craft + bio + CTA) reads over it.
function HeroCard({ m, testId }) {
  const bg = m.cover || m.portrait || "";
  const bioBlurb = (m.bio || m.story || "").slice(0, 220).trimEnd();
  const bioTrail = (m.bio || m.story || "").length > 220 ? "…" : "";
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45 }}
      className="relative overflow-hidden border border-line bg-ink group h-full min-h-[420px] md:min-h-[560px]"
      data-testid={testId}
    >
      {bg && (
        <img
          src={bg}
          alt={m.name || m.slug}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
      <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand text-white font-mono text-[9px] uppercase tracking-[0.28em]">
        ★ Featured Maker
      </div>
      <div className="relative z-10 p-6 md:p-8 flex flex-col justify-end h-full text-white">
        {m.location && (
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-white/80 mb-3">
            <MapPin className="w-3.5 h-3.5" />
            {m.location}
          </div>
        )}
        <h3 className="font-display text-3xl md:text-5xl tracking-tight leading-[1.02] mb-2">
          {m.name || m.slug}
        </h3>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/80 mb-4">
          {primaryCraft(m)}
        </div>
        {bioBlurb && (
          <p className="text-sm md:text-base text-white/85 max-w-lg leading-relaxed mb-5">
            {bioBlurb}{bioTrail}
          </p>
        )}
        <Link
          to={`/makers/${m.slug}`}
          className="inline-flex items-center gap-2 self-start px-5 py-2.5 bg-brand hover:bg-brand-hover text-white font-mono text-[11px] uppercase tracking-[0.22em] transition-colors"
          data-testid={`${testId}-cta`}
        >
          View Maker <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </motion.article>
  );
}

// ── Featured card ────────────────────────────────────────────────────
// Mid-size. Cover on top, meta + short blurb + CTA below.
function FeaturedCard({ m, testId }) {
  const cover = m.cover || m.portrait || "";
  const bioBlurb = (m.bio || m.story || "").slice(0, 120).trimEnd();
  const bioTrail = (m.bio || m.story || "").length > 120 ? "…" : "";
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45 }}
      className="border border-line bg-surface overflow-hidden flex flex-col h-full group"
      data-testid={testId}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-paper">
        {cover ? (
          <img
            src={cover}
            alt={m.name || m.slug}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-display text-4xl text-ink-muted">
            {m.initials || (m.name || m.slug || "?")[0].toUpperCase()}
          </div>
        )}
        <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 bg-brand text-white font-mono text-[8px] uppercase tracking-[0.24em]">
          ★ Featured
        </div>
      </div>
      <div className="p-4 md:p-5 flex flex-col flex-1">
        {m.location && (
          <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.24em] text-ink-muted mb-2">
            <MapPin className="w-3 h-3" />
            {m.location}
          </div>
        )}
        <h3 className="font-display text-xl md:text-2xl tracking-tight leading-tight mb-1">
          {m.name || m.slug}
        </h3>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
          {primaryCraft(m)}
        </div>
        {bioBlurb && (
          <p className="text-sm text-ink-muted leading-relaxed mb-4 flex-1">
            {bioBlurb}{bioTrail}
          </p>
        )}
        <Link
          to={`/makers/${m.slug}`}
          className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-brand hover:text-brand-hover self-start"
          data-testid={`${testId}-cta`}
        >
          View Maker <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </motion.article>
  );
}

// ── Grid card ────────────────────────────────────────────────────────
// Compact. Cover + name + location + craft + View Maker.
function GridCard({ m, testId }) {
  const cover = m.cover || m.portrait || "";
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className="border border-line bg-surface overflow-hidden flex flex-col group"
      data-testid={testId}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-paper">
        {cover ? (
          <img
            src={cover}
            alt={m.name || m.slug}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-display text-3xl text-ink-muted">
            {m.initials || (m.name || m.slug || "?")[0].toUpperCase()}
          </div>
        )}
      </div>
      <div className="p-3 md:p-4 flex flex-col flex-1">
        {m.location && (
          <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.24em] text-ink-muted mb-1.5">
            <MapPin className="w-3 h-3" />
            <span className="truncate">{m.location}</span>
          </div>
        )}
        <h3 className="font-display text-base md:text-lg tracking-tight leading-tight mb-0.5 truncate">
          {m.name || m.slug}
        </h3>
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted mb-3 truncate">
          {primaryCraft(m)}
        </div>
        <Link
          to={`/makers/${m.slug}`}
          className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.22em] text-brand hover:text-brand-hover self-start mt-auto"
          data-testid={`${testId}-cta`}
        >
          View Maker <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </motion.article>
  );
}
