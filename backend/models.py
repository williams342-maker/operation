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

    Pricing — two ways to set the price for a variant:
      • `price` (preferred): absolute price for this SKU in USD.
      • `price_delta` (legacy): added to the listing's base `price`.
    `price` wins when both are set. New listings created through the
    Listing Editor write `price`; older docs continue to work via
    `price_delta`. See `effective_variant_price()` in core.
    """
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    label: str                         # buyer-facing label, e.g. '24" Walnut'
    price: Optional[float] = None      # absolute SKU price (overrides base+delta)
    price_delta: float = 0.0           # added to base price (legacy fallback)
    in_stock: int = 0
    axis1: Optional[str] = None        # e.g. '24"' (size axis)
    axis2: Optional[str] = None        # e.g. 'Walnut' (finish axis)
    image: Optional[str] = None        # optional per-variant image URL
    # iter364 — Variation groups: when the listing defines `variant_groups`
    # (e.g. Color × Engraving), each variant row is a generated COMBINATION.
    # `option_ids` lists the VariantOption ids that compose it (one per
    # group), `price_delta` holds the summed option adjustments, and `price`
    # acts as the optional per-combination override.
    sku: Optional[str] = None          # maker SKU override per combo
    option_ids: List[str] = []         # composing VariantOption ids


class VariantOption(BaseModel):
    """iter364 — One choice inside a variation group (e.g. 'Tan').

    `price_delta` is the +$ adjustment added to the listing base price
    when this option is selected. `image` optionally swaps the gallery
    when the buyer picks the option.
    """
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    label: str
    price_delta: float = 0.0
    image: Optional[str] = None


class VariantGroup(BaseModel):
    """iter364 — A named variation category (e.g. 'Color', 'Engraving').

    Groups are ordered (drag-reorder in the editor); buyer-facing
    selectors render one per group in this order. Combinations across
    groups are generated client-side and stored as flat `variants`
    rows carrying `option_ids` — see ProductVariant.
    """
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str
    options: List[VariantOption] = []


class Product(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    slug: str
    title: str
    category: str = "Wall Art"          # "Wall Art", "Custom Signs", "Outdoor Art"
    technique: str = "CUSTOM"            # PLASMA, LASER, ROUTER, CUSTOM
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
    # iter364 — Nested variation categories (Color × Engraving …). When
    # non-empty, the buyer page renders one selector per group and the
    # flat `variants` list holds the generated combinations.
    variant_groups: List[VariantGroup] = []
    status: str = "published"          # "published" | "draft" — drafts hidden from public catalog
    # ---- Etsy-style economics ----
    # Listings expire 4 months after publish; on expiry, status auto-flips to
    # "draft" and the maker can renew for `listing_fee_cents`.
    expires_at: Optional[str] = None
    # Etsy-style listing renewal mode. "automatic" → scheduler extends
    # `expires_at` by another LISTING_EXPIRY_DAYS window when the listing
    # lapses (accrues the standard listing fee via the existing tier-aware
    # quota — free for Founders/Plus within quota). "manual" → listing flips
    # to draft on expiry and the maker decides whether to renew.
    renewal_option: str = "automatic"
    # ISO ts of the most recent 7-day expiry reminder email sent for this
    # listing — gates the scheduler so we don't double-send across runs.
    renewal_reminder_sent_at: Optional[str] = None
    # Lifetime count of times this listing was renewed (manual or auto).
    # Drives the "9 renewals" line in the Etsy-style stats panel.
    renewals_count: int = 0
    # ISO ts of the last Smart-Pause auto-flip. Used so the scheduler can
    # avoid re-pausing the same listing on consecutive runs and so the UI
    # can surface "paused on X because no views since Y" context.
    smart_paused_at: Optional[str] = None
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
    # iter364 — When True, the buyer MUST attach at least one photo in the
    # personalization panel before the item can be added to the cart
    # (engraving references, fingerprints, pet nose prints, memorial
    # artwork…). Uploads flow through /api/personalization/files.
    personalization_requires_upload: bool = False
    # ---- Google Merchant feed controls (iter365) ----
    # Feed-only metadata: Merchant Center false-positives engraved knife
    # listings as restricted "Guns and Parts" off title keywords. These
    # fields shape ONLY the exported Google feed — public titles, URLs,
    # and SEO never change. See services/merchant_sanitizer.py.
    merchant_title: Optional[str] = None        # Google-specific title override
    merchant_auto_optimize: bool = True         # swap restricted terms in feed
    merchant_exclude: bool = False              # drop from Google feed entirely
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
    # Google Product Category (GPC) path override — when set, this verbatim
    # breadcrumb wins over the auto-derived path in every external catalog
    # feed (Pinterest, Google Merchant, Meta). Empty/None ⇒ fall back to
    # the category→GPC mapper. See routers/pinterest_feed._google_product_category.
    gpc_path: Optional[str] = None
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
    # Denormalized — true when the maker is on Crafters Plus (active or
    # trialing). Drives the Plus badge on ProductCard and powers the
    # 3-tier catalog ranking boost. Never stored on the product doc.
    maker_is_plus: bool = False
    # iter362 — Computed on read by /products/trending only: count of
    # `product_view` events inside the trending window. Drives the
    # view-count badge on the homepage trending tiles. Never stored.
    trend_views: Optional[int] = None
    # iter318c — Denormalized trust facts pulled from the maker on read
    # (never stored on the product doc). Surface them on ProductCard so
    # buyers see who built the piece + where + how fast they ship,
    # without an N+1 maker fetch.
    maker_location: Optional[str] = None
    lead_time_days: Optional[int] = None
    accepts_custom_orders: bool = False
    maker_response_time_hours: Optional[int] = None
    # Transparent platform-seed marker. When True, this product was seeded by
    # the platform team as a "Featured Example" so the marketplace doesn't
    # feel empty pre-launch — ProductCard renders an explicit
    # "✦ FEATURED EXAMPLE" pill so visitors aren't misled into thinking it's
    # a real listing for sale. Admins can purge all seeded examples in one
    # click once organic listings fill the catalog.
    featured_example: bool = False
    # iter327 — Digital + hybrid listings.
    # `listing_type`: "physical" (default — legacy listings) | "digital"
    # (downloadable file only) | "both" (physical item + bonus digital
    # source files). Drives shipping calc skip on checkout, "Instant
    # Download" badge on the product card, and post-payment file
    # delivery emails. Defaulting to "physical" keeps every pre-iter327
    # listing behaving exactly as before.
    listing_type: str = "physical"
    # `digital_files`: 0..10 file manifest entries. Each entry is a dict
    # `{id, filename, size_bytes, content_type, ext, url, uploaded_at}`.
    # `url` points to R2 — the public URL is only useful to admins; on
    # the buyer side we serve a token-gated download endpoint after
    # purchase. Skip ObjectIds; this is just a thin manifest.
    digital_files: List[dict] = []
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
    variant_groups: List[VariantGroup] = []    # iter364 — nested variation categories
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
    personalization_requires_upload: bool = False   # iter364
    # iter365 — Google Merchant feed controls (feed-only).
    merchant_title: Optional[str] = None
    merchant_auto_optimize: bool = True
    merchant_exclude: bool = False
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
    # Google Product Category path override — verbatim breadcrumb that
    # wins over the auto-derived path in external catalog feeds.
    gpc_path: Optional[str] = None
    # Backorder gating (see Product class for semantics)
    accepts_backorders: Optional[bool] = None
    backorder_lead_weeks: Optional[int] = None
    # Etsy-style renewal mode: "automatic" (default) or "manual".
    renewal_option: str = "automatic"
    # iter327 — Digital/hybrid listing type. Validated at the create/
    # update handler (must be one of "physical" | "digital" | "both").
    # `digital_files` are NOT set via this payload — they're uploaded
    # separately to POST /api/maker/listings/{slug}/digital-files so we
    # can stream multipart bodies straight to R2 without bloating the
    # JSON create payload.
    listing_type: str = "physical"


class Maker(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    slug: str
    name: str
    initials: str
    location: str
    bio: str
    techniques: List[str] = []
    # "Meet the Makers" upgrade (iter178) — story-building fields that
    # buyers use to vet a maker before committing to a custom order.
    # `years_crafting` is a self-reported integer (capped at 60 for sanity).
    # `machinery` is a freeform tag list ("Plasma CNC", "Fiber Laser",
    # "8-Axis Mill", "Cherry Lathe"…) — distinct from techniques because
    # buyers searching for "plasma-cut signs" want makers with plasma
    # tables specifically, not just the technique.
    years_crafting: Optional[int] = None
    machinery: List[str] = []
    # iter321 — SEO/Trust audit proof signals.
    # `workshop_photos`: up to 6 R2/CDN URLs of the maker's shop floor,
    # machines, in-progress work. Surfaced on /makers/<slug> as a gallery.
    # Stored as strings (not dicts) — the frontend handles lightbox + alt.
    # `response_time_hours`: self-reported typical reply time to a custom
    # order or message. Surfaced as "Replies in ~Nh" in the proof strip.
    workshop_photos: List[str] = Field(default_factory=list)
    response_time_hours: Optional[int] = None
    # Maker workshop videos (iter186). Up to 6 embeds (YouTube / Vimeo URL).
    # Each row: {url, video_id, provider, title?, thumbnail?, added_at}.
    # Provider+id are extracted from the URL at insert time so the frontend
    # can build the embed without re-parsing.
    workshop_videos: List[dict] = Field(default_factory=list)
    portrait: str
    cover: str
    # iter228 — "From the Workshop" — a 100-180 word documentary-style
    # intro paragraph generated (or hand-written) for each maker, surfaced
    # on /makers/<slug> directly under the bio. Distinct from `bio`: bio
    # is the 1-3 sentence tagline, workshop_intro is the deeper "how I
    # got into this craft, what we run on the floor, what we obsess
    # about" story that converts visitors into buyers. Optional — pages
    # auto-hide the section when empty.
    workshop_intro: Optional[str] = None
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
    # Plus-only: vanity shop URL slug. When set, the maker is reachable
    # at `/makers/<custom_url>` in addition to the canonical
    # `/makers/<slug>`. Lowercase, 3-30 chars, [a-z0-9-], must pass the
    # reserved-word blocklist (admin, api, shop, etc.). Cleared when the
    # subscription lapses so a former Plus maker can't keep camping on
    # a vanity URL.
    custom_url: Optional[str] = None
    custom_url_changed_at: Optional[str] = None
    # ---- Plus trial referral program (iter172) ----
    # Maker's unique invite code — minted lazily on first /referrals call.
    # Shareable as `/beta?ref=<code>` to attract new makers.
    referral_code: Optional[str] = None
    # Count of REFERRED makers who reached `subscription_status=active`
    # (including trialing). Threshold of 3 triggers the +30-day trial
    # extension bonus exactly once per referrer (idempotent via
    # `referral_bonus_applied_at`).
    referrals_completed_count: int = 0
    referral_bonus_applied_at: Optional[str] = None
    # Code captured at application time — the new maker was referred by
    # the maker whose `referral_code` matches this value. Copied from
    # `maker_applications.referred_by_code` when the maker is created.
    referred_by_code: Optional[str] = None
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
    # Veteran $10/mo boost credit ledger. Replenished monthly by the
    # `veteran_boost_credit` cron; burned ahead of cash promotion fees.
    veteran_boost_credit_cents: int = 0
    veteran_boost_credit_replenished_at: Optional[str] = None
    # Plus subscribers also get a $15/mo boost credit (3 boosted listings).
    # Replenished by the same monthly cron at 00:05 UTC on the 1st.
    plus_boost_credit_cents: int = 0
    plus_boost_credit_replenished_at: Optional[str] = None
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
    # ---- Smart Pause ----
    # Opt-in: when ON, the daily scheduler auto-flips published listings with
    # zero pageviews in the last `smart_pause_threshold_days` window to draft
    # and emails the maker with optimisation tips. OFF by default — explicit
    # opt-in only since this can hide stale-but-not-bad listings.
    smart_pause_enabled: bool = False
    smart_pause_threshold_days: int = 30
    smart_pause_last_run_at: Optional[str] = None
    # Transparent platform-seed marker. When True, this maker profile was
    # seeded by the platform team as a "Founding Maker · Platform Showcase"
    # to populate the directory before organic makers onboard. The shop
    # page renders a visible badge so visitors aren't misled into thinking
    # it's a fully transacting maker. Purged via the admin one-click tool.
    featured_example: bool = False
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
    # Imported-review provenance (iter183). `source` is None for native
    # Crafters Market reviews and "etsy" / "shopify" / "csv" when the
    # maker uploaded a CSV from another platform. Imports default to
    # publicly visible but can be hidden per-batch via the dashboard.
    source: Optional[str] = None
    imported_at: Optional[str] = None
    imported_batch_id: Optional[str] = None
    published_publicly: bool = True


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
    # Referral attribution — populated when the applicant arrived via
    # `/beta?ref=<code>`. On approval, copied to `maker.referred_by_code`
    # so the trial-extension hook can credit the referrer when this
    # maker subscribes to Plus.
    referred_by_code: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class MakerApplicationCreate(BaseModel):
    name: str
    email: EmailStr
    studio_name: str
    location: str
    techniques: List[str] = []
    portfolio_url: Optional[str] = None
    about: str
    referred_by_code: Optional[str] = None
    # iter324 — Honeypot field. Real applicants never see this hidden
    # input; bots that scrape <form> elements fill everything. If
    # non-empty, the endpoint silently 200s without persisting so the
    # bot doesn't retry with variations.
    website: Optional[str] = ""


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
    # iter339 — Buyer's color choice from the maker's offered palette
    # (see `Listing.colors`). Free-text up to 40 chars so the buyer can
    # also write "I'd like the third silver swatch from the left" or
    # similar — the field doubles as a soft attribute and a manual note.
    color_choice: Optional[str] = Field(default=None, max_length=40)
    # iter364 — ids of customer photo uploads (POST /api/personalization/
    # files) attached to this line. Max 10 per item; the ids resolve to
    # `customer_uploads` docs whose bytes live in Emergent object storage.
    # Persisted verbatim on the tx doc, hydrated for the maker's order
    # detail view, and marked `referenced` on payment success.
    personalization_upload_ids: List[str] = Field(default=[], max_length=10)


class CheckoutRequest(BaseModel):
    items: List[CartItem]
    origin_url: str
    customer_email: Optional[EmailStr] = None
    gift_note: Optional[str] = None
    attribution_source: Optional[str] = None   # off-site ad surcharge tag
    # iter334l — Microsoft Click ID (msclkid) captured from Bing Ads
    # landing URLs. Persisted on the txn so the admin ROAS tile can
    # attribute revenue back to the ad click within Bing's 30-day window.
    msclkid: Optional[str] = Field(default=None, max_length=100)
    # iter334u — Google Click ID (gclid). Same shape as msclkid; surfaced
    # on the admin Google Ads ROAS tile to attribute Stripe revenue back
    # to Google Ads clicks. gclids can be longer than msclkids (encoded
    # auction metadata), so we allow up to 200 chars.
    gclid: Optional[str] = Field(default=None, max_length=200)
    # iter334x — Facebook/Meta Click ID (fbclid). Mirror of gclid; surfaced
    # on the admin Meta Ads ROAS tile. fbclids encode session metadata and
    # can be quite long, so we allow up to 300 chars.
    fbclid: Optional[str] = Field(default=None, max_length=300)
    discount_code: Optional[str] = None        # per-shop maker promo code
    # Audit-trail consent. Frontend must stamp this client-side at submit;
    # backend re-stamps a server-time value into the order doc.
    policy_accepted: bool = False
    policy_version: Optional[str] = None
    policy_accepted_at: Optional[str] = None
    # iter267 — optional SMS contact + transactional consents only.
    # The cart-nudges consent was removed; cart-recovery SMS is an
    # automatic 24h-after-email fallback against the receipts/shipping
    # phone. Backend treats absence/empty-string as "no consent".
    customer_phone: Optional[str] = Field(default=None, max_length=24)
    sms_consent_receipts_at: Optional[str] = None
    sms_consent_shipping_at: Optional[str] = None
    # iter268 — Cart-recovery attribution. Set client-side when the
    # buyer lands on /cart from an abandoned-cart email/SMS CTA
    # (`?recovery=email|sms`). Logged into `discount_attributions` on
    # successful redemption so the admin can measure the SMS channel's
    # incremental lift over email alone.
    recovery_medium: Optional[str] = None


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
    # iter178 — Meet-the-Makers fields
    years_crafting: Optional[int] = None
    machinery: Optional[List[str]] = None
    # iter321 — SEO/Trust audit proof signals (editable from profile tab).
    workshop_photos: Optional[List[str]] = None
    response_time_hours: Optional[int] = None
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
    # Smart Pause preferences
    smart_pause_enabled: Optional[bool] = None
    smart_pause_threshold_days: Optional[int] = None


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
    Sent automatically the next time stock goes from 0 → positive.

    iter266 — Optional SMS channel. `phone` (E.164) + `sms_consent_at`
    (ISO timestamp at click-time) opt the buyer into receiving the
    notification as a text in addition to the email. Both fields must be
    present together or neither — the modal enforces this client-side."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    product_id: str
    product_slug: str
    product_title: str
    maker_slug: str
    buyer_email: EmailStr
    buyer_name: Optional[str] = ""
    phone: Optional[str] = None
    sms_consent_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    notified_at: Optional[str] = None


class RestockWaitlistCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    buyer_email: EmailStr
    buyer_name: Optional[str] = ""
    # iter266 — optional SMS opt-in. If `phone` is set without
    # `sms_consent_at` (or vice-versa) the backend silently drops both
    # and falls back to email-only.
    phone: Optional[str] = None
    sms_consent_at: Optional[str] = None
