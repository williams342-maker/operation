import React from "react";

const SRC = "/downloads/cnc-garage-builders.png";

/**
 * CNCEmblem — clickable badge linking the home page to the full-size
 * CNC Garage Builders emblem. The anchor uses HTML5 `download` so the click
 * triggers a browser-side download rather than an in-tab navigation.
 */
export default function CNCEmblem() {
  return (
    <section
      className="py-24 md:py-32 bg-[#0a0a0a] grain border-y border-[#262626]"
      data-testid="cnc-emblem-section"
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-8">
        <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center">
          {/* Emblem */}
          <a
            href={SRC}
            download="cnc-garage-builders.png"
            className="group block relative mx-auto md:mx-0 w-full max-w-[420px] focus:outline-none focus:ring-2 focus:ring-[#ff4500]"
            aria-label="Download the CNC Garage Builders emblem (full size, 2048×2048 PNG)"
            data-testid="cnc-emblem-download"
          >
            <div className="relative aspect-square">
              {/* Soft orange glow on hover */}
              <div className="absolute inset-0 bg-[#ff4500] opacity-0 group-hover:opacity-30 blur-3xl transition-opacity duration-500" />
              <img
                src={SRC}
                alt="CNC Garage Builders — All CNC Machines. One Community."
                loading="lazy"
                className="relative w-full h-full object-contain drop-shadow-[0_30px_60px_rgba(0,0,0,0.6)] transition-transform duration-500 group-hover:scale-[1.02]"
                data-testid="cnc-emblem-img"
              />
              {/* Download chip */}
              <div className="absolute bottom-3 right-3 px-3 py-2 bg-[#ff4500] text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square">
                  <path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" />
                </svg>
                Download
              </div>
            </div>
          </a>

          {/* Copy */}
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
              ◆ Community Emblem
            </div>
            <h2 className="font-display text-5xl md:text-7xl uppercase leading-[0.9] mb-6">
              CNC Garage<br/>
              <span className="text-outline-orange">Builders.</span>
            </h2>
            <p className="font-mono text-base md:text-lg text-[#a3a3a3] leading-relaxed mb-3 max-w-md">
              Mill, router, plasma, laser, lathe — every machine, one community.
              Stamp it on your shirt, your shop sign, your shipping crate.
            </p>
            <p className="font-mono text-xs text-[#525252] leading-relaxed mb-8 max-w-md">
              2048 × 2048 PNG · transparent background · free to use for
              members of the Crafters Market workshop.
            </p>
            <a
              href={SRC}
              download="cnc-garage-builders.png"
              className="btn-industrial btn-primary inline-flex items-center gap-2 group"
              data-testid="cnc-emblem-download-cta"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" className="transition-transform group-hover:translate-y-0.5">
                <path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" />
              </svg>
              Download Emblem
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
