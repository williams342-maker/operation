// Reference enums + empty-form factory for the Listing Editor.
// Pulled out of the parent component so the orchestrator file stays focused
// on state/effects/handlers and so individual section components can import
// just what they need without round-tripping through the parent.

// Listing categories. Ordered roughly by buyer demand on the marketplace
// (Wall Art / Custom Signs first; niche buckets later) so the dropdown is
// faster to scan for the most common cases. Adding a new value here is
// non-breaking — `Product.category` is a free-form string in the backend
// (see `models.py`), so historical listings keep working.
//
// Keep "Other" pinned to the bottom as the catch-all.
export const CATEGORIES = [
  "Wall Art",
  "Custom Signs",
  "Outdoor Art",
  "Home Decor",
  "Wedding Gifts",
  "Business Signage",
  "Address Numbers",
  "Lighting & Lamps",
  "Garden & Yard Art",
  "Memorial & Tribute",
  "Furniture",
  "Kitchen & Bar",
  "Sculpture",
  // iter330 — Broadened "Jewelry" → "Jewelry & Wearables" to cover
  // necklaces + rings + earrings + cufflinks + belt buckles + key chains
  // + money clips + leather wallets + embroidered patches + apparel.
  // The Product.category field is a free-form string so historical
  // listings tagged "Jewelry" continue to render — feeds.py + checkout.py
  // do prefix/substring matches that still hit both labels.
  "Jewelry & Wearables",
  "Holiday & Seasonal",
  "Other",
];
export const TECHNIQUES = ["PLASMA", "LASER", "ROUTER", "FORGE", "CUSTOM"];

// iter331 — Per-category default shipping rates, mirrored 1:1 with
// `SHIPPING_BY_CATEGORY` in /app/backend/routers/checkout.py. Used by
// the listing editor to show makers what flat ship rate buyers will
// see at checkout when no custom `shipping_domestic_usd` is set.
// MUST stay in sync with the backend — there's no API endpoint to
// fetch this dynamically (it's a 14-entry static map). If you change
// one, change both.
export const SHIPPING_DEFAULTS = {
  "Wall Art": 25.0,
  "Custom Signs": 35.0,
  "Outdoor Art": 55.0,
  "Home Decor": 25.0,
  "Wedding Gifts": 20.0,
  "Business Signage": 45.0,
  "Address Numbers": 20.0,
  "Lighting & Lamps": 35.0,
  "Garden & Yard Art": 55.0,
  "Memorial & Tribute": 25.0,
  "Furniture": 95.0,
  "Kitchen & Bar": 25.0,
  "Sculpture": 65.0,
  "Jewelry & Wearables": 8.0,
  "Holiday & Seasonal": 25.0,
};
export const SHIPPING_FALLBACK = 30.0;

// Human-readable carrier hint — derived from the preset table so the
// chip label and the picker stay perfectly aligned.
export function shippingHintForCategory(cat) {
  const presetId = defaultPresetIdForCategory(cat);
  const preset = SHIPPING_PRESETS.find((p) => p.id === presetId);
  if (!preset) return "";
  return `${preset.label} ($${preset.cost.toFixed(2)})`;
}

// iter332 — Carrier shipping presets. Each preset captures the
// canonical packed dimensions + weight assumption + cost for a USPS
// or UPS service tier. Clicking the chip-as-button in the listing
// editor pops a picker and fills the `packed_*` + `weight_*` fields
// + sets `shipping_domestic_usd` to the listed cost.
//
// Dimensions are USPS / UPS published box specs. Weight assumptions
// are conservative defaults makers can override per-listing — if you
// don't know your weight, "average filled" is a safer guess than
// blank (Shippo rejects blank weight).
//
// Stays in sync with backend `SHIPPING_BY_CATEGORY` (checkout.py) by
// matching the per-category default dollar amount when applicable.
export const SHIPPING_PRESETS = [
  {
    id: "envelope",
    label: "USPS first-class envelope",
    blurb: "Jewelry · patches · flat lightweight",
    length: 9.5, width: 6, height: 0.25,
    weight_lbs: 0, weight_oz: 4,
    cost: 8.0,
  },
  {
    id: "small_box",
    label: "USPS Priority small flat-rate box",
    blurb: "Trinkets · address numbers · small wall art",
    length: 8.625, width: 5.375, height: 1.625,
    weight_lbs: 0, weight_oz: 12,
    cost: 25.0,
  },
  {
    id: "medium_box",
    label: "USPS Priority medium flat-rate box",
    blurb: "Mid-size wall art · custom signs · home decor",
    length: 11, width: 8.5, height: 5.5,
    weight_lbs: 2, weight_oz: 0,
    cost: 35.0,
  },
  {
    id: "large_box",
    label: "USPS Priority large flat-rate box",
    blurb: "Bigger signs · clustered orders · framed art",
    length: 12, width: 12, height: 5.5,
    weight_lbs: 5, weight_oz: 0,
    cost: 45.0,
  },
  {
    id: "ups_ground",
    label: "UPS Ground · oversized",
    blurb: "Outdoor sculpture · large yard art · clocks",
    length: 24, width: 18, height: 12,
    weight_lbs: 12, weight_oz: 0,
    cost: 65.0,
  },
  {
    id: "freight",
    label: "Freight / LTL · heavy",
    blurb: "Furniture · multi-piece installations · entry signs",
    length: 48, width: 30, height: 24,
    weight_lbs: 75, weight_oz: 0,
    cost: 95.0,
  },
];

