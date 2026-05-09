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

export const MAX_IMAGES = 8;
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
  processing_time: "1-3 business days",
  accept_returns: false, accept_exchanges: false,
  seo_tags: [], seo_input: "",
  contact_email: "",
  // Backorders — `null` means inherit from maker.accepts_backorders_default
  accepts_backorders: null,
  backorder_lead_weeks: null,
  status: "draft",
});
