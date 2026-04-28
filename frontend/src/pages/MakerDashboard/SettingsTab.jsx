import React, { useState } from "react";
import { toast } from "sonner";
import {
  Image as ImageIcon, BookOpen, SlidersHorizontal, Truck, Shield,
  Users, Megaphone, Languages, Sparkles, Facebook, ChevronRight,
} from "lucide-react";
import { updateMakerProfile } from "../../lib/api";
import UpgradeTab from "./UpgradeTab";

/**
 * Etsy-parity Settings tab for the Maker Shop Manager.
 *
 * Layout: 2-column on desktop (~220px sub-nav + content), stacked on mobile
 * (sub-nav becomes a select). Each sub-section is a self-contained form
 * that talks to PATCH /api/maker/profile so we don't need 9 new endpoints.
 *
 * Sections mirror Etsy's Shop Manager → Settings layout:
 *   - Info & Appearance (name, headline, location, portrait/cover/banner)
 *   - About your shop (long-form story, headline, mission)
 *   - Options (vacation mode, accepts custom orders, off-site ads opt-out)
 *   - Shipping settings (processing-time + deep-link to Financials)
 *   - Policy settings (returns/refunds copy)
 *   - Partners you work with (placeholder — coming soon)
 *   - Offsite Ads (deep-link to Marketing tab — already lives there)
 *   - Languages and translations (placeholder)
 *   - Your subscription (deep-link to Upgrade tab)
 *   - Facebook Shops (placeholder)
 */
const SECTIONS = [
  { id: "info",       label: "Info & Appearance", icon: ImageIcon, kind: "form" },
  { id: "about",      label: "About your shop",   icon: BookOpen,  kind: "form" },
  { id: "options",    label: "Options",           icon: SlidersHorizontal, kind: "form" },
  { id: "shipping",   label: "Shipping settings", icon: Truck,     kind: "form" },
  { id: "policy",     label: "Policy settings",   icon: Shield,    kind: "form" },
  { id: "partners",   label: "Partners you work with", icon: Users, kind: "soon" },
  { id: "offsite",    label: "Offsite Ads",       icon: Megaphone, kind: "deeplink", target: "marketing" },
  { id: "languages",  label: "Languages and translations", icon: Languages, kind: "soon" },
  { id: "subscription", label: "Your subscription", icon: Sparkles, kind: "embed" },
  { id: "facebook",   label: "Facebook Shops",    icon: Facebook,  kind: "soon" },
];

