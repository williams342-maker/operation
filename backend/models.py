"""Pydantic models shared across routers."""
import uuid
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from core import now_iso


class ProductVariant(BaseModel):
    """A SKU variant of a product (e.g. size/finish/color).
    Empty `variants` list ⇒ product has no variants (unchanged behavior).

    Optional two-axis support: `axis1` / `axis2` are short tags that, when
    present on every variant, let the buyer page render a 2D grid (e.g. size ×
    finish). When axes are blank, the UI falls back to a flat one-axis list.
    """
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    label: str                         # buyer-facing label, e.g. '24" Walnut'
    price_delta: float = 0.0           # added to base price (can be negative)
    in_stock: int = 0
    axis1: Optional[str] = None        # e.g. '24"' (size axis)
    axis2: Optional[str] = None        # e.g. 'Walnut' (finish axis)
    image: Optional[str] = None        # optional per-variant image URL


class Product(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    slug: str
    title: str
    category: str          # "Wall Art", "Custom Signs", "Outdoor Art"
    technique: str         # PLASMA, LASER, ROUTER, CUSTOM
    price: float
    description: str = ""           # safe default — older seed docs may be missing this
    materials: List[str] = []
    dimensions: Optional[str] = None
    images: List[str] = []
    model_url: Optional[str] = None   # 3D viewer (.glb / .gltf URL); optional
    video_url: Optional[str] = None   # short showcase video (mp4/webm/mov), max ~50MB
    maker_slug: str
    in_stock: int = 4
    featured: bool = False
    variants: List[ProductVariant] = []
    variant_axis1_name: Optional[str] = None   # e.g. "Size"
    variant_axis2_name: Optional[str] = None   # e.g. "Finish"
    status: str = "published"          # "published" | "draft" — drafts hidden from public catalog
    # ---- Etsy-style economics ----
    # Listings expire 4 months after publish; on expiry, status auto-flips to
    # "draft" and the maker can renew for `listing_fee_cents`.
    expires_at: Optional[str] = None
    promoted_until: Optional[str] = None  # ISO ts; if in the future, listing pinned
    auto_renew_promotion: bool = False  # if true, scheduler extends weekly
    deleted_at: Optional[str] = None  # soft-delete marker; hides from public views
    # ---- Item details (extended) ----
    who_made_it: Optional[str] = None       # "i_made_it" | "another_company" | "supplied_design"
    condition: Optional[str] = None         # "new" | "made_to_order" | "vintage" | "refurbished"
    # Structured dimensions — split out from the legacy `dimensions` string so
    # buyers can filter and the listing detail page can render a clean table.
    length_in: Optional[float] = None
    width_in: Optional[float] = None
    height_in: Optional[float] = None
    dim_unit: Optional[str] = "in"          # "in" | "cm"
    weight_lbs: Optional[float] = None
    weight_oz: Optional[float] = None
    colors: List[str] = []                  # e.g. ["black","copper"]
    occasions: List[str] = []               # e.g. ["wedding","housewarming"]
    # ---- Personalization ----
    personalization_enabled: bool = False
    personalization_instructions: Optional[str] = None
    # ---- Shipping ----
    free_shipping: bool = False
    shipping_domestic_usd: Optional[float] = None
    shipping_international_usd: Optional[float] = None
    shipping_carrier: Optional[str] = None
    shipping_est_delivery: Optional[str] = None  # e.g. "5-7 business days"
    processing_time: Optional[str] = None        # e.g. "1-3 business days"
    # Packed dimensions — distinct from the item's own dimensions because a
    # 24x18 wall sign might ship in a 30x24x4 cardboard mailer once it's
    # bubble-wrapped + corner-protected. Carriers price by packed size, not
    # the bare item, so we collect both.
    packed_length_in: Optional[float] = None
    packed_width_in: Optional[float] = None
    packed_height_in: Optional[float] = None
    # ---- Returns ----
    accept_returns: bool = False
    accept_exchanges: bool = False
    # ---- SEO ----
    seo_tags: List[str] = []                # max 13, validated in router
    # ---- Contact override (optional — defaults to maker email) ----
    contact_email: Optional[str] = None
    # ---- Backorders ----
    # When the listing is at 0 stock but still published, buyers see a
    # "Request backorder" CTA instead of "Sold out". The maker reviews
    # each request manually and confirms / declines. Payment is handled
    # off-platform (no auto-charge) per user choice 2b.
    #   • None  → inherit from maker.accepts_backorders_default
    #   • True  → backorders ON regardless of maker default
    #   • False → backorders OFF regardless of maker default
    accepts_backorders: Optional[bool] = None
    backorder_lead_weeks: Optional[int] = None  # set by maker; surfaced on the OOS pill
    # Denormalized from the maker on read — never stored on the product doc.
    # Lets ProductCard render the US-flag "Veteran-Owned" badge without a
    # second round-trip to /api/makers.
    maker_is_veteran: bool = False
    created_at: str = Field(default_factory=now_iso)


class MakerProductCreate(BaseModel):
    """Self-serve listing creation by a logged-in maker."""
    title: str
    slug: Optional[str] = None        # auto-derived from title if missing
    category: str
    technique: str
    price: float
    description: str
    materials: List[str] = []
    dimensions: Optional[str] = None
    images: List[str] = []
    model_url: Optional[str] = None
    video_url: Optional[str] = None
    in_stock: int = 4
    variants: List[ProductVariant] = []
    variant_axis1_name: Optional[str] = None
    variant_axis2_name: Optional[str] = None
    status: str = "published"          # accept "draft" to save without publishing
    # Extended item-detail fields (all optional, backwards compatible)
    who_made_it: Optional[str] = None
    condition: Optional[str] = None
    length_in: Optional[float] = None
    width_in: Optional[float] = None
    height_in: Optional[float] = None
    dim_unit: Optional[str] = "in"
    weight_lbs: Optional[float] = None
    weight_oz: Optional[float] = None
    colors: List[str] = []
    occasions: List[str] = []
    personalization_enabled: bool = False
    personalization_instructions: Optional[str] = None
    free_shipping: bool = False
    shipping_domestic_usd: Optional[float] = None
    shipping_international_usd: Optional[float] = None
    shipping_carrier: Optional[str] = None
    shipping_est_delivery: Optional[str] = None
    processing_time: Optional[str] = None
    packed_length_in: Optional[float] = None
    packed_width_in: Optional[float] = None
    packed_height_in: Optional[float] = None
    accept_returns: bool = False
    accept_exchanges: bool = False
    seo_tags: List[str] = []
    contact_email: Optional[str] = None
    # Backorder gating (see Product class for semantics)
    accepts_backorders: Optional[bool] = None
    backorder_lead_weeks: Optional[int] = None


class Maker(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    slug: str
    name: str
    initials: str
    location: str
    bio: str
    techniques: List[str] = []
    portrait: str
    cover: str
    email: Optional[EmailStr] = None
    listings_count: int = 0
    rating: float = 4.95
    # ---- Stripe Connect (Express) ----
    stripe_account_id: Optional[str] = None
    stripe_charges_enabled: bool = False
    stripe_payouts_enabled: bool = False
    stripe_details_submitted: bool = False
    # ---- Etsy-style subscription tier (Crafters Plus) ----
    # "free" or "active". "past_due" / "canceled" handled via webhook.
    subscription_status: str = "free"
    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    subscription_started_at: Optional[str] = None
    subscription_renews_at: Optional[str] = None
    # YYYY-MM → listings published that month (used to enforce Plus monthly quota)
    listings_by_month: dict = Field(default_factory=dict)
    # Plus-only: custom shop banner image (R2 URL)
    banner_image_url: Optional[str] = None
    # ---- Off-site ads attribution ----
    # When false (default), buyer orders that arrived via `?utm_source=external` get
    # an extra 12% off-site fee deducted from this maker's payout. Opt-out turns
    # the surcharge off (maker forgoes off-site promotion).
    external_ads_opt_out: bool = False
    # ---- Revenue model ledger (Etsy-style) ----
    # Lifetime number of listings created (counts published; not soft-deleted).
    # Free quota is 10 — beyond that, each listing/renewal accrues `listing_fee_cents`
    # to `pending_charges_cents`, debited from the next payout.
    listings_used_lifetime: int = 0
    pending_charges_cents: int = 0
    # Pre-paid listing credits — bought in packs via Stripe one-time checkout.
    # Burned BEFORE pending_charges accrue, in `accrue_listing_charge`.
    listing_credits: int = 0
    # Audit trail of charge events: [{kind, slug, amount_cents, ts, note}]
    charge_history: List[dict] = []
    # ---- Founding Seller Beta ----
    # Set to True when the applicant came through the /beta signup page OR
    # toggled on manually by an admin via /api/admin/makers/{slug}/beta.
    # When enabled, `beta_expires_at` is set to approved_at + 90 days so the
    # admin UI can render a live countdown. The toggle doesn't change fees
    # today — it's a signal flag carried on the maker doc that future code
    # (priority placement, Founding Seller badge, $0 listing fees during
    # beta) will read. Disabling clears both timestamps.
    is_beta: bool = False
    beta_approved_at: Optional[str] = None
    beta_expires_at: Optional[str] = None
    # ---- Veteran-Owned badge ----
    # Self-declared via Shop Manager → Settings → About your shop. When ON,
    # a US-flag "Veteran-Owned" badge renders on every listing card and the
    # maker's profile hero. Free / honor-system today; we may add doc upload
    # verification later (DoD DD-214 / VA proof).
    is_veteran_owned: bool = False
    # ---- Founders Tier (iter153) ----
    # "standard" | "founder"  — Plus is layered separately via
    # `subscription_status`. Founders get a 3% commission, 50 free
    # listings per month, a permanent ◆ Founding Maker badge and an
    # optional ◆ Beta Tester sub-badge for the original cohort.
    # `founder_status` is "inaugural" (lifetime, first 100) or "regular"
    # (12-month window with auto-roll to standard).
    tier: str = "standard"
    founder_status: Optional[str] = None       # "inaugural" | "regular" | None
    founder_started_at: Optional[str] = None
    founder_expires_at: Optional[str] = None   # None for inaugural / lifetime
    founder_grace_until: Optional[str] = None  # 14-day publish-or-lose
    founder_rolled_at: Optional[str] = None
    founder_grace_revoked_at: Optional[str] = None
    founder_number: Optional[int] = None       # monotonic, never reused
    is_beta_tester: bool = False
    # ---- Processing profiles (saved Etsy-style ship-time presets) ----
    # Custom turnaround presets (e.g. "Made to order · 5-7 weeks") that
    # the maker has saved in the Listing Editor's processing-time
    # picker. Persisted server-side so they carry over across devices
    # and browser sessions; the legacy localStorage value is migrated
    # on first PATCH after rollout.
    # Shape: [{id, kind, range}] — see ProcessingProfilePicker.jsx.
    processing_profiles: List[dict] = []
    # ---- Restock waitlist digest opt-out (iter113) ----
    # Default false → maker is opted IN to the weekly Sunday digest.
    # Toggling ON suppresses the email entirely (the cron filters them out).
    restock_digest_opt_out: bool = False
    # ---- Social momentum digest opt-out (iter149) ----
    # Weekly Monday email summarising how many times each listing was
    # shared (via the public Share button) in the past 7 days. Default
    # IN — flip ON to suppress.
    social_momentum_opt_out: bool = False
    # ---- Watermark on uploaded photos ----
    # When ON, every listing photo uploaded by this maker is watermarked
    # at upload time (tiled diagonal label + corner stamp with the shop's
    # name). Existing photos are not retroactively re-processed; toggle
    # OFF disables the behaviour for future uploads only. Deters casual
    # right-click theft and re-listing on rival marketplaces.
    watermark_images: bool = False
    # ---- Settings tab fields (Etsy-parity) ----
    # Vacation mode: when on, shop pages render a banner and disable Add-to-Cart
    # across all listings until toggled off. Optional message shown to buyers.
    vacation_mode: bool = False
    vacation_message: Optional[str] = ""
    # "About your shop" — narrative content, separate from the short bio.
    story_headline: Optional[str] = ""    # e.g. "Forged in the heart of Montana."
    story: Optional[str] = ""             # long-form shop story (markdown ok)
    # Policy settings — surfaced on every product detail page below the price.
    processing_time: Optional[str] = ""   # e.g. "1-3 business days"
    returns_policy: Optional[str] = ""    # free-text policy text (catch-all)
    # Per-shop default returns/exchange policy. Each listing still has its own
    # accept_returns / accept_exchanges toggle (per-product override) but these
    # fields capture the SHOP-level rules that apply when returns are accepted:
    # window length, who pays return shipping, restocking fee, exclusions.
    # Surfaced on shop policy pages and product detail pages.
    accepts_returns_default: bool = False
    accepts_exchanges_default: bool = False
    return_window_days: int = 14            # e.g. 14, 30
    return_shipping_paid_by: str = "buyer"  # "buyer" | "seller"
    restocking_fee_pct: int = 0             # 0-100
    non_returnable_items: Optional[str] = "Custom or personalized orders, digital downloads, intimate or hygienic items."
    accepts_custom_orders: bool = True    # gates the "Request Custom" CTA
    # Custom & personalized order policy — applies only to custom-order
    # requests. Free-text override of the platform-wide policy + a toggle
    # that lets confident shops skip the proof-approval step (default ON
    # because most shops should require proofs to prevent disputes).
    custom_order_policy: Optional[str] = ""
    custom_orders_require_proof: bool = True
    # Maker-only UI preference: render the Shop Manager (dashboard +
    # all sub-tabs) on a light backdrop instead of the dark industrial
    # theme. Public shop / buyer pages are unaffected — this is purely
    # a personal accessibility/eye-strain accommodation for the seller.
    appearance_mode: str = "dark"  # "dark" | "light"
    # Maker-level default for backorders. Per-listing `accepts_backorders`
    # overrides this when set; when null on the listing, this default
    # applies. Defaults to False — makers must opt in.
    accepts_backorders_default: bool = False
    # ---- Etsy-style Info & Appearance ----
    shop_title: Optional[str] = ""                    # Shop hero tagline (appears under the shop name)
    order_receipt_banner_url: Optional[str] = ""      # 760×100 banner printed on order receipts + emails
    shop_announcement: Optional[str] = ""             # Pinned notice on shop page (outages, sales, etc.)
    message_to_buyers: Optional[str] = ""             # Auto-appended to all order confirmation emails
    message_to_buyers_digital: Optional[str] = ""     # Shown on Downloads page for digital items
    # ---- Social media ----
    # Pure URL inputs (no OAuth) — vanity links surfaced on the shop profile.
    social_facebook: Optional[str] = ""
    social_instagram: Optional[str] = ""
    social_twitter: Optional[str] = ""
    social_tiktok: Optional[str] = ""
    social_youtube: Optional[str] = ""
    social_pinterest: Optional[str] = ""
    website_url: Optional[str] = ""
    # ---- Account lifecycle (shop closure + deletion) ----
    # `shop_closed` is a stronger form of vacation_mode — permanently pauses
    # sales until re-opened, hides the shop from search/category pages, and
    # blocks new listings. Re-openable anytime (non-destructive).
    shop_closed: bool = False
    shop_closed_at: Optional[str] = None
    # 30-day grace delete: sets `deletion_requested_at`; a scheduler (or
    # manual check at login) purges the shop + all listings on day 30.
    # Setting to None cancels the request. While flagged, the UI renders
    # a red banner with days-remaining so the maker can back out.
    deletion_requested_at: Optional[str] = None
    deletion_cancels_at: Optional[str] = None  # iso: 30 days after request
    # ---- Auto-boost on best-sellers ----
    # Daily cron promotes the top-N selling listings (>= threshold orders in
    # the past 30 days) for 1 week each at $5/wk — billed to pending balance.
    # Admin/Plus opt-in; off by default. `auto_boost_min_orders_30d` sets
    # the bar (default 10), `auto_boost_max_per_run` caps spend per day.
    auto_boost_enabled: bool = False
    auto_boost_min_orders_30d: int = 10
    auto_boost_max_per_run: int = 3
    auto_boost_last_run_at: Optional[str] = None
    auto_boost_total_spent_usd: float = 0.0
    created_at: str = Field(default_factory=now_iso)


class Review(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    location: str
    rating: int = 5
    text: str
    product_slug: Optional[str] = None
    maker_slug: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    # Public maker response — Etsy-style "From the seller" reply rendered
    # below the review on every public surface. Optional, set by the maker
    # without admin approval (it's the maker's own published voice).
    maker_response: Optional[str] = None
    maker_response_at: Optional[str] = None
    # Dispute lifecycle. One review can have at most one open dispute at
    # a time; status flips to upheld/denied once admin rules. We mirror
    # the latest status on the review doc so the frontend doesn't need
    # to join across collections to render the maker dashboard.
    dispute_status: Optional[str] = None  # None | "open" | "upheld" | "denied"
    dispute_id: Optional[str] = None


class ReviewCreate(BaseModel):
    name: str
    location: str = ""
    rating: int = 5
    text: str
    product_slug: Optional[str] = None
    maker_slug: Optional[str] = None


class ReviewDispute(BaseModel):
    """A maker-filed challenge to a review they believe is unfair, fake,
    or violates platform policy (off-topic / harassment / from a non-buyer
    competitor / etc.). Admins resolve to either:
      - upheld: review is removed from public view (deleted)
      - denied: review stays; maker is notified with an explanation
    The maker can ALSO post a public response (no admin approval needed).
    Disputes are for the harder cases where a reply isn't enough."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    review_id: str
    maker_slug: str
    review_snapshot: dict        # {name, rating, text, created_at} — frozen
    reason: str                  # one of REVIEW_DISPUTE_REASONS
    explanation: str             # free text from the maker
    status: str = "open"         # open | upheld | denied
    created_at: str = Field(default_factory=now_iso)
    resolved_at: Optional[str] = None
    resolved_by: Optional[str] = None
    admin_note: Optional[str] = None  # internal admin note (maker doesn't see)


REVIEW_DISPUTE_REASONS = (
    "not_a_buyer",          # reviewer never purchased
    "factually_wrong",      # specific claims are false (delivered vs not, etc.)
    "off_topic",            # complaints about something maker didn't sell
    "harassment",           # personal attack / hate speech / threats
    "competitor",           # rival shop trying to tank ranking
    "duplicate",            # same buyer left multiple bad reviews
    "other",
)


class ReviewDisputeCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str = Field(min_length=1)
    explanation: str = Field(min_length=10, max_length=4000)


class ReviewMakerResponseCreate(BaseModel):
    """Maker's public response to a review. Capped at 1500 chars to keep
    review pages scannable. Empty string clears the response."""
    model_config = ConfigDict(extra="ignore")
    response: str = Field(max_length=1500)


class ReviewDisputeResolve(BaseModel):
    model_config = ConfigDict(extra="ignore")
    status: str = Field(pattern="^(upheld|denied)$")
    admin_note: Optional[str] = ""


class BlogPost(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    slug: str
    title: str
    excerpt: str
    body: str
    cover: str
    author: str
    read_min: int = 4
    created_at: str = Field(default_factory=now_iso)


import secrets
class CustomOrder(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    # Public-safe 10-digit tracking number printed on every brief. Random
    # so it's not enumerable; stored as a string so leading zeros survive.
    # Uniqueness is enforced server-side at insert time (collision-retry).
    tracking_number: str = Field(
        default_factory=lambda: "".join(secrets.choice("0123456789") for _ in range(10)),
    )
    name: str
    email: EmailStr
    phone: Optional[str] = None
    project_type: str
    material: str
    size: Optional[str] = None
    budget: Optional[str] = None
    description: str
    quantity: Optional[str] = None
    timeline: Optional[str] = None
    preferred_maker_slug: Optional[str] = None
    design_file_url: Optional[str] = None
    design_file_name: Optional[str] = None
    policy_version: Optional[str] = None
    policy_accepted_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class CustomOrderCreate(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    project_type: str
    material: str
    size: Optional[str] = None
    budget: Optional[str] = None
    description: str
    quantity: Optional[str] = None
    timeline: Optional[str] = None
    preferred_maker_slug: Optional[str] = None
    design_file_url: Optional[str] = None
    design_file_name: Optional[str] = None
    policy_accepted: bool = False
    policy_version: Optional[str] = None


class MakerApplication(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: EmailStr
    studio_name: str
    location: str
    techniques: List[str] = []
    portfolio_url: Optional[str] = None
    about: str
    # True when the application came through the /beta Founding Seller page
    # (detected server-side via the `[FOUNDING SELLER BETA]` marker).
    is_beta: bool = False
    created_at: str = Field(default_factory=now_iso)


class MakerApplicationCreate(BaseModel):
    name: str
    email: EmailStr
    studio_name: str
    location: str
    techniques: List[str] = []
    portfolio_url: Optional[str] = None
    about: str


class CartItem(BaseModel):
    product_id: str
    quantity: int = 1
    variant_id: Optional[str] = None    # selected variant (optional)
    # ---- Buyer personalization (iter150) ----
    # Both optional; surfaced to the maker on the order detail page +
    # in the order confirmation email. The image URL points at the
    # R2-hosted file the buyer uploaded via /api/personalization/upload
    # BEFORE adding the item to cart. We don't validate the URL here
    # (would couple the model to R2 internals) — the upload endpoint
    # is the only way to get a URL onto this field via the UI, so an
    # adversarial caller can at worst poison their own order doc.
    personalization_text: Optional[str] = Field(default=None, max_length=2000)
    personalization_image_url: Optional[str] = Field(default=None, max_length=600)


class CheckoutRequest(BaseModel):
    items: List[CartItem]
    origin_url: str
    customer_email: Optional[EmailStr] = None
    gift_note: Optional[str] = None
    attribution_source: Optional[str] = None   # off-site ad surcharge tag
    discount_code: Optional[str] = None        # per-shop maker promo code
    # Audit-trail consent. Frontend must stamp this client-side at submit;
    # backend re-stamps a server-time value into the order doc.
    policy_accepted: bool = False
    policy_version: Optional[str] = None
    policy_accepted_at: Optional[str] = None


class ActivityEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: str  # sold | shipped | listed | applied | drop | admin
    text: str
    location: Optional[str] = None  # admin housekeeping events have no location
    created_at: str = Field(default_factory=now_iso)


# ---- Maker portal ----
class MakerLoginRequest(BaseModel):
    email: EmailStr
    origin_url: str


class MakerVerifyRequest(BaseModel):
    token: str


class MakerProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    techniques: Optional[List[str]] = None
    portrait: Optional[str] = None
    cover: Optional[str] = None
    email: Optional[EmailStr] = None
    banner_image_url: Optional[str] = None       # Plus-only: custom shop banner
    external_ads_opt_out: Optional[bool] = None
    # ---- Settings tab patchable fields ----
    vacation_mode: Optional[bool] = None
    vacation_message: Optional[str] = None
    story_headline: Optional[str] = None
    story: Optional[str] = None
    processing_time: Optional[str] = None
    returns_policy: Optional[str] = None
    accepts_returns_default: Optional[bool] = None
    accepts_exchanges_default: Optional[bool] = None
    return_window_days: Optional[int] = None
    return_shipping_paid_by: Optional[str] = None
    restocking_fee_pct: Optional[int] = None
    non_returnable_items: Optional[str] = None
    accepts_custom_orders: Optional[bool] = None
    custom_order_policy: Optional[str] = None
    custom_orders_require_proof: Optional[bool] = None
    appearance_mode: Optional[str] = None
    accepts_backorders_default: Optional[bool] = None
    is_veteran_owned: Optional[bool] = None
    restock_digest_opt_out: Optional[bool] = None
    social_momentum_opt_out: Optional[bool] = None
    watermark_images: Optional[bool] = None
    # Saved processing profile presets — see Maker.processing_profiles.
    processing_profiles: Optional[List[dict]] = None
    # Etsy-style Info & Appearance
    shop_title: Optional[str] = None
    order_receipt_banner_url: Optional[str] = None
    shop_announcement: Optional[str] = None
    message_to_buyers: Optional[str] = None
    message_to_buyers_digital: Optional[str] = None
    # Social media links
    social_facebook: Optional[str] = None
    social_instagram: Optional[str] = None
    social_twitter: Optional[str] = None
    social_tiktok: Optional[str] = None
    social_youtube: Optional[str] = None
    social_pinterest: Optional[str] = None
    website_url: Optional[str] = None
    # Auto-boost preferences
    auto_boost_enabled: Optional[bool] = None
    auto_boost_min_orders_30d: Optional[int] = None
    auto_boost_max_per_run: Optional[int] = None


# ---- Admin ----
class AdminLoginRequest(BaseModel):
    email: EmailStr
    origin_url: str


class AdminVerifyRequest(BaseModel):
    token: str


class ApplicationDecision(BaseModel):
    approved: bool
    note: Optional[str] = ""


class CustomOrderQuote(BaseModel):
    quote: float
    message: Optional[str] = ""


# ---- Backorders ----
class BackorderRequest(BaseModel):
    """A buyer's request to be notified / fulfilled when a 0-stock listing
    can be made again. Lifecycle:
       pending → accepted (maker confirmed; maker handles payment offline)
       pending → declined (maker said no, with reason)
       accepted → fulfilled (maker marked it shipped after charging the buyer)
    """
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    product_id: str
    product_slug: str
    product_title: str
    maker_slug: str
    buyer_email: EmailStr
    buyer_name: str
    quantity: int = 1
    message: Optional[str] = ""        # buyer's note to the maker
    lead_weeks_quoted: Optional[int] = None  # snapshot of the listing's lead time at request time
    status: str = "pending"            # pending | accepted | declined | fulfilled | cancelled
    decline_reason: Optional[str] = ""
    created_at: str = Field(default_factory=now_iso)
    accepted_at: Optional[str] = None
    declined_at: Optional[str] = None
    fulfilled_at: Optional[str] = None


class BackorderRequestCreate(BaseModel):
    """Public payload from the product detail backorder modal."""
    model_config = ConfigDict(extra="ignore")
    buyer_email: EmailStr
    buyer_name: str
    quantity: int = 1
    message: Optional[str] = ""


class BackorderDecision(BaseModel):
    """Maker accept/decline payload."""
    model_config = ConfigDict(extra="ignore")
    decline_reason: Optional[str] = ""


# ---- Restock waitlist (lighter-weight than backorders) ----
class RestockWaitlistEntry(BaseModel):
    """A buyer who wants to hear back when a 0-stock listing is restocked.
    Distinct from BackorderRequest — no commitment, no maker decision flow.
    Sent automatically the next time stock goes from 0 → positive."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    product_id: str
    product_slug: str
    product_title: str
    maker_slug: str
    buyer_email: EmailStr
    buyer_name: Optional[str] = ""
    created_at: str = Field(default_factory=now_iso)
    notified_at: Optional[str] = None


class RestockWaitlistCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    buyer_email: EmailStr
    buyer_name: Optional[str] = ""
