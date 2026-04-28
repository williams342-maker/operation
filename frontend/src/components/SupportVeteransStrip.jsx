import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

/**
 * "Support Our Veterans" announcement strip — sits just under the Nav at the
 * very top of the Home page. Two pieces:
 *
 *   1. A circular SVG stamp ("SUPPORT OUR VETERANS · EST 2025 ·") with a US
 *      flag in the middle. Pure inline SVG so it renders crisp at every
 *      density and stays branded on dark backgrounds — no Shutterstock
 *      watermarks, no PNG dependency.
 *
 *   2. A short manifesto line + CTA pill linking to the veteran-owned
 *      filter on /makers. Visually it picks up the navy/red/cream colour
 *      story of the stamp so it doesn't fight the rest of the dark theme.
 */
export default function SupportVeteransStrip() {
  return (
    <section
      className="relative isolate overflow-hidden border-b border-[#1f1f1f] bg-gradient-to-r from-[#0a0e1c] via-[#0d1126] to-[#0a0e1c] pt-[calc(var(--beta-banner-h,0px)+72px)]"
      data-testid="support-veterans-strip"
    >
      {/* Subtle striped backdrop (American flag stripe motif) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, #b22234 0 6px, transparent 6px 24px)",
        }}
      />
      {/* Star-field flicker on the left edge */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-1/3 opacity-[0.10]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 30% 30%, #ffffff 1px, transparent 2px), radial-gradient(circle at 70% 70%, #ffffff 1px, transparent 2px)",
          backgroundSize: "32px 32px, 48px 48px",
        }}
      />

      <Link
        to="/makers?veteran=1"
        className="relative max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-2.5 md:py-3 flex items-center gap-3 md:gap-4 group"
        data-testid="support-veterans-cta"
      >
        <SupportSeal className="w-9 h-9 md:w-12 md:h-12 shrink-0 transition-transform group-hover:rotate-[-6deg]" />

        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9px] md:text-[10px] uppercase tracking-[0.3em] text-[#b22234]">
            ◆ Crafters Market salutes
          </div>
          <h2 className="font-display text-sm md:text-lg uppercase leading-tight text-white truncate inline-flex items-center gap-2">
            <span className="border-b border-transparent group-hover:border-[#b22234] transition-colors">
              Support our <span className="text-[#b22234]">Veteran-Owned</span> Makers.
            </span>
            <ArrowRight
              size={14}
              className="opacity-50 group-hover:opacity-100 transition-all group-hover:translate-x-1"
            />
          </h2>
        </div>
      </Link>
    </section>
  );
}

/**
 * Inline SVG stamp. 200×200 viewBox.
 *   - Outer + inner navy rings
 *   - Circular text "★ SUPPORT OUR VETERANS ★ EST 2025 ★" using textPath
 *   - Centred US flag (13 stripes + canton with stars)
 */
function SupportSeal({ className = "" }) {
  const NAVY = "#3c3b6e";
  const RED = "#b22234";
  const WHITE = "#fafafa";

  return (
    <svg viewBox="0 0 200 200" className={className} aria-label="Support Our Veterans seal">
      <defs>
        {/* Path the circular text rides on — slightly inside the outer ring */}
        <path id="seal-text-arc" d="M 100,100 m -76,0 a 76,76 0 1,1 152,0 a 76,76 0 1,1 -152,0" />
      </defs>

      {/* Cream background disc */}
      <circle cx="100" cy="100" r="98" fill={WHITE} />

      {/* Outer + inner navy rings */}
      <circle cx="100" cy="100" r="96" fill="none" stroke={NAVY} strokeWidth="3" />
      <circle cx="100" cy="100" r="62" fill="none" stroke={NAVY} strokeWidth="2" />

      {/* Circular text — set wide tracking so the words breathe around the ring */}
      <text fill={NAVY} fontFamily="'Bebas Neue', 'Impact', sans-serif" fontSize="14" letterSpacing="2">
        <textPath href="#seal-text-arc" startOffset="0%">
          ★ SUPPORT OUR VETERANS ★ EST 2025 ★ MADE IN USA ★
        </textPath>
      </text>

      {/* Center US flag — same construction as VeteranBadge for consistency */}
      <g transform="translate(50, 70)">
        {/* 13 horizontal stripes (7 red, 6 white) inside a 100×60 area */}
        {Array.from({ length: 13 }).map((_, i) => (
          <rect
            key={i}
            x="0"
            y={(i * 60) / 13}
            width="100"
            height={60 / 13}
            fill={i % 2 === 0 ? RED : WHITE}
          />
        ))}
        {/* Canton — covers top 7 stripes, 40% of the width */}
        <rect x="0" y="0" width="40" height={(7 * 60) / 13} fill={NAVY} />
        {/* Stylised star pattern in the canton (5 simple star dots — keeps SVG light) */}
        {[
          [6, 4],   [14, 4],  [22, 4],  [30, 4],
          [10, 10], [18, 10], [26, 10],
          [6, 16],  [14, 16], [22, 16], [30, 16],
          [10, 22], [18, 22], [26, 22],
          [6, 28],  [14, 28], [22, 28], [30, 28],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="1.4" fill={WHITE} />
        ))}
      </g>

      {/* Decorative side-stars at 9 o'clock & 3 o'clock */}
      <Star x={20} y={100} size={5} fill={NAVY} />
      <Star x={180} y={100} size={5} fill={NAVY} />
    </svg>
  );
}

function Star({ x, y, size, fill }) {
  // 5-pointed star polygon centred on (x,y) with outer radius `size`.
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? size : size / 2.4;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${x + r * Math.cos(a)},${y + r * Math.sin(a)}`);
  }
  return <polygon points={pts.join(" ")} fill={fill} />;
}