export default function SettingsTab({ maker = {}, onMakerUpdated, onTabChange, initialSection = null }) {
  const [section, setSection] = useState(() => {
    // Honour caller-provided initial section (from the Plus nudge etc.) but
    // only if it's a real section id — fall back to the first one otherwise.
    if (initialSection && SECTIONS.some((s) => s.id === initialSection)) {
      return initialSection;
    }
    return SECTIONS[0].id;
  });
  // If the caller passes a fresh initialSection (e.g. user clicks the nudge
  // again with the tab already active), jump to it.
  React.useEffect(() => {
    if (initialSection && SECTIONS.some((s) => s.id === initialSection)) {
      setSection(initialSection);
    }
  }, [initialSection]);
  const active = SECTIONS.find((s) => s.id === section) || SECTIONS[0];

  // When a deep-link section is selected, route to that tab and don't
  // mount any form below — keeps the URL accurate.
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
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
          ◆ Shop Manager · Settings
        </div>
        <h1 className="font-display text-3xl md:text-5xl uppercase leading-[0.95]">
          Configure Your Shop.
        </h1>
        <p className="font-mono text-sm text-[#a3a3a3] mt-2 max-w-2xl">
          Profile, policies, and storefront options — every knob in one place.
        </p>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-6">
        {/* Sub-nav (mobile = select, desktop = vertical menu) */}
        <SubNav
          sections={SECTIONS}
          activeId={section}
          onPick={handlePick}
        />

        {/* Active section content */}
        <div className="min-w-0" data-testid={`settings-section-${active.id}`}>
          {active.kind === "soon" && <ComingSoon section={active} />}
          {active.kind === "form" && active.id === "info" && (
            <InfoAppearance maker={maker} onSaved={onMakerUpdated} />
          )}
          {active.kind === "form" && active.id === "about" && (
            <AboutShop maker={maker} onSaved={onMakerUpdated} />
          )}
          {active.kind === "form" && active.id === "options" && (
            <Options maker={maker} onSaved={onMakerUpdated} />
          )}
          {active.kind === "form" && active.id === "shipping" && (
            <Shipping maker={maker} onSaved={onMakerUpdated} onTabChange={onTabChange} />
          )}
          {active.kind === "form" && active.id === "policy" && (
            <Policy maker={maker} onSaved={onMakerUpdated} />
          )}
          {active.kind === "embed" && active.id === "subscription" && (
            <UpgradeTab maker={maker} />
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
      {/* Mobile select */}
      <div className="lg:hidden">
        <select
          value={activeId}
          onChange={(e) => onPick(sections.find((s) => s.id === e.target.value))}
          className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5]"
          data-testid="settings-subnav-mobile"
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Desktop list */}
      <nav
        className="hidden lg:block bg-[#0d0d0d] border border-[#1f1f1f] p-2 self-start"
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
                  ? "bg-[#ff4500]/10 border-[#ff4500] text-[#ff4500]"
                  : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5] hover:bg-[#161616]"
              }`}
              data-testid={`settings-subnav-${s.id}`}
            >
              <Icon size={14} className="shrink-0" />
              <span className="flex-1 truncate">{s.label}</span>
              {s.kind === "deeplink" && (
                <ChevronRight size={12} className="opacity-60 shrink-0" />
              )}
              {s.kind === "soon" && (
                <span className="text-[8px] tracking-[0.18em] text-[#525252] shrink-0">SOON</span>
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}

// ============================================================================
// Shared form helpers (label + status + submit button)
// ============================================================================
function FormShell({ title, blurb, children, onSubmit, dirty, busy, testId }) {
  return (
    <form
      onSubmit={onSubmit}
      className="border border-[#262626] p-5 md:p-6 space-y-5"
      data-testid={testId}
    >
      <div>
        <h2 className="font-display text-2xl md:text-3xl uppercase">{title}</h2>
        {blurb && (
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 leading-relaxed">{blurb}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
      <div className="flex items-center justify-end gap-3 border-t border-[#1f1f1f] pt-4">
        {dirty && (
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400" data-testid={`${testId}-dirty`}>
            ◇ Unsaved changes
          </span>
        )}
        <button
          type="submit"
          disabled={!dirty || busy}
          className="btn-industrial btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid={`${testId}-save`}
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children, testId }) {
  return (
    <label className="block" data-testid={testId}>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <span className="font-mono text-[10px] text-[#525252] mt-1.5 block">{hint}</span>
      )}
    </label>
  );
}

const inputCls = "w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2.5 font-mono text-sm text-[#e5e5e5]";

function ToggleRow({ label, hint, value, onChange, testId }) {
  return (
    <div className="flex items-start justify-between gap-3 border border-[#262626] p-3" data-testid={testId}>
      <div className="min-w-0">
        <div className="font-mono text-xs text-[#e5e5e5]">{label}</div>
        {hint && <div className="font-mono text-[10px] text-[#a3a3a3] mt-1 leading-relaxed">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 border transition-colors ${
          value ? "bg-[#ff4500] border-[#ff4500]" : "bg-[#0a0a0a] border-[#262626]"
        }`}
        data-testid={`${testId}-toggle`}
      >
        <span className={`inline-block h-4 w-4 mt-0.5 bg-black transition-transform ${value ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

// ============================================================================
// "Coming soon" stub
// ============================================================================
function ComingSoon({ section }) {
  const Icon = section.icon;
  return (
    <div className="border border-dashed border-[#262626] p-10 text-center" data-testid="settings-soon">
      <Icon size={28} className="mx-auto text-[#525252] mb-3" />
      <h2 className="font-display text-2xl uppercase mb-2">{section.label}</h2>
      <p className="font-mono text-xs text-[#a3a3a3] max-w-md mx-auto">
        Coming soon — we'll wire this up as we onboard the founding-seller cohort.
        Drop us a note in the Help tab if you need this sooner than later.
      </p>
    </div>
  );
}

// ============================================================================
// Generic settings form factory — DRY for the 5 working forms below.
// Each form picks the fields it cares about and supplies a save handler.
// ============================================================================
function useSettingsForm(maker, fields, onSaved) {
  const initial = React.useMemo(
    () => Object.fromEntries(fields.map((f) => [f, maker?.[f] ?? ""])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maker, fields.join("|")],
  );
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { setForm(initial); }, [initial]);
  const dirty = fields.some((f) => (form[f] ?? "") !== (initial[f] ?? ""));
  const set = (k) => (v) => setForm((c) => ({ ...c, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await updateMakerProfile(form);
      toast.success("Saved.");
      onSaved?.(updated);
    } catch (e2) {
      const d = e2?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  };
  return { form, set, dirty, busy, submit };
}

// ============================================================================
// Section: Info & Appearance
// ============================================================================
function InfoAppearance({ maker, onSaved }) {
  const fields = ["name", "location", "portrait", "cover"];
  const { form, set, dirty, busy, submit } = useSettingsForm(maker, fields, onSaved);
  return (
    <FormShell
      title="Info & Appearance"
      blurb="The basics buyers see at the top of your shop. URLs to images should point at uploaded R2 assets."
      onSubmit={submit}
      dirty={dirty}
      busy={busy}
      testId="settings-info"
    >
      <Field label="Shop name" testId="settings-info-name">
        <input className={inputCls} value={form.name} onChange={(e) => set("name")(e.target.value)} />
      </Field>
      <Field label="Location" hint="City, state — keeps shipping estimates honest.">
        <input className={inputCls} value={form.location} onChange={(e) => set("location")(e.target.value)} />
      </Field>
      <Field label="Portrait URL" hint="Square headshot or logo (recommended 800×800).">
        <input className={inputCls} value={form.portrait} onChange={(e) => set("portrait")(e.target.value)} />
      </Field>
      <Field label="Cover URL" hint="Wide banner that fills your shop hero (recommended 2400×800).">
        <input className={inputCls} value={form.cover} onChange={(e) => set("cover")(e.target.value)} />
      </Field>
    </FormShell>
  );
}

// ============================================================================
// Section: About your shop
// ============================================================================
function AboutShop({ maker, onSaved }) {
  const fields = ["bio", "story_headline", "story"];
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
    </FormShell>
  );
}

// ============================================================================
// Section: Options
// ============================================================================
function Options({ maker, onSaved }) {
  const fields = ["vacation_mode", "vacation_message", "accepts_custom_orders", "external_ads_opt_out"];
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
        label="Opt out of off-site ads"
        hint="When ON, we won't promote your listings on Google/Meta — but you also won't pay the 12% off-site ad fee on attributed orders."
        value={!!form.external_ads_opt_out}
        onChange={set("external_ads_opt_out")}
        testId="settings-offsite-optout"
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
      <div className="border border-[#262626] bg-[#0d0d0d] p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="font-mono text-xs text-[#a3a3a3]">
          ◆ Per-listing shipping rates are managed inside each listing's editor.
        </div>
        <button
          type="button"
          onClick={() => onTabChange?.("listings")}
          className="px-3 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition"
          data-testid="settings-shipping-listings-link"
        >
          Open Listings →
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Section: Policy settings
// ============================================================================
function Policy({ maker, onSaved }) {
  const fields = ["returns_policy"];
  const { form, set, dirty, busy, submit } = useSettingsForm(maker, fields, onSaved);
  return (
    <FormShell
      title="Policy settings"
      blurb="Returns, refunds, and exchange copy — shown on every product page below the description."
      onSubmit={submit}
      dirty={dirty}
      busy={busy}
      testId="settings-policy"
    >
      <Field label="Returns & exchanges policy" hint="Be specific: timeframe, who pays return shipping, custom-order exclusions.">
        <textarea rows={8} className={`${inputCls} resize-none leading-relaxed`} value={form.returns_policy} onChange={(e) => set("returns_policy")(e.target.value)} />
      </Field>
    </FormShell>
  );
}
