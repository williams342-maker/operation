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
  "Jewelry",
  "Holiday & Seasonal",
  "Other",
];
export const TECHNIQUES = ["PLASMA", "LASER", "ROUTER", "FORGE", "CUSTOM"];
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
  "Yellow", "Green", "Blue", "Purple", "Brown", "Beige", "Natural", "Multi-color",
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
  "Home & Garden > Kitchen & Dining > Tableware > Serveware > Serving Boards",
  "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Cutting Boards",
  "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Coasters",
  "Home & Garden > Kitchen & Dining > Tableware > Drinkware",
  "Home & Garden > Lawn & Garden > Outdoor Living > Outdoor Decor",
  "Home & Garden > Lawn & Garden > Outdoor Living > Garden Art",
  "Home & Garden > Linens & Bedding > Towels",
  "Home & Garden > Lighting > Lamps",
  "Home & Garden > Lighting > Light Bulbs",
  "Home & Garden > Lighting > Light Ropes & Strings",
  "Home & Garden > Lighting > Night Lights",
  // Furniture
  "Furniture > Tables > Accent Tables",
  "Furniture > Tables > Coffee Tables",
  "Furniture > Tables > End Tables",
  "Furniture > Tables > Dining Tables",
  "Furniture > Shelving > Wall Shelves & Ledges",
  "Furniture > Shelving > Bookcases & Standing Shelves",
  "Furniture > Cabinets & Storage > Storage Cabinets",
  "Furniture > Chairs",
  // Jewelry
  "Apparel & Accessories > Jewelry > Necklaces",
  "Apparel & Accessories > Jewelry > Bracelets",
  "Apparel & Accessories > Jewelry > Earrings",
  "Apparel & Accessories > Jewelry > Rings",
  "Apparel & Accessories > Jewelry > Pins",
  // Office & business
  "Office Supplies > Office Equipment > Desk Organizers",
  "Office Supplies > Desk Pads & Blotters",
  "Business & Industrial > Signage",
  "Business & Industrial > Retail > Retail Display Cases",
  // Arts & entertainment
  "Arts & Entertainment > Hobbies & Creative Arts > Arts & Crafts",
  "Arts & Entertainment > Hobbies & Creative Arts > Musical Instruments",
  "Arts & Entertainment > Party & Celebration > Special Occasion Decor",
  // Toys / kids
  "Toys & Games > Toys > Educational Toys",
  "Toys & Games > Toys > Wooden Toys",
  // Pet supplies
  "Animals & Pet Supplies > Pet Supplies > Pet ID Tags",
  // Sporting / outdoors
  "Sporting Goods > Outdoor Recreation > Camping & Hiking > Camping Tools",
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
  personalization_enabled: false, personalization_instructions: "",
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
  status: "draft",
});
