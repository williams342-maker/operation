import React from "react";
import EmblemHotspots from "./EmblemHotspots";

// iter413br — Community Emblem v2.
// Evolved from CNC-specific to inclusive maker identity. The old asset
// at /downloads/cnc-garage-builders.png is intentionally PRESERVED so
// shared links, OG previews, and any cached references keep resolving.
// This component now points to the v2 emblem at
// /downloads/garage-builders.png and uses inclusive copy covering all
// nine maker segments (Woodworking · Metalworking · Leather · Electronics
// · 3D Printing · Laser · Textiles · Pottery · Arts & Crafts).
//
// iter413bs — Optional interactive SVG hotspot overlay (`interactive`
// prop). Off by default — only enabled on /community/emblem. The home-
// page rendering stays static to keep the hero light.
const SRC = "/downloads/garage-builders.png";

/**
 * CommunityEmblem — clickable badge linking the home page to the full-size
 * Garage Builders v2 emblem. The anchor uses HTML5 `download` so the click
 * triggers a browser-side download rather than an in-tab navigation.
 *
 * Note: The component file is still named `CNCEmblem.jsx` and exported
 * as `CNCEmblem` because it's imported in App.js by that name. The user-
 * facing identity is "Community Emblem · Garage Builders v2".
 *
 * Props:
 *   - interactive (bool): When true, overlays an SVG hotspot grid that
 *     hover-highlights each maker segment and deep-links to
 *     /shop?segment=<slug>. Used on /community/emblem only.
 */
export default function CNCEmblem({ interactive = false }) {
  return (
    <section
      className="py-24 md:py-32 bg-paper grain border-y border-line"
      data-testid="community-emblem-section"
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-8">
        <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center">
          {/* Emblem — interactive variant overlays SVG hotspots; static
              variant wraps the image in a download <a>. We do NOT wrap
              the image in <a> when interactive because the hotspot
              clicks would bubble up and trigger the download. */}
          {interactive ? (
            <div
              className="block relative mx-auto md:mx-0 w-full max-w-[420px]"
              data-testid="community-emblem-interactive"
            >
              <div className="relative aspect-square">
                <img
                  src={SRC}
                  alt="Garage Builders — interactive maker segments"
                  loading="eager"
                  className="relative w-full h-full object-contain drop-shadow-[0_30px_60px_rgba(0,0,0,0.6)]"
                  data-testid="community-emblem-img"
                />
                <EmblemHotspots />
                <div className="absolute top-3 left-3 px-2 py-1 border border-brand text-brand font-mono text-[9px] uppercase tracking-[0.22em] bg-paper/80 backdrop-blur-sm">
                  V2 · Interactive
                </div>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-3 text-center md:text-left">
                Hover a segment to highlight · tap on mobile · click to filter the shop.
              </p>
            </div>
          ) : (
            <a
              href={SRC}
              download="garage-builders.png"
              className="group block relative mx-auto md:mx-0 w-full max-w-[420px] focus:outline-none focus:ring-2 focus:ring-[#ff4500]"
              aria-label="Download the Garage Builders emblem (full size, 2048×2048 PNG)"
              data-testid="community-emblem-download"
            >
              <div className="relative aspect-square">
                {/* Soft orange glow on hover */}
                <div className="absolute inset-0 bg-brand opacity-0 group-hover:opacity-30 blur-3xl transition-opacity duration-500" />
                <img
                  src={SRC}
                  alt="Garage Builders — All Makers. One Community."
                  loading="lazy"
                  className="relative w-full h-full object-contain drop-shadow-[0_30px_60px_rgba(0,0,0,0.6)] transition-transform duration-500 group-hover:scale-[1.02]"
                  data-testid="community-emblem-img"
                />
                {/* V2 marker chip — top-left so it doesn't fight the download chip */}
                <div className="absolute top-3 left-3 px-2 py-1 border border-brand text-brand font-mono text-[9px] uppercase tracking-[0.22em] bg-paper/80 backdrop-blur-sm">
                  V2
                </div>
                {/* Download chip */}
                <div className="absolute bottom-3 right-3 px-3 py-2 bg-brand text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square">
                    <path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" />
                  </svg>
                  Download
                </div>
              </div>
            </a>
          )}

          {/* Copy */}
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
              ◆ Community Emblem · v2
            </div>
            <h2 className="font-display text-5xl md:text-7xl uppercase leading-[0.9] mb-6">
              Garage<br/>
              <span className="text-outline-orange">Builders.</span>
            </h2>
            <p className="font-mono text-base md:text-lg text-ink-muted leading-relaxed mb-3 max-w-md">
              A badge for independent builders, makers, creators and craftspeople.
              From garages and workshops to studios and home businesses —
              represent your craft.
            </p>
            <p className="font-mono text-sm text-ink-muted leading-relaxed mb-3 max-w-md" data-testid="community-emblem-segments">
              Woodworking · Metalworking · Leather Craft · Electronics ·
              3D Printing · Laser Craft · Textiles &amp; Fiber ·
              Pottery &amp; Ceramics · Arts &amp; Crafts.
            </p>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-ink mb-3" data-testid="community-emblem-tagline">
              Build it. Cut it. Create it.
              <span className="text-ink-muted"> — All makers. One community.</span>
            </p>
            <p className="font-mono text-xs text-ink-muted leading-relaxed mb-8 max-w-md">
              2048 × 2048 PNG · transparent background · free to use on apparel,
              packaging, workshop walls, and maker profiles.
            </p>
            <a
              href={SRC}
              download="garage-builders.png"
              className="btn-industrial btn-primary inline-flex items-center gap-2 group"
              data-testid="community-emblem-download-cta"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" className="transition-transform group-hover:translate-y-0.5">
                <path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" />
              </svg>
              Download Emblem
            </a>
            {!interactive && (
              <a
                href="/community/emblem"
                data-testid="community-emblem-interactive-link"
                className="ml-3 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition"
              >
                Try interactive badge →
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
