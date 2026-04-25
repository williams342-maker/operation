# Crafters Market — Modernized Homepage (Handoff Build)

## Original Problem Statement
> "look at my current website craftersmarket.org make it more modern and dynamic"

User selected: **Bold editorial / industrial** aesthetic, with **animation**, modernized for **handoff** to the existing site/team.

## Reference Site
https://craftersmarket.org — A marketplace for handcrafted CNC art, custom signs, and metal/wood creations made by approved artisan makers (plasma cutting, laser engraving, wood routing).

## Architecture
- **Pure frontend handoff** — React 19 + Tailwind + Framer Motion + react-fast-marquee
- No backend logic touched (default FastAPI starter remains)
- Single-page composition: drop-in `Home` page assembled from 9 modular section components in `/app/frontend/src/components/sections/`

## Design System (see /app/design_guidelines.json)
- **Archetype:** Swiss Brutalist / Industrial Dark
- **Palette:** `#0a0a0a` background, `#e5e5e5` foreground, `#ff4500` safety-orange / plasma-spark accent
- **Type:** `Anton` for massive cinematic display, `JetBrains Mono` for body/labels (no Inter, no purple gradients)
- **Layout:** Asymmetric bento grids, generous spacing, left/right alignment (never centered)
- **Surfaces:** Flat `#121212` cards with sharp 1px `#262626` borders, no rounded corners, no drop shadows
- **Motion:** Framer Motion (parallax hero, staggered word reveal, scroll-triggered fades, hover translate-up), `react-fast-marquee` kinetic tickers

## Sections Implemented
1. **Nav** — Sticky glassmorphism on scroll, logo wordmark, animated underline links, mobile fullscreen menu
2. **Hero** — Cinematic welding-spark backdrop with parallax scroll, 4-line word-reveal headline ("FORGED BY HAND. CUT BY MACHINE."), live-makers strip, dual CTAs, bottom info ticker
3. **Maker Showcase** — Asymmetric bento (col-span-7 hero card with row-span-2, plus three supporting cards), maker badges with initials, technique tags (PLASMA / LASER / ROUTER / CUSTOM), hover image zoom
4. **Categories** — Editorial numbered row list (01/02/03 — Wall Art, Custom Signs, Outdoor Art), oversized type that translates on hover, contextual thumbnails
5. **Process** — Background marquee tickers ("DESIGN · TOOLPATH · CARVE · DETAIL ·"), large "live feed" workshop image with overlay tags, 4-step ordered list (CAD → CNC → Detail → Finish)
6. **For Makers** — Full-bleed safety-orange editorial poster with diagonal stripe noise, oversized "BUILT FOR CNC GARAGE MAKERS" headline, 4-perk grid, dual CTAs
7. **Reviews** — 3-column verified reviews with massive display type, 4.97/5 hero rating, hairline column dividers
8. **Custom CTA** — "BRING YOUR VISION TO LIFE" with tri-state typography (solid / orange / outline), bullet checklist, dual CTAs, "CUSTOM · ONE-OF-ONE · BUILT TO ORDER" marquee strip
9. **Footer** — Brand block with contact, 3-column link grid, full-width oversized "CRAFTERS MARKET" outline wordmark, admin access link

## File Map
```
/app/frontend/src/
├── App.js                              # Composes Home page
├── App.css                             # Minimal app shell
├── index.css                           # Theme tokens, fonts, utilities (.font-display, .text-outline, .btn-industrial, .grain, etc.)
└── components/sections/
    ├── Nav.jsx
    ├── Hero.jsx
    ├── MakerShowcase.jsx
    ├── Categories.jsx
    ├── Process.jsx
    ├── ForMakers.jsx
    ├── Reviews.jsx
    ├── CustomCTA.jsx
    └── Footer.jsx
/app/frontend/public/index.html         # Loads Anton + JetBrains Mono via Google Fonts
```

## What's Implemented (2026-01-25)
- Full responsive homepage with all 9 sections styled in industrial dark theme
- Framer Motion animations: parallax hero, staggered word reveal, scroll-triggered fade-up, hover micro-interactions, mobile menu transitions
- Two kinetic marquees (Process backdrop + Custom CTA strip)
- Grain noise overlay on body via SVG fractal
- Custom industrial CTA buttons with hover invert
- All interactive elements have unique `data-testid` attributes
- Verified visually via screenshots (hero, showcase, categories, process, makers, custom CTA all rendering correctly)

## Backlog / P1
- Wire individual product/category routes (currently `#shop` placeholders)
- "Custom Order" form modal with validation + email notification
- Maker application form
- Real product/maker data from CMS or backend
- Cart + Stripe checkout integration

## Backlog / P2
- Rich product detail pages with 3D viewer for CNC pieces
- Maker profile pages and storefronts
- Search + filter for the full marketplace
- Press / About / Sustainability content pages
- Blog/Journal for the "Crafted with Precision" stories

## Next Action Items
- User reviews handoff and provides feedback on copy / sections
- Decide whether to extend into full marketplace build or hand React components to existing Crafters Market team to integrate
