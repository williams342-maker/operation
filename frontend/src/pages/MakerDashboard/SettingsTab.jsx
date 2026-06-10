import React, { useState } from "react";
import {
  Image as ImageIcon, BookOpen, SlidersHorizontal, Truck, Shield,
  Users, Megaphone, Languages, Sparkles, Facebook, ChevronRight,
  Share2, AlertTriangle, Bell, Video,
} from "lucide-react";
import UpgradeTab from "./UpgradeTab";
import { FormShell, Field, ToggleRow, useSettingsForm, inputCls } from "./Settings/_shared";
import InfoAppearance from "./Settings/InfoAppearance";
import PolicyPanel from "./Settings/PolicyPanel";
import AccountPanel from "./Settings/AccountPanel";
import NotificationsPanel from "./Settings/NotificationsPanel";
import ChannelsPanel from "./Settings/ChannelsPanel";
import WorkshopVideosPanel from "./Settings/WorkshopVideosPanel";
import ClipsPanel from "./Settings/ClipsPanel";

/**
 * Etsy-parity Settings tab for the Maker Shop Manager.
 *
 * Layout: 2-column on desktop (~220px sub-nav + content), stacked on
 * mobile (sub-nav becomes a select). Each sub-section is a self-
 * contained form that talks to PATCH /api/maker/profile so we don't
 * need 9 new endpoints.
 *
 * iter131 split: the three heaviest panels (InfoAppearance, PolicyPanel,
 * AccountPanel) and shared form helpers moved into `Settings/*` modules.
 * This file went from ~1145 to ~430 lines and now only owns the shell
 * + the small inline panels (SocialMedia, AboutShop, Options, Shipping).
 */
const SECTIONS = [
  { id: "info",       label: "Info & Appearance", icon: ImageIcon, kind: "form" },
  { id: "videos",     label: "Workshop videos",   icon: Video,     kind: "embed" },
  { id: "clips",      label: "Workshop clips (feed)", icon: Video, kind: "embed" },
  { id: "about",      label: "About your shop",   icon: BookOpen,  kind: "form" },
  { id: "social",     label: "Social media",      icon: Share2,    kind: "form" },
  { id: "options",    label: "Options",           icon: SlidersHorizontal, kind: "form" },
  { id: "shipping",   label: "Shipping settings", icon: Truck,     kind: "form" },
  { id: "policy",     label: "Policy settings",   icon: Shield,    kind: "form" },
  { id: "notifications", label: "Notifications",  icon: Bell,      kind: "form" },
  { id: "partners",   label: "Partners you work with", icon: Users, kind: "soon" },
  { id: "offsite",    label: "Offsite Ads",       icon: Megaphone, kind: "deeplink", target: "marketing" },
  { id: "languages",  label: "Languages and translations", icon: Languages, kind: "soon" },
  { id: "subscription", label: "Your subscription", icon: Sparkles, kind: "embed" },
  { id: "facebook",   label: "Off-site channels", icon: Facebook,  kind: "form" },
  { id: "account",    label: "Account & Plan",    icon: AlertTriangle, kind: "form" },
];