// Map a category's flat shipping cost back to the closest preset id so
// the chip can open the picker with the "right" preset pre-highlighted.
export function defaultPresetIdForCategory(cat) {
  const usd = SHIPPING_DEFAULTS[cat] ?? SHIPPING_FALLBACK;
  if (usd <= 10) return "envelope";
  if (usd <= 25) return "small_box";
  if (usd <= 45) return "medium_box";
  if (usd <= 60) return "large_box";
  if (usd <= 80) return "ups_ground";
  return "freight";
}
export const WHO_MADE_IT = [
  ["i_made_it", "I made it"],
  ["shop_member", "A member of my shop"],
  ["another_company", "Another company or person"],
];
export const CONDITIONS = [
  ["new", "New"],
  ["made_to_order", "Made to order"],
  ["vintage", "Vintage"],
  ["refurbished", "Refurbished"],
];
export const DIM_UNITS = ["in", "cm"];
export const COLORS = [
  "Black", "White", "Gray", "Silver", "Gold", "Bronze", "Copper", "Red", "Orange",
  "Yellow", "Green", "Blue", "Purple", "Pink", "Brown", "Beige", "Natural",
  "Multi-color", "Rainbow", "Custom color",
];
export const OCCASIONS = [
  "Birthday", "Wedding", "Anniversary", "Housewarming", "Christmas", "Father's Day",
  "Mother's Day", "Valentine's Day", "Graduation", "Baby Shower", "Just Because",
  "Holiday", "Memorial",
];
export const PROCESSING_TIMES = [
  "1-3 business days", "3-5 business days", "1-2 weeks", "2-4 weeks",
  "4-6 weeks", "6-8 weeks", "Custom — see description",
];
export const DELIVERY_RANGES = [
  "3-5 business days", "5-7 business days", "7-10 business days",
  "10-14 business days", "2-4 weeks",
];
export const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Other"];

