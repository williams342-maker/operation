/**
 * Guide configs (iter301 / Phase 4 Bundle A).
 *
 * One entry per educational content-hub article. Each guide targets
 * informational-intent SEO queries and links back to the buyer-intent
 * landing pages + the custom-order form for conversion.
 *
 * To add a new guide:
 *   1. Append an entry below.
 *   2. Add `("/guides/<slug>", "monthly", "0.80")` to backend/routers/seo.py
 *   3. App.js already routes /guides/:slug dynamically — no change needed.
 *
 * Target ~700-1200 words per guide across 5+ sections.
 */
export const GUIDES = {
  "plasma-vs-laser-vs-router": {
    slug: "plasma-vs-laser-vs-router",
    title: "Plasma vs Laser vs Router: Which CNC for Which Job?",
    eyebrow: "Guide · CNC Techniques",
    h1: "Plasma vs Laser vs Router.",
    intro:
      "Three CNC techniques. Different machines, different materials, different price points, very different end results. Here's how to know which one's right for the piece you're commissioning — and how to read a maker's tooling list when you're browsing the marketplace.",
    publishedAt: "2026-05-30",
    sections: [
      {
        heading: "Plasma cutting: heavy metal, fast",
        paragraphs: [
          "Plasma cutting uses a high-velocity stream of superheated ionized gas to slice through electrically conductive metal — typically steel, stainless steel, aluminum, copper, and brass. The cut edge is rougher than laser or waterjet, but the machine is fast, the material range is wide, and the table sizes scale to 6+ feet without exotic capital costs. This is the workhorse for outdoor signs, ranch entry pieces, custom address numbers, and any metal art where the design is bold and the gauge is thick.",
          "Plasma's sweet spot is 14-gauge through 1/2-inch plate steel. Thinner than 16-gauge and the heat distorts the metal; thicker than 1/2-inch and you're better served by waterjet or oxy-fuel. Detail resolution is limited by the kerf width (the slot the plasma carves) — typically 0.060\" to 0.150\" depending on the system. Fine script lettering or intricate filigree starts to round off below about 1/4\" character height. Bold sans-serif letters, silhouettes, and geometric panels look great.",
        ],
      },
      {
        heading: "Laser cutting: precision, thin material",
        paragraphs: [
          "Lasers come in two main flavors for makers: CO2 lasers (great for wood, acrylic, leather, paper, fabric, some plastics) and fiber lasers (designed for metals, including stainless, mild steel, brass, copper, and aluminum up to about 1/4 inch). Both deliver cleaner edges than plasma, finer detail than router, and the ability to engrave the surface as well as cut through it. If you need photo-quality engraving or hair-fine script lettering, laser is your tool.",
          "The trade-off is bed size and material thickness. Most maker lasers have 24\" × 48\" or smaller working envelopes. Cutting through 1/2-inch plate or larger-than-bed panels means switching to plasma or router. Lasers are also slower per cut than plasma on equivalent material — you pay for the precision in machine time.",
        ],
      },
      {
        heading: "CNC routers: wood, plastics, composites, and 3D",
        paragraphs: [
          "Where plasma and laser are subtractive 2D techniques, a CNC router cuts and carves in true 3D. Wood, MDF, HDPE, foam, composites, soft metals (aluminum, brass with the right tooling) — anything a spinning bit can chip away. Routers do the deep relief carving on wooden signs, the surfacing on live-edge tables, the pocket-and-tab joinery on flat-pack furniture, and the precision drilling on hardware-rich pieces.",
          "Detail resolution depends on bit diameter — most makers run 1/8\" through 1/2\" end-mills for routine work, with 1/16\" or smaller for fine detail. Surface finish depends on bit selection, spindle speed, and feed rate; a skilled CNC operator can produce a surface that needs little or no sanding before finish. Routers don't engrave like lasers do — but they can V-carve script lettering into wood that looks far better than a laser scorch on the same material.",
        ],
      },
      {
        heading: "Quick decision matrix",
        paragraphs: [
          "Here's the short answer when you're trying to decide which technique to ask the maker for:",
        ],
        list: [
          "Custom metal sign for outdoor mounting → Plasma (most cost-effective for 14-gauge+ steel) OR fiber laser (if detail matters more than thickness).",
          "Engraved cutting board, photo plaque, fine script wedding sign → CO2 laser (cleanest engrave, fastest turnaround).",
          "Wall-art metal panel with intricate filigree, 1/8\" thick stainless → Fiber laser (plasma can't hold the detail).",
          "Live-edge wood table, carved kitchen sign, dimensional furniture → CNC router.",
          "Large ranch entry sign, 1/4\" steel plate, 6+ feet wide → Plasma (the only tool with the bed size + speed at that scale).",
          "Acrylic light-up sign, layered laser-cut shapes → CO2 laser.",
          "Layered wooden mountain relief, multi-depth carving → CNC router with multiple bit changes.",
        ],
      },
      {
        heading: "How to read a maker's tooling list",
        paragraphs: [
          "Every Crafters Market maker lists their techniques on their shop profile. \"PLASMA\" means they run a plasma table (size and amperage usually noted in the bio); \"LASER\" means CO2 or fiber (often both — check the materials list); \"ROUTER\" means a CNC mill, usually 3- or 5-axis; \"FORGE\" means traditional hot-metal work outside the CNC universe entirely.",
          "If your brief mentions a material the maker hasn't listed, ask. Many shops have access to friend-shops nearby and will sub-contract a single operation rather than turn down a commission. Other shops are specialist-only and will tell you upfront they're not the right fit — which is honest and saves everyone time.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can the same maker do all three techniques?",
        a: "Some can — multi-discipline shops with both a plasma table and a CNC router are common, especially among the mid-size workshops on the platform. A laser added on top is less common because lasers are a separate capital outlay and footprint. If you need a piece that combines techniques (say, a wood base with a laser-engraved name plate and plasma-cut steel decorative elements), look for a shop with multiple listed techniques OR ask the routing team to pair two makers who routinely sub-contract to each other.",
      },
      {
        q: "Which technique gives the cleanest edge?",
        a: "Fiber laser on thin steel gives the cleanest edge of these three. Waterjet (not on this list — separate marketplace category) gives even cleaner edges with no heat-affected zone, but waterjet shops are rare on the platform and more expensive. CO2 laser on wood and acrylic gives a clean burn-edge that many designs lean into intentionally. Plasma is always the roughest — the edges typically need a quick pass with a flap disc or wire wheel before finishing.",
      },
      {
        q: "Which is fastest?",
        a: "Plasma is fastest per linear inch on thick steel — by a wide margin. Laser is fastest on detailed small pieces in thin material. Router is generally the slowest because every cut path is a physical pass with a spinning bit, but it produces a finished 3D surface in a single setup that the other two can't match.",
      },
      {
        q: "Which is cheapest for buyers?",
        a: "It depends on the design and material, not the technique. A plasma-cut 24-inch address sign in 1/8\" steel is typically cheaper than the same design laser-cut from the same material because of the speed difference. A 12-inch engraved cutting board is laser-only territory and priced accordingly. A live-edge coffee table is router-only and priced by the slab + the machine time. Ask the maker for a line-item quote; you'll see exactly what you're paying for.",
      },
      {
        q: "Can I get a 'finished' piece directly off the machine?",
        a: "Rarely from plasma — almost every plasma-cut piece needs at least a deburring pass and either a clear-coat, paint, powder-coat, or patina. Laser pieces on wood or acrylic often ship straight off the machine because the laser-burned edge IS the finish. Router pieces depend on bit selection and how much hand-sanding the maker does after the program runs. Discuss the finish expectations in the brief — \"machine-finished\" and \"hand-finished\" are two different price points.",
      },
    ],
    relatedLinks: [
      { to: "/cnc-metal-art", label: "CNC Metal Art", blurb: "Plasma and laser-cut metal pieces from vetted shops." },
      { to: "/cnc-laser-art", label: "CNC Laser Art", blurb: "Precision laser-cut and engraved originals." },
      { to: "/custom-metal-signs", label: "Custom Metal Signs", blurb: "Buyer-intent landing — common applications for plasma and laser." },
      { to: "/guides/outdoor-mounting-guide", label: "Outdoor Mounting Guide", blurb: "How to install metal pieces outdoors." },
      { to: "/guides/metal-gauge-finish-guide", label: "Metal Gauge & Finish Guide", blurb: "Pick the right gauge and finish for your piece." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "The 5-step commission flow." },
    ],
  },

  "outdoor-mounting-guide": {
    slug: "outdoor-mounting-guide",
    title: "Outdoor Mounting Guide: Hanging Metal & Wood Pieces That Last",
    eyebrow: "Guide · Installation",
    h1: "Outdoor Mounting Guide.",
    intro:
      "A beautiful piece is only as good as the wall, post, or substrate behind it. Here's the practical guide to mounting custom metal and wood signs outdoors so they survive the weather, the wind, and 20 years of seasonal cycling without sagging, cracking, or pulling out of the substrate.",
    publishedAt: "2026-05-30",
    sections: [
      {
        heading: "Read your substrate first",
        paragraphs: [
          "Before you measure for hardware, identify what you're mounting to. The four common outdoor substrates each require different anchors: wood siding (cedar, redwood, fiber-cement) accepts deck screws straight into the studs behind it; brick and stone require masonry sleeves and concrete screws; stucco needs a careful pilot hole and either a hollow-wall anchor or a deep masonry anchor depending on the underlying construction; a freestanding post (wood 4x4, steel tube, or concrete) accepts through-bolts with washers and lock nuts.",
          "If you don't know what's behind the surface, knock on it — solid sounds and a small drill test will tell you. Going into the wrong substrate with the wrong hardware is the #1 cause of outdoor-sign failure within the first year.",
        ],
      },
      {
        heading: "Hardware sizing and stand-offs",
        paragraphs: [
          "For metal pieces under about 20 pounds, two anchors are usually sufficient. Anything heavier, or anything in a high-wind area, deserves four anchors on a rectangular pattern that distributes load to the corners of the piece. Always anchor through a structural point on the sign — most metal pieces have either welded standoffs, drilled holes at the corners, or a hidden cleat system the maker can spec for you.",
          "Stand-offs (small spacers that hold the piece off the wall by 1/2\" to 2\") aren't just aesthetic. They let air flow behind the piece, which prevents moisture trapping that causes rust on steel and rot on wood. They also let the piece breathe with temperature swings — a metal sign bolted flush to wood siding can buckle the siding as the metal expands in summer heat. Ask the maker to include stand-offs unless the design specifically calls for flush mounting.",
        ],
      },
      {
        heading: "Sealing and protecting the mounting point",
        paragraphs: [
          "Every hole you drill through siding or masonry is a potential water-entry point. After drilling, fill the hole with a dab of construction sealant (Loctite PL Premium, Big Stretch, or similar polyurethane caulk) BEFORE driving the anchor. The sealant flows around the anchor as it goes in and seals the hole permanently.",
          "On metal signs, dab clear-coat or paint over the anchor head once it's installed. The bare-steel head of a stainless lag bolt looks fine on day one but rust-bleeds on the powder-coat finish over winter cycles. A drop of touch-up paint or clear-coat on top of the anchor head stops the bleed before it starts.",
        ],
      },
      {
        heading: "Wind, weight, and worst-case loading",
        paragraphs: [
          "Outdoor pieces don't just hang at their dead weight — they pull against the wall during wind gusts. A 30-pound metal sign in a 60-mph gust can apply 150+ pounds of force to its anchors momentarily. The fix is conservative anchoring (use the manufacturer's load rating divided by 4 as your design ceiling) and orienting the piece so the wind load is parallel to the wall, not perpendicular to it.",
          "If you're hanging a piece in a coastal high-wind area, hurricane-prone zone, or above a doorway where a fall would cause injury, ask the maker about a hidden steel cleat system. Cleats distribute load across a much larger anchor footprint and prevent the piece from pulling off the wall as a single unit.",
        ],
      },
      {
        heading: "Maintenance schedule that keeps things tight",
        paragraphs: [
          "Once a year, walk every outdoor piece and check four things: are the anchors still tight (a quick quarter-turn with a wrench), is the sealant intact around the anchor heads, is the finish on the piece still continuous (no chips exposing bare metal), and is there any sag or drift in the mounting position. Anything you spot in a 5-minute annual walk is 100x easier to fix than the failure that comes from ignoring it for three years.",
          "Heavy outdoor pieces — anything over 50 pounds — deserve a quick re-tightening every spring after winter cycles. Cold contraction can loosen anchors that were torqued correctly when warm. A quarter-turn of preload back into the system extends the life of the install by decades.",
        ],
      },
    ],
    faqs: [
      {
        q: "Will my Crafters Market piece ship with the mounting hardware?",
        a: "Standard mounting hardware (anchors appropriate for the substrate you specified in the brief) ships with every custom piece. If you didn't specify a substrate, the maker will include a generic kit and an installation guide. If you need specialty hardware (hurricane-rated anchors, custom standoffs, hidden cleats), tell the maker before they finalize the build; most will source the hardware for you at cost.",
      },
      {
        q: "Can I install a large piece myself?",
        a: "Most signs under 30 pounds and 36 inches across are a confident-homeowner DIY install with a hammer drill, a level, and a helper. Anything over 50 pounds, anything over 4 feet wide, or anything mounting on stucco or stone is worth hiring a licensed sign installer or a handyman with a power tool collection. The install cost is usually 10-25% of the sign cost and prevents a failure that could damage the piece or the wall.",
      },
      {
        q: "What's the best mounting for a freestanding ranch entry sign?",
        a: "Welded steel posts in concrete footings, 30+ inches deep below the frost line for your zone. The sign bolts to the posts with through-bolts and lock nuts (never wood screws — those work loose in steel). The maker fabricates the sign panel + post system as a kit and you install on-site; some makers in your region will also handle the install for an additional fee. Ask in the message thread.",
      },
      {
        q: "How do I hang a sign on stucco without cracking it?",
        a: "Pre-drill with a masonry bit one size smaller than your anchor, use a hammer drill on rotary-only mode (not hammer mode for the first 1/4 inch — that's where stucco cracks). Pack the hole with sealant before driving the anchor. Use a vibration-damping anchor if available. If the stucco is over wood lath, your anchor needs to reach the structural framing behind it; surface anchors in stucco alone will pull out under load.",
      },
      {
        q: "Do I need to repaint or seal the wall around the sign?",
        a: "Not the wall — but DO touch up the sign finish around the anchor heads once installed (see the section above). If you ever remove the sign, you'll have anchor holes to patch with appropriate filler (wood filler for siding, mortar repair for masonry, stucco patch for stucco). Most installs that look right do so because of attention to the small details at the anchor point, not because of expensive hardware.",
      },
    ],
    relatedLinks: [
      { to: "/outdoor-metal-decor", label: "Outdoor Metal Decor", blurb: "Browse weatherproofed outdoor pieces." },
      { to: "/custom-metal-signs", label: "Custom Metal Signs", blurb: "Commission a custom outdoor sign." },
      { to: "/custom-ranch-signs", label: "Custom Ranch Signs", blurb: "Large-format ranch entry pieces." },
      { to: "/guides/plasma-vs-laser-vs-router", label: "Plasma vs Laser vs Router", blurb: "Pick the right technique before the install." },
      { to: "/guides/metal-gauge-finish-guide", label: "Metal Gauge & Finish Guide", blurb: "Match the gauge and finish to your climate." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "The 5-step commission flow." },
    ],
  },

  "metal-gauge-finish-guide": {
    slug: "metal-gauge-finish-guide",
    title: "Metal Gauge & Finish Guide: Picking the Right Spec for Your Piece",
    eyebrow: "Guide · Materials",
    h1: "Metal Gauge & Finish Guide.",
    intro:
      "Material gauge and surface finish are the two specs that decide whether your custom metal piece looks great for 6 months or 60 years. Here's the practical buyer's guide — what the numbers mean, what to ask for, and what makers wish you knew before you wrote the brief.",
    publishedAt: "2026-05-30",
    sections: [
      {
        heading: "Steel gauge: thicker isn't always better",
        paragraphs: [
          "Steel sheet thickness is measured in gauges (smaller numbers = thicker steel) up to about 11-gauge, then in fractions of an inch above that. 20-gauge is roughly the thickness of a tin can. 14-gauge is roughly 0.075 inches. 11-gauge is 1/8 inch. 1/4-inch plate is the heaviest material most makers will laser- or plasma-cut without switching to a heavier industrial machine.",
          "For most wall art and indoor signs, 16- to 14-gauge is the sweet spot — substantial enough to feel like real steel in your hands, thin enough to keep the piece's weight manageable for shipping and hanging. Outdoor signs in 14-gauge through 11-gauge are durable and won't warp from temperature cycling. Ranch entry signs and architectural pieces start at 1/8 inch (11-gauge equivalent) and go up to 1/4 inch for true heirloom durability.",
        ],
      },
      {
        heading: "When to step up the gauge",
        paragraphs: [
          "Three signals tell you to ask for a thicker gauge than the maker's default: the piece is destined for outdoors in a high-wind or coastal area (step up to 1/8 inch minimum), the piece is over 24 inches in its longest dimension (thinner gauges visibly wave at that scale), or the piece will be mounted unsupported in the middle (a long horizontal sign with anchors only at the ends needs more gauge to stay flat).",
          "Conversely, three signals tell you the maker's default is fine: the piece is indoor-only, the longest dimension is under 24 inches, and the design uses bold negative space (large open areas) rather than thin connecting webs. In that regime, going thicker just adds weight and shipping cost without improving the result.",
        ],
      },
      {
        heading: "Powder-coat vs paint vs clear-coat vs raw patina",
        paragraphs: [
          "Powder-coat is the industry standard for durable outdoor metal finishes. The piece is sprayed with charged dry powder pigment, then baked in an oven until the powder melts into a continuous polymer coating. The result is a 5-7+ year UV-stable, chip-resistant finish in any of 300+ color options through systems like Prismatic, TIGER Drylac, and Cardinal. Tell the maker the RAL number or Pantone you want and they'll match it. Powder-coat IS the right choice for outdoor signs, mailboxes, ranch art, and anything that lives in weather.",
          "Wet paint (industrial enamel, automotive 2K urethane) is faster, often cheaper, and easier to color-match exactly. It lasts 3-5 years outdoors before needing touch-up versus powder-coat's 5-7+ years. Best for indoor pieces or pieces where a specific color match (e.g., to existing trim) trumps weather durability.",
          "Clear-coat over raw steel is the high-style finish: the piece is sanded to a specific texture, hit with a sealed patina or kept raw, then coated with a UV-stable clear lacquer or 2K clear urethane. Industrial, dark, gallery-worthy. Lasts indefinitely indoors; outdoor durability depends entirely on the clear-coat quality (ask the maker which system they use). Recoat every 5-10 years for outdoor pieces.",
          "Raw patina is the lowest-maintenance \"finish\" — the steel is allowed to develop a controlled rust layer (forced with hydrogen peroxide and salt, or just left to weather naturally) and then sealed with a flat clear or oil. Looks like reclaimed industrial salvage; ages beautifully. Best for outdoor decorative pieces where you WANT the warm orange-brown patina; not ideal for crisp graphic signs or anything that needs to read sharp at distance.",
        ],
      },
      {
        heading: "Aluminum and copper specs",
        paragraphs: [
          "Aluminum is lighter, doesn't rust, and finishes well — anodized or powder-coated aluminum is common for marine-environment signs (coastal homes, dock signs, boat-house pieces) where steel would corrode. Aluminum gauge runs lighter than steel; 1/8-inch aluminum is about as stiff as 16-gauge steel and weighs less than half as much. Aluminum doesn't develop the same rich patina as steel — it tends to dull rather than develop character — so the finish carries more of the visual weight.",
          "Copper is the high-end choice for signs and decorative pieces. Develops a living patina (green-blue verdigris over years of weathering) that many buyers want and most makers can accelerate-and-seal in-shop. Copper is roughly 3x the material cost of steel for the same gauge, but the result is unique enough that it's often worth the upgrade for signature pieces.",
        ],
      },
      {
        heading: "Spec your brief like a pro",
        paragraphs: [
          "When you write the custom-order brief, three sentences cover most of what the maker needs:",
        ],
        list: [
          "Material: \"14-gauge mild steel\" or \"1/8-inch aluminum\" or \"1/16-inch copper sheet.\"",
          "Finish: \"Black powder-coat (RAL 9005)\" or \"Sealed raw patina\" or \"Matte clear-coat over brushed finish.\"",
          "Mounting context: \"Outdoor, mounted on cedar siding\" or \"Indoor, freestanding on a shelf\" or \"Coastal, salt-air exposure.\"",
        ],
      },
    ],
    faqs: [
      {
        q: "What gauge do I need for an outdoor address sign?",
        a: "14-gauge mild steel is the standard floor. If the sign is over 24 inches in its longest dimension, step up to 1/8-inch (11-gauge equivalent). If you're in a high-wind area or hurricane-prone region, ask for 3/16-inch and stand-offs to let wind pass through the design. Don't go below 16-gauge for any outdoor application — you'll get visible warping within the first temperature-cycle season.",
      },
      {
        q: "Will my powder-coat fade in the sun?",
        a: "Industrial powder-coat systems are rated for 5-7+ years of UV exposure before noticeable fade. Dark colors (black, navy, deep red) hold their saturation longer than light or bright colors (white, yellow, sky blue). If you're hanging a piece in direct south-facing sun in a high-UV region (Southwest, Florida, high altitude), expect to recoat or live with some fade after 7-10 years. \"Lifetime\" finish claims should be treated with skepticism — UV degrades every organic polymer eventually.",
      },
      {
        q: "How do I tell the maker exactly what color I want?",
        a: "Three good ways: (1) Send a RAL number — the international color standard powder-coat shops use. RAL 9005 = jet black, RAL 9016 = traffic white, RAL 3020 = traffic red, and so on. (2) Send a Pantone number — a custom-mix powder-coat run can match Pantone, with a small surcharge for the custom batch. (3) Send a photo or physical sample — your maker can hold it up to their color samples and pick the closest standard. Worst option: \"like a barn red\" — leaves too much room for mismatch.",
      },
      {
        q: "Can I get a piece in two colors or with details in a different finish?",
        a: "Yes — multi-color powder-coat requires masking each color and a separate bake for each, so there's a small surcharge per additional color. Some shops also do two-tone with mixed techniques (raw-patina base + powder-coat lettering, for example). Tell the maker exactly what you want and they'll quote the additional setup cost.",
      },
      {
        q: "What's the lowest-maintenance outdoor finish?",
        a: "Sealed raw patina on cor-ten or weathering steel. Cor-ten naturally develops a stable rust layer that protects the steel underneath and stops further corrosion at that surface depth. A single sealed coat lasts decades with no recoating. Trade-off: you live with the rust-orange-brown color, which doesn't suit every design. For low-maintenance + saturated color, anodized aluminum is the alternative — anodizing IS the finish, baked into the metal, and lasts the life of the piece.",
      },
    ],
    relatedLinks: [
      { to: "/custom-metal-signs", label: "Custom Metal Signs", blurb: "Browse plasma- and laser-cut metal signs." },
      { to: "/outdoor-metal-decor", label: "Outdoor Metal Decor", blurb: "Weatherproofed outdoor pieces by gauge and finish." },
      { to: "/custom-ranch-signs", label: "Custom Ranch Signs", blurb: "Heavy-gauge ranch entry signs and property markers." },
      { to: "/guides/plasma-vs-laser-vs-router", label: "Plasma vs Laser vs Router", blurb: "Choose the technique to match the gauge." },
      { to: "/guides/outdoor-mounting-guide", label: "Outdoor Mounting Guide", blurb: "Mount the piece to match the spec." },
      { to: "/how-custom-orders-work", label: "How Custom Orders Work", blurb: "The 5-step commission flow." },
    ],
  },
};

export const GUIDE_SLUGS = Object.keys(GUIDES);
