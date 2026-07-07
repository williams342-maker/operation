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
    bodyExtras: [
      {
        heading: "Materials and finishes that hold up",
        paragraphs: [
          "Our makers cut from 14-gauge through 1/4-inch plate steel, plus aluminum and copper sheet for indoor pieces. Steel signs designed for outdoor use are finished with industrial powder-coat (300+ color options through Prismatic and TIGER Drylac systems) or a sealed raw-steel patina that develops a controlled rust layer without flaking. Aluminum signs are anodized or powder-coated and rated for marine air. Copper develops a living patina — most buyers want it accelerated and sealed, which our makers do in-shop.",
          "Indoor-only signs can use thinner gauges and lighter finishes — clear-coat over raw steel, hand-rubbed oil patina, even brushed brass plating. If you're not sure what'll work for your space, message a maker before booking; they'll tell you exactly which finish system fits your wall, your weather, and your budget.",
        ],
      },
      {
        heading: "Sizes, mounting, and installation",
        paragraphs: [
          "Most custom signs ship with mounting hardware appropriate for the substrate (drywall anchors, masonry sleeves, exterior-rated lag screws). Address signs are typically 24-36 inches wide and mount with two anchors; business storefront signs scale up to 6+ feet and may require a structural sub-frame the maker fabricates separately. Ranch entry signs over 4 feet usually mount on welded posts shipped flat-packed for on-site install.",
          "If you're hanging a heavy sign on an exterior wall or planning a multi-piece installation, ask the maker for a mounting diagram before the cut goes on the table. Most will send a CAD layout with anchor points marked so your installer (or you) knows exactly where to drill.",
        ],
      },
      {
        heading: "Custom design, proofs, and lead times",
        paragraphs: [
          "Every custom metal sign goes through three confirmation stages: brief approval (you describe what you want), design proof (the maker sends a CAD render or hand sketch with the final dimensions and font), and material confirmation (you sign off on gauge, finish, and mounting before the cut starts). This is the failsafe — once steel is cut, it can't be uncut, so we build the human checkpoints in before the metal hits the table.",
          "Typical lead times: 2-3 weeks for in-stock material small signs (under 24 inches), 3-5 weeks for medium signs with custom finishes, 4-8 weeks for entry-sign-scale work or pieces requiring sourced specialty materials. Rush options exist on most listings — ask the maker before checkout if you have a fixed deadline.",
        ],
      },
    ],
    faqs: [
      {
        q: "How long does a custom metal sign take?",
        a: "Most pieces ship in 2-4 weeks from final design approval. Small signs under 24 inches can ship in as little as 7-10 days when the maker has the material on hand. Larger ranch entry or storefront signs typically take 4-6 weeks because the finishing passes (powder-coat, clear-coat, weatherproofing) each need 24-48 hours to cure properly. Rush options halve those windows when available.",
      },
      {
        q: "Are these signs weatherproof?",
        a: "All metal signs intended for outdoor use are powder-coated or marine-grade clear-coated to spec. Powder-coat finishes are rated for 5-7+ years of UV and weather exposure without fading; a controlled patina sealed with industrial clear-coat lasts indefinitely if recoated every 5-10 years. Tell the maker your climate (coastal, desert, snowbelt, humid) and they'll match the coating system — there's no universal 'outdoor finish' that works everywhere.",
      },
      {
        q: "Can the maker match a specific font, logo, or color?",
        a: "Yes — every custom sign starts with a design proof. Send your font (a .ttf, a screenshot, or just the name), your logo as a vector (.svg, .ai, .dxf) or as a clean high-res raster image we can re-trace, and your color reference (Pantone, RAL, or a hex code). Powder-coat finishes are matched to RAL numbers; a Pantone match can be quoted as a custom run. There's a small surcharge for custom color matches but no upcharge for using your supplied font or logo.",
      },
      {
        q: "What does it cost?",
        a: "Custom metal signs start around $85 for small address numbers and scale up to $1,200+ for ranch-entry pieces with welded posts. The price drivers are material gauge, total square footage, complexity of the cut path (intricate lettering and inset details add machine time), finish system, and whether the maker is sourcing specialty hardware. Every quote breaks the cost down so you see exactly what you're paying for.",
      },
      {
        q: "Do I own the design after the sign ships?",
        a: "Yes — once the sign is delivered and you've accepted it, the artwork is yours for personal use. Reuse on additional pieces from the same maker is typically free; commercial licensing for resale would need a separate agreement and is rare on custom one-off pieces. If you want the original .dxf or .svg file to use elsewhere, ask the maker — most are happy to send it for a small file-prep fee.",
      },
    ],
    relatedLinks: [
      { to: "/custom-ranch-signs", label: "Custom Ranch Signs", blurb: "Plasma-cut ranch entry signs and family-name property markers." },
      { to: "/business-signs", label: "Custom Business Signs", blurb: "Storefront and brand signage built in real American shops." },
      { to: "/outdoor-metal-decor", label: "Outdoor Metal Decor", blurb: "Weatherproof yard art, garden silhouettes, and entry pieces." },
      { to: "/cnc-metal-wall-art", label: "CNC Metal Wall Art", blurb: "Plasma and laser-cut steel wall sculptures and panels." },
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "Engraved gifts and monogrammed pieces from the same makers." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "The 5-step flow from brief to shipping." },
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
    bodyExtras: [
      {
        heading: "Engraved vs. printed vs. cut: what to expect",
        paragraphs: [
          "There's a real difference between a personalized gift and a printed one. A laser-engraved cutting board has the name burned into the maple at depth — it gets darker with use and outlives every sealant. A plasma-cut metal monogram is the steel itself in your initials, not paint on a panel. A printed mug or t-shirt is ink on a surface; it wears, fades, and washes off. Every personalized gift on Crafters Market is engraved, cut, or carved at the material level. The result lasts decades, not seasons.",
          "Wood pieces are engraved with CO2 lasers (deeper burn, more contrast) or fiber lasers (precise photo-quality detail). Metal pieces are either plasma-cut (the metal becomes the design), laser-engraved (precise text and fine art on flat panels), or hand-stamped (uniform letters set into the metal by punch). Each technique has a different look — ask the maker for shop photos of past pieces in your preferred technique before you commit.",
        ],
      },
      {
        heading: "Popular gift categories and what they cost",
        paragraphs: [
          "Engraved hardwood cutting boards run $45-$120 and are the workhorse wedding and housewarming gift. Monogrammed plasma-cut metal wall pieces (12-24 inch range) sit at $75-$200 and make great anniversary or new-home gifts. Custom name plaques for kids' rooms or family entryways run $35-$95 in wood or $55-$140 in metal. Engraved whiskey barrels, charcuterie boards, and serving trays are usually $80-$180. Service memorials, retirement plaques, and military tribute pieces start around $120 and scale with complexity.",
          "If you have a budget ceiling, tell the maker upfront. They'll suggest the material, size, and finish that fits — often a smaller piece in a premium wood or metal looks better than a larger piece in a budget material.",
        ],
      },
      {
        heading: "Personalization details that matter",
        paragraphs: [
          "Spelling, dates, and capitalization on personalized gifts are the #1 source of preventable returns. Triple-check the brief before approving the design proof — once the laser fires or the plasma cuts, corrections mean a remake. Most makers send a final proof image for your written approval; never skip that step, even if you're sure the maker has the spelling right.",
          "Wedding monograms typically use the bride's first initial, the shared last name's initial in the center (larger), then the groom's first initial — but some couples prefer alphabetical or a different layout. Anniversary pieces should call out the year of the wedding, not the anniversary year (unless asked specifically). Memorials should include full names and accurate dates; many makers will request a copy of the obituary or service record to verify.",
        ],
      },
    ],
    faqs: [
      {
        q: "How fast can I get a personalized gift?",
        a: "Most personalized gifts ship in 2-3 weeks from final approval. Smaller engraved pieces (cutting boards, small plaques, name necklaces) can ship in 5-10 days when the maker has stock-material on hand. Larger custom pieces and multi-piece sets take 3-5 weeks. Filter by 'rush available' in the shop or message the maker directly with your deadline — many can prioritize gift orders for weddings, birthdays, and holidays.",
      },
      {
        q: "Can I see a proof before it's made?",
        a: "Yes — every personalized order goes through a written design proof. The maker sends you a CAD render, mockup, or hand sketch with the final text, dimensions, and material specified. You approve in writing before any cutting or engraving starts. This is the failsafe against typos and mis-formatted dates; never skip the proof, even on simple pieces.",
      },
      {
        q: "What if I don't like it when it arrives?",
        a: "Custom and personalized pieces are non-refundable once made-to-order — that's standard across the personalization industry because we can't resell a piece engraved with your name. BUT: if there's a quality defect (cracked wood, burned engraving, mis-cut) or if the maker didn't follow the approved proof, the maker will remake it at no charge. Stripe funds only release once the piece ships, so you're protected against non-delivery.",
      },
      {
        q: "Can I add multiple names or a long message?",
        a: "Yes — every maker can engrave or cut multi-line text. The constraint is space and legibility. A 12-inch cutting board can hold a name + date + short phrase comfortably; a 6-inch trinket box might only fit a name. Send the full text in your brief and the maker will tell you how it'll lay out and suggest a font size that stays readable. Calligraphy fonts look elegant but eat space; sans-serif fonts pack more text into the same footprint.",
      },
      {
        q: "Do you offer gift wrapping or direct ship to the recipient?",
        a: "Many makers offer hand-tied gift packaging at no extra charge (or for a small fee on premium boxes). At checkout you can specify a different shipping address and a gift message — the maker will exclude the invoice from the package and include a handwritten card with your message. Confirm with the maker before checkout if direct ship is critical to your plan.",
      },
    ],
    relatedLinks: [
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Handmade wedding signs, monograms, and anniversary keepsakes." },
      { to: "/handmade-gifts-for-dad", label: "Handmade Gifts for Dad", blurb: "Engraved tool boxes, garage signs, and shop gifts." },
      { to: "/memorial-pieces", label: "Memorial Pieces", blurb: "Custom name plaques, tribute signs, and service memorials." },
      { to: "/custom-metal-signs", label: "Custom Metal Signs", blurb: "Plasma-cut family monograms, address pieces, and ranch signs." },
      { to: "/farmhouse-decor", label: "Farmhouse Decor", blurb: "Rustic and farmhouse-style personalized pieces." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "Brief → proof → shipping in one place." },
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
    bodyExtras: [
      {
        heading: "Gifts that survive the marriage, not just the registry",
        paragraphs: [
          "The wedding-gift problem: most registries are stocked with mid-tier household goods you forget about in 18 months. The pieces couples actually keep — and pass to their kids — are the ones a real maker built with their names on them. A plasma-cut family-name wall piece, an engraved butcher-block cutting board, a hand-burned framed map of the venue, a custom address sign for the first home: these end up on walls, in kitchens, and over mantels for decades.",
          "If you're shopping for a couple who already has 'everything,' lean into the personalization. The whole point is that nobody else can give them this exact gift — it can't be returned, swapped, or duplicated. That's the value.",
        ],
      },
      {
        heading: "Timing your order: don't wait until the week of",
        paragraphs: [
          "Custom wedding gifts on this platform take 2-5 weeks to make. If the wedding is more than 6 weeks out, you have room to commission anything from a small engraved keepsake to a full ranch-entry-scale name piece. Inside 4 weeks, focus on smaller engraved items (cutting boards, framed prints, name plaques) which several makers can rush in 7-10 days.",
          "Inside 2 weeks? Some makers have pre-built unpersonalized pieces they can engrave and ship within a week, but options narrow. Message a maker directly before booking — they'll be honest about whether your deadline is realistic. Better to know now than to receive an apologetic email three days before the ceremony.",
        ],
      },
      {
        heading: "Anniversaries and gifts to the couple later",
        paragraphs: [
          "Wedding-themed pieces aren't just for the ceremony itself. Many makers also handle anniversary commissions — engraving the original wedding-day vows on a wood plaque, plasma-cutting a stylized family tree for the 5th anniversary, fabricating a steel rose for the 25th. Tell the maker what milestone you're marking and they'll suggest material, size, and the symbolic touches that fit (paper for the 1st, wood for the 5th, silver for the 25th, gold for the 50th — the makers know the schedule).",
          "Some shops keep their previous wedding-piece designs on file, so if you commissioned the wedding gift through Crafters Market, you can come back later and order matching anniversary pieces with the same fonts, colors, and motifs. Continuity matters when a couple is building a home together.",
        ],
      },
    ],
    faqs: [
      {
        q: "How far in advance should I order a wedding gift?",
        a: "Ideally 6-8 weeks before the wedding for fully custom pieces, 3-4 weeks for engraved cutting boards or smaller personalized items, and 2 weeks minimum for any rush option. Several makers offer expedited turnaround for wedding-timed orders — message before booking and they'll confirm. If the wedding is less than 2 weeks away, focus on pre-built pieces that can be quickly engraved.",
      },
      {
        q: "Can the maker work from a photo of the venue or wedding invitation?",
        a: "Yes — many makers can incorporate venue silhouettes, custom map prints of the location, or motifs lifted from the wedding invitation into the design. Send a clear high-res photo of whatever you want referenced and the maker will sketch a treatment for approval. There's typically no upcharge for using your supplied art beyond the standard custom-design fee on the piece.",
      },
      {
        q: "What's the most popular wedding gift on the platform?",
        a: "Engraved hardwood cutting boards with the couple's last name and wedding date are the consistent #1, followed by plasma-cut metal family-name monograms for the wall. Custom address signs for the couple's first home are a rising third — they're practical, displayed daily, and signal that you knew where the couple was settling down. Memory boxes and engraved frames round out the top five.",
      },
      {
        q: "Can I ship directly to the wedding venue?",
        a: "Yes — at checkout you can specify a delivery address different from your billing address. For venue shipping, confirm the address with the venue coordinator first (some won't accept large or fragile shipments). The maker can also include a gift message and exclude the invoice from the package. Build buffer time into the delivery date in case of carrier delays.",
      },
      {
        q: "Do you handle bridal-party or groomsmen gift sets?",
        a: "Many makers offer multi-piece set pricing for bridal parties — matching engraved cutting boards, monogrammed whiskey glasses, custom medallions for the groomsmen. Tell the maker the count, the names, and any variations (e.g., 'one for the maid of honor with a different inscription'), and they'll quote the set. Bulk-set discounts typically kick in at 4+ matching pieces.",
      },
    ],
    relatedLinks: [
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "Engraved keepsakes, monograms, and made-to-order pieces." },
      { to: "/custom-metal-signs", label: "Custom Metal Signs", blurb: "Plasma-cut family monograms and address signs for new homes." },
      { to: "/farmhouse-decor", label: "Farmhouse Decor", blurb: "Rustic wedding-suitable wood and metal pieces." },
      { to: "/memorial-pieces", label: "Memorial Pieces", blurb: "Tribute pieces for honoring family members at the ceremony." },
      { to: "/handmade-gifts-for-dad", label: "Father of the Bride/Groom Gifts", blurb: "Handmade pieces for fathers, brothers, and groomsmen." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "The 5-step flow from brief to delivery." },
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

  // ── iter321 — 5 new category landing pages (SEO/Trust audit) ──────
  "plasma-cut-wall-art": {
    slug: "plasma-cut-wall-art",
    keyword: "Plasma Cut Wall Art",
    eyebrow: "Curated · Plasma Cut Wall Art",
    h1: "Plasma Cut Wall Art, Made in American Shops.",
    intro:
      "Real plasma-cut steel wall art — abstract sculptures, geometric panels, wildlife silhouettes, family-name monograms, and custom statement pieces. Every piece is cut on a CNC plasma table by a vetted American maker, then hand-finished in their workshop.",
    paragraphs: [
      "Plasma cutting gives steel a depth you can't fake — raw cut edges, controlled HAZ patina, and the kind of weight that makes a 4-foot panel land on a wall instead of float on it. Our makers run Hypertherm Powermax and EDGE Pro tables to keep cuts crisp on stock from 12-gauge up to 1/4-inch plate.",
      "Most plasma-cut pieces ship in 2-4 weeks. Custom monograms, ranch silhouettes, compass roses, and one-off commissions are bread-and-butter — submit a brief with your size, finish, and dimensions and the maker quotes back inside 24 hours.",
    ],
    bodyExtras: [
      {
        heading: "What plasma cutting actually means",
        paragraphs: [
          "Plasma cutting passes a high-velocity ionized gas stream through steel to slice through it cleanly — the result is a sharper, more controlled cut than oxy-fuel and the ability to handle thicker stock than fiber laser. For wall art, that translates into pieces that look like sculpture, not stamped sheet metal.",
          "Look for makers running CNC plasma (not handheld torches) for art-grade work — every curve in the photo was generated from a vector file, not freehanded. That's why our marketplace surfaces the machine type on every maker's profile.",
        ],
      },
      {
        heading: "Finishes that survive the wall",
        paragraphs: [
          "Indoor plasma-cut steel typically ships with a clear-coat or hand-rubbed oil finish that preserves the raw mill scale and HAZ coloring around the cut edge. For a darker look, makers blacken the steel with gun-blue or hot-patina then seal it. For outdoor pieces, powder-coat (RAL or Pantone matched) gives 5-7+ years of UV durability.",
          "If you want a controlled rust patina (the orange-brown 'weathered steel' look popular for ranch and farmhouse decor), the maker accelerates the rust with saltwater + vinegar + peroxide, then seals it with industrial clear-coat so it stops oxidizing.",
        ],
      },
    ],
    faqs: [
      {
        q: "Plasma vs. laser — what's the difference for wall art?",
        a: "Plasma is faster and cheaper on thick stock (1/8-inch and up), and the cut edge has a slightly rounded, hand-finished look. Fiber laser is razor-sharp on thin stock (under 1/8-inch) and great for fine detail like tight lettering. Most wall art at 16+ inches looks better in plasma; small ornate pieces under a foot look better in laser.",
      },
      {
        q: "How big can a plasma-cut wall piece be?",
        a: "Our makers' tables max out around 5x10 feet of cut bed, but pieces can be built modular up to any size — a 12-foot ranch entry sign typically ships as 2-3 sections that bolt together on site. Tell the maker your max wall dimension and they'll plan the splits where they're least visible.",
      },
      {
        q: "Can I supply my own design file?",
        a: "Yes — most makers accept .dxf, .ai, .svg, or even high-resolution PNG that can be re-traced. Vector files run straight to the table. Raster designs add a small re-tracing fee. Send what you have and the maker will tell you if it's table-ready.",
      },
      {
        q: "What does it cost?",
        a: "Plasma-cut wall pieces start around $95 for small accent panels (12-18 inches) and scale up to $1,500+ for 6-foot statement pieces or multi-layered welded sculptures. The price drivers are total cut length, material gauge, and finish system — every quote breaks down where the cost goes.",
      },
    ],
    relatedLinks: [
      { to: "/cnc-metal-wall-art", label: "CNC Metal Wall Art", blurb: "All metal wall art (plasma + laser + router)." },
      { to: "/custom-metal-signs", label: "Custom Metal Signs", blurb: "Address, family-name, and storefront signage." },
      { to: "/outdoor-metal-decor", label: "Outdoor Metal Decor", blurb: "Yard art and garden silhouettes built for weather." },
      { to: "/custom-ranch-signs", label: "Custom Ranch Signs", blurb: "Property-entry plasma signs with livestock brands." },
      { to: "/cnc-metal-art", label: "CNC Metal Art", blurb: "The full CNC-fabricated metal art catalog." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "The 5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /plasma|wall art|sculpture|panel|silhouette|monogram/i.test(`${p.title} ${p.description}`)
      || p.technique === "PLASMA",
    ctaLabel: "Browse plasma cut wall art",
    ctaHref: "/shop?category=Wall%20Art",
  },

  "cnc-wood-signs": {
    slug: "cnc-wood-signs",
    keyword: "CNC Wood Signs",
    eyebrow: "Made-to-Order · CNC Wood Signs",
    h1: "CNC Wood Signs, Carved in American Shops.",
    intro:
      "V-carved and 3D-routed wood signs in walnut, white oak, cherry, maple, and reclaimed hardwoods — family-name signs, address plaques, business signage, cabin and lake-house names, wedding signs, and memorial pieces. Every sign is routed on a CNC and finished by hand.",
    paragraphs: [
      "CNC wood signs look like they were carved by hand but with the precision of a laser — clean V-grooves, deep 3D relief, perfect repeatable letterforms in any font. Our makers run ShopBots, Avid CNCs, and large-format Laguna routers on solid hardwood up to 8 feet long.",
      "Standard finishes: hand-rubbed oil for indoor pieces, marine-grade spar urethane for porch and entry signs, and epoxy-filled inlays for high-contrast letter work. Most signs ship in 2-4 weeks; rush is available on most makers for an extra fee.",
    ],
    bodyExtras: [
      {
        heading: "Wood species and what they're good for",
        paragraphs: [
          "Walnut is the workhorse for high-end signs — dark chocolate grain, takes V-carve cleanly, gets richer with age. White oak handles outdoor exposure better than any other domestic hardwood (it's what they build wine barrels and shipyards out of) — sealed white oak signs last 15+ years outside. Cherry is gorgeous for indoor pieces and gets a deeper red patina with sunlight. Maple is the cheapest hardwood that still looks premium and is perfect for stained or painted signs.",
          "If you want reclaimed wood (barn-board, salvaged lumber with natural patina), most makers source regionally and can quote with photos before they cut. Reclaimed adds character and story but limits the size — you're working with what the salvage yard has on the truck.",
        ],
      },
      {
        heading: "V-carve, 3D relief, and epoxy inlay",
        paragraphs: [
          "V-carving cuts the letter or graphic at a 60- or 90-degree angle so the deepest point is at the centerline — it's the classic 'carved' wood-sign look you've seen on cabin and ranch signs your whole life. 3D relief uses multiple tool passes to actually carve the design out of the surface (think topographic maps or sculpted faces) — more expensive but lets the wood become a sculpture.",
          "Epoxy inlay is the modern upgrade: V-carve the design deep, then fill the channel with pigmented epoxy (black, white, gold leaf, glow-in-the-dark, color-matched to your branding), sand flush, and finish. The result is a perfectly flat surface where the design pops in another color — high-contrast at any viewing distance. Adds 1-2 weeks to lead time and ~30% to cost but transforms the piece.",
        ],
      },
    ],
    faqs: [
      {
        q: "Are CNC wood signs as good as hand-carved?",
        a: "Different strengths. Hand-carving has slight imperfections that read as 'human' up close — beautiful for small heirloom pieces. CNC delivers perfect consistency, repeatable lettering, and lets you scale to 6-foot signs that would take a hand-carver months. The best CNC sign-makers hand-finish (sand, oil, distress) after the router pass so the sign reads as crafted, not machine-stamped. That's what we vet for.",
      },
      {
        q: "How long do CNC wood signs last outside?",
        a: "With marine-grade spar urethane on sealed white oak or western red cedar: 15+ years before refinishing. With standard exterior poly on softer woods like walnut or maple: 5-7 years before fading or checking. Re-coat every 5-7 years and an outdoor sign can last indefinitely. Tell the maker your climate (humidity, sun exposure, freeze cycles) and they'll match the finish system.",
      },
      {
        q: "Can I get a CNC sign with my logo or custom font?",
        a: "Yes — every CNC sign is custom by definition. Send your logo as a vector (.svg, .ai, .dxf) or as a clean high-res image to re-trace, and your font as a .ttf file (or just the font name if it's a common one). Custom fonts cost nothing extra; logo re-tracing is a small one-time setup fee.",
      },
      {
        q: "What sizes work for V-carved address signs?",
        a: "Standard porch address signs run 18-24 inches wide with 4-inch numbers. For mounting at the street or above a garage, scale up to 30-48 inches with 6-8 inch numbers so they're readable from 50 feet away. Our makers will tell you the readable distance for any size — match it to where the sign will be viewed from.",
      },
    ],
    relatedLinks: [
      { to: "/custom-metal-signs", label: "Custom Metal Signs", blurb: "Plasma and laser-cut steel signage." },
      { to: "/custom-address-signs", label: "Custom Address Signs", blurb: "Wood and metal house-number plaques." },
      { to: "/farmhouse-decor", label: "Farmhouse Decor", blurb: "Distressed wood and CNC pieces for farmhouse aesthetics." },
      { to: "/rustic-cabin-decor", label: "Rustic Cabin Decor", blurb: "Cabin and lake-house signs and wall pieces." },
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Wedding-name and date V-carved signs." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "The brief-to-shipping flow for custom CNC work." },
    ],
    match: (p) =>
      /wood|sign|v-carve|v carve|carved|router|hardwood|walnut|oak|maple|cherry/i.test(`${p.title} ${p.description}`)
      || p.technique === "ROUTER",
    ctaLabel: "Browse CNC wood signs",
    ctaHref: "/shop?category=Custom%20Signs",
  },

  "laser-engraved-gifts": {
    slug: "laser-engraved-gifts",
    keyword: "Laser Engraved Gifts",
    eyebrow: "Made-to-Order · Laser Engraved Gifts",
    h1: "Laser Engraved Gifts, Personalized in Real Shops.",
    intro:
      "Engraved cutting boards, custom whiskey glasses, leather portfolios, slate coasters, photo-engraved keepsakes, and one-off personalized pieces — every gift is laser-engraved by an American maker, not screen-printed in a factory.",
    paragraphs: [
      "Laser engraving permanently marks wood, leather, slate, glass, anodized aluminum, and acrylic without changing the substrate's shape — the design becomes part of the material itself. Our makers run Epilog, Trotec, and OMTech CO2 and fiber lasers calibrated to keep edges crisp at any scale.",
      "Most engraved gifts ship in 5-10 business days because the engraving step itself is fast — the wait is the curing of any oil or wax finish after the engraving. Rush orders for birthdays, anniversaries, weddings, and graduations are almost always available; just message the maker before checkout.",
    ],
    bodyExtras: [
      {
        heading: "Materials that engrave well — and ones that don't",
        paragraphs: [
          "Best results: walnut, cherry, maple, and oak hardwoods (clean dark contrast, no scorching when calibrated right); vegetable-tanned leather (deep brown burn line that ages beautifully); slate (high-contrast white-on-black); anodized aluminum (laser strips the anodization to reveal silver underneath — perfect for branded tumblers and tool tags); acrylic (clean frosted etching on either side).",
          "Photos engrave best on light hardwood (maple, beech) or slate — the laser converts the photo to a grayscale dot pattern. Send the highest-resolution original you have; the maker will dither it for the laser. Avoid trying to engrave dark woods like walnut for photos (the contrast won't carry).",
        ],
      },
      {
        heading: "Personalization that doesn't look cheesy",
        paragraphs: [
          "The difference between a meaningful engraved gift and a tchotchke is usually the typography. Our makers stock a curated set of script and serif fonts that look hand-crafted; they'll also import any custom font you supply (.ttf). Skip the default 'Curlz' or 'Comic Sans' presets — pick a font that fits the piece (script for romantic gifts, slab serif for masculine pieces, sans serif for modern).",
          "For couples gifts, three lines of text is the sweet spot: name 1, ampersand or date or symbol, name 2. More than that and the engraving starts to feel busy. For corporate gifts, lead with the recipient's name + a small logo block rather than the giver's logo top-and-center.",
        ],
      },
    ],
    faqs: [
      {
        q: "How long does laser engraving last?",
        a: "Permanently. The laser physically alters the surface (carbonizes wood, etches slate, strips anodization on aluminum) — there's no ink or paint that can wear off. A cutting board you engrave today will still show the engraving after 30 years of dishwasher cycles, just lighter. Oil-treated boards keep the engraving sharper longer.",
      },
      {
        q: "Can I engrave food-safe items?",
        a: "Yes — every cutting board, charcuterie plank, and bamboo serving piece sold on the marketplace is laser-engraved on food-grade hardwood and finished with food-safe mineral oil and beeswax. The laser doesn't introduce any chemicals; it just chars the surface in a controlled pattern.",
      },
      {
        q: "Can I send a photo for engraving?",
        a: "Yes — most makers offer photo engraving on maple, slate, leather, or anodized aluminum. Send the highest-resolution original you have (ideally 1500+ pixels on the long edge). The maker converts it to a grayscale dot pattern that the laser reproduces; you'll see a digital proof before the engraving runs.",
      },
      {
        q: "What's the shortest lead time for an engraved gift?",
        a: "1-3 business days from order on most ready-stock items (cutting boards, glasses, slate coasters). Custom photos or complex multi-side engraving runs 5-10 days. Need it tomorrow? Many makers offer rush + overnight shipping for an upcharge — message them before checkout.",
      },
    ],
    relatedLinks: [
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "All custom and monogrammed gift pieces." },
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Engraved wedding-name boards and keepsakes." },
      { to: "/engraved-cutting-boards", label: "Engraved Cutting Boards", blurb: "Hardwood boards with name + date engraving." },
      { to: "/handmade-gifts-for-dad", label: "Handmade Gifts for Dad", blurb: "Engraved tools, whiskey glasses, and shop pieces." },
      { to: "/memorial-pieces", label: "Memorial Pieces", blurb: "Tribute plaques and remembrance keepsakes." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "The brief-to-shipping flow." },
    ],
    match: (p) =>
      /engrav|laser|cutting board|glass|coaster|keepsake|leather|monogram/i.test(`${p.title} ${p.description}`)
      || p.technique === "LASER",
    ctaLabel: "Browse laser engraved gifts",
    ctaHref: "/shop?q=engraved",
  },

  "custom-address-signs": {
    slug: "custom-address-signs",
    keyword: "Custom Address Signs",
    eyebrow: "Made-to-Order · Custom Address Signs",
    h1: "Custom Address Signs, Made for Your House Number.",
    intro:
      "Personalized address plaques in plasma-cut steel, V-carved hardwood, and laser-cut copper — built to your house number, street, and finish preferences by vetted American makers. The first thing visitors see should not be a stick-on number from the hardware store.",
    paragraphs: [
      "A custom address sign is the cheapest curb-appeal upgrade in real estate. Our makers build address plaques in raw steel, powder-coated aluminum, V-carved walnut, hand-burnished copper, and stained hardwood — sized from a 12-inch porch number up to 36-inch mailbox or driveway-entry signs.",
      "Most address signs ship in 1-3 weeks with mounting hardware included (anchors sized for drywall, brick, stucco, or wood siding). Tell the maker your wall material and they'll send the right anchors in the box — no separate hardware-store trip after the sign arrives.",
    ],
    bodyExtras: [
      {
        heading: "Sizes that actually read from the street",
        paragraphs: [
          "The general rule: numbers should be 1 inch tall for every 10 feet of viewing distance. A house set 30 feet back from the road needs 3-inch numbers minimum. A mailbox sign needs 4-inch numbers to be readable from a car. A driveway-entry sign for a 100-foot lane needs 10-inch numbers.",
          "Most porch and front-door address signs run 18-24 inches wide with 4-6 inch numbers — readable for delivery drivers and emergency services without being oversized. Driveway-entry signs scale up to 36+ inches with 8-12 inch numbers and are usually mounted on welded steel posts shipped separately.",
        ],
      },
      {
        heading: "Materials matched to your facade",
        paragraphs: [
          "Modern / contemporary homes: brushed aluminum, powder-coated steel in matte black or charcoal, or copper that's been sealed before it patinas. Clean sans-serif fonts, geometric layouts.",
          "Traditional / craftsman / colonial homes: V-carved walnut or cherry with gold or black painted numbers, hand-rubbed oil finish, marine-grade spar urethane for weather. Serif or script fonts.",
          "Farmhouse / ranch / rustic homes: raw steel with controlled patina, plasma-cut numbers with hammered edges, distressed reclaimed wood with hand-painted numbers. Slab-serif or hand-lettered fonts.",
          "If you're not sure what fits, message the maker with a photo of your front door and they'll mock up two or three options before you commit.",
        ],
      },
    ],
    faqs: [
      {
        q: "How long do custom address signs last outside?",
        a: "Powder-coated steel and aluminum signs last 7-10+ years before any visible fading. Marine-finished hardwood signs (white oak, walnut with spar urethane) last 5-7 years before they need a re-coat. Raw steel with sealed patina lasts indefinitely — the patina is the finish, and it's chemically stable once sealed. Tell the maker your climate (coastal, desert, snowbelt) and they'll match the finish to it.",
      },
      {
        q: "Can the maker match my house's font or style?",
        a: "Yes — send a photo of your existing house numbers (or your address, mailbox, or front door) and the maker will suggest 2-3 font and material combinations that match. Most makers offer 1-2 free font swaps before the cut goes on the table.",
      },
      {
        q: "Do address signs come with mounting hardware?",
        a: "Yes — every address sign ships with the right anchors for your wall material. Drywall + interior trim get heavy-duty anchors rated for the sign weight. Brick, stucco, and masonry get sleeves and masonry screws. Wood siding gets stainless deck screws. Tell the maker what your wall is and they include the right hardware at no extra charge.",
      },
      {
        q: "What if my address has more than 4 digits?",
        a: "No problem — our makers scale the layout to fit. Long addresses (5+ digits) typically go horizontal on a wider sign or split across two lines on a square layout. Street name + number combo signs are common for rural and ranch addresses. Just tell the maker your full address and any layout preference.",
      },
    ],
    relatedLinks: [
      { to: "/custom-metal-signs", label: "Custom Metal Signs", blurb: "All custom metal signage." },
      { to: "/cnc-wood-signs", label: "CNC Wood Signs", blurb: "V-carved hardwood signs and plaques." },
      { to: "/outdoor-metal-decor", label: "Outdoor Metal Decor", blurb: "Yard art, garden silhouettes, and mailbox flags." },
      { to: "/custom-ranch-signs", label: "Custom Ranch Signs", blurb: "Large-format property and driveway entry signs." },
      { to: "/business-signs", label: "Custom Business Signs", blurb: "Storefront and commercial signage." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /address|house number|mailbox|porch|street|entry sign/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Order a custom address sign",
    ctaHref: "/custom-order",
  },

  "engraved-cutting-boards": {
    slug: "engraved-cutting-boards",
    keyword: "Engraved Cutting Boards",
    eyebrow: "Made-to-Order · Engraved Cutting Boards",
    h1: "Engraved Cutting Boards, Made for Real Kitchens.",
    intro:
      "Hardwood cutting boards engraved with your family name, wedding date, monogram, or custom artwork — walnut, maple, cherry, and end-grain butcher blocks finished with food-safe mineral oil and beeswax by vetted American makers.",
    paragraphs: [
      "An engraved cutting board is the wedding gift that gets used three times a week for 30 years. Our makers route and laser-engrave solid hardwood boards in sizes from 9x12-inch personal boards up to 18x24-inch carving boards. Standard finishes are food-safe mineral oil topped with beeswax conditioner — refresh once a quarter and the board stays beautiful for decades.",
      "Most engraved boards ship in 5-10 business days. End-grain butcher-block boards take longer (2-3 weeks) because each block is hand-glued from individual hardwood squares for self-healing knife marks and edge stability.",
    ],
    bodyExtras: [
      {
        heading: "Hardwoods that work in a real kitchen",
        paragraphs: [
          "Walnut is the showstopper — dark chocolate grain, engraves with high contrast, and the natural tannins resist staining from beets and berries. Maple is the chef's standard — pale, dense, and easy on knife edges. Cherry develops a deeper red over time and looks beautiful as a serving piece. White oak is the most water-resistant domestic hardwood and is ideal if the board will see a lot of dishwasher-adjacent use.",
          "Skip exotic species (bamboo, teak, padauk) for engraved-gift cutting boards — they engrave with poor contrast, can react with food acids, and lack the look-and-feel that makes the gift land. Stick with American hardwoods.",
        ],
      },
      {
        heading: "Edge-grain vs. end-grain — what matters",
        paragraphs: [
          "Edge-grain boards (the long planks bonded side-to-side) are the most common: lighter, less expensive, and showcase the wood's flowing grain pattern beautifully — perfect for serving boards and gift pieces. Engraving stays sharp because the wood fibers run horizontal to the surface.",
          "End-grain boards (small hardwood squares bonded face-up so the cut grain shows on top) are the chef's-knife standard: knife edges slip between the wood fibers instead of slicing them, so the board self-heals and stays sharp on your knives. Heavier, pricier, and the engraving sits on top of a checkerboard grain pattern instead of a flowing one. Decide based on whether the board is for daily cooking (end-grain) or for serving and display (edge-grain).",
        ],
      },
    ],
    faqs: [
      {
        q: "Is laser-engraved wood food-safe?",
        a: "Yes — the laser carbonizes a thin layer of wood without introducing any chemicals. Finished with food-grade mineral oil and beeswax (both NSF-certified for direct food contact), the board is safe for raw meat, vegetables, bread, and cheese. Don't put it in a dishwasher (heat warps the wood) and re-condition with mineral oil every 1-3 months and it'll last 30+ years.",
      },
      {
        q: "Will the engraving wear off?",
        a: "No — laser engraving is permanent. The carbonized surface is sealed under the mineral-oil finish. After years of use, the engraving may lighten slightly from natural wear, but it never disappears. Re-conditioning with oil brings back the contrast.",
      },
      {
        q: "Can I get a family-name + date engraved board?",
        a: "Yes — this is the most-ordered customization. Standard layout is last name on top in larger script, established date below in smaller serif. Many makers also offer monogram-in-a-wreath, vintage-style banner art, or your own custom artwork. Send the maker your preferred font and layout in the order notes.",
      },
      {
        q: "What size board should I get for a wedding gift?",
        a: "12x18 inch is the gift-standard sweet spot — large enough for a charcuterie spread or a multi-course prep job, small enough to fit on most counters. For couples who entertain, jump to 14x20. For everyday-use kitchens, a 10x14 personal board is more practical. End-grain butcher-block versions of any of these add weight and price but last forever.",
      },
    ],
    relatedLinks: [
      { to: "/laser-engraved-gifts", label: "Laser Engraved Gifts", blurb: "All laser-engraved gift pieces." },
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Engraved wedding-name boards and keepsakes." },
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "All custom and monogrammed gift pieces." },
      { to: "/handmade-gifts-for-dad", label: "Handmade Gifts for Dad", blurb: "Engraved tools, whiskey glasses, and shop pieces." },
      { to: "/cnc-wood-signs", label: "CNC Wood Signs", blurb: "V-carved hardwood signs and plaques." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /cutting board|charcuterie|serving|butcher|board/i.test(`${p.title} ${p.description}`),
    ctaLabel: "Browse engraved cutting boards",
    ctaHref: "/shop?q=cutting+board",
  },

  // ── iter411 — Craft-expansion landing pages ─────────────────────────
  // Mirrors the homepage broadening (Woodworking, Pottery, Jewelry,
  // Leather, Fiber). Each is a dedicated SEO landing for the new
  // craft category so Google indexes "handmade pottery", "handmade
  // jewelry", etc. as Crafters Market territory — not just
  // CNC/metal/laser.
  "handmade-woodworking": {
    slug: "handmade-woodworking",
    keyword: "Handmade Woodworking",
    eyebrow: "Marketplace · Handmade Woodworking",
    h1: "Handmade Woodworking from American Workshops.",
    intro:
      "Shop handmade woodworking from vetted American makers — solid hardwood furniture, custom signs, cutting boards, charcuterie, turned bowls, jewelry boxes, wedding decor, and heirloom pieces built one at a time in independent shops.",
    paragraphs: [
      "Every woodworker on Crafters Market is individually approved before they can list a single piece. We verify shop photos, machine setups, and finished past work — so what you buy was actually built in a real workshop by the person who answers your messages.",
      "Filter by species (walnut, white oak, cherry, maple, reclaimed barn-board), by category (furniture, signs, kitchenware, decor), or by maker. Most pieces ship in 1-4 weeks, and custom commissions get routed to the right maker through our brief form — typically quoted inside 48 hours.",
    ],
    bodyExtras: [
      {
        heading: "What real handmade woodworking looks like",
        paragraphs: [
          "Handmade woodworking isn't just 'cut wood' — it's species selection, grain matching, joinery choice, and a finish system that actually survives kitchens, bathrooms, mantels, and entryways. Our makers spec their builds the way a furniture maker spec'd them in 1950: solid hardwoods (no MDF, no veneer-over-particleboard), traditional joinery (dovetail, mortise-and-tenon, dado), and hand-rubbed oil or polyurethane finishes you can actually re-condition decades from now.",
          "You'll see a mix of machine-aided and hand-tool work — most modern shops route mortises on a CNC, then chop and fit the tenons by hand. That's not a downgrade; it's how the best small shops in the country build today. Speed where it doesn't matter, hand work where the eye lands.",
        ],
      },
      {
        heading: "Hardwoods worth ordering",
        paragraphs: [
          "Walnut is the workhorse for high-end pieces — rich chocolate grain, takes oil beautifully, gets richer with age. White oak is the most weather-tolerant domestic hardwood (it's what shipyards and wine barrels are made of) and the right call for any outdoor sign or porch furniture. Cherry develops a deeper red patina the longer it sits in sunlight. Maple is dense and pale and cheap to ship — perfect for cutting boards and stained pieces.",
          "If you want reclaimed wood — barn-board, salvaged church beams, fence rails with natural patina — most makers source regionally and can quote with photos before they cut. Reclaimed adds character and story but limits the size to whatever the salvage yard has on the truck.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is this real handmade work or factory-built?",
        a: "Real handmade. Every woodworker on Crafters Market is individually vetted — we require workshop photos, machine details, and samples of past work before approval. No drop-shippers, no resellers, no factories overseas pretending to be small. Roughly 1 in 4 maker applications gets approved.",
      },
      {
        q: "Can I commission a custom woodworking piece?",
        a: "Yes — submit a brief with your size, species preference, design, and timeline. We route it to a maker whose shop fits the build, and you get a quote (usually inside 48 hours) before any work starts. You message the maker directly through the order thread.",
      },
      {
        q: "What's the difference between solid wood and 'wood' furniture from big retailers?",
        a: "Solid hardwood is one continuous piece of natural wood — durable, refinishable, and gets better-looking with age. The 'wood' furniture from big retailers is usually MDF or particleboard with a thin wood veneer glued on top — when it chips, you see the brown crumble underneath, and you can't sand or refinish it. Every piece on Crafters Market is real solid wood unless explicitly described otherwise.",
      },
      {
        q: "How long do shipping and lead times take?",
        a: "Most in-stock pieces ship in 1-2 weeks. Made-to-order pieces (custom signs, cutting boards with engraving, furniture) typically take 2-6 weeks depending on complexity. Each listing shows the maker's current lead time, and your maker will update you if anything changes.",
      },
    ],
    relatedLinks: [
      { to: "/cnc-wood-signs", label: "CNC Wood Signs", blurb: "V-carved hardwood signs and plaques." },
      { to: "/engraved-cutting-boards", label: "Engraved Cutting Boards", blurb: "Personalized hardwood cutting and serving boards." },
      { to: "/handmade-pottery", label: "Handmade Pottery", blurb: "Wheel-thrown ceramics from independent studios." },
      { to: "/leather-goods", label: "Leather Goods", blurb: "Hand-stitched wallets, belts, bags, and accessories." },
      { to: "/artisan-marketplace", label: "Artisan Marketplace", blurb: "The full curated marketplace of vetted makers." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /wood|walnut|oak|cherry|maple|cedar|mahogany|cutting board|charcuterie|furniture|shelf|table|chair|bowl|turned|joinery/i
        .test(`${p.title} ${p.description} ${(p.materials || []).join(" ")}`)
      || p.category === "Woodworking"
      || p.category === "Furniture",
    ctaLabel: "Browse handmade woodworking",
    ctaHref: "/shop?category=Woodworking",
  },

  "handmade-pottery": {
    slug: "handmade-pottery",
    keyword: "Handmade Pottery",
    eyebrow: "Marketplace · Handmade Pottery",
    h1: "Handmade Pottery from American Studios.",
    intro:
      "Wheel-thrown mugs, vases, planters, bowls, dinnerware, and one-of-a-kind ceramic sculpture from vetted American potters. Every piece is shaped, glazed, and fired in an independent studio — never mass-produced.",
    paragraphs: [
      "Handmade pottery has a quality that mass-produced ceramics can't fake — slight asymmetries from the wheel, glaze pooling at the rim, the artist's fingermarks on the base. Our potters spec their own clay bodies (stoneware, porcelain, raku), mix their own glazes, and fire in their own kilns. What you get is a piece with a maker behind it, not a SKU.",
      "Filter by category (drinkware, vases, planters, dinnerware), by glaze family (matte black, celadon, raw stoneware, copper red), or by potter. Most pieces ship in 1-3 weeks, and many studios offer custom commissions for wedding registries, hostess sets, and gallery pieces.",
    ],
    bodyExtras: [
      {
        heading: "Stoneware, porcelain, and the rest",
        paragraphs: [
          "Stoneware is the everyday workhorse — dense, dishwasher-safe, chip-resistant, and the body most of our mugs and bowls are made from. It fires at high temperature (cone 6 or higher) which makes it food-safe, microwave-safe, and durable enough to last decades. Porcelain is finer-grained and translucent when thin — perfect for tea sets, cups, and pieces where you want light passing through the wall.",
          "Raku and pit-fired pieces have dramatic, unpredictable surfaces — metallic lusters, crackle glazes, smoke-blackened bottoms. These are decorative pieces, not for daily food use, but they're the kind of object that anchors a shelf or mantel for a lifetime.",
        ],
      },
      {
        heading: "Glazes and what they tell you",
        paragraphs: [
          "Glaze is where a potter's signature shows up. Matte black, celadon green, ash-glazed runs, ash-and-iron speckles, salt-fire orange peel — every studio develops their own recipes and refines them over years. When you find a glaze you love, follow that potter; the next piece they list will have the same hand.",
          "Food-safe glazes carry no lead or cadmium and are tested at full firing temperature. Every potter on Crafters Market labels their food-safe pieces explicitly. Decorative-only pieces are labeled too — usually because of a low-fire luster or an unsealed earthenware body that wouldn't survive a dishwasher.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is handmade pottery dishwasher-safe?",
        a: "Most stoneware on Crafters Market is dishwasher-safe and microwave-safe. Porcelain is too. Raku, pit-fired, and unsealed earthenware are typically display-only — each listing states clearly what the piece is rated for. When in doubt, hand-wash; it doubles the lifespan of any glaze.",
      },
      {
        q: "Why does each piece look slightly different?",
        a: "Because each piece is shaped by hand on a wheel and glazed individually. Variation in form, glaze pooling, and firing color is the signature of real handmade work — not a defect. If you order a set, the potter matches them as closely as they can while preserving the handmade character.",
      },
      {
        q: "Can I commission a custom set?",
        a: "Yes — most studios accept commissions for wedding registries, hostess gifts, gallery pieces, and corporate gifts. Submit a brief with your set size, glaze preference, and timeline and we route it to the right potter. Lead times typically 4-8 weeks for a 6+ piece commission.",
      },
      {
        q: "How is pottery shipped without breaking?",
        a: "Every potter packs in custom-foam or double-boxed cells, and most ship via UPS or FedEx with insurance on anything over $100. In the rare case a piece arrives damaged, the maker covers replacement or refund — no fight, no paperwork. We track this rate and only keep potters with damage-free rates above 99%.",
      },
    ],
    relatedLinks: [
      { to: "/handmade-woodworking", label: "Handmade Woodworking", blurb: "Solid hardwood furniture, signs, and kitchenware." },
      { to: "/handmade-jewelry", label: "Handmade Jewelry", blurb: "Sterling silver, gold-fill, and one-of-a-kind pieces." },
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Curated registry pieces and one-of-a-kind sets." },
      { to: "/artisan-marketplace", label: "Artisan Marketplace", blurb: "The full curated marketplace of vetted makers." },
      { to: "/custom-handmade-goods", label: "Custom Handmade Goods", blurb: "Made-to-order originals across every craft." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /pottery|ceramic|stoneware|porcelain|mug|vase|planter|bowl|dinnerware|raku|kiln|glaze|wheel.?thrown/i
        .test(`${p.title} ${p.description} ${(p.materials || []).join(" ")}`)
      || p.category === "Pottery & Ceramics",
    ctaLabel: "Browse handmade pottery",
    ctaHref: "/shop?category=Pottery%20%26%20Ceramics",
  },

  // ── iter430 — Home Fragrance & Wellness category landing ────────────
  "home-fragrance": {
    slug: "home-fragrance",
    keyword: "Handmade Home Fragrance",
    eyebrow: "Marketplace · Home Fragrance & Wellness",
    h1: "Handmade Home Fragrance from Independent Makers.",
    intro:
      "Hand-poured candles, wax melts, room and linen sprays, reed diffusers, essential oils, incense, potpourri, and aromatherapy blends from vetted American makers — small-batch, honestly scented, and made by the person who answers your messages.",
    paragraphs: [
      "Every fragrance maker on Crafters Market is individually approved before they can list a single product. We verify studio photos, materials, and finished past work — so the candle on your shelf was actually hand-poured in a small studio, not relabeled from a factory pallet.",
      "Filter by product type (candles, wax melts, room sprays, reed diffusers, essential oils, incense) or by maker. Most orders ship in under a week, and many makers offer custom scent work — wedding favors, memorial candles, signature scents for small businesses — through our custom order flow.",
    ],
    bodyExtras: [
      {
        heading: "What small-batch fragrance actually means",
        paragraphs: [
          "Small-batch makers pour in kettles measured in pounds, not tons. That changes everything: waxes are chosen for burn quality (soy, coconut-soy, beeswax) instead of shelf price, fragrance loads are tuned by hand and cure for days before sale, and wicks are sized to the exact vessel so the melt pool reaches the edge without tunneling or sooting.",
          "The same care shows up across the category — room and linen sprays blended with skin-safe fragrance and distilled water, reed diffusers with genuine rattan reeds, incense hand-dipped rather than machine-extruded, and essential oils sourced from named distillers rather than anonymous brokers.",
        ],
      },
      {
        heading: "Choosing between candles, melts, sprays, and diffusers",
        paragraphs: [
          "Candles give the ritual — flame, warm light, and the strongest scent throw while burning. Wax melts deliver the same fragrance flame-free through a warmer, ideal for households with kids or pets. Room and linen sprays are instant and portable; reed diffusers scent a room continuously for weeks with zero effort. Many buyers keep one of each: a candle for evenings, melts for daytime, and a spray for refreshing bedding and upholstery.",
          "For aromatherapy, look to makers listing pure essential oils and blends — lavender for wind-down, eucalyptus for showers, citrus for workspaces. Every listing states exactly what's inside; our makers label materials honestly because their name is on the label.",
        ],
      },
    ],
    faqs: [
      {
        q: "Are these candles really hand-poured?",
        a: "Yes. Every fragrance maker on Crafters Market is individually vetted — we require studio photos, materials details, and samples of past work before approval. No drop-shippers, no relabeled factory stock. Roughly 1 in 4 maker applications gets approved.",
      },
      {
        q: "What waxes and ingredients do makers use?",
        a: "Most candles and melts here are soy, coconut-soy, or beeswax — cleaner-burning than paraffin and easier on sensitive noses. Sprays are blended with skin-safe fragrance oils, and aromatherapy products use pure essential oils. Each listing states its materials; if something matters to you (vegan, phthalate-free, pet-safe), message the maker directly.",
      },
      {
        q: "Can I order custom scents for a wedding or business?",
        a: "Yes — custom scent work is one of the most-requested commissions in this category. Submit a brief with your quantity, vessel or format preference, scent direction, and date. We route it to a fragrance maker whose studio fits the job, and you'll get a quote — usually inside 48 hours.",
      },
      {
        q: "How is fragrance shipped safely?",
        a: "Candles and diffusers ship in snug, padded boxes; most makers avoid shipping soft waxes during heat waves or add insulation in summer. Sprays and oils ship in leak-checked, sealed bottles. If anything arrives damaged, the maker covers replacement or refund — no fight, no paperwork.",
      },
    ],
    relatedLinks: [
      { to: "/handmade-pottery", label: "Handmade Pottery", blurb: "Wheel-thrown ceramics — pairs well with candle vessels." },
      { to: "/handmade-textiles", label: "Handmade Textiles", blurb: "Quilts, weavings, and fiber art for cozy rooms." },
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "All custom and monogrammed gift pieces." },
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Favors, registry pieces, and one-of-a-kind sets." },
      { to: "/artisan-marketplace", label: "Artisan Marketplace", blurb: "The full curated marketplace of vetted makers." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /candle|wax melt|room spray|linen spray|reed diffuser|diffuser|essential oil|incense|potpourri|sachet|aromatherapy|air freshener|soy wax|beeswax|fragrance|scented/i
        .test(`${p.title} ${p.description} ${(p.materials || []).join(" ")}`)
      || p.category === "Home Fragrance & Wellness",
    ctaLabel: "Browse home fragrance",
    ctaHref: "/shop?category=Home%20Fragrance%20%26%20Wellness",
  },

  "handmade-jewelry": {
    slug: "handmade-jewelry",
    keyword: "Handmade Jewelry",
    eyebrow: "Marketplace · Handmade Jewelry",
    h1: "Handmade Jewelry from Independent Studios.",
    intro:
      "Sterling silver, gold-fill, raw gemstones, hand-forged copper, and one-of-a-kind statement pieces from vetted American jewelers. Every ring, necklace, earring, and cuff is fabricated by hand in an independent studio.",
    paragraphs: [
      "Handmade jewelry has a texture and weight that machine-stamped retail jewelry can't fake — the hammer marks on a forged silver cuff, the slightly uneven solder lines on a bezel, the way a raw stone catches light because it was set by someone who chose it. Our jewelers cut, forge, solder, and stone-set in their own studios.",
      "Filter by material (sterling silver, 14k gold-fill, brass, copper, bronze), by category (rings, necklaces, earrings, cuffs, statement pieces), or by jeweler. Most pieces ship in 1-2 weeks, and made-to-order rings (engagement, signet, custom band) take 2-6 weeks depending on the build.",
    ],
    bodyExtras: [
      {
        heading: "Sterling silver, gold-fill, and what's worth your money",
        paragraphs: [
          "Sterling silver (.925) is the everyday standard — durable, repairable, and develops a patina that gives it character over time. Pure silver is too soft to hold a ring shape, which is why almost every silver piece is sterling. Gold-fill is a heavy layer of real gold bonded to a base metal core — it's not plated and won't flake; expect 10-20+ years of daily wear before it shows the base metal. Solid gold (14k, 18k) is what you order for engagement rings and lifetime pieces.",
          "Skip jewelry sold by weight with 'silver-tone' or 'gold-tone' in the description — that's plated base metal that will turn your finger green inside a year. Every listing on Crafters Market specifies the actual metal composition.",
        ],
      },
      {
        heading: "Stones, settings, and the hand at work",
        paragraphs: [
          "Bezel setting (a metal rim around the stone) is the strongest, most heirloom-grade setting type — it protects the stone, hides girdle nicks, and looks intentional. Prong setting (the classic 4- or 6-prong claw) puts more of the stone on display but needs maintenance — re-tipping prongs every 5-10 years to keep the stone from popping. Bezel work is harder to fabricate by hand, which is why you see it more on independent makers' work than on retail jewelry.",
          "Many of our jewelers work with raw or rough-cut stones — turquoise, lapis, agate, druzy, raw quartz — that don't exist in retail catalogs because each stone is a one-off. If you fall in love with a piece, order it; it can't be reproduced.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is this real silver and gold, not plated?",
        a: "Yes — every piece labeled sterling silver is .925 sterling. Every piece labeled gold-fill is real gold-fill (not plated). Solid gold is solid karat as stated (14k, 18k). Plated pieces are explicitly labeled as plated. We don't approve makers who try to pass plated work off as solid.",
      },
      {
        q: "Can I get a custom engagement ring or signet?",
        a: "Yes — most jewelers accept commissions. Submit a brief with your size, metal preference, stone preference (or 'maker's choice' for one-of-a-kind), and budget. We route it to a jeweler whose work fits the build. Custom rings typically run 4-8 weeks from brief to shipping.",
      },
      {
        q: "How do I know my ring size?",
        a: "Most jewelers can size a ring for you if you provide a measurement — order a $5 plastic sizer (Amazon or your local jeweler), or send the inner-diameter measurement of a ring that already fits the same finger. We have a sizing guide that every maker links to on their listings.",
      },
      {
        q: "What about resizing or repair later?",
        a: "Almost every sterling silver and solid gold piece can be resized or repaired. Gold-fill is harder to resize without compromising the gold layer — order it correctly the first time. Many of our jewelers offer free first-year resizing on rings they made, and reasonable resize fees after that. Each shop's policy is on their profile page.",
      },
    ],
    relatedLinks: [
      { to: "/leather-goods", label: "Leather Goods", blurb: "Hand-stitched wallets, belts, and bags." },
      { to: "/handmade-pottery", label: "Handmade Pottery", blurb: "Wheel-thrown ceramics from independent studios." },
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Curated heirloom gifts and registry pieces." },
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "All custom and monogrammed pieces." },
      { to: "/artisan-marketplace", label: "Artisan Marketplace", blurb: "The full curated marketplace of vetted makers." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /jewel|ring|necklace|earring|bracelet|cuff|pendant|silver|gold|turquoise|gemstone|signet/i
        .test(`${p.title} ${p.description} ${(p.materials || []).join(" ")}`)
      || /jewelry/i.test(p.category || ""),
    ctaLabel: "Browse handmade jewelry",
    ctaHref: "/shop?category=Jewelry%20%26%20Wearables",
  },

  "leather-goods": {
    slug: "leather-goods",
    keyword: "Leather Goods",
    eyebrow: "Marketplace · Leather Goods",
    h1: "Handmade Leather Goods from American Workshops.",
    intro:
      "Hand-stitched wallets, belts, bags, journals, knife sheaths, dog collars, and made-to-order accessories from vetted American leatherworkers. Every piece is cut, edged, stitched, and finished by hand in an independent shop.",
    paragraphs: [
      "Real leather goods are obvious the moment you hold one — full-grain hide with visible pores, hand-burnished edges, saddle-stitched seams that won't unravel if a single thread breaks. Our leatherworkers source full-grain Horween, Wickett & Craig, and Hermann Oak leather, and stitch every seam by hand or with traditional harness needles.",
      "Filter by category (wallets, belts, bags, journals, accessories), by leather type (full-grain, bridle, chromexcel, latigo, suede), or by maker. Most pieces ship in 1-3 weeks, and custom commissions — monogrammed wallets, bespoke belt sizing, made-to-measure bags — typically take 3-6 weeks.",
    ],
    bodyExtras: [
      {
        heading: "Full-grain leather and why it matters",
        paragraphs: [
          "Full-grain leather is the top layer of the hide, still attached, with the natural grain intact. It's the strongest, most durable, and only-gets-better-with-age leather there is — every wallet, belt, and bag worth keeping for decades is full-grain. 'Top-grain' is full-grain with the top sanded off (looks uniform but loses the patina). 'Genuine leather' is the bottom-of-the-barrel layer, glued and embossed to look like leather — avoid.",
          "Our leatherworkers source from tanneries with real provenance: Horween Chicago (chromexcel and shell cordovan), Wickett & Craig (English bridle), Hermann Oak (saddle skirting). When a listing says 'Horween chromexcel,' it's actually Horween chromexcel — we verify supplier invoices during the maker vetting process.",
        ],
      },
      {
        heading: "Hand-stitching vs. machine-stitching",
        paragraphs: [
          "Saddle-stitching by hand uses two needles and a single waxed thread, pulled tight on each pass. The result is a seam where every stitch is independent — if one breaks, the others stay locked in place. Machine-stitched seams unravel if a single thread breaks. The difference matters most on belts, wallet edges, and dog collars where a stitch sees daily friction.",
          "Hand-stitching takes 3-5x longer than machine-stitching, which is why machine-stitched leather is cheaper. It also doesn't last as long. Every leatherworker on Crafters Market labels each piece clearly — hand-stitched seams are the standard on belts, wallets, and journals.",
        ],
      },
    ],
    faqs: [
      {
        q: "How long does handmade leather last?",
        a: "A well-made full-grain leather wallet or belt lasts 15-30 years with normal use, and develops a deeper patina the whole time. Belts can be re-stitched or re-edged once the leather softens. Wallets eventually wear at the corners — many makers offer free first-year repairs and reasonable repair fees after that.",
      },
      {
        q: "Can I get a custom-sized belt or monogrammed wallet?",
        a: "Yes — almost every leatherworker on Crafters Market offers custom sizing on belts and monograms on wallets. Some offer made-to-measure bags. Submit a brief with the measurements, hardware preference, and any personalization, and we route it to the right maker.",
      },
      {
        q: "How do I take care of my leather goods?",
        a: "Full-grain leather wants to breathe and stay conditioned. Wipe with a dry cloth weekly, condition with a wax-based leather conditioner (Saphir, Smith's, Pecard's) every 3-6 months, and avoid soaking it in water. If it does get wet, let it air-dry away from direct heat — never use a hair dryer. Conditioned leather lasts decades; neglected leather cracks at the fold lines inside 5 years.",
      },
      {
        q: "Are these gifts good for men, women, or both?",
        a: "Both. Our leatherworkers make pieces across the full range — slim cardholders, structured tote bags, classic bifold wallets, statement belts, journal covers, jewelry rolls. Filter by category and price, and every listing shows the maker's range. Many pieces are intentionally unisex — a saddle-tan bifold or a hand-stitched journal cover works for anyone.",
      },
    ],
    relatedLinks: [
      { to: "/handmade-jewelry", label: "Handmade Jewelry", blurb: "Sterling silver, gold-fill, and stone-set pieces." },
      { to: "/handmade-woodworking", label: "Handmade Woodworking", blurb: "Hardwood furniture, signs, and kitchenware." },
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "Monogrammed and custom-made gift pieces." },
      { to: "/handmade-gifts-for-dad", label: "Handmade Gifts for Dad", blurb: "Engraved tools, wallets, and shop pieces." },
      { to: "/artisan-marketplace", label: "Artisan Marketplace", blurb: "The full curated marketplace of vetted makers." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /leather|wallet|belt|bag|journal|sheath|holster|cordovan|chromexcel|saddle|bridle/i
        .test(`${p.title} ${p.description} ${(p.materials || []).join(" ")}`)
      || p.category === "Leather Goods",
    ctaLabel: "Browse leather goods",
    ctaHref: "/shop?category=Leather%20Goods",
  },

  "handmade-textiles": {
    slug: "handmade-textiles",
    keyword: "Handmade Textiles & Fiber Arts",
    eyebrow: "Marketplace · Fiber Arts & Textiles",
    h1: "Handmade Textiles & Fiber Arts.",
    intro:
      "Handwoven blankets, naturally-dyed scarves, hand-knit goods, quilts, embroidered wall hangings, and one-of-a-kind fiber art from vetted American makers. Every piece is woven, knitted, quilted, or stitched in an independent studio.",
    paragraphs: [
      "Fiber arts are the slowest, most labor-intensive craft on the marketplace — a handwoven throw can take 40+ hours on the loom, a queen-size quilt 80+ hours of cutting, piecing, and stitching. The result is an object you can pass down: natural fibers, real dyes, and the kind of texture mass-produced textiles can't fake.",
      "Filter by category (blankets, scarves, wall art, quilts, apparel, home textiles), by technique (handwoven, hand-knit, quilted, embroidered, naturally-dyed), or by maker. Most pieces ship in 1-3 weeks for finished work; commissioned heirloom quilts and custom woven blankets typically take 4-12 weeks.",
    ],
    bodyExtras: [
      {
        heading: "Natural fibers and what to look for",
        paragraphs: [
          "Wool is the workhorse — warm, breathable, durable, and naturally water-resistant. Merino wool is the soft variety used in next-to-skin pieces like scarves and shawls; sheep's wool is the heavier variety used in blankets, throws, and rugs. Linen is the dressier natural fiber — drapes beautifully, gets softer with washing, takes natural dyes brilliantly. Cotton is the everyday standard for quilts and embroidery.",
          "Synthetic fibers (acrylic, polyester) are cheap and easy to wash but feel plasticky against the skin and don't take dye the same way. Almost every piece on Crafters Market is natural fiber — when a piece blends in a synthetic for stretch or durability, the listing says so explicitly.",
        ],
      },
      {
        heading: "Natural dyes and the colors you get",
        paragraphs: [
          "Many of our fiber makers use natural plant dyes — indigo, madder root, weld, walnut hulls, cochineal, logwood. The colors are deeper, more nuanced, and slightly variable in a way that synthetic dyes can't replicate. A naturally-dyed indigo scarf has 15 different shades of blue depending on the angle and the light; a synthetic-dyed one has one shade. Once you see them side-by-side, you can't unsee it.",
          "Natural dyes do fade slightly over years of sun exposure — that's the trade for the depth. Synthetic dyes are colorfast for decades but read flatter. Each maker labels their dye approach clearly on the listing.",
        ],
      },
    ],
    faqs: [
      {
        q: "How do I wash handwoven and hand-knit goods?",
        a: "Wool (handwoven blankets, hand-knit scarves, throws): hand wash in cold water with a wool-safe detergent (Eucalan, Woolite for wool), lay flat to dry. Linen and cotton (quilts, embroidery, summer pieces): gentle machine wash cold, tumble low or line dry. Every piece ships with care instructions from the maker. Never put wool in a dryer — it felts and shrinks irreversibly.",
      },
      {
        q: "Can I commission a custom quilt or blanket?",
        a: "Yes — many of our fiber artists accept commissions for heirloom quilts (wedding quilts, memorial quilts incorporating loved-ones' shirts, baby quilts), custom-sized blankets, and personalized embroidery. Lead times run 4-12 weeks depending on size and complexity. Submit a brief and we route it to the right maker.",
      },
      {
        q: "Are these pieces really handwoven, not machine-loomed?",
        a: "Yes — every piece labeled handwoven on Crafters Market was woven by hand on a floor or table loom, by the maker named on the listing. We verify loom photos and in-progress work during vetting. Machine-loomed pieces from industrial mills aren't allowed on the marketplace; if you find one, please report it.",
      },
      {
        q: "Why are some pieces so much more expensive than others?",
        a: "Time. A handwoven throw is 40+ hours on the loom. A queen-size hand-quilted quilt is 80-150 hours of cutting, piecing, and stitching. Naturally-dyed yarn doubles material cost. The price reflects the actual labor, not a markup — most fiber artists make $10-20/hour on a finished piece. If you find a handwoven blanket for $50, it isn't handwoven.",
      },
    ],
    relatedLinks: [
      { to: "/handmade-pottery", label: "Handmade Pottery", blurb: "Wheel-thrown ceramics from independent studios." },
      { to: "/handmade-jewelry", label: "Handmade Jewelry", blurb: "Sterling silver, gold-fill, and stone-set pieces." },
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Heirloom gifts and registry pieces." },
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "Embroidered and monogrammed work." },
      { to: "/artisan-marketplace", label: "Artisan Marketplace", blurb: "The full curated marketplace of vetted makers." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /quilt|blanket|throw|scarf|shawl|tapestry|weav|knit|crochet|embroider|textile|fiber|wool|linen|merino|indigo/i
        .test(`${p.title} ${p.description} ${(p.materials || []).join(" ")}`)
      || p.category === "Fiber & Textiles",
    ctaLabel: "Browse handmade textiles",
    ctaHref: "/shop?category=Fiber%20%26%20Textiles",
  },

  // ── iter411b — Buyer-intent variants of the new craft categories ───
  // The category landing pages above target browse queries ("handmade
  // pottery"); these target high-intent purchase queries with a specific
  // product type ("handmade mugs", "leather wallets"). Each is narrower
  // but converts harder because the searcher already knows what they
  // want to buy.
  "handmade-mugs": {
    slug: "handmade-mugs",
    keyword: "Handmade Mugs",
    eyebrow: "Curated · Handmade Mugs",
    h1: "Handmade Mugs from American Potters.",
    intro:
      "Wheel-thrown stoneware and porcelain mugs from vetted American potters. Every mug is shaped, glazed, and fired in an independent studio — coffee, tea, and morning ritual upgrades you'll keep for years.",
    paragraphs: [
      "A handmade mug is the daily-use object that earns the most affection per dollar in your kitchen. Our potters throw each mug on the wheel, pull the handle by hand (no slip-cast, no extruded handles), trim the foot, and glaze each piece individually. The result is a mug with a real weight, a balanced handle, and a glaze that develops a patina over thousands of washes.",
      "Filter by capacity (espresso, 10 oz, 12 oz, 14 oz tankard), by glaze (matte black, celadon, raw stoneware, copper red, salt-fired orange peel), or by potter. Most mugs ship in 1-2 weeks; sets of 2, 4, or 6 take a bit longer because the potter matches each piece in the same firing cycle.",
    ],
    bodyExtras: [
      {
        heading: "What a good handmade mug feels like",
        paragraphs: [
          "Pick it up. The handle should feel balanced when the mug is full — not too small, not too far from the body. The lip should be smooth enough that you don't notice it on every sip. The base should sit flat without rocking. And the weight should feel substantial without being heavy. Those four things separate a serious potter's work from beginner-grade.",
          "Glaze pooling at the bottom interior is normal — that's where the glaze runs slightly during the firing, and it's a signature of real wheel-thrown work. Skin-thin walls feel elegant; thicker walls keep your coffee hot longer. Pick your priority.",
        ],
      },
      {
        heading: "Daily use, dishwasher, microwave",
        paragraphs: [
          "Stoneware mugs are dishwasher- and microwave-safe by default. Porcelain mugs are too, though gold or silver luster bands aren't (skip the microwave on those). Hand-washing extends the glaze's life by years but isn't required for daily-use stoneware.",
          "Avoid thermal shock — don't pull a mug out of the freezer and pour boiling water in. Don't take a hot mug straight onto a cold marble counter. Stoneware handles a lot, but the one thing it doesn't like is fast temperature swings.",
        ],
      },
    ],
    faqs: [
      {
        q: "How much coffee does a handmade mug hold?",
        a: "Most everyday mugs run 10-14 oz. Espresso cups are 3-5 oz. Tankards and 'big morning' mugs go 16-20 oz. Each listing states the exact capacity (filled to the rim and a safe pour line — usually about 1 oz below the rim).",
      },
      {
        q: "Are these dishwasher-safe?",
        a: "Yes — all stoneware and porcelain mugs are dishwasher-safe. The exception is any mug with a gold or silver luster band (those are hand-wash). Each listing labels this clearly.",
      },
      {
        q: "Can I get a matched set?",
        a: "Yes — most potters offer sets of 2, 4, or 6 fired in the same batch so the glaze tone matches as closely as possible. Slight variation is the signature of handmade work, but a matched set will be far closer than ordering individual mugs at different times.",
      },
      {
        q: "Will the mug I receive look exactly like the photos?",
        a: "Close, but not identical. Each mug is glazed and fired individually, so the glaze can pool slightly differently, the handle can sit at a slightly different angle, and the wheel marks vary. That's the trade for real wheel-thrown work — every mug is a single object, not a SKU.",
      },
    ],
    relatedLinks: [
      { to: "/handmade-pottery", label: "Handmade Pottery", blurb: "All pottery — vases, bowls, planters, dinnerware." },
      { to: "/handmade-jewelry", label: "Handmade Jewelry", blurb: "Sterling silver, gold-fill, and stone-set pieces." },
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Curated registry pieces and one-of-a-kind sets." },
      { to: "/handmade-gifts-for-dad", label: "Handmade Gifts for Dad", blurb: "Coffee, whiskey, and shop pieces for him." },
      { to: "/artisan-marketplace", label: "Artisan Marketplace", blurb: "The full curated marketplace of vetted makers." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /mug|cup|tumbler|tankard|espresso|coffee|tea/i.test(`${p.title} ${p.description}`)
      && /pottery|ceramic|stoneware|porcelain|clay|glaze|wheel/i
        .test(`${p.title} ${p.description} ${(p.materials || []).join(" ")} ${p.category}`),
    ctaLabel: "Browse handmade mugs",
    ctaHref: "/shop?q=mug",
  },

  "handmade-quilts": {
    slug: "handmade-quilts",
    keyword: "Handmade Quilts",
    eyebrow: "Curated · Handmade Quilts",
    h1: "Handmade Quilts from American Makers.",
    intro:
      "Hand-pieced and hand-quilted blankets, throws, and heirloom quilts from vetted American quilters. Wedding quilts, memorial quilts, baby quilts, and one-of-a-kind throws — all stitched in independent studios.",
    paragraphs: [
      "A handmade quilt is the longest-running craft project most makers ever take on — 80-150 hours of cutting, piecing, basting, and stitching for a queen-size piece. The result is an object that's typically passed down through generations: cotton, linen, and natural-fiber blends, traditional and modern patterns, and finishing by hand or with traditional treadle machines.",
      "Filter by size (baby, throw, twin, queen, king), by style (traditional patchwork, modern improvisational, log cabin, double wedding ring, memorial t-shirt), or by quilter. Most in-stock pieces ship in 1-2 weeks; commissioned heirloom quilts (memorial quilts using a loved-one's clothing, wedding quilts, baby-name quilts) typically run 6-16 weeks.",
    ],
    bodyExtras: [
      {
        heading: "Fabric, batting, and what to look for",
        paragraphs: [
          "Quilt-shop cotton (Moda, Robert Kaufman, Art Gallery) is the standard for the top — colorfast, soft, and built to survive decades of washing. Linen, voile, and lawn show up in lighter summer quilts. The backing is usually wide-format cotton or a soft flannel for warmth.",
          "Batting (the middle layer) determines the quilt's weight and warmth. Cotton batting is dense and drapes heavy — traditional. Wool batting is warm without weight — modern. Bamboo batting is lightweight and breathable — great for summer pieces. Each listing tells you which.",
        ],
      },
      {
        heading: "Hand-quilted vs. machine-quilted",
        paragraphs: [
          "Hand-quilted means the quilting stitches (the lines holding all three layers together) were sewn with a needle, by hand. It takes 60-100 hours on a queen-size quilt and is the most heirloom-grade finishing. Machine-quilted means the quilting was done on a domestic or long-arm machine — still hand-guided by the maker, but much faster. Both are legitimate; each listing labels which approach the quilter used.",
          "Look for binding (the strip around the edge) that's stitched down by hand on the back — it's the small detail that separates a real heirloom from a quilt finished in a rush.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I commission a quilt from a loved-one's clothing?",
        a: "Yes — memorial quilts from t-shirts, button-downs, and clothing of someone you've lost are one of the most-ordered custom commissions. Ship the clothing to the quilter (most accept 20-40 pieces for a throw or twin-size), describe your color preferences and any specific shirts you want featured, and the quilter designs a layout for your approval before cutting. Typical lead time: 8-16 weeks.",
      },
      {
        q: "How do I wash a quilt?",
        a: "Cold-water gentle cycle in a front-load washer, with a mild detergent (no bleach, no fabric softener). Tumble low or — even better — lay flat to dry. Avoid wringing or twisting. A well-made quilt survives hundreds of washes; the colors will mellow over decades but the structure will hold.",
      },
      {
        q: "What sizes do quilts come in?",
        a: "Baby (36x48), throw (50x65), twin (68x88), queen (88x96), king (108x96). Custom sizes are available for daybeds, RV bunks, and oversized king beds — just specify in the brief.",
      },
      {
        q: "Are these heirloom quality or daily-use?",
        a: "Both. A well-made handmade quilt is daily-use durable AND heirloom quality — that's the point. Your great-grandkids will use the quilt you order today if you wash it gently and rotate it with another piece. Each quilter labels whether their piece is built for everyday use or display-only.",
      },
    ],
    relatedLinks: [
      { to: "/handmade-textiles", label: "Handmade Textiles", blurb: "Handwoven blankets, scarves, and fiber art." },
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Heirloom registry gifts and one-of-a-kind sets." },
      { to: "/memorial-pieces", label: "Memorial Pieces", blurb: "Custom keepsakes honoring loved ones." },
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "Embroidered, monogrammed, and named pieces." },
      { to: "/artisan-marketplace", label: "Artisan Marketplace", blurb: "The full curated marketplace of vetted makers." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /quilt|patchwork|coverlet|throw|blanket|comforter/i
        .test(`${p.title} ${p.description} ${(p.materials || []).join(" ")}`)
      || p.category === "Fiber & Textiles",
    ctaLabel: "Browse handmade quilts",
    ctaHref: "/shop?q=quilt",
  },

  "handmade-rings": {
    slug: "handmade-rings",
    keyword: "Handmade Rings",
    eyebrow: "Curated · Handmade Rings",
    h1: "Handmade Rings from Independent Jewelers.",
    intro:
      "Sterling silver, gold-fill, solid gold, and one-of-a-kind statement rings from vetted American jewelers. Engagement rings, signet rings, stacking bands, raw-stone rings, and made-to-order pieces — every ring fabricated by hand in an independent studio.",
    paragraphs: [
      "Handmade rings have weight, texture, and detail that retail-store rings can't fake — the hammer marks on a forged silver band, the bezel set by hand around a one-of-a-kind stone, the inside of the shank polished smooth so it sits comfortably for 18 hours a day. Our jewelers cut, forge, solder, and stone-set in their own studios.",
      "Filter by metal (sterling silver, 14k gold-fill, 14k solid gold, 18k solid gold), by style (signet, band, statement, stacking, engagement), by stone (none, raw, faceted), or by jeweler. Most in-stock rings ship in 1-2 weeks; custom and made-to-measure (engagement, signet engraving, custom stone setting) typically run 3-8 weeks.",
    ],
    bodyExtras: [
      {
        heading: "Sterling silver, gold-fill, solid gold — which to order",
        paragraphs: [
          "Sterling silver (.925) is the everyday workhorse — durable, repairable, develops a patina you can polish back. Best for everyday rings and statement pieces under $400. Gold-fill is a heavy bonded layer of real 14k gold over a brass core — lasts 10-20 years of daily wear without revealing the base metal. Best for stacking bands and statement rings under $250.",
          "Solid 14k or 18k gold is for the lifetime pieces — engagement rings, signets that pass down, wedding bands. 14k is harder and more scratch-resistant; 18k is softer but has a richer color. Choose 14k for daily wear and 18k for occasion pieces.",
        ],
      },
      {
        heading: "Stone setting and what lasts",
        paragraphs: [
          "Bezel setting (a metal rim around the stone) is the strongest, most heirloom-grade type. The stone is fully protected — no exposed edges to nick, no prongs to catch on sweaters, no annual jeweler visits for re-tipping. The trade is that the bezel hides slightly more of the stone than a prong setting does.",
          "Prong setting (4- or 6-prong claw) puts more of the stone on display but needs maintenance — re-tipping every 5-10 years so the stone doesn't pop. Most of our jewelers offer both; bezel is the long-term recommendation for engagement and signet pieces, prong for statement rings where you want the stone to show.",
        ],
      },
    ],
    faqs: [
      {
        q: "How do I know my ring size?",
        a: "Order a $5 plastic sizer from Amazon or visit a local jeweler — they'll measure for free. Or send the inside-diameter measurement of a ring that already fits the same finger. Most jewelers can adjust by half a size in their workshop; full-size or larger adjustments may take a couple weeks.",
      },
      {
        q: "Can I commission a custom engagement ring?",
        a: "Yes — most jewelers accept commissions. Submit a brief with metal, stone preference (or 'jeweler's choice' for one-of-a-kind), size, and budget. Most jewelers send sketches or CAD renderings for approval before cutting. Custom engagement rings typically run 4-8 weeks from brief to shipping.",
      },
      {
        q: "What if the ring doesn't fit when it arrives?",
        a: "Most jewelers offer free first-resize on rings they made, within 60-90 days of delivery. After that, resizing runs $20-60 depending on the metal and how many sizes up or down. Each jeweler's policy is on their profile page.",
      },
      {
        q: "How do I care for a handmade ring?",
        a: "Polish with a soft polishing cloth (most jewelers ship one with the ring). For sterling silver, a quick polish brings back the shine — patina is normal and many love it. For gold, polish with a soft cloth or buff lightly. Avoid harsh chemicals (bleach, chlorine, drain cleaner) and take the ring off before gym, dishes, or beach.",
      },
    ],
    relatedLinks: [
      { to: "/handmade-jewelry", label: "Handmade Jewelry", blurb: "Necklaces, earrings, cuffs, and full jewelry catalog." },
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Heirloom gifts and registry pieces." },
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "All custom and monogrammed pieces." },
      { to: "/leather-goods", label: "Leather Goods", blurb: "Hand-stitched wallets and accessories." },
      { to: "/artisan-marketplace", label: "Artisan Marketplace", blurb: "The full curated marketplace of vetted makers." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /ring|band|signet|engagement|wedding band|stacker/i
        .test(`${p.title} ${p.description}`)
      && /silver|gold|brass|copper|bronze|jewel|metal/i
        .test(`${p.title} ${p.description} ${(p.materials || []).join(" ")} ${p.category}`),
    ctaLabel: "Browse handmade rings",
    ctaHref: "/shop?q=ring",
  },

  "leather-wallets": {
    slug: "leather-wallets",
    keyword: "Leather Wallets",
    eyebrow: "Curated · Leather Wallets",
    h1: "Handmade Leather Wallets from American Workshops.",
    intro:
      "Hand-stitched bifold, cardholder, long-wallet, and zip-around leather wallets from vetted American leatherworkers. Full-grain Horween chromexcel, Wickett & Craig bridle, and Hermann Oak saddle leather — every wallet cut, edged, stitched, and burnished by hand.",
    paragraphs: [
      "A handmade leather wallet is the everyday-carry object that pays you back most. Spend $80-180 once on a hand-stitched full-grain wallet and it lasts 15-30 years, developing a patina the whole time. Spend the same on a synthetic or top-grain retail wallet and it's in the trash inside 3 years.",
      "Filter by style (bifold, slim cardholder, long wallet, zip-around, money clip), by leather (Horween chromexcel, English bridle, vegetable-tanned, shell cordovan), or by maker. Most in-stock wallets ship in 1-2 weeks; custom monogrammed wallets and made-to-order styles typically take 2-4 weeks.",
    ],
    bodyExtras: [
      {
        heading: "Full-grain leather and why it matters",
        paragraphs: [
          "Full-grain leather is the top layer of the hide, with the natural grain still intact. It's the strongest, most durable layer, and the only leather that develops a real patina over years. 'Top-grain' (sanded) and 'genuine leather' (laminated scraps) are both downgrades — avoid them. Every wallet on Crafters Market is full-grain unless explicitly labeled otherwise.",
          "Our leatherworkers source from Horween Chicago (chromexcel — soft, fast patina), Wickett & Craig (English bridle — firm, slow patina, dressier), and Hermann Oak (saddle skirting — heavy-duty, slowest patina). When the listing says 'Horween chromexcel,' it's actually Horween — we verify supplier invoices during vetting.",
        ],
      },
      {
        heading: "Hand-stitching, edges, and the details that matter",
        paragraphs: [
          "Saddle-stitching by hand uses two needles and a single waxed thread, pulled tight on each pass. Each stitch is independent — if one breaks, the others stay locked. Machine-stitched seams use chain-stitch construction, which unravels if a single thread breaks. For a wallet that gets pulled in and out of a pocket thousands of times a year, hand-stitching is the difference between a wallet that lasts and one that doesn't.",
          "Look at the edges. A great wallet has edges that are sanded, beveled, then burnished (rubbed smooth with wax and friction) to a polished round. A cheap wallet has raw cut edges, painted edges, or edges that are starting to delaminate before you've used it. Our makers burnish every edge; you'll feel the difference the moment you hold one.",
        ],
      },
    ],
    faqs: [
      {
        q: "How long will a handmade leather wallet last?",
        a: "A well-made full-grain leather wallet lasts 15-30 years with normal daily-carry use. The leather softens, the patina deepens, and the wallet only gets better-looking. Eventually the stitching at high-stress corners may need a re-stitch — most leatherworkers offer free first-year repairs and reasonable repair fees after that. Many wallets are essentially indestructible if conditioned every 3-6 months.",
      },
      {
        q: "What's the difference between a slim cardholder and a bifold?",
        a: "Slim cardholders hold 4-8 cards and folded cash in a slim front-pocket profile (1/4 inch thick). Bifolds hold 6-12 cards plus a cash sleeve in a traditional back-pocket profile (1/2 inch thick when full). Long wallets and zip-arounds hold full-length bills flat and add interior coin pockets — back-pocket size, but everything inside lies flat for easy access.",
      },
      {
        q: "Can I get a monogrammed wallet?",
        a: "Yes — most leatherworkers offer hand-stamped or laser-engraved monograms in 2-4 character initials. Embossed text (1-3 lines, usually a name + date or a short phrase) is also available. Add custom monogram to the order notes and the maker confirms placement before stitching.",
      },
      {
        q: "How do I take care of a leather wallet?",
        a: "Condition with a wax-based leather conditioner (Saphir, Smith's, Pecard's) every 3-6 months. Wipe down with a dry cloth weekly. Avoid soaking it (rain is fine; dropping in a puddle is not — pat dry, air dry away from heat). Conditioned full-grain lasts decades; neglected leather cracks at the fold lines inside 5-7 years.",
      },
    ],
    relatedLinks: [
      { to: "/leather-goods", label: "Leather Goods", blurb: "All leather — belts, bags, journals, accessories." },
      { to: "/handmade-jewelry", label: "Handmade Jewelry", blurb: "Sterling silver, gold-fill, and stone-set pieces." },
      { to: "/handmade-gifts-for-dad", label: "Handmade Gifts for Dad", blurb: "Engraved tools, wallets, and shop pieces." },
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "Monogrammed and custom-made gift pieces." },
      { to: "/artisan-marketplace", label: "Artisan Marketplace", blurb: "The full curated marketplace of vetted makers." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /wallet|cardholder|bifold|money clip|card case/i
        .test(`${p.title} ${p.description}`)
      || (p.category === "Leather Goods" && /wallet/i.test(p.title || "")),
    ctaLabel: "Browse leather wallets",
    ctaHref: "/shop?q=wallet",
  },

  "wood-cutting-boards": {
    slug: "wood-cutting-boards",
    keyword: "Wood Cutting Boards",
    eyebrow: "Curated · Wood Cutting Boards",
    h1: "Handmade Wood Cutting Boards.",
    intro:
      "Solid hardwood cutting and serving boards — walnut, white oak, cherry, maple, end-grain butcher blocks, and engraved wedding boards from vetted American woodworkers. Built to last 30+ years with simple care.",
    paragraphs: [
      "A real hardwood cutting board is the kitchen workhorse that quietly outlasts every other tool in the drawer. Our woodworkers cut from solid domestic hardwoods (no MDF, no bamboo composite, no glued-up scraps), finish with food-safe mineral oil and beeswax, and burn or engrave personalization on request.",
      "Filter by species (walnut, maple, white oak, cherry, hickory), by construction (edge-grain, end-grain butcher block, juice-groove), by use (daily prep, serving/charcuterie, butcher), or by maker. Most in-stock boards ship in 1-2 weeks; custom engraved boards and butcher-block commissions typically take 2-4 weeks.",
    ],
    bodyExtras: [
      {
        heading: "Edge-grain vs. end-grain",
        paragraphs: [
          "Edge-grain boards (long planks bonded side-to-side) are lighter, more affordable, and showcase the wood's flowing grain pattern. Engraving stays crisp because the wood fibers are oriented horizontal to the surface. These are the standard for serving boards, charcuterie, and gift pieces.",
          "End-grain boards (small hardwood squares bonded face-up so the cut grain shows on top) are the chef's-knife standard — knife edges slip between the wood fibers instead of slicing them, so the board self-heals and keeps your knives sharp longer. Heavier, pricier, and the engraving sits on top of a checkerboard grain pattern instead of a flowing one. Choose based on whether the board is for daily cooking (end-grain) or for serving and display (edge-grain).",
        ],
      },
      {
        heading: "Hardwoods worth ordering",
        paragraphs: [
          "Walnut is the showstopper — dark chocolate grain, engraves with high contrast, naturally resists staining. Maple is the chef's standard — pale, dense, easy on knife edges, neutral against any food color. Cherry develops a deeper red patina with sunlight. White oak is the most water-resistant domestic hardwood and is ideal for boards that see heavy use.",
          "Skip exotic species (bamboo, teak, padauk) for engraved boards — they engrave with poor contrast, react with food acids, and lack the look-and-feel that makes the board land as a gift. Domestic hardwoods are better in every way.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I get a board with a family name or date engraved?",
        a: "Yes — this is the most-ordered customization. Standard layout is last name on top in larger script, established date below in smaller serif. Many makers also offer monogram-in-a-wreath, vintage banner art, or your own custom artwork. Send the maker your preferred font and layout in the order notes.",
      },
      {
        q: "How do I take care of a wood cutting board?",
        a: "Wash by hand with mild soap and warm water (never in the dishwasher — the heat warps the wood). Towel dry immediately. Re-oil every 1-3 months with food-grade mineral oil, then top with beeswax conditioner. Properly maintained, a hardwood board lasts 30+ years and looks better the longer you have it.",
      },
      {
        q: "Is laser-engraved wood food-safe?",
        a: "Yes — the laser carbonizes a thin layer of wood without introducing any chemicals. Finished with food-grade mineral oil and beeswax (both NSF-certified for direct food contact), the board is safe for raw meat, vegetables, bread, and cheese.",
      },
      {
        q: "What size board should I order?",
        a: "12x18 is the gift-standard sweet spot — large enough for charcuterie or multi-course prep, small enough for most counters. For couples who entertain heavily, jump to 14x20. For everyday-use kitchens, 10x14 is more practical. End-grain butcher-block versions add weight and price but last indefinitely.",
      },
    ],
    relatedLinks: [
      { to: "/engraved-cutting-boards", label: "Engraved Cutting Boards", blurb: "Personalized hardwood cutting and serving boards." },
      { to: "/handmade-woodworking", label: "Handmade Woodworking", blurb: "Hardwood furniture, signs, and kitchenware." },
      { to: "/wedding-gifts", label: "Wedding Gifts", blurb: "Engraved wedding-name boards and keepsakes." },
      { to: "/handmade-gifts-for-dad", label: "Handmade Gifts for Dad", blurb: "Engraved tools, whiskey glasses, and shop pieces." },
      { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "Monogrammed and custom-made gift pieces." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "5-step brief-to-shipping flow." },
    ],
    match: (p) =>
      /cutting board|charcuterie|serving board|butcher block/i
        .test(`${p.title} ${p.description}`),
    ctaLabel: "Browse wood cutting boards",
    ctaHref: "/shop?q=cutting+board",
  },
};

/** Slug list for sitemap consumers — keep in sync with the keys above. */
export const SEO_LANDING_SLUGS = Object.keys(SEO_LANDING_PAGES);