// Google Product Category preset breadcrumb paths — mirror the
// `_google_product_category` mapper in `backend/routers/pinterest_feed.py`
// plus extra CNC-relevant leaves. Pinterest/Google reject any path ≤ 2
// levels deep (alert 126) so every entry here is ≥ 3 levels. Makers can
// also paste any verbatim path from
// https://www.google.com/basepages/producttype/taxonomy.en-US.txt
// — the combobox accepts freeform input alongside presets.
export const GPC_PRESETS = [
  // Home & Garden — the bucket most CNC/laser/plasma pieces land in.
  "Home & Garden > Decor > Signs",
  "Home & Garden > Decor > Address Signs",
  "Home & Garden > Decor > House Numbers & Letters",
  "Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork",
  "Home & Garden > Decor > Artwork > Sculptures & Statues",
  "Home & Garden > Decor > Wall Decor",
  "Home & Garden > Decor > Clocks",
  "Home & Garden > Decor > Mirrors",
  "Home & Garden > Decor > Ornaments",
  "Home & Garden > Decor > Music Boxes",
  "Home & Garden > Decor > Picture Frames",
  "Home & Garden > Decor > Plaques",
  "Home & Garden > Decor > Vases",
  "Home & Garden > Decor > Wreaths",
  "Home & Garden > Decor > Candles",
  "Home & Garden > Decor > Candle Holders",
  "Home & Garden > Decor > Decorative Bottles",
  "Home & Garden > Decor > Decorative Bowls",
  "Home & Garden > Decor > Decorative Trays",
  "Home & Garden > Decor > Hourglasses",
  "Home & Garden > Decor > Trunks",
  "Home & Garden > Decor > World Globes",
  "Home & Garden > Decor > Wind Chimes",
  "Home & Garden > Decor > Bird & Wildlife Feeders",
  "Home & Garden > Decor > Bird & Wildlife House Accessories",
  "Home & Garden > Decor > Bird & Wildlife Houses",
  "Home & Garden > Decor > Flag & Windsock Accessories",
  "Home & Garden > Decor > Flags & Windsocks",
  "Home & Garden > Decor > Home Fragrances",
  // Kitchen & Dining
  "Home & Garden > Kitchen & Dining > Tableware > Serveware > Serving Boards",
  "Home & Garden > Kitchen & Dining > Tableware > Serveware > Serving Trays",
  "Home & Garden > Kitchen & Dining > Tableware > Serveware > Pitchers & Carafes",
  "Home & Garden > Kitchen & Dining > Tableware > Drinkware",
  "Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs",
  "Home & Garden > Kitchen & Dining > Tableware > Drinkware > Wine Glasses",
  "Home & Garden > Kitchen & Dining > Tableware > Dinnerware > Plates",
  "Home & Garden > Kitchen & Dining > Tableware > Flatware",
  "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Cutting Boards",
  "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Coasters",
  "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Knife Blocks",
  "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Spice Grinders",
  "Home & Garden > Kitchen & Dining > Barware > Bar Tools & Accessories",
  "Home & Garden > Kitchen & Dining > Barware > Bottle Caps",
  "Home & Garden > Kitchen & Dining > Barware > Wine Racks",
  // Outdoor / Lawn & Garden (the "outdoor" bucket from the user request)
  "Home & Garden > Lawn & Garden > Outdoor Living > Outdoor Decor",
  "Home & Garden > Lawn & Garden > Outdoor Living > Garden Art",
  "Home & Garden > Lawn & Garden > Outdoor Living > Address Plaques",
  "Home & Garden > Lawn & Garden > Outdoor Living > Hammock Parts & Accessories",
  "Home & Garden > Lawn & Garden > Outdoor Living > Hammocks",
  "Home & Garden > Lawn & Garden > Outdoor Living > Porch Swings",
  "Home & Garden > Lawn & Garden > Gardening > Composting > Compost",
  "Home & Garden > Lawn & Garden > Gardening > Pots & Planters",
  "Home & Garden > Lawn & Garden > Gardening > Plant Stands",
  "Home & Garden > Lawn & Garden > Gardening > Garden Stakes",
  "Home & Garden > Lawn & Garden > Gardening > Plant Markers & Stakes",
  "Home & Garden > Lawn & Garden > Snow Removal > Ice Scrapers & Snow Brushes",
  // Linens / Bedding
  "Home & Garden > Linens & Bedding > Towels",
  "Home & Garden > Linens & Bedding > Bedding > Pillows",
  "Home & Garden > Linens & Bedding > Table Linens > Placemats",
  "Home & Garden > Linens & Bedding > Table Linens > Tablecloths",
  // Lighting
  "Home & Garden > Lighting > Lamps",
  "Home & Garden > Lighting > Light Bulbs",
  "Home & Garden > Lighting > Light Ropes & Strings",
  "Home & Garden > Lighting > Night Lights",
  "Home & Garden > Lighting > Lamp Shades",
  "Home & Garden > Lighting > Picture Lights",
  "Home & Garden > Lighting > Track Lighting",
  "Home & Garden > Lighting > Chandeliers",
  // Bathroom
  "Home & Garden > Bathroom Accessories > Bath Mats & Rugs",
  "Home & Garden > Bathroom Accessories > Soap Dispensers",
  "Home & Garden > Bathroom Accessories > Toothbrush Holders",
  "Home & Garden > Bathroom Accessories > Towel Racks & Holders",
  // Furniture
  "Furniture > Tables > Accent Tables",
  "Furniture > Tables > Coffee Tables",
  "Furniture > Tables > End Tables",
  "Furniture > Tables > Dining Tables",
  "Furniture > Tables > Console Tables",
  "Furniture > Tables > Kotatsu Tables",
  "Furniture > Shelving > Wall Shelves & Ledges",
  "Furniture > Shelving > Bookcases & Standing Shelves",
  "Furniture > Cabinets & Storage > Storage Cabinets",
  "Furniture > Cabinets & Storage > Magazine Racks",
  "Furniture > Cabinets & Storage > Hutches",
  "Furniture > Chairs",
  "Furniture > Benches",
  "Furniture > Beds & Accessories > Headboards & Footboards",
  // Jewelry
  "Apparel & Accessories > Jewelry > Necklaces",
  "Apparel & Accessories > Jewelry > Bracelets",
  "Apparel & Accessories > Jewelry > Earrings",
  "Apparel & Accessories > Jewelry > Rings",
  "Apparel & Accessories > Jewelry > Pins",
  "Apparel & Accessories > Jewelry > Anklets",
  "Apparel & Accessories > Jewelry > Charms & Pendants",
  "Apparel & Accessories > Jewelry > Jewelry Sets",
  "Apparel & Accessories > Jewelry > Watches",
  // Apparel accessories — engraved keychains, money clips, etc.
  "Apparel & Accessories > Clothing Accessories > Belt Buckles",
  "Apparel & Accessories > Clothing Accessories > Cufflinks",
  "Apparel & Accessories > Clothing Accessories > Tie Clips",
  "Apparel & Accessories > Handbag & Wallet Accessories > Keychains",
  "Apparel & Accessories > Handbag & Wallet Accessories > Money Clips",
  // Office & business signage
  "Office Supplies > Office Equipment > Desk Organizers",
  "Office Supplies > Desk Pads & Blotters",
  "Office Supplies > General Office Supplies > Bookends",
  "Office Supplies > General Office Supplies > Business Card Stands",
  "Office Supplies > General Office Supplies > Pen & Pencil Cases",
  "Office Supplies > Filing & Organization > Card Files",
  "Business & Industrial > Signage",
  "Business & Industrial > Retail > Retail Display Cases",
  "Business & Industrial > Food Service > Food Service Signs",
  "Business & Industrial > Work Safety Protective Gear > Hard Hats",
  // Arts & entertainment / gifts / seasonal / celebration
  "Arts & Entertainment > Hobbies & Creative Arts > Arts & Crafts",
  "Arts & Entertainment > Hobbies & Creative Arts > Musical Instruments",
  "Arts & Entertainment > Hobbies & Creative Arts > Musical Instrument & Orchestra Accessories",
  "Arts & Entertainment > Party & Celebration > Special Occasion Decor",
  "Arts & Entertainment > Party & Celebration > Gift Giving > Gift Cards & Certificates",
  "Arts & Entertainment > Party & Celebration > Gift Giving > Greeting & Note Cards",
  "Arts & Entertainment > Party & Celebration > Gift Giving > Gift Wrapping",
  "Arts & Entertainment > Party & Celebration > Party Supplies > Banners",
  "Arts & Entertainment > Party & Celebration > Party Supplies > Cake Toppers",
  "Arts & Entertainment > Party & Celebration > Trophies & Awards",
  // Weddings — explicitly called out by the user.
  "Arts & Entertainment > Party & Celebration > Special Occasion Decor > Wedding Decor",
  "Arts & Entertainment > Party & Celebration > Special Occasion Decor > Wedding Guest Books",
  "Arts & Entertainment > Party & Celebration > Special Occasion Decor > Wedding Cake Toppers",
  // Seasonal — Christmas, Hanukkah, Halloween, etc.
  "Home & Garden > Decor > Seasonal & Holiday Decorations",
  "Home & Garden > Decor > Seasonal & Holiday Decorations > Christmas Tree Stands",
  "Home & Garden > Decor > Seasonal & Holiday Decorations > Holiday Ornament Displays & Stands",
  "Home & Garden > Decor > Seasonal & Holiday Decorations > Holiday Ornaments",
  "Home & Garden > Decor > Seasonal & Holiday Decorations > Holiday Stocking Hangers",
  "Home & Garden > Decor > Seasonal & Holiday Decorations > Holiday Stockings",
  "Home & Garden > Decor > Seasonal & Holiday Decorations > Menorahs",
  "Home & Garden > Decor > Seasonal & Holiday Decorations > Nativity Sets",
  // Toys / kids
  "Toys & Games > Toys > Educational Toys",
  "Toys & Games > Toys > Wooden Toys",
  "Toys & Games > Toys > Building Toys",
  "Toys & Games > Toys > Puzzles",
  "Toys & Games > Toys > Toy Vehicles",
  "Toys & Games > Toys > Play Vehicles",
  "Toys & Games > Toys > Dollhouse Accessories",
  "Toys & Games > Toys > Dolls, Playsets & Toy Figures",
  "Toys & Games > Outdoor Play Equipment > Sandboxes",
  "Toys & Games > Outdoor Play Equipment > Swing Sets & Playsets",
  // Pet supplies
  "Animals & Pet Supplies > Pet Supplies > Pet ID Tags",
  "Animals & Pet Supplies > Pet Supplies > Dog Supplies > Dog Beds",
  "Animals & Pet Supplies > Pet Supplies > Dog Supplies > Dog Bowl Stands",
  "Animals & Pet Supplies > Pet Supplies > Dog Supplies > Dog Houses",
  "Animals & Pet Supplies > Pet Supplies > Cat Supplies > Cat Beds",
  "Animals & Pet Supplies > Pet Supplies > Pet Memorials & Urns",
  // Sporting / outdoors / camping
  "Sporting Goods > Outdoor Recreation > Camping & Hiking > Camping Tools",
  "Sporting Goods > Outdoor Recreation > Camping & Hiking > Hammocks",
  "Sporting Goods > Outdoor Recreation > Fishing > Fishing Tools",
  "Sporting Goods > Outdoor Recreation > Boating & Water Sports",
  "Sporting Goods > Outdoor Recreation > Cycling > Bicycle Accessories",
  "Sporting Goods > Indoor Games > Billiards > Billiard Cue Racks",
  "Sporting Goods > Indoor Games > Dartboards",
  // Automotive — explicitly called out by the user.
  "Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Exterior > Motor Vehicle Emblems",
  "Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Exterior > Motor Vehicle License Plate Frames",
  "Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Interior Fittings",
  "Vehicles & Parts > Vehicle Parts & Accessories > Watercraft Parts & Accessories",
  // Hardware / tools — for CNC fixtures, jigs, custom bit holders, etc.
  "Hardware > Tools > Hand Tool Accessories",
  "Hardware > Tools > Tool Storage & Organization",
  "Hardware > Hardware Accessories > Cabinet Hardware > Cabinet & Furniture Knobs",
  "Hardware > Hardware Accessories > Cabinet Hardware > Cabinet & Furniture Pulls",
  // Religious — crosses, prayer plaques.
  "Religious & Ceremonial > Religious Items > Religious Veils",
];

