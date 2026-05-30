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
};

/** Slug list for sitemap consumers — keep in sync with the keys above. */
export const SEO_LANDING_SLUGS = Object.keys(SEO_LANDING_PAGES);
