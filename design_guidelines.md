# Crafters Market — Design Guidelines (iter349)

Source: design blueprint locked 2026-06-10. Reference JSON at `/app/design_guidelines.json`.

## Direction
**Organic & Earthy** (paper-textured, USA artisan, magazine-editorial) **+ Swiss high-contrast typography** (bold condensed display).

LIGHT is the new default theme. DARK is a refined "workshop after hours" toggle. Buyers default LIGHT. Makers default LIGHT but can toggle DARK. Preference persists in localStorage. First visit respects `prefers-color-scheme`.

## Typography
- **Heading**: Oswald (weights 500–700), condensed, uppercase, tight tracking
- **Body**: Inter (400–600)
- **Mono**: JetBrains Mono (for stats, code, admin)

Scale:
- h1: `text-5xl sm:text-7xl lg:text-8xl tracking-tighter uppercase leading-none`
- h2: `text-4xl sm:text-5xl lg:text-6xl tracking-tight uppercase leading-tight`
- h3: `text-2xl sm:text-3xl tracking-tight uppercase`
- body: `text-base leading-relaxed text-ink-muted`
- eyebrow: `text-sm font-bold tracking-[0.2em] uppercase text-accent`

## Color tokens (CSS variables, RGB triplet)
| Token | Light | Dark |
|---|---|---|
| `--bg` | `249, 248, 246` (cream `#F9F8F6`) | `18, 18, 18` (`#121212`) |
| `--bg-elevated` | `255, 255, 255` | `30, 30, 30` (`#1E1E1E`) |
| `--ink` | `26, 26, 26` | `243, 244, 246` |
| `--ink-muted` | `74, 74, 74` | `156, 163, 175` |
| `--accent` | `234, 88, 12` (`#EA580C`) | `249, 115, 22` (`#F97316`) |
| `--accent-hover` | `194, 65, 12` | `234, 88, 12` |
| `--border` | `229, 229, 229` | `55, 65, 81` |
| `--success` | `22, 163, 74` | `34, 197, 94` |
| `--warn` | `234, 179, 8` | `250, 204, 21` |
| `--danger` | `220, 38, 38` | `239, 68, 68` |

Tailwind colors expose them as `bg-bg`, `bg-bg-elevated`, `text-ink`, `text-ink-muted`, `bg-accent`, `text-accent`, `border-border`, etc.

## Layout
- Sharp corners (`rounded-none`, max `rounded-sm`). NEVER pill/full radius on cards.
- Generous spacing: section padding `py-16 md:py-24`, card padding `p-6 md:p-8`.
- Bento-style grids with `gap-8` to `gap-12`.
- Subtle grain overlay via `bg-texture-grain` utility (SVG noise, opacity 30-50%).

## Hero clip-path
Diagonal photo panels: `clip-path: polygon(15% 0, 100% 0, 85% 100%, 0 100%)` or rotate the panel ~6-10°. Sequence: woodworking → leather → metal sparks → ceramic.

## Components
- **Promo bar**: cream/grey strip, truck icon, single-line copy
- **Nav**: orange square "CM" logo + wordmark left; centered nav (SHOP / MAKERS / CUSTOM / COMMUNITY); right cluster (theme toggle, sign-in pill, cart pill). Sharp corners.
- **Buttons**:
  - Primary: `bg-accent text-white hover:bg-accent-hover` (sharp corners)
  - Secondary: `border-2 border-ink text-ink hover:bg-ink hover:text-bg`
- **Cards**: 1px `border-border`, no shadow, hover lifts to `border-accent`
- **Trust strip**: 5 monoline lucide icons with `divide-x` separators
- **Category tiles**: monoline icon + label + accent "SHOP NOW →"
- **Stats row**: monoline icon + huge number + label + thin bottom border
- **Inputs**: sharp corners, `bg-bg-elevated`, `border-border`, focus `ring-accent`

## Motion
- Buttons: 150-200ms color transitions; primary slight scale on press
- Cards: 200ms border + bg tint hover
- Page entrance (hero): staggered fade-up (Eyebrow → H1 → Body → CTAs, ~120ms gaps). Photo panels slide in diagonally from right.
- Icons: optional draw-in / bounce on hover (framer-motion)

## Theme toggle
Sun/moon Lucide icon in nav right cluster. On click → toggle `dark` class on `<html>`. Persist in `localStorage["cm_theme"]`. First-load respects `window.matchMedia('(prefers-color-scheme: dark)')` for buyers; makers always default light.

## Implementation rules
1. Keep every existing `data-testid` attribute.
2. No new icon library — use existing `lucide-react`.
3. Use Tailwind utilities + CSS variables. NO hardcoded hex in components.
4. Reuse Shadcn components but customize via Tailwind/variables (sharp corners, var-driven colors).
5. Light & dark MUST both look intentional (no "dark = light inverted" laziness).
