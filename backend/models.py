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
    # ---- Returns ----
    accept_returns: bool = False
    accept_exchanges: bool = False
    # ---- SEO ----
    seo_tags: List[str] = []                # max 13, validated in router
    # ---- Contact override (optional — defaults to maker email) ----
    contact_email: Optional[str] = None
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
    accept_returns: bool = False
    accept_exchanges: bool = False
    seo_tags: List[str] = []
    contact_email: Optional[str] = None


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


class ReviewCreate(BaseModel):
    name: str
    location: str = ""
    rating: int = 5
    text: str
    product_slug: Optional[str] = None
    maker_slug: Optional[str] = None


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


class CustomOrder(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
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
    kind: str  # sold | shipped | listed | applied
    text: str
    location: str
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
