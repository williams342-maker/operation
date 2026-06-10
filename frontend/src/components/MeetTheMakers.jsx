/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, MapPin } from "lucide-react";
import { fetchMakers } from "../lib/api";

/**
 * "Meet the Makers" homepage section.
 *
 * People trust people more than platforms — this section humanises the
 * marketplace by surfacing 4 maker cards with a portrait + workshop cover
 * + location + specialties + a 2-sentence bio. Designed to be the warm,
 * personal counterweight to the more product-forward FeaturedBuildsRail
 * higher up the page.
 *
 * Curation: a hand-picked CURATED_SLUGS list leads (one per primary
 * craft — wood, metal, leather, blacksmith) so visitors always see craft
 * diversity at a glance. Anything else tails after, capped at 4 total.
 *
 * Self-hides when fewer than 3 cards qualify (a single maker alone looks
 * worse than no section at all).
 */

const CURATED_SLUGS = [
  "anvil-row-forge",      // blacksmith / forge — strongest portrait
  "river-and-resin",      // wood + epoxy — most colorful cover
  "iron-and-oak",         // CNC + plasma — flagship maker
  "hidehouse-craft",      // leather — adds a non-CNC dimension
];

// Friendly labels for the technique codes we store. Falls through to the
// raw code if a new technique is added before this map is updated.
const TECHNIQUE_LABEL = {
  PLASMA: "Plasma",
  LASER: "Laser",
  ROUTER: "Router",
  FORGE: "Forge",
  CUSTOM: "Custom",
  "3D": "3D Print",
};