export default function SettingsTab({ maker = {}, onMakerUpdated, onTabChange, initialSection = null }) {
  const [section, setSection] = useState(() => {
    if (initialSection && SECTIONS.some((s) => s.id === initialSection)) {
      return initialSection;
    }
    return SECTIONS[0].id;
  });
  React.useEffect(() => {
    if (initialSection && SECTIONS.some((s) => s.id === initialSection)) {
      setSection(initialSection);
    }
  }, [initialSection]);
  const active = SECTIONS.find((s) => s.id === section) || SECTIONS[0];

  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [section]);

  const handlePick = (s) => {
    if (s.kind === "deeplink" && onTabChange) {
      onTabChange(s.target);
      return;
    }
    setSection(s.id);
  };

  return (
    <div className="space-y-8" data-testid="settings-tab">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
          ◆ Shop Manager · Settings
        </div>
        <h1 className="font-display text-3xl md:text-5xl uppercase leading-[0.95]">
          Configure Your Shop.
        </h1>
        <p className="font-mono text-sm text-ink-muted mt-2 max-w-2xl">
          Profile, policies, and storefront options — every knob in one place.
        </p>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-6">
        <SubNav sections={SECTIONS} activeId={section} onPick={handlePick} />

        <div className="min-w-0" data-testid={`settings-section-${active.id}`}>
          {active.kind === "soon" && <ComingSoon section={active} />}
          {active.kind === "form" && active.id === "info" && (
            <InfoAppearance maker={maker} onSaved={onMakerUpdated} />
          )}
          {active.kind === "form" && active.id === "about" && (
            <AboutShop maker={maker} onSaved={onMakerUpdated} />
          )}
          {active.kind === "form" && active.id === "social" && (
            <SocialMedia maker={maker} onSaved={onMakerUpdated} />
          )}
          {active.kind === "form" && active.id === "options" && (
            <Options maker={maker} onSaved={onMakerUpdated} />
          )}
          {active.kind === "form" && active.id === "shipping" && (
            <Shipping maker={maker} onSaved={onMakerUpdated} onTabChange={onTabChange} />
          )}
          {active.kind === "form" && active.id === "policy" && (
            <PolicyPanel maker={maker} onSaved={onMakerUpdated} />
          )}
          {active.kind === "form" && active.id === "notifications" && (
            <NotificationsPanel />
          )}
          {active.kind === "form" && active.id === "facebook" && (
            <ChannelsPanel maker={maker} />
          )}
          {active.kind === "form" && active.id === "account" && (
            <AccountPanel maker={maker} onSaved={onMakerUpdated} />
          )}
          {active.kind === "embed" && active.id === "subscription" && (
            <UpgradeTab maker={maker} />
          )}
          {active.kind === "embed" && active.id === "videos" && (
            <WorkshopVideosPanel />
          )}
          {active.kind === "embed" && active.id === "clips" && (
            <ClipsPanel />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-navigation (left rail on desktop, select on mobile)
// ============================================================================
function SubNav({ sections, activeId, onPick }) {
  return (
    <>
      <div className="lg:hidden">
        <select
          value={activeId}
          onChange={(e) => onPick(sections.find((s) => s.id === e.target.value))}
          className="w-full bg-paper border border-line focus:border-brand outline-none px-4 py-3 font-mono text-sm text-ink"
          data-testid="settings-subnav-mobile"
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>
      <nav
        className="hidden lg:block bg-paper border border-line p-2 self-start"
        data-testid="settings-subnav"
      >
        {sections.map((s) => {
          const Icon = s.icon;
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              onClick={() => onPick(s)}
              className={`w-full text-left px-3 py-2.5 mb-1 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] transition border-l-2 ${
                isActive
                  ? "bg-brand/10 border-brand text-brand"
                  : "border-transparent text-ink-muted hover:text-ink hover:bg-surface"
              }`}
              data-testid={`settings-subnav-${s.id}`}
            >
              <Icon size={14} className="shrink-0" />
              <span className="flex-1 truncate">{s.label}</span>
              {s.kind === "deeplink" && (
                <ChevronRight size={12} className="opacity-60 shrink-0" />
              )}
              {s.kind === "soon" && (
                <span className="text-[8px] tracking-[0.18em] text-ink-muted shrink-0">SOON</span>
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}

function ComingSoon({ section }) {
  const Icon = section.icon;
  return (
    <div className="border border-dashed border-line p-10 text-center" data-testid="settings-soon">
      <Icon size={28} className="mx-auto text-ink-muted mb-3" />
      <h2 className="font-display text-2xl uppercase mb-2">{section.label}</h2>
      <p className="font-mono text-xs text-ink-muted max-w-md mx-auto">
        Coming soon — we'll wire this up as we onboard the founding-seller cohort.
        Drop us a note in the Help tab if you need this sooner than later.
      </p>
    </div>
  );
}

// ============================================================================
// Section: Social media — pure URL inputs, vanity links surfaced on the
// shop profile. No OAuth — these are just hrefs.
// ============================================================================
const SOCIAL_SPECS = [
  { key: "social_facebook",  label: "Facebook",  placeholder: "https://facebook.com/yourshop",   hint: "fb.com/…"       },
  { key: "social_instagram", label: "Instagram", placeholder: "https://instagram.com/yourshop",  hint: "instagram.com/…" },
  { key: "social_twitter",   label: "Twitter/X", placeholder: "https://twitter.com/yourshop",    hint: "twitter.com/…"  },
  { key: "social_tiktok",    label: "TikTok",    placeholder: "https://tiktok.com/@yourshop",    hint: "tiktok.com/@…"  },
  { key: "social_youtube",   label: "YouTube",   placeholder: "https://youtube.com/@yourshop",   hint: "youtube.com/@…" },
  { key: "social_pinterest", label: "Pinterest", placeholder: "https://pinterest.com/yourshop",  hint: "pinterest.com/…"},
  { key: "website_url",      label: "Website",   placeholder: "https://yourshop.com",            hint: "Your own domain"},
];

function SocialMedia({ maker, onSaved }) {
  const fields = SOCIAL_SPECS.map((s) => s.key);
  const { form, set, dirty, busy, submit } = useSettingsForm(maker, fields, onSaved);
  return (
    <FormShell
      title="Social media"
      blurb="Drop your social handles here — they show as icons on your public shop profile and on share cards."
      onSubmit={submit}
      dirty={dirty}
      busy={busy}
      testId="settings-social"
    >
      <div className="grid md:grid-cols-2 gap-4">
        {SOCIAL_SPECS.map(({ key, label, placeholder, hint }) => (
          <Field key={key} label={label} hint={hint} testId={`settings-social-${key}`}>
            <input
              className={inputCls}
              value={form[key] || ""}
              onChange={(e) => set(key)(e.target.value)}
              placeholder={placeholder}
              type="url"
              autoComplete="url"
            />
          </Field>
        ))}
      </div>
    </FormShell>
  );
}

// ============================================================================
// Section: About your shop
// ============================================================================
function AboutShop({ maker, onSaved }) {
  const fields = ["bio", "story_headline", "story", "is_veteran_owned", "watermark_images"];
  const { form, set, dirty, busy, submit } = useSettingsForm(maker, fields, onSaved);
  return (
    <FormShell
      title="About your shop"
      blurb="Tell buyers who you are, where you're from, and why you make. This is the long-form story under your shop hero."
      onSubmit={submit}
      dirty={dirty}
      busy={busy}
      testId="settings-about"
    >
      <Field label="Short bio" hint="One or two sentences — shown in compact cards.">
        <textarea rows={2} className={`${inputCls} resize-none`} value={form.bio} onChange={(e) => set("bio")(e.target.value)} />
      </Field>
      <Field label="Story headline" hint="A single punchy line, e.g. 'Forged in the heart of Montana.'">
        <input className={inputCls} value={form.story_headline} onChange={(e) => set("story_headline")(e.target.value)} />
      </Field>
      <Field label="Your story" hint="Long-form — talk about your craft, process, and what makes your shop different.">
        <textarea rows={8} className={`${inputCls} resize-none leading-relaxed`} value={form.story} onChange={(e) => set("story")(e.target.value)} />
      </Field>
      <ToggleRow
        label={
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-4 h-2.5 border border-white/30 overflow-hidden align-middle">
              <svg viewBox="0 0 19 10" aria-hidden="true" className="block w-full h-full">
                {Array.from({ length: 13 }).map((_, i) => (
                  <rect key={i} x="0" y={(i * 10) / 13} width="19" height={10 / 13} fill={i % 2 === 0 ? "#b22234" : "#ffffff"} />
                ))}
                <rect x="0" y="0" width="7.6" height={(7 * 10) / 13} fill="#3c3b6e" />
              </svg>
            </span>
            Veteran-Owned business
          </span>
        }
        hint="When ON, a US-flag 'Veteran-Owned' badge shows on every one of your listings and on your maker profile. Honors your service and signals to buyers who want to support veteran makers."
        value={!!form.is_veteran_owned}
        onChange={set("is_veteran_owned")}
        testId="settings-veteran-owned"
      />
      <ToggleRow
        label="Watermark my listing photos"
        hint="When ON, every new listing photo you upload is stamped with your shop name (tiled across the image + corner stamp). Deters image theft. Existing photos aren't re-processed — re-upload them to apply the watermark retroactively."
        value={!!form.watermark_images}
        onChange={set("watermark_images")}
        testId="settings-watermark"
      />
    </FormShell>
  );
}

// ============================================================================
// Section: Options
// ============================================================================
function Options({ maker, onSaved }) {
  const fields = ["vacation_mode", "vacation_message", "accepts_custom_orders", "accepts_backorders_default", "external_ads_opt_out", "restock_digest_opt_out", "social_momentum_opt_out", "appearance_mode"];
  const { form, set, dirty, busy, submit } = useSettingsForm(maker, fields, onSaved);
  return (
    <FormShell
      title="Options"
      blurb="Storefront-level switches that affect every listing in your shop."
      onSubmit={submit}
      dirty={dirty}
      busy={busy}
      testId="settings-options"
    >
      <ToggleRow
        label="Light mode for Shop Manager"
        hint="Render your dashboard, listings, orders, and settings on a white backdrop instead of the default industrial dark theme. Affects only your private dashboard — your public shop and the rest of the site stay on the brand-standard dark theme. Saved on your account so it follows you across devices. Tip: press ⌘+L (Mac) or Ctrl+L (Windows) anywhere in the dashboard to flip themes instantly."
        value={form.appearance_mode === "light"}
        onChange={(v) => set("appearance_mode")(v ? "light" : "dark")}
        testId="settings-appearance-light"
      />
      <ToggleRow
        label="Vacation mode"
        hint="When ON, your shop shows a 'Currently away' banner and Add-to-Cart is disabled across all listings."
        value={!!form.vacation_mode}
        onChange={set("vacation_mode")}
        testId="settings-vacation"
      />
      {form.vacation_mode && (
        <Field label="Vacation message (shown to buyers)" hint="Optional — e.g. 'Back from custom-build trip on May 15.'">
          <input className={inputCls} value={form.vacation_message || ""} onChange={(e) => set("vacation_message")(e.target.value)} />
        </Field>
      )}
      <ToggleRow
        label="Accept custom-order requests"
        hint="When ON, the 'Request Custom' CTA is visible on your shop page."
        value={!!form.accepts_custom_orders}
        onChange={set("accepts_custom_orders")}
        testId="settings-custom-orders"
      />
      <ToggleRow
        label="Accept backorder requests by default"
        hint="When a listing is out of stock, buyers can submit a backorder request instead of seeing 'Sold out'. You can override this per-listing in the listing editor."
        value={!!form.accepts_backorders_default}
        onChange={set("accepts_backorders_default")}
        testId="settings-backorders-default"
      />
      <ToggleRow
        label="Opt out of off-site ads & marketing feeds"
        hint="When ON: (1) we won't promote your listings on Google/Meta — and you won't pay the 12% off-site ad fee on attributed orders, and (2) your listings will be excluded from our partner marketing feeds (EnrichLabs and any future ad partners that pull from our catalog). When OFF (default), your listings get maximum reach across all channels."
        value={!!form.external_ads_opt_out}
        onChange={set("external_ads_opt_out")}
        testId="settings-offsite-optout"
      />
      <ToggleRow
        label="Mute the weekly Restock digest email"
        hint="By default you get one email every Sunday morning summarizing the buyers waiting on each of your back-ordered listings. Turn this ON to stop those emails — the waitlist data is still visible in your dashboard either way."
        value={!!form.restock_digest_opt_out}
        onChange={set("restock_digest_opt_out")}
        testId="settings-restock-digest-optout"
      />
      <ToggleRow
        label="Mute the weekly Social Momentum email"
        hint="Every Monday afternoon we email you a count of how many times each listing was shared (via the public Share button) in the past 7 days, plus a CTA to keep the momentum going. Turn this ON to silence those recaps — the share counts still display publicly on each listing as social proof either way."
        value={!!form.social_momentum_opt_out}
        onChange={set("social_momentum_opt_out")}
        testId="settings-social-momentum-optout"
      />
    </FormShell>
  );
}

// ============================================================================
// Section: Shipping settings
// ============================================================================
function Shipping({ maker, onSaved, onTabChange }) {
  const fields = ["processing_time"];
  const { form, set, dirty, busy, submit } = useSettingsForm(maker, fields, onSaved);
  return (
    <div className="space-y-5">
      <FormShell
        title="Shipping settings"
        blurb="The processing-time copy buyers see on every listing."
        onSubmit={submit}
        dirty={dirty}
        busy={busy}
        testId="settings-shipping"
      >
        <Field label="Default processing time" hint="e.g. '1-3 business days' — shown above the Add-to-Cart button.">
          <input className={inputCls} value={form.processing_time} onChange={(e) => set("processing_time")(e.target.value)} placeholder="1-3 business days" />
        </Field>
      </FormShell>
      <div className="border border-line bg-paper p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="font-mono text-xs text-ink-muted">
          ◆ Per-listing shipping rates are managed inside each listing's editor.
        </div>
        <button
          type="button"
          onClick={() => onTabChange?.("listings")}
          className="px-3 py-2 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
          data-testid="settings-shipping-listings-link"
        >
          Open Listings →
        </button>
      </div>
    </div>
  );
}
