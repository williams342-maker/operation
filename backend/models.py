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
    description: str
    materials: List[str] = []
    dimensions: Optional[str] = None
    images: List[str] = []
    model_url: Optional[str] = None   # 3D viewer (.glb / .gltf URL); optional
    maker_slug: str
    in_stock: int = 4
    featured: bool = False
    variants: List[ProductVariant] = []
    variant_axis1_name: Optional[str] = None   # e.g. "Size"
    variant_axis2_name: Optional[str] = None   # e.g. "Finish"
    status: str = "published"          # "published" | "draft" — drafts hidden from public catalog
    deleted_at: Optional[str] = None  # soft-delete marker; hides from public views
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
    in_stock: int = 4
    variants: List[ProductVariant] = []
    variant_axis1_name: Optional[str] = None
    variant_axis2_name: Optional[str] = None
    status: str = "published"          # accept "draft" to save without publishing


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
    created_at: str = Field(default_factory=now_iso)


class Review(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    location: str
    rating: int = 5
    text: str
    product_slug: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


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
