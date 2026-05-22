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

  // ============================================================
  // Buyer-intent landing pages (iter177).
  // Each targets a high-volume buyer search phrase. H1 + meta-title
  // match the phrase verbatim; `match` filters live inventory so each
  // page surfaces real products (no keyword-stuffed empty shells).
  // ============================================================

  "custom-metal-signs": {
    slug: "custom-metal-signs",
    keyword: "Custom Metal Signs",
    eyebrow: "Marketplace · Custom Metal Signs",
    h1: "Custom Metal Signs, Cut to Order in American Shops.",
    intro:
      "Personalized metal signs for your home, ranch, garage, business, or wedding — plasma-cut and laser-cut steel, aluminum, and copper by vetted American makers. Every sign is built to your specs, never warehoused, and ships straight from the artisan's workshop.",
    paragraphs: [
      "Address numbers, family monograms, ranch entry signs, garage wall art, business storefront pieces — our makers run real plasma and fiber-laser tables and can quote anything from a 12-inch house number to a 6-foot custom entry sign. Tell us your size, material, and finish; we'll route the brief to the right maker.",
      "All metal signs come with weatherproof powder-coat or clear-coat options. Most pieces ship in 2-4 weeks; rush availability varies by maker. Pay direct through Stripe — funds only release once the sign ships.",
    ],
    match: (p) => /sign|address|monogram|name plate|metal art/i.test(`${p.title} ${p.description}`)
      || ["PLASMA", "LASER"].includes(p.technique),
    ctaLabel: "Browse custom metal signs",
    ctaHref: "/shop?category=Custom%20Signs",
  },

  "personalized-gifts": {
    slug: "personalized-gifts",
    keyword: "Personalized Gifts",
    eyebrow: "Made-to-Order · Personalized Gifts",
    h1: "Personalized Gifts, Made by Real Makers.",
    intro:
      "Engraved cutting boards, monogrammed wall art, custom wedding signs, anniversary keepsakes, baby-name plaques, and one-of-a-kind retirement gifts — every piece personalized to order by an American artisan in their own workshop.",
    paragraphs: [
      "Stop hunting through factory-printed novelties on the big retailers. Crafters Market connects you directly with skilled woodworkers, metal artists, and laser-engravers who can cut, etch, and finish your name, date, or message into the material itself — not just slap a sticker on a mug.",
      "Need it for a specific date? Use the rush-order filter on the maker's product page or message the artisan directly. Most pieces ship within 2-4 weeks; rush options usually halve that.",
    ],
    match: (p) => /personalized|monogram|custom|engrav|gift|wedding|anniversary|memorial/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Start a personalized gift",
    ctaHref: "/custom-order",
  },

  "farmhouse-decor": {
    slug: "farmhouse-decor",
    keyword: "Farmhouse Decor",
    eyebrow: "Curated · Farmhouse Decor",
    h1: "Handmade Farmhouse Decor.",
    intro:
      "Rustic farmhouse signs, reclaimed-wood wall art, family-name plaques, and farmhouse-style metal pieces — handmade by American artisans for kitchens, dining rooms, and farmhouse-style entryways.",
    paragraphs: [
      "Farmhouse decor on the big sites is dominated by drop-shipped imports stamped with cliché phrases. Our makers carve the wood, weld the brackets, and finish each piece in their own studio — every grain pattern is real, every weld is theirs.",
      "Looking for a specific feel? Filter by material (oak, walnut, reclaimed barn wood, raw steel), by finish (whitewash, dark stain, natural patina), or by size. Need a custom kitchen sign with your last name? Submit a brief and a wood-shop maker will quote it in days.",
    ],
    match: (p) => /farmhouse|rustic|barn|reclaimed|wood sign|family name/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Shop farmhouse decor",
    ctaHref: "/shop",
  },

  "garage-decor": {
    slug: "garage-decor",
    keyword: "Garage Decor",
    eyebrow: "Marketplace · Garage Decor",
    h1: "Garage Signs & Workshop Decor.",
    intro:
      "Plasma-cut garage signs, vintage-style shop logos, custom toolbox medallions, and metal wall art for car guys, woodworkers, and shop owners. Built in real workshops by makers who actually use the spaces they design for.",
    paragraphs: [
      "Most 'garage decor' online is mass-produced printed tin junk. Our makers cut real steel, weld real brackets, and finish in real workshops. Want a sign with your shop's name, your car's badge, or your dad's old tool brand? The makers here can build it.",
      "Sizes from 12-inch toolbox medallions up to 6-foot shop entry signs. Powder-coat or raw-steel finish. Most pieces ship in 2-4 weeks.",
    ],
    match: (p) => /garage|workshop|shop|tool|man cave|car|automotive|motorcycle/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Browse garage decor",
    ctaHref: "/shop",
  },

  "rustic-cabin-decor": {
    slug: "rustic-cabin-decor",
    keyword: "Rustic Cabin Decor",
    eyebrow: "Curated · Rustic Cabin Decor",
    h1: "Rustic Cabin & Lodge Decor.",
    intro:
      "Handmade cabin signs, antler-style metal art, lodge wall pieces, and wood-burned wildlife portraits — built by American artisans for cabins, lodges, and outdoor retreats.",
    paragraphs: [
      "Cabins deserve decor with the same handmade authenticity as the structures themselves. Crafters Market makers work with reclaimed barn wood, weathered steel, and live-edge slabs to build pieces that age the way your cabin does — not the way a glossy import does.",
      "Looking for a family cabin name sign, a custom address plaque for the driveway, or a 4-foot mountain silhouette over the fireplace? Filter the catalog or commission custom.",
    ],
    match: (p) => /cabin|lodge|rustic|wildlife|antler|mountain|deer|elk|moose|bear/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Browse cabin decor",
    ctaHref: "/shop",
  },

  "wedding-gifts": {
    slug: "wedding-gifts",
    keyword: "Wedding Gifts",
    eyebrow: "Made-to-Order · Wedding Gifts",
    h1: "Handmade Wedding & Anniversary Gifts.",
    intro:
      "Custom wedding signs, monogrammed cutting boards, engraved memory boxes, last-name family wall art, and one-of-a-kind anniversary keepsakes — built by American makers and personalized to order.",
    paragraphs: [
      "Wedding gifts that get displayed instead of stashed in a closet are usually handmade and personalized. Our makers engrave, plasma-cut, and hand-finish wedding pieces with the couple's names, the date, and details from the venue or ceremony itself.",
      "Need it before a specific date? Most makers offer rush options for wedding-timed orders. Message any maker before booking and they'll confirm your timeline.",
    ],
    match: (p) => /wedding|anniversary|monogram|family|memory box|engrav/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Commission a wedding gift",
    ctaHref: "/custom-order",
  },

  "memorial-pieces": {
    slug: "memorial-pieces",
    keyword: "Memorial Pieces",
    eyebrow: "Made-to-Order · Memorial Pieces",
    h1: "Custom Memorial Wall Art & Plaques.",
    intro:
      "Personalized memorial pieces — name plaques, engraved portraits, plasma-cut tribute signs, and military-service memorials — handmade by American artisans in their own workshops.",
    paragraphs: [
      "Memorial pieces are deeply personal. Our makers work directly with you to engrave names, dates, military branches, or hand-drawn portraits into wood, steel, or stone — at the size, finish, and material you need. Many of our makers are veteran-owned and specialize in service memorials specifically.",
      "Submit a custom-order brief with the names, dates, and any specific imagery you'd like. We'll route it to a maker who can quote your piece and walk you through the finishing options.",
    ],
    match: (p) => /memorial|tribute|in loving memory|service|veteran|fallen/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Commission a memorial piece",
    ctaHref: "/custom-order",
  },

  "outdoor-metal-decor": {
    slug: "outdoor-metal-decor",
    keyword: "Outdoor Metal Decor",
    eyebrow: "Marketplace · Outdoor Metal Decor",
    h1: "Weatherproof Outdoor Metal Decor.",
    intro:
      "Plasma-cut yard art, custom address signs, garden silhouettes, ranch entry pieces, and outdoor metal sculptures — every piece finished for the elements by American metal artists.",
    paragraphs: [
      "Outdoor metal pieces need real powder-coat or marine-grade clear-coat to survive year-round weather. Our makers finish every outdoor piece to spec — you tell them the climate (coastal, desert, snowbelt) and they'll match the coating system.",
      "Mounting hardware ships with every piece. Most outdoor signs install with two anchors and a level. Need professional install? Many makers can recommend local fabricators.",
    ],
    match: (p) => /outdoor|garden|yard|address|silhouette|entry|porch|patio/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Shop outdoor metal decor",
    ctaHref: "/shop",
  },

  "business-signs": {
    slug: "business-signs",
    keyword: "Custom Business Signs",
    eyebrow: "Made-to-Order · Custom Business Signs",
    h1: "Custom Business Signs, Built by American Makers.",
    intro:
      "Storefront signs, retail logo plaques, restaurant entry pieces, brewery taproom signage, office wall art, and custom branding signage — every piece fabricated to your spec by vetted American metal and wood artisans.",
    paragraphs: [
      "Off-the-shelf signs scream cookie-cutter. Custom-fabricated signage tells your customers you took your space seriously. Our makers cut, weld, and finish business signage in steel, aluminum, hardwood, or acrylic with installation hardware included.",
      "Most business signs ship in 3-6 weeks depending on size and finish. For grand openings or renovations on a deadline, message the maker first to confirm your timeline.",
    ],
    match: (p) => /business|brewery|restaurant|storefront|logo|brand|retail|office|tap room/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Commission a business sign",
    ctaHref: "/custom-order",
  },

  "patriotic-decor": {
    slug: "patriotic-decor",
    keyword: "Patriotic Decor",
    eyebrow: "Made in America · Patriotic Decor",
    h1: "American-Made Patriotic Decor.",
    intro:
      "American flags in steel, military-branch wall art, veteran tributes, eagle silhouettes, Pledge of Allegiance plaques — every patriotic piece built in the USA by vetted American makers, many of them veteran-owned shops.",
    paragraphs: [
      "Patriotic decor mass-produced overseas is, frankly, a contradiction. Our entire marketplace is built around US-based craftsmen, with a dedicated 'veteran-owned' badge for makers who served. Browse by maker if you want to specifically support veteran-owned shops.",
      "Plasma-cut flags, engraved memorials, branch-specific service plaques, and custom retirement pieces are all in our makers' wheelhouse. Submit a brief with the branch, dates, and names — we'll route it.",
    ],
    match: (p) => /flag|patriot|america|military|veteran|eagle|liberty|service|branch/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Shop patriotic decor",
    ctaHref: "/shop",
  },

  "custom-ranch-signs": {
    slug: "custom-ranch-signs",
    keyword: "Custom Ranch Signs",
    eyebrow: "Made-to-Order · Custom Ranch Signs",
    h1: "Custom Ranch & Property Signs.",
    intro:
      "Plasma-cut ranch entry signs, family-name property markers, livestock-brand plaques, and large-format driveway signage — built to your ranch name, brand, and material spec by American metal artists.",
    paragraphs: [
      "Ranch signs aren't just decoration — they're the first thing visitors see and the first impression of your property. Our makers cut signs from 1/4-inch plate steel for serious weather durability, with options for raw-steel patina, powder-coat color matching, and integrated lighting.",
      "Sizes from 2-foot panel signs up to 8-foot driveway entry signs with structural posts. Submit your ranch name, brand graphic, and rough sketch — most makers quote inside 48 hours.",
    ],
    match: (p) => /ranch|farm|property|livestock|brand|driveway|entry|estate/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Commission a ranch sign",
    ctaHref: "/custom-order",
  },

  "cnc-metal-wall-art": {
    slug: "cnc-metal-wall-art",
    keyword: "CNC Metal Wall Art",
    eyebrow: "Curated · CNC Metal Wall Art",
    h1: "CNC Metal Wall Art for Real Spaces.",
    intro:
      "Plasma-cut and laser-cut steel wall art — abstract sculptures, geometric panels, custom family monograms, and statement pieces from American CNC artists. Every piece is hand-finished after the cut.",
    paragraphs: [
      "Mass-produced 'metal wall art' on the big retailers is stamped and shipped flat from a factory. Our pieces are cut from real plate steel by independent makers, then hand-sanded, patina'd, powder-coated, or clear-coated in their workshop — the texture and depth you can see in the photos is real.",
      "Sizes range from 18-inch accent panels to 6-foot statement walls. Filter by technique (plasma vs. laser vs. router) or by maker. Want a one-off custom design? Submit a brief.",
    ],
    match: (p) => /wall art|panel|sculpture|monogram|geometric|abstract/i.test(`${p.title} ${p.description}`)
      || p.category === "Wall Art",
    ctaLabel: "Browse CNC metal wall art",
    ctaHref: "/shop?category=Wall%20Art",
  },

  "handmade-gifts-for-dad": {
    slug: "handmade-gifts-for-dad",
    keyword: "Handmade Gifts for Dad",
    eyebrow: "Made-to-Order · Handmade Gifts for Dad",
    h1: "Handmade Gifts for Dad — Built, Not Bought.",
    intro:
      "Engraved tool boxes, monogrammed cutting boards, custom garage signs, branded toolbox medallions, plasma-cut family-name pieces — every dad-gift here is built by an American maker, not stamped in a factory.",
    paragraphs: [
      "The good dad-gift problem isn't selection — it's that everything online is the same printed-mug factory garbage. Our makers cut, weld, engrave, and finish real materials your dad will actually display: solid hardwood boards, raw steel signs, leather portfolios, hand-burned plaques.",
      "Most pieces ship in 2-3 weeks with rush options for Father's Day, birthdays, and retirements. Filter by under-$50, under-$100, or commission a one-of-a-kind for the dad who has everything.",
    ],
    match: (p) => /dad|father|toolbox|garage|whiskey|bourbon|tool|workshop/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Shop gifts for dad",
    ctaHref: "/shop",
  },
};

/** Slug list for sitemap consumers — keep in sync with the keys above. */
export const SEO_LANDING_SLUGS = Object.keys(SEO_LANDING_PAGES);
