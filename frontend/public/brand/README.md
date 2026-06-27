# Compass Brand Kit

Crafters Market AI · official identity (iter413cu).

## Files

| File | Purpose |
| --- | --- |
| `compass-master.svg` | Source SVG. Uses `currentColor`. Drop into any React tree via `<img>` or copy paths into a JSX component. |
| `compass-light.svg` | Fixed-color ink stroke (`#1a1a18`). For light backgrounds where you cannot inherit `currentColor`. |
| `compass-dark.svg` | Fixed-color cream stroke (`#f4ecd8`). For dark backgrounds. |
| `compass-brand.svg` | Copper-accent stroke (`#ff4500`). Matches Crafters Market `var(--brand)`. Default for buttons / interactive surfaces. |
| `compass-avatar.svg` | 512×512 padded canvas with the mark centred. For social profiles, OG cards, app store icons. |
| `compass-favicon.svg` | 32×32 favicon source with thicker stroke for legibility at 16px. |

## In-React usage

Prefer the React component over `<img>` so the icon inherits `currentColor`:

```jsx
import { CompassIcon, CompassLockup } from "@/components/icons/CompassIcon";

// Standalone mark — inherits text color
<CompassIcon size={20} className="text-[var(--brand)]" />

// Wordmark lockup — preferred per the year-1 brand-building rule
<CompassLockup size={20} />                            // ◈ Compass
<CompassLockup size={20} subtitle />                   // ◈ Compass · Your Marketplace Assistant
<CompassLockup size={22} subtitle align="stack" />     // icon left, stacked text right
```

## Construction rules

- **Viewbox:** 24 × 24 (matches lucide-react sizing — drop-in replacement).
- **Stroke:** 1.75 for 24px+, 2.5 for 16-and-under favicon work.
- **Corner radius:** 4 (master) / 5 (favicon) for the rotated-square silhouette.
- **Inner triangle:** filled `currentColor`, apex at y=8.5, base y=11.5. Sits slightly above optical centre to give a subtle directional cue.
- **Never** add gloss / drop-shadows / colour gradients. The mark must read solid at 16px.
- **Never** rotate or recolour the inner triangle independently — the apex always points up.

## Sub-brand lockups

When introducing a Compass-powered surface, pair the mark with a wordmark:

```
◈ Compass Discovery
◈ Compass Recommendations
◈ Compass Insights
◈ Compass Operations
◈ Compass Growth
```

Render via:

```jsx
<span className="inline-flex items-center gap-1.5">
  <CompassIcon size={18} className="text-[var(--brand)]" />
  <span className="font-mono text-sm text-[var(--ink)] tracking-tight">
    Compass <span className="text-[var(--ink-muted)] font-normal">Discovery</span>
  </span>
</span>
```

## Live preview

`/admin/compass-preview` renders all variants + size + colour treatments
+ in-context Help-widget mockups. Use it as a visual regression
reference whenever the icon is updated.