export default function MeetTheMakers({ testId = "home-meet-makers" }) {
  const [makers, setMakers] = useState([]);

  useEffect(() => {
    fetchMakers()
      .then((d) => setMakers(Array.isArray(d) ? d : []))
      .catch(() => setMakers([]));
  }, []);

  const ordered = useMemo(() => {
    if (!makers.length) return [];
    const bySlug = new Map(makers.map((m) => [m.slug, m]));
    const head = CURATED_SLUGS.map((s) => bySlug.get(s)).filter(Boolean);
    const headSet = new Set(head.map((m) => m.slug));
    const tail = makers.filter((m) => !headSet.has(m.slug));
    return [...head, ...tail].slice(0, 4);
  }, [makers]);

  if (ordered.length < 3) return null;
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
        <div className="flex items-end justify-between mb-12 gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.32em] text-amber-400 mb-3 inline-flex items-center gap-2">
              <span className="inline-block w-6 h-px bg-amber-400" />
              Meet the Makers
            </div>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl tracking-tighter leading-[0.95]">
              The people behind<br />
              <span className="text-outline-orange">the work.</span>
            </h2>
            <p className="font-mono text-[12px] text-zinc-400 mt-5 max-w-2xl leading-relaxed">
              Real workshops. Real hands. Every maker on Crafters Market is application-vetted,
              location-verified, and reachable directly — no resellers, no dropshipping, no
              factory storefronts pretending to be artisans.
            </p>
          </div>
          <Link
            to="/makers"
            className="industrial-link font-mono text-[11px] uppercase tracking-[0.22em] text-amber-300 hover:text-amber-100 whitespace-nowrap"
            data-testid={`${testId}-view-all`}
          >
            See all makers →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 md:gap-6">
          {ordered.map((m, i) => (
            <MakerCard key={m.id || m.slug} m={m} i={i} testId={`${testId}-card-${m.slug}`} />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Single maker card. Stacked layout: workshop cover up top (sets the
 * scene), then a portrait + name row that breaks out of the cover via
 * negative margin so the photo feels embedded in the workshop, then
 * location, specialty pills, and the bio. Hovering the whole card
 * subtly lifts the orange accent border so it reads as clickable.
 */
function MakerCard({ m, i, testId }) {
  // Pull the first 220 chars of the bio so cards stay uniform — anything
  // longer than that the visitor can read on the maker's full profile.
  const bioBlurb = (m.bio || m.story || "").slice(0, 220).trimEnd();
  const bioTrail = (m.bio || m.story || "").length > 220 ? "…" : "";

  // Use cover when present, fall back to portrait so cards never have
  // a blank top frame.
  const workshopImg = m.cover || m.portrait || "/placeholder-shop.png";
  // The portrait can be empty or a stale CDN URL — fall back to cover on
  // load failure, then to a generated initials avatar if even the cover
  // is unavailable. Keeps the row clean for makers like Iron & Oak whose
  // portrait points to a now-404 CDN file.
  const [portraitSrc, setPortraitSrc] = useState(
    m.portrait || m.cover || "",
  );
  const [portraitFailed, setPortraitFailed] = useState(false);
  const handlePortraitErr = () => {
    if (portraitSrc !== m.cover && m.cover) {
      setPortraitSrc(m.cover);
      return;
    }
    setPortraitFailed(true);
  };
  // Some legacy portraits load with status 200 but render as a tiny stub
  // image — e.g. Iron & Oak's stale CDN path returns a 67-byte 1×1 PNG.
  // Any portrait under 60px on either side is almost certainly a broken
  // placeholder; swap it through the same fallback as a network error.
  const handlePortraitLoad = (e) => {
    const w = e.currentTarget.naturalWidth || 0;
    const h = e.currentTarget.naturalHeight || 0;
    if (w < 60 || h < 60) handlePortraitErr();
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ delay: (i % 4) * 0.08, duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
      className="cinematic-frame group flex flex-col"
      data-testid={testId}
    >
      <Link to={`/makers/${m.slug}`} className="block group">
        {/* Workshop cover — the "where" of the maker. */}
        <div className="relative aspect-[5/3] overflow-hidden">
          <img
            src={workshopImg}
            alt={`${m.name} workshop`}
            className="absolute inset-0 w-full h-full object-cover workshop-tone group-hover:scale-[1.06] group-hover:filter-none transition-all duration-[1100ms] ease-out"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
          <div className="absolute inset-0 cinematic-vignette pointer-events-none opacity-50" />
          {m.is_veteran_owned && (
            <span
              className="absolute top-3 right-3 px-2 py-1 bg-black/80 backdrop-blur-sm border border-emerald-400/70 text-emerald-300 font-mono text-[9px] uppercase tracking-[0.28em]"
              data-testid={`${testId}-veteran-pill`}
            >
              ◆ VETERAN
            </span>
          )}
          {m.featured_example && (
            <span
              className="absolute top-3 left-3 px-2 py-1 bg-amber-500 text-black font-mono text-[9px] uppercase tracking-[0.28em] font-bold"
              data-testid={`${testId}-founding-pill`}
              title="Founding Maker · curated by Crafters Market to showcase the platform"
            >
              ✦ FOUNDING MAKER
            </span>
          )}
        </div>

        <div className="px-5 pt-0 pb-5 -mt-10 relative z-10">
          {/* Portrait + name row. */}
          <div className="flex items-end gap-3 mb-4">
            <div className="w-20 h-20 flex-shrink-0 border-2 border-[#0a0a0a] bg-paper overflow-hidden shadow-[0_4px_24px_-6px_rgba(0,0,0,0.9)] ring-1 ring-amber-500/20 group-hover:ring-amber-400/60 transition-shadow">
              {portraitFailed || !portraitSrc ? (
                <div
                  className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#ff4500] to-[#8a2400] text-white font-display text-2xl"
                  data-testid={`${testId}-portrait-initials`}
                >
                  {m.initials || m.name?.slice(0, 2).toUpperCase() || "CM"}
                </div>
              ) : (
                <img
                  src={portraitSrc}
                  alt={`${m.name} portrait`}
                  className="w-full h-full object-cover portrait-duotone"
                  onError={handlePortraitErr}
                  onLoad={handlePortraitLoad}
                />
              )}
            </div>
            <div className="min-w-0 pb-1">
              <div className="font-display text-xl leading-tight line-clamp-1 tracking-tight">{m.name}</div>
              {m.location && (
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400 mt-1 inline-flex items-center gap-1">
                  <MapPin size={10} className="text-amber-400" />
                  {m.location}
                </div>
              )}
            </div>
          </div>

          {/* Specialty pills */}
          {Array.isArray(m.techniques) && m.techniques.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {m.techniques.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 border border-zinc-700 text-zinc-300 font-mono text-[9px] uppercase tracking-[0.22em]"
                >
                  {TECHNIQUE_LABEL[t] || t}
                </span>
              ))}
              {typeof m.years_crafting === "number" && m.years_crafting > 0 && (
                <span className="px-2 py-0.5 border border-amber-500/40 text-amber-300 font-mono text-[9px] uppercase tracking-[0.22em]">
                  {m.years_crafting}+ yrs
                </span>
              )}
            </div>
          )}

          {bioBlurb && (
            <p className="text-[12px] text-zinc-400 leading-relaxed mb-4 line-clamp-4">
              {bioBlurb}{bioTrail}
            </p>
          )}

          <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
              {m.listings_count || 0} listing{m.listings_count === 1 ? "" : "s"}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300 group-hover:text-amber-100 inline-flex items-center gap-1 group-hover:gap-2 transition-all">
              Visit shop <ArrowUpRight size={12} />
            </span>
          </div>
        </div>
      </Link>
    </motion.article>
  );
}
