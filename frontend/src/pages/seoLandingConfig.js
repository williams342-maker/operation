/**
 * SEO landing-page configs.
 * --------------------------
 * One entry per high-intent keyword search phrase we want to rank for.
 * Each entry feeds the reusable `SEOLandingPage` component.
 *
 * Keep H1 EXACTLY matching the target keyword (lowercase optional).
 * The `match` predicate filters the live products/makers grid so
 * Google sees real, relevant inventory on every page — not stuffed
 * keyword shells.
 *
 * To add a new landing page:
 *   1. Append a new entry below.
 *   2. Add a `<Route path="/<slug>" element={<SEOLandingPage config={SEO_LANDING_PAGES.<slug>} />} />`
 *      to App.js.
 *   3. (Optional) Surface a link to it in Footer.jsx for crawler discovery
 *      and to pass link equity from the homepage.
 *   4. Append the slug to `SEO_LANDING_SLUGS` in /app/backend/routers/seo.py
 *      so it lands in sitemap.xml.
 */
export const SEO_LANDING_PAGES = {
  "cnc-metal-art": {
    slug: "cnc-metal-art",
    keyword: "CNC Metal Art",
    eyebrow: "Marketplace · CNC Metal Art",
    h1: "CNC Metal Art, Built by Hand.",
    intro:
      "Shop original CNC metal art — plasma-cut and laser-cut steel, aluminum, and copper pieces by vetted American artisans. Every wall sculpture, monogram, and custom sign is hand-finished in a real workshop, never mass-produced.",
    paragraphs: [
      "From rustic ranch signs to precision-cut compass roses, CNC metal art on Crafters Market is built one piece at a time. Each maker runs their own shop, programs their own cuts, and finishes every edge by hand — the difference shows up in the texture, weight, and patina you get.",
      "Filter by technique (plasma, laser, router), by category (wall art, custom signs, garden art, business signage), or just scroll the curated grid. Every order pays the maker directly through Stripe Connect — no middleman holding funds, no anonymous factories.",
    ],
    match: (p) => /metal|steel|plasma|laser|aluminum|copper|forge/i.test(`${p.title} ${p.description} ${p.materials?.join(" ")} ${p.technique}`)
      || ["PLASMA", "LASER", "FORGE"].includes(p.technique),
    ctaLabel: "Browse CNC metal art",
    ctaHref: "/shop?category=Wall%20Art",
  },

  "cnc-laser-art": {
    slug: "cnc-laser-art",
    keyword: "CNC Laser Art",
    eyebrow: "Marketplace · CNC Laser Art",
    h1: "CNC Laser Art & Engraved Originals.",
    intro:
      "Precision laser-cut and laser-engraved wood, acrylic, and metal art from independent makers. Crisp detail work, custom monograms, photo-engraved keepsakes, and wedding signs you won't find on big retail sites.",
    paragraphs: [
      "Laser tooling pulls off details handheld tools can't — micro-engraved family photos in maple, lace-cut acrylic edge-lit lamps, intricate mandala wall panels. Crafters Market makers run vetted fiber and CO2 systems with the operator notes, machine settings, and finishing passes that separate good from great.",
      "Looking to commission something one-off? Submit a custom-order brief and we'll route it to a laser-equipped artisan who can quote your file, your timeline, and your size — usually inside 24 hours.",
    ],
    match: (p) => /laser|engrav|etch|burn/i.test(`${p.title} ${p.description} ${p.technique}`)
      || p.technique === "LASER",
    ctaLabel: "Browse laser-cut originals",
    ctaHref: "/shop",
  },

  "cnc-manufacturing": {
    slug: "cnc-manufacturing",
    keyword: "CNC Manufacturing",
    eyebrow: "Made-to-Order · CNC Manufacturing",
    h1: "CNC Manufacturing — One Piece at a Time.",
    intro:
      "Looking for small-batch CNC manufacturing in the USA? Crafters Market connects buyers with vetted independent CNC shops running plasma, laser, router, and forge tooling. Submit a brief, get a quote, and your piece ships direct from the artisan who built it.",
    paragraphs: [
      "Unlike industrial CNC shops chasing volume contracts, our makers specialize in run-of-one and small-batch precision crafting — perfect for custom signs, branded gifts, architectural details, restoration parts, and commissioned art. You talk directly to the operator, not a sales department.",
      "Every approved maker submits real shop photos, machine specs, and past-work samples before they're listed. You see what they've built before you commit, and Stripe-secured payments only release when your piece ships.",
    ],
    match: () => true,
    ctaLabel: "Commission a custom piece",
    ctaHref: "/custom-order",
  },

  "cnc-usa": {
    slug: "cnc-usa",
    keyword: "CNC USA",
    eyebrow: "Made in America · CNC USA",
    h1: "CNC USA — Built in American Shops.",
    intro:
      "Every CNC piece on Crafters Market is cut, finished, and shipped from an American shop. No drop-shipping, no overseas factories, no anonymous wholesalers — just vetted independent makers from coast to coast.",
    paragraphs: [
      "We verify every applicant's workshop before they list. Real machines, real address, real past work — that's the floor. The result is a marketplace where 'Made in USA' is the default, not a premium tier you pay extra for.",
      "Many of our makers are veteran-owned, family-run, or solo-operator shops. Supporting them keeps precision craft skills alive in towns the big retailers ignore — and gives you a piece with a story you can actually trace.",
    ],
    mode: "makers",
    match: (m) => !m.deleted_at,
    ctaLabel: "Meet the American makers",
    ctaHref: "/makers",
  },

  "artisan-marketplace": {
    slug: "artisan-marketplace",
    keyword: "Artisan Marketplace",
    eyebrow: "Curated · Artisan Marketplace",
    h1: "An Artisan Marketplace, Curated by Makers.",
    intro:
      "Crafters Market is the artisan marketplace built for precision craft — CNC metal art, laser-cut originals, wood signs, plasma-cut sculptures, and custom commissions from vetted independent shops across the United States.",
    paragraphs: [
      "Unlike sprawling craft sites where mass-produced imports drown out real makers, every listing here is hand-built by a vetted artisan in their own workshop. We screen every applicant, verify every shop, and let the makers' own work do the rest of the talking.",
      "Browse by category, by technique, or by maker. Read each shop's story before you buy. Track production from your dashboard. Pay the maker direct through Stripe Connect with no marketplace middleman skimming the proceeds.",
    ],
    match: () => true,
    ctaLabel: "Shop the marketplace",
    ctaHref: "/shop",
  },

  "custom-handmade-goods": {
    slug: "custom-handmade-goods",
    keyword: "Custom Handmade Goods",
    eyebrow: "Made-to-Order · Custom Handmade Goods",
    h1: "Custom Handmade Goods, Built to Order.",
    intro:
      "Order custom handmade goods directly from the artisan: monogrammed wall art, engraved cutting boards, plasma-cut address signs, wedding gifts, business signage, and one-of-a-kind commissions. Every piece is made-to-order, never warehoused.",
    paragraphs: [
      "Submit a brief with your idea, your material preference, and your timeline. We'll route it to the right maker on the platform — usually within 24 hours. You'll get a quote, a turnaround estimate, and direct messaging with the artisan who'll build your piece.",
      "Need it in time for a specific event? Filter makers by processing time and rush-order availability. Want to see the work-in-progress shots before final shipping? Just ask the maker — most are happy to share.",
    ],
    match: () => true,
    ctaLabel: "Start a custom order",
    ctaHref: "/custom-order",
  },
};

/** Slug list for sitemap consumers — keep in sync with the keys above. */
export const SEO_LANDING_SLUGS = Object.keys(SEO_LANDING_PAGES);
