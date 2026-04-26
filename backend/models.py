"""Pydantic models shared across routers."""
import uuid
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from core import now_iso


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
    created_at: str = Field(default_factory=now_iso)


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


class CheckoutRequest(BaseModel):
    items: List[CartItem]
    origin_url: str
    customer_email: Optional[EmailStr] = None


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