export const MAX_IMAGES = 10;
export const MAX_TAGS = 13;

export const emptyForm = () => ({
  title: "", category: CATEGORIES[0], technique: TECHNIQUES[0],
  description: "", price: "", in_stock: 1,
  images: [], video_url: "",
  who_made_it: "i_made_it", condition: "new",
  length_in: "", width_in: "", height_in: "", dim_unit: "in",
  weight_lbs: 0, weight_oz: 0,
  colors: [], occasions: [],
  materials: [], materials_input: "",
  variants: [], variant_axis1_name: "", variant_axis2_name: "",
  // iter364 — Nested variation categories (Color × Engraving…). Combos
  // generated from these land in `variants` with `option_ids` set.
  variant_groups: [],
  personalization_enabled: false, personalization_instructions: "",
  // iter364 — buyer MUST attach ≥1 photo before add-to-cart when true.
  personalization_requires_upload: false,
  free_shipping: false,
  shipping_domestic_usd: "", shipping_international_usd: "",
  shipping_carrier: "", shipping_est_delivery: "",
  packed_length_in: "", packed_width_in: "", packed_height_in: "",
  processing_time: "Made to order · 1-2 weeks",
  accept_returns: false, accept_exchanges: false,
  seo_tags: [], seo_input: "",
  // Google Product Category override — verbatim breadcrumb path. Empty
  // string ⇒ feeds auto-derive from category. See backend pinterest_feed.py.
  gpc_path: "",
  contact_email: "",
  // Backorders — `null` means inherit from maker.accepts_backorders_default
  accepts_backorders: null,
  backorder_lead_weeks: null,
  // Etsy-style listing renewal: "automatic" (scheduler keeps it live) vs
  // "manual" (flips to draft on expiry). Default to automatic so the
  // listing keeps earning unless the maker deliberately opts out.
  renewal_option: "automatic",
  // iter327 — Digital/hybrid listings. "physical" by default (legacy
  // behaviour). Switching to "digital" or "both" unlocks the file
  // upload card and hides irrelevant shipping fields.
  listing_type: "physical",
  digital_files: [],
  status: "draft",
});
