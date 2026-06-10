/**
 * DeclineReasonPicker — shared preset-dropdown for any "decline with
 * optional reason" workflow. Currently powering:
 *   • Maker application rejection (admin)
 *   • Backorder request decline (maker)
 *
 * Behaviour:
 *   • Clicking a preset chip fills the textarea with that preset's copy
 *   • Clicking "Custom..." clears the textarea so the admin/maker can
 *     write something fully bespoke
 *   • The textarea remains the source of truth — preset chips just seed
 *     it. Editing after picking a preset is encouraged.
 */
import React from "react";

const PRESETS = {
  application: [
    {
      id: "portfolio-thin",
      label: "Portfolio thin",
      body: "We loved your craft, but we'd like to see a bit more depth in your portfolio before bringing you on. Aim for at least 8-10 finished pieces showcasing your range, then feel free to reapply.",
    },
    {
      id: "off-platform",
      label: "Niche fit",
      body: "Your work is beautiful, but it doesn't quite fit Crafters Market's current niche of handmade goods. Best of luck — we'd be glad to revisit if your range expands.",
    },
    {
      id: "geo-not-yet",
      label: "Geo not yet supported",
      body: "We aren't yet shipping to/from your region, but we're expanding fast. We've kept your application on file and will reach out the moment we open up.",
    },
    {
      id: "incomplete",
      label: "Incomplete",
      body: "Your application is missing a portfolio link or about section. Reapply with both filled in and we'll prioritize the review.",
    },
  ],
  backorder: [
    {
      id: "booked",
      label: "Booked through quarter",
      body: "Booked through this quarter — happy to revisit in 8-12 weeks if you're still interested.",
    },
    {
      id: "materials",
      label: "Materials unavailable",
      body: "I'm out of the specific material this piece needs and won't be re-sourcing it for a while. Sorry to disappoint.",
    },
    {
      id: "discontinued",
      label: "Discontinued",
      body: "I've discontinued this design. Browse my other pieces or message me about a custom commission inspired by it.",
    },
    {
      id: "scope",
      label: "Scope mismatch",
      body: "Your customizations are outside what I can offer right now. If you can flex on the spec, message me directly and we can scope a path forward.",
    },
  ],
};

/**
 * @param {"application"|"backorder"} kind  preset library to render
 * @param {string} value current textarea value
 * @param {(v: string) => void} onChange
 * @param {string} testIdPrefix data-testid prefix for chips + textarea
 * @param {string} placeholder
 * @param {number} rows
 */
export default function DeclineReasonPicker({
  kind, value, onChange, testIdPrefix = "decline",
  placeholder = "Reason (optional, shown to recipient)…", rows = 3,
}) {
  const presets = PRESETS[kind] || [];
  const matchedPreset = presets.find((p) => p.body === value);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" data-testid={`${testIdPrefix}-presets`}>
        {presets.map((p) => {
          const active = matchedPreset?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.body)}
              data-testid={`${testIdPrefix}-preset-${p.id}`}
              className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-[0.18em] transition ${
                active
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-line text-ink-muted hover:border-brand/50 hover:text-ink"
              }`}
              title={p.body}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange("")}
          data-testid={`${testIdPrefix}-preset-custom`}
          className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-[0.18em] transition ${
            !value
              ? "border-line text-ink-muted"
              : "border-line text-ink-muted hover:border-brand/50 hover:text-ink"
          }`}
        >
          ✕ Custom
        </button>
      </div>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={`${testIdPrefix}-textarea`}
        className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-muted"
      />
    </div>
  );
}
