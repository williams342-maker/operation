import React, { useState } from "react";
import { toast } from "sonner";
import {
  Image as ImageIcon, BookOpen, SlidersHorizontal, Truck, Shield,
  Users, Megaphone, Languages, Sparkles, Facebook, ChevronRight,
  Share2, AlertTriangle,
} from "lucide-react";
import {
  updateMakerProfile, makerCloseShop, makerReopenShop,
  makerRequestDeletion, makerCancelDeletion, cancelMakerSubscription,
  fetchMakerMe,
} from "../../lib/api";
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
  { id: "social",     label: "Social media",      icon: Share2,    kind: "form" },
  { id: "options",    label: "Options",           icon: SlidersHorizontal, kind: "form" },
  { id: "shipping",   label: "Shipping settings", icon: Truck,     kind: "form" },
  { id: "policy",     label: "Policy settings",   icon: Shield,    kind: "form" },
  { id: "partners",   label: "Partners you work with", icon: Users, kind: "soon" },
  { id: "offsite",    label: "Offsite Ads",       icon: Megaphone, kind: "deeplink", target: "marketing" },
  { id: "languages",  label: "Languages and translations", icon: Languages, kind: "soon" },
  { id: "subscription", label: "Your subscription", icon: Sparkles, kind: "embed" },
  { id: "facebook",   label: "Facebook Shops",    icon: Facebook,  kind: "soon" },
  { id: "account",    label: "Account & Plan",    icon: AlertTriangle, kind: "form" },
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
            <Policy maker={maker} onSaved={onMakerUpdated} />
          )}
          {active.kind === "form" && active.id === "account" && (
            <AccountPanel maker={maker} onSaved={onMakerUpdated} />
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
      // Only send fields that actually changed — avoids leaking the
      // empty-string defaults from useSettingsForm into bool-typed columns
      // (e.g. is_veteran_owned, vacation_mode) on the backend, which would
      // fail Pydantic validation for Optional[bool].
      const patch = Object.fromEntries(
        fields
          .filter((f) => (form[f] ?? "") !== (initial[f] ?? ""))
          .map((f) => [f, form[f]]),
      );
      const updated = await updateMakerProfile(patch);
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
  const fields = [
    "name", "shop_title", "location", "portrait", "cover",
    "order_receipt_banner_url", "shop_announcement",
    "message_to_buyers", "message_to_buyers_digital",
  ];
  const { form, set, dirty, busy, submit } = useSettingsForm(maker, fields, onSaved);
  return (
    <FormShell
      title="Info & Appearance"
      blurb="The basics buyers see at the top of your shop + auto-messaging that goes out with every order. URLs should point at uploaded R2 assets."
      onSubmit={submit}
      dirty={dirty}
      busy={busy}
      testId="settings-info"
    >
      <Field label="Shop name" testId="settings-info-name">
        <input className={inputCls} value={form.name} onChange={(e) => set("name")(e.target.value)} />
      </Field>
      <Field label="Shop title" hint="A short tagline shown under your shop name. Appears in search results — treat it like an SEO headline.">
        <input
          className={inputCls}
          value={form.shop_title || ""}
          onChange={(e) => set("shop_title")(e.target.value)}
          maxLength={140}
          placeholder="e.g. Precision CNC art since 2019"
          data-testid="settings-info-shop-title"
        />
      </Field>
      <Field label="Location" hint="City, state — keeps shipping estimates honest.">
        <input className={inputCls} value={form.location} onChange={(e) => set("location")(e.target.value)} />
      </Field>
      <Field label="Shop icon URL" hint="Square headshot or logo (recommended 800×800). Shown on cards, receipts, and your profile.">
        <input className={inputCls} value={form.portrait} onChange={(e) => set("portrait")(e.target.value)} placeholder="https://cdn.craftersmarket.org/…" />
      </Field>
      <Field label="Cover URL" hint="Wide banner that fills your shop hero (recommended 2400×800).">
        <input className={inputCls} value={form.cover} onChange={(e) => set("cover")(e.target.value)} placeholder="https://cdn.craftersmarket.org/…" />
      </Field>
      <Field label="Order receipt banner URL" hint="Thin banner (760×100, <2MB) printed at the top of emailed order receipts. Great place for a brand mark.">
        <input
          className={inputCls}
          value={form.order_receipt_banner_url || ""}
          onChange={(e) => set("order_receipt_banner_url")(e.target.value)}
          placeholder="https://cdn.craftersmarket.org/…"
          data-testid="settings-info-receipt-banner"
        />
      </Field>
      <Field label="Shop announcement" hint="Pinned notice shown at the top of your shop page. Use it for sales, vacations, or new drops.">
        <textarea
          rows={3}
          className={`${inputCls} resize-none`}
          value={form.shop_announcement || ""}
          onChange={(e) => set("shop_announcement")(e.target.value)}
          maxLength={800}
          placeholder="Thanks everyone for all your support. Please contact me if you have any questions…"
          data-testid="settings-info-announcement"
        />
      </Field>
      <Field label="Message to buyers" hint="Auto-appended to order confirmation emails for physical goods. Set tone and turnaround expectations.">
        <textarea
          rows={4}
          className={`${inputCls} resize-none`}
          value={form.message_to_buyers || ""}
          onChange={(e) => set("message_to_buyers")(e.target.value)}
          maxLength={1200}
          placeholder="Thank you for your order! I'm adding new patterns all the time…"
          data-testid="settings-info-msg-buyers"
        />
      </Field>
      <Field label="Message to buyers for digital items" hint="Shown on the Downloads page and in the digital-item delivery email.">
        <textarea
          rows={3}
          className={`${inputCls} resize-none`}
          value={form.message_to_buyers_digital || ""}
          onChange={(e) => set("message_to_buyers_digital")(e.target.value)}
          maxLength={1200}
          placeholder="Thanks for downloading! Need a different file format? Message me…"
          data-testid="settings-info-msg-digital"
        />
      </Field>
    </FormShell>
  );
}

// ============================================================================
// Section: Social media — pure URL inputs, rendered as a compact "connect"
// grid. No OAuth — these are vanity links surfaced on the shop profile.
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
      blurb="Link your social profiles so buyers can follow your work outside Crafters Market. Links surface on your shop page and in every listing footer."
      onSubmit={submit}
      dirty={dirty}
      busy={busy}
      testId="settings-social"
    >
      <div className="space-y-3">
        {SOCIAL_SPECS.map((s) => {
          const connected = !!(form[s.key] || "").trim();
          return (
            <div
              key={s.key}
              className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 border border-[#262626] p-3"
              data-testid={`settings-social-${s.key}`}
            >
              <div className="md:w-40 shrink-0">
                <div className="font-mono text-xs uppercase tracking-[0.22em] text-[#e5e5e5]">{s.label}</div>
                <div className="font-mono text-[10px] text-[#525252] mt-0.5">{s.hint}</div>
              </div>
              <input
                className={`${inputCls} flex-1`}
                type="url"
                name={s.key}
                autoComplete="url"
                value={form[s.key] || ""}
                onChange={(e) => set(s.key)(e.target.value)}
                placeholder={s.placeholder}
                data-testid={`settings-social-${s.key}-input`}
              />
              <span
                className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border ${
                  connected
                    ? "border-emerald-500/60 text-emerald-400"
                    : "border-[#262626] text-[#525252]"
                }`}
                data-testid={`settings-social-${s.key}-status`}
              >
                {connected ? "◆ Connected" : "◇ Not set"}
              </span>
            </div>
          );
        })}
      </div>
    </FormShell>
  );
}

// ============================================================================
// Section: Account & Plan — downgrade (cancel Plus), close shop, request
// 30-day deletion (and back out during grace). Kept as a separate section
// with prominent red styling so nobody nukes their shop by accident.
// ============================================================================
function AccountPanel({ maker, onSaved }) {
  const isPlus = ["active", "trialing"].includes(maker?.subscription_status);
  const closed = !!maker?.shop_closed;
  const deletionAt = maker?.deletion_requested_at;
  const purgeAt = maker?.deletion_cancels_at;
  const daysRemaining = purgeAt
    ? Math.max(0, Math.ceil((new Date(purgeAt).getTime() - Date.now()) / (24 * 3600 * 1000)))
    : null;

  const [busy, setBusy] = useState("");

  // Account actions return `{ok: true}` only — they don't include the
  // full maker doc. We re-fetch /maker/me after each mutation and hand
  // the result to `onSaved` so the parent's `setMaker(m)` gets a real
  // maker (not undefined) and the current Settings sub-section stays
  // mounted without flashing an empty state.
  const refreshMaker = async () => {
    try {
      const m = await fetchMakerMe();
      onSaved?.(m);
    } catch { /* silently ignore — toast already surfaced the primary success */ }
  };

  const downgrade = async () => {
    if (!window.confirm(
      "Cancel Crafters Plus at the end of your billing period?\n\n" +
      "You'll keep Plus benefits until the period ends, then drop to Free " +
      "(10 listings/mo quota, 5% fee).",
    )) return;
    setBusy("downgrade");
    try {
      await cancelMakerSubscription();
      toast.success("Plus will cancel at the end of the current period.");
      await refreshMaker();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cancel failed.");
    } finally { setBusy(""); }
  };

  const closeShop = async () => {
    if (!window.confirm(
      "Close your shop platform-wide?\n\n" +
      "Buyers see a 'This shop is closed' banner. No new orders. " +
      "Existing listings stay. You can reopen anytime.",
    )) return;
    setBusy("close");
    try {
      await makerCloseShop();
      toast.success("Shop closed. Reopen whenever you're ready.");
      await refreshMaker();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Close failed.");
    } finally { setBusy(""); }
  };

  const reopen = async () => {
    setBusy("reopen");
    try {
      await makerReopenShop();
      toast.success("Shop reopened. Welcome back.");
      await refreshMaker();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reopen failed.");
    } finally { setBusy(""); }
  };

  const requestDelete = async () => {
    const ok = window.prompt(
      "DELETE YOUR ACCOUNT?\n\n" +
      "This starts a 30-day grace period. On day 30 we permanently remove:\n" +
      "• Your shop profile\n" +
      "• All listings\n" +
      "• Messages, reviews, design files\n\n" +
      "Financial records (orders, payouts, tax) are preserved for accounting.\n\n" +
      "To continue, type DELETE below:",
    );
    if (ok !== "DELETE") {
      if (ok !== null) toast.error("Cancelled — you didn't type DELETE.");
      return;
    }
    setBusy("delete");
    try {
      const r = await makerRequestDeletion();
      toast.success(`Deletion scheduled in ${r.days_remaining} days. Cancel anytime.`);
      await refreshMaker();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete request failed.");
    } finally { setBusy(""); }
  };

  const cancelDelete = async () => {
    setBusy("cancel-delete");
    try {
      await makerCancelDeletion();
      toast.success("Deletion cancelled — your account is safe.");
      await refreshMaker();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cancel failed.");
    } finally { setBusy(""); }
  };

  return (
    <div className="space-y-6" data-testid="settings-account">
      <div>
        <h2 className="font-display text-2xl text-[#e5e5e5]">Account & Plan</h2>
        <p className="font-mono text-sm text-[#a3a3a3] mt-2 max-w-2xl">
          Downgrade your subscription, close your shop, or request account deletion.
        </p>
      </div>

      {/* Pending-deletion banner — red, impossible to miss */}
      {deletionAt && (
        <div className="border-2 border-red-600 bg-red-950/30 p-4" data-testid="account-deletion-banner">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 mb-1">◆ Pending deletion</div>
          <div className="font-display text-xl text-red-300">
            Your account is scheduled for deletion in {daysRemaining} {daysRemaining === 1 ? "day" : "days"}.
          </div>
          <p className="font-mono text-xs text-red-300/80 mt-2">
            On {new Date(purgeAt).toLocaleDateString()}, your shop and every listing will be permanently removed.
            Change your mind?
          </p>
          <button
            onClick={cancelDelete}
            disabled={busy === "cancel-delete"}
            className="mt-3 px-4 py-2 bg-white hover:bg-[#e5e5e5] text-red-700 border border-white font-mono text-[10px] uppercase tracking-[0.22em] font-bold disabled:opacity-50"
            data-testid="account-cancel-deletion-btn"
          >
            {busy === "cancel-delete" ? "…" : "← Cancel deletion — keep my account"}
          </button>
        </div>
      )}

      {/* Plan downgrade */}
      <section className="border border-[#262626] p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Current plan</div>
            <div className="font-display text-2xl mt-1">
              {isPlus ? (
                <span className="text-emerald-400">★ Crafters Plus · $12/mo</span>
              ) : (
                <span className="text-[#a3a3a3]">◇ Free</span>
              )}
            </div>
          </div>
          {isPlus ? (
            <button
              onClick={downgrade}
              disabled={!!busy}
              className="px-4 py-2 border border-[#262626] hover:border-amber-500 hover:text-amber-400 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid="account-downgrade-btn"
            >
              {busy === "downgrade" ? "…" : "Downgrade to Free"}
            </button>
          ) : (
            <span className="font-mono text-[10px] text-[#525252] uppercase tracking-[0.22em]">
              Upgrade available in "Your subscription" →
            </span>
          )}
        </div>
      </section>

      {/* Close / reopen shop */}
      <section className="border border-[#262626] p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Shop status</div>
            <div className="font-display text-2xl mt-1">
              {closed ? (
                <span className="text-amber-400">◆ Closed · No new orders</span>
              ) : (
                <span className="text-emerald-400">◆ Open</span>
              )}
            </div>
            <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-md">
              Closing hides your shop from search and blocks new orders without deleting data. Reopen anytime.
            </p>
          </div>
          {closed ? (
            <button
              onClick={reopen}
              disabled={!!busy}
              className="px-4 py-2 border border-emerald-600 text-emerald-400 hover:bg-emerald-600 hover:text-white font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50"
              data-testid="account-reopen-btn"
            >
              {busy === "reopen" ? "…" : "Reopen shop"}
            </button>
          ) : (
            <button
              onClick={closeShop}
              disabled={!!busy || !!deletionAt}
              className="px-4 py-2 border border-amber-600 text-amber-400 hover:bg-amber-600 hover:text-black font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50"
              data-testid="account-close-btn"
            >
              {busy === "close" ? "…" : "Close shop"}
            </button>
          )}
        </div>
      </section>

      {/* Danger zone */}
      <section className="border-2 border-red-900/60 bg-red-950/10 p-5" data-testid="account-danger-zone">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} className="text-red-500" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-500 font-bold">Danger zone</span>
        </div>
        <div className="font-display text-xl text-[#e5e5e5] mb-2">Delete my account</div>
        <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed max-w-2xl">
          Starts a <b className="text-red-400">30-day grace period</b>. After 30 days your shop
          and every listing, message, review, and design file is permanently
          removed. Orders and payouts are preserved (required for accounting &
          tax compliance) but your maker identifier is anonymized. Cancellable
          anytime during the 30-day window.
        </p>
        <button
          onClick={requestDelete}
          disabled={!!busy || !!deletionAt}
          className="mt-4 px-4 py-2 border border-red-600 text-red-400 hover:bg-red-600 hover:text-white font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50"
          data-testid="account-delete-btn"
        >
          {busy === "delete" ? "…" : deletionAt ? "Deletion pending →" : "Request account deletion"}
        </button>
      </section>
    </div>
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
