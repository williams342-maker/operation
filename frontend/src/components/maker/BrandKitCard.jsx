// iter413bw — Maker Brand Kit card (Garage Builders identity).
// Surfaced on the Maker Dashboard for approved sellers only. Pure
// identity / belonging — never blocks any flow. Permanently
// dismissible via the "Not for me" link.
//
// Spec:
//   • Header: "Represent your craft"
//   • Subtext: "Show customers you're part of the Garage Builders community."
//   • Actions: [Add to Profile] [Download for Shop] [Download for Packaging]
//             [Download Social Version] [View Brand Guide]
//   • Variants visible: Profile Badge / Sticker / Shop Banner / Packaging Stamp
//   • 3-step gamification: ✓ Profile completed · ✓ Brand kit applied · ✓ Public maker page live
//   • Optional preview with maker's shop name
//   • Reuses the 4 existing variant assets generated in iter413bv

import React, { useState } from "react";
import { toast } from "sonner";
import { applyBrandKit, dismissBrandKit } from "../../lib/api";

const VARIANTS = [
  {
    id: "profile",
    label: "Profile Badge",
    desc: "On your /makers/<shop> page",
    file: "/downloads/garage-builders-orange.png",
    download: "garage-builders-profile.png",
    cta: "Download for Shop",
    testid: "brand-kit-profile",
  },
  {
    id: "sticker",
    label: "Sticker",
    desc: "Transparent PNG · die-cut friendly",
    file: "/downloads/garage-builders.png",
    download: "garage-builders-sticker.png",
    cta: "Download for Shop",
    testid: "brand-kit-sticker",
  },
  {
    id: "packaging",
    label: "Packaging Stamp",
    desc: "White on dark · print-ready",
    file: "/downloads/garage-builders-monochrome.png",
    download: "garage-builders-packaging.png",
    cta: "Download for Packaging",
    testid: "brand-kit-packaging",
  },
  {
    id: "social",
    label: "Shop Banner / Avatar",
    desc: "1080² · Instagram, X, TikTok",
    file: "/downloads/garage-builders-square.png",
    download: "garage-builders-social.png",
    cta: "Download Social Version",
    testid: "brand-kit-social",
  },
];

// Pure presentational — defined outside the component so React doesn't
// rebuild the type tree on every render.
const Step = ({ done, label, testid }) => (
  <li
    className={`flex items-center gap-2 font-mono text-[11px] ${done ? "text-emerald-700" : "text-ink-muted"}`}
    data-testid={testid}
    data-done={done ? "true" : "false"}
  >
    <span className="inline-block w-4 text-center">{done ? "✓" : "○"}</span>
    <span>{label}</span>
  </li>
);

export default function BrandKitCard({ maker, onMakerChange }) {
  const [applying, setApplying] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  // iter413bw — Only approved makers see this card. Permanent dismissal
  // hides it forever; the card never blocks any flow.
  const isApproved = maker?.status === "approved" || maker?.approved_at;
  if (!maker || !isApproved) return null;
  if (maker.brand_kit_dismissed) return null;

  const applied = !!maker.brand_kit_applied;
  // "Profile completed" — has bio + at least 1 workshop photo or technique.
  const profileComplete = !!(maker.bio && maker.bio.length > 40 && (
    (maker.workshop_photos || []).length > 0 || (maker.techniques || []).length > 0
  ));
  // "Public maker page live" — maker has a slug AND at least 1 listing.
  const pageLive = !!maker.slug && (maker.listings_count || 0) > 0;

  const onApply = async () => {
    setApplying(true);
    try {
      const r = await applyBrandKit();
      toast.success("◆ Garage Builders badge applied to your profile.");
      onMakerChange?.({ ...maker, brand_kit_applied: true, brand_kit_applied_at: r.applied_at });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to apply badge.");
    } finally {
      setApplying(false);
    }
  };

  const onDismiss = async () => {
    if (!window.confirm(
      "Hide the brand kit card permanently?\n\nYou can always grab the assets from /community/emblem later."
    )) return;
    setDismissing(true);
    try {
      await dismissBrandKit();
      onMakerChange?.({ ...maker, brand_kit_dismissed: true });
    } catch (e) {
      toast.error("Failed to dismiss.");
    } finally {
      setDismissing(false);
    }
  };

  return (
    <section
      data-testid="brand-kit-card"
      className="border border-line bg-paper p-5 md:p-6 mb-6 relative"
      aria-label="Your maker brand kit"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
            ◆ Your Maker Brand Kit
          </div>
          <h2 className="font-display text-2xl md:text-3xl text-ink mt-1" data-testid="brand-kit-header">
            Represent your craft.
          </h2>
          <p className="font-mono text-xs text-ink-muted mt-1 max-w-xl">
            Show customers you&apos;re part of the Garage Builders community.
            {maker.name && (
              <>
                {" · "}
                <span className="text-ink" data-testid="brand-kit-preview-name">
                  {maker.name}
                </span>
              </>
            )}
          </p>
        </div>
        <button
          onClick={onDismiss}
          disabled={dismissing}
          data-testid="brand-kit-dismiss"
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink underline-offset-2 hover:underline disabled:opacity-50"
        >
          {dismissing ? "…" : "Not for me"}
        </button>
      </div>

      {/* Primary CTA + brand guide */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={onApply}
          disabled={applying || applied}
          data-testid="brand-kit-apply"
          className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-60 ${
            applied
              ? "border border-emerald-600 text-emerald-700 bg-emerald-50"
              : "bg-brand text-paper border border-brand hover:bg-paper hover:text-brand"
          }`}
        >
          {applied ? "✓ Badge on your profile" : applying ? "Applying…" : "★ Add to Profile"}
        </button>
        <a
          href="/community/emblem"
          target="_blank"
          rel="noreferrer"
          data-testid="brand-kit-guide"
          className="px-4 py-2 border border-line text-ink hover:border-brand hover:text-brand font-mono text-[11px] uppercase tracking-[0.22em] transition"
        >
          View Brand Guide ↗
        </a>
      </div>

      {/* Variant tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {VARIANTS.map((v) => (
          <a
            key={v.id}
            href={v.file}
            download={v.download}
            data-testid={v.testid}
            className="block border border-line p-3 hover:border-brand transition group"
          >
            <div className="aspect-square bg-surface flex items-center justify-center mb-2 overflow-hidden">
              <img
                src={v.file}
                alt={`Garage Builders ${v.label} variant`}
                loading="lazy"
                className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink">{v.label}</div>
            <div className="font-mono text-[9px] text-ink-muted mt-0.5">{v.desc}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mt-2 opacity-0 group-hover:opacity-100 transition">
              {v.cta} ↓
            </div>
          </a>
        ))}
      </div>

      {/* Gamification strip — 3 small badges, no pressure */}
      <ul
        className="flex flex-wrap items-center gap-4 pt-3 border-t border-line"
        data-testid="brand-kit-gamification"
      >
        <Step done={profileComplete} label="Profile completed"     testid="brand-kit-step-profile" />
        <Step done={applied}         label="Brand kit applied"     testid="brand-kit-step-applied" />
        <Step done={pageLive}        label="Public maker page live" testid="brand-kit-step-live" />
      </ul>
    </section>
  );
}
