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
      className="w-full py-14 md:py-20 bg-[#0a0a0a] border-b border-[#262626]"
      data-testid={testId}
    >
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="flex items-end justify-between mb-10 gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
              ◆ Meet the Makers
            </div>
            <h2 className="font-display text-3xl md:text-5xl lg:text-6xl">
              The people behind the work
            </h2>
            <p className="font-mono text-[12px] text-[#a3a3a3] mt-4 max-w-2xl leading-relaxed">
              Real workshops. Real hands. Every maker on Crafters Market is application-vetted,
              location-verified, and reachable directly — no resellers, no dropshipping, no
              factory storefronts pretending to be artisans.
            </p>
          </div>
          <Link
            to="/makers"
            className="industrial-link font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] whitespace-nowrap"
            data-testid={`${testId}-view-all`}
          >
            See all makers →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
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
      transition={{ delay: (i % 4) * 0.07, duration: 0.55 }}
      className="bg-[#121212] border border-[#262626] hover:border-[#ff4500] transition-colors duration-500 flex flex-col"
      data-testid={testId}
    >
      <Link to={`/makers/${m.slug}`} className="block group">
        {/* Workshop cover — the "where" of the maker. */}
        <div className="relative aspect-[5/3] overflow-hidden">
          <img
            src={workshopImg}
            alt={`${m.name} workshop`}
            className="absolute inset-0 w-full h-full object-cover media-img group-hover:scale-105 transition duration-700"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
          {m.is_veteran_owned && (
            <span
              className="tag absolute top-3 right-3 text-emerald-300 border-emerald-400/70 bg-black/70 text-[9px]"
              data-testid={`${testId}-veteran-pill`}
            >
              ◆ VETERAN
            </span>
          )}
          {m.featured_example && (
            <span
              className="tag absolute top-3 left-3 text-amber-300 border-amber-400/70 bg-black/70 text-[9px]"
              data-testid={`${testId}-founding-pill`}
              title="Founding Maker · curated by Crafters Market to showcase the platform"
            >
              ✦ FOUNDING MAKER
            </span>
          )}
        </div>

        <div className="px-5 pt-0 pb-5 -mt-10 relative z-10">
          {/* Portrait + name row. The square photo overlaps the cover so the
              face is anchored visually to the workshop above it. */}
          <div className="flex items-end gap-3 mb-4">
            <div className="w-20 h-20 flex-shrink-0 border-2 border-[#0a0a0a] bg-[#0a0a0a] overflow-hidden shadow-lg">
              {portraitFailed || !portraitSrc ? (
                <div
                  className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#ff4500] to-[#cc3700] text-white font-display text-2xl"
                  data-testid={`${testId}-portrait-initials`}
                >
                  {m.initials || m.name?.slice(0, 2).toUpperCase() || "CM"}
                </div>
              ) : (
                <img
                  src={portraitSrc}
                  alt={`${m.name} portrait`}
                  className="w-full h-full object-cover"
                  onError={handlePortraitErr}
                  onLoad={handlePortraitLoad}
                />
              )}
            </div>
            <div className="min-w-0 pb-1">
              <div className="font-display text-xl leading-tight line-clamp-1">{m.name}</div>
              {m.location && (
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-1 inline-flex items-center gap-1">
                  <MapPin size={10} className="text-[#ff4500]" />
                  {m.location}
                </div>
              )}
            </div>
          </div>

          {/* Specialty pills — translate technique codes to readable labels
              and cap at 3 so the row never wraps awkwardly. */}
          {Array.isArray(m.techniques) && m.techniques.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {m.techniques.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 border border-[#262626] text-[#a3a3a3] font-mono text-[9px] uppercase tracking-[0.2em]"
                >
                  {TECHNIQUE_LABEL[t] || t}
                </span>
              ))}
              {typeof m.years_crafting === "number" && m.years_crafting > 0 && (
                <span className="px-2 py-0.5 border border-[#ff4500]/40 text-[#ff4500] font-mono text-[9px] uppercase tracking-[0.2em]">
                  {m.years_crafting}+ yrs
                </span>
              )}
            </div>
          )}

          {bioBlurb && (
            <p className="text-[12px] text-[#a3a3a3] leading-relaxed mb-4 line-clamp-4">
              {bioBlurb}{bioTrail}
            </p>
          )}

          <div className="flex items-center justify-between border-t border-[#262626] pt-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">
              {m.listings_count || 0} listing{m.listings_count === 1 ? "" : "s"}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] inline-flex items-center gap-1 group-hover:gap-2 transition-all">
              Visit shop <ArrowUpRight size={12} />
            </span>
          </div>
        </div>
      </Link>
    </motion.article>
  );
}
