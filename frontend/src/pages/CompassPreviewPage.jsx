// iter413ct+ — Compass icon comparison gallery. Temporary preview
// surface for selecting the final Compass identity. Renders all 5
// design-agent concepts at multiple sizes, on light & dark surfaces,
// in monochrome, and embedded in a Help-widget-style mockup.
//
// Removed once the user picks a direction and the chosen icon is
// wired into HelpSupportWidget. Until then this lets you eyeball
// them side-by-side without touching production code.
import React from "react";
import {
  CompassNeedle, CompassStar, CompassPin, CompassCraft, CompassAbstract,
} from "../components/icons/CompassIcon";

const CONCEPTS = [
  {
    id: "needle",
    name: "Concept 1 — Compass Needle",
    Icon: CompassNeedle,
    blurb: "Clean geometric needle. Closest to literal compass but stripped of all ornament. Premium and stable at 16px.",
  },
  {
    id: "star",
    name: "Concept 2 — Four-Point Star",
    Icon: CompassStar,
    blurb: "Compass rose reimagined as a soft, modern four-point star. Welcoming, not ornate. Reads cleanly as a brand mark.",
  },
  {
    id: "pin",
    name: "Concept 3 — Compass + Location Pin",
    Icon: CompassPin,
    blurb: "Pin silhouette with an inset needle. Evokes discovery — finding makers, finding products — without being a map.",
  },
  {
    id: "craft",
    name: "Concept 4 — Compass + Craft",
    Icon: CompassCraft,
    blurb: "Faceted diamond with crosshair-dashed inner lines. Subtle nod to chisel marks and stitched geometry while staying timeless.",
  },
  {
    id: "abstract",
    name: "Concept 5 — Abstract Navigation",
    Icon: CompassAbstract,
    blurb: "Rotated rounded square + offset dot. Not literally a compass. Slack/Notion/Stripe-grade evocative simplicity.",
    recommended: true,
  },
];

const SIZES = [16, 24, 32, 48];

function MockHelpButton({ Icon }) {
  // Mirrors the new semantic styling proposed by the design agent
  // (surface bg, ink text, brand hover) so each concept is judged in
  // the exact context it'll ship in.
  return (
    <div className="inline-flex items-center justify-center w-12 h-12 bg-[var(--surface)] text-[var(--ink)] border border-[var(--line)] hover:text-[var(--brand)] shadow-sm transition-colors">
      <Icon size={20} />
    </div>
  );
}

function MockWidgetHeader({ Icon }) {
  return (
    <div className="w-[320px] bg-[var(--paper)] border border-[var(--line)]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--line)]">
        <Icon size={24} className="text-[var(--brand)]" />
        <h2 className="font-mono text-base text-[var(--ink)] tracking-tight">
          Compass <span className="text-[var(--ink-muted)] font-normal text-sm">Assistant</span>
        </h2>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-[var(--ink-muted)] leading-relaxed">
          Hi! I&apos;m Compass, your Marketplace Assistant. How can I help?
        </p>
      </div>
    </div>
  );
}

export default function CompassPreviewPage() {
  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] py-12 px-6" data-testid="compass-preview">
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--brand)]">◆ Brand identity preview</div>
          <h1 className="font-display text-5xl mt-2">Compass — pick a direction</h1>
          <p className="text-[var(--ink-muted)] mt-3 max-w-2xl">
            Five concepts from the design agent. Each rendered at multiple sizes, on light + dark + mono surfaces,
            and inside a mock Help widget header so you can judge them in real Crafters Market context.
            The design agent recommends <span className="text-[var(--ink)] font-medium">Concept 5 (Abstract)</span> as best
            embodying &ldquo;evocative not literal,&rdquo; but the call is yours.
          </p>
        </div>

        <div className="space-y-10">
          {CONCEPTS.map(({ id, name, Icon, blurb, recommended }) => (
            <section
              key={id}
              className="border border-[var(--line)] bg-[var(--paper)] p-6"
              data-testid={`compass-concept-${id}`}
            >
              <div className="flex items-baseline justify-between gap-4 mb-4 flex-wrap">
                <div className="min-w-0">
                  <h2 className="font-display text-2xl">{name}</h2>
                  <p className="text-sm text-[var(--ink-muted)] mt-1 max-w-3xl">{blurb}</p>
                </div>
                {recommended && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--brand)] border border-[var(--brand)] px-2 py-1">
                    ★ Designer pick
                  </span>
                )}
              </div>

              <div className="grid lg:grid-cols-3 gap-6">
                {/* Size scaling row */}
                <div className="border border-[var(--line)] p-4 bg-[var(--surface)]">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] mb-3">
                    Size scalability
                  </div>
                  <div className="flex items-end gap-5">
                    {SIZES.map((s) => (
                      <div key={s} className="text-center">
                        <Icon size={s} className="text-[var(--ink)]" />
                        <div className="font-mono text-[9px] text-[var(--ink-muted)] mt-1">{s}px</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Color treatments */}
                <div className="border border-[var(--line)] p-4 bg-[var(--surface)]">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] mb-3">
                    Color treatments
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col items-center gap-2">
                      <div className="bg-[var(--paper)] border border-[var(--line)] p-3"><Icon size={32} className="text-[var(--ink)]" /></div>
                      <span className="font-mono text-[9px] text-[var(--ink-muted)]">Light · ink</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="bg-[var(--paper)] border border-[var(--line)] p-3"><Icon size={32} className="text-[var(--brand)]" /></div>
                      <span className="font-mono text-[9px] text-[var(--ink-muted)]">Light · brand</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="bg-[#0a0a0a] border border-[var(--line)] p-3"><Icon size={32} className="text-white" /></div>
                      <span className="font-mono text-[9px] text-[var(--ink-muted)]">Dark · mono</span>
                    </div>
                  </div>
                </div>

                {/* Widget mockups */}
                <div className="border border-[var(--line)] p-4 bg-[var(--surface)]">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] mb-3">
                    In context
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <MockHelpButton Icon={Icon} />
                      <span className="font-mono text-[10px] text-[var(--ink-muted)]">Widget button</span>
                    </div>
                    <MockWidgetHeader Icon={Icon} />
                  </div>
                </div>
              </div>

              {/* Sub-brand lockups */}
              <div className="mt-4 border border-[var(--line)] p-4 bg-[var(--surface)]">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] mb-3">
                  Sub-brand lock-ups
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  {["Discovery", "Recommendations", "Insights", "Operations", "Growth"].map((sub) => (
                    <div key={sub} className="inline-flex items-center gap-2">
                      <Icon size={18} className="text-[var(--brand)]" />
                      <span className="font-mono text-sm text-[var(--ink)] tracking-tight">
                        Compass <span className="text-[var(--ink-muted)] font-normal">{sub}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 border-t border-[var(--line)] pt-6 text-sm text-[var(--ink-muted)]">
          When you&apos;ve picked a direction, the rebrand is a single-line swap in{" "}
          <code className="text-[var(--ink)]">/app/frontend/src/components/icons/CompassIcon.jsx</code>{" "}
          (change the <code className="text-[var(--ink)]">CompassIcon</code> export to point at the chosen concept) plus the{" "}
          <code className="text-[var(--ink)]">HelpSupportWidget</code> brand label/welcome strings already locked behind{" "}
          <code className="text-[var(--ink)]">ASSISTANT_BRAND</code>.
        </div>
      </div>
    </div>
  );
}
