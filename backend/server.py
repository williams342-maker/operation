from fastapi import FastAPI, APIRouter, HTTPException, Request, BackgroundTasks
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, uuid, logging, random
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from typing import List, Optional, Dict
from datetime import datetime, timezone
from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout, CheckoutSessionRequest
)
import asyncio
from email_service import (
    send_buyer_receipt, send_ops_new_order,
    send_ops_new_application, send_ops_new_custom_order,
    send_buyer_custom_ack, send_maker_new_order,
    send_maker_magic_link,
    send_admin_magic_link, send_application_decision, send_custom_order_quote,
)
from maker_auth import (
    issue_magic_token, verify_magic_token,
    issue_session_jwt, current_maker_slug,
    issue_admin_magic_token, verify_admin_magic_token, current_admin,
)
from fastapi import Depends

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
PUBLIC_BACKEND_URL = (os.environ.get("PUBLIC_BACKEND_URL") or "").rstrip("/")


def _public_host(http_request: Request) -> str:
    """Public base URL for webhooks. Prefer PUBLIC_BACKEND_URL; fall back to the
    forwarded host so we never use the internal pod URL by accident."""
    if PUBLIC_BACKEND_URL:
        return PUBLIC_BACKEND_URL
    fwd_host = http_request.headers.get("x-forwarded-host")
    fwd_proto = http_request.headers.get("x-forwarded-proto", "https")
    if fwd_host:
        return f"{fwd_proto}://{fwd_host}"
    return str(http_request.base_url).rstrip("/")

app = FastAPI(title="Crafters Market API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("crafters")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Models ----------
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


# ---------- Seed Data ----------
SEED_MAKERS = [
    {"slug": "iron-and-oak", "name": "Iron & Oak Studio", "initials": "IR", "location": "Nashville, TN",
     "email": "iron-and-oak@craftersmarket.org",
     "bio": "Father-and-son shop forging wall art and custom signs from raw oak and 14ga steel.",
     "techniques": ["PLASMA", "ROUTER"],
     "portrait": "https://images.unsplash.com/photo-1764115424737-25aca6f47835?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwxfHxjbmMlMjBwbGFzbWElMjBjdXR0aW5nJTIwbWV0YWwlMjB3b3JrZXJ8ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85",
     "cover": "https://images.pexels.com/photos/17180807/pexels-photo-17180807.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
     "listings_count": 14, "rating": 4.97},
    {"slug": "metalart-pro", "name": "MetalArt Pro Shop", "initials": "ME", "location": "Austin, TX",
     "email": "metalart-pro@craftersmarket.org",
     "bio": "Industrial design studio specializing in laser-cut steel signage and bespoke business pieces.",
     "techniques": ["LASER", "CUSTOM"],
     "portrait": "https://images.unsplash.com/photo-1689960253768-72a12bc8320f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHw0fHxjbmMlMjBwbGFzbWElMjBjdXR0aW5nJTIwbWV0YWwlMjB3b3JrZXJ8ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85",
     "cover": "https://images.unsplash.com/photo-1745448797900-35d08e85e9db?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1NzZ8MHwxfHNlYXJjaHwxfHx3ZWxkaW5nJTIwc3BhcmtzJTIwZGFyayUyMGluZHVzdHJpYWx8ZW58MHx8fHwxNzc3MTU0OTg0fDA&ixlib=rb-4.1.0&q=85",
     "listings_count": 22, "rating": 4.96},
]

P_MOUNTAIN = "https://images.unsplash.com/photo-1705661902771-28a65b16ea98?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwzfHxtb2Rlcm4lMjBtZXRhbCUyMHdhbGwlMjBhcnQlMjBzaWdufGVufDB8fHx8MTc3NzE1NDk4NHww&ixlib=rb-4.1.0&q=85"
P_WOOD = "https://images.unsplash.com/photo-1776142519609-a4858781a01a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1MDV8MHwxfHNlYXJjaHw0fHxjdXN0b20lMjB3b29kJTIwY2FydmVkJTIwd2FsbCUyMHNpZ258ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85"
P_CNC = "https://images.pexels.com/photos/17180807/pexels-photo-17180807.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
P_LASER = "https://images.unsplash.com/photo-1689960253768-72a12bc8320f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHw0fHxjbmMlMjBwbGFzbWElMjBjdXR0aW5nJTIwbWV0YWwlMjB3b3JrZXJ8ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85"

SEED_PRODUCTS = [
    {"slug": "mountain-range-silhouette", "title": "Mountain Range Silhouette", "category": "Wall Art",
     "technique": "PLASMA", "price": 149.0, "maker_slug": "iron-and-oak", "featured": True,
     "description": '36" wide mountain scene cut from 14ga mild steel. Raw steel finish with clear coat.',
     "materials": ["14ga mild steel", "Clear coat"], "dimensions": '36" × 14"',
     "images": [P_MOUNTAIN, P_LASER, P_CNC]},
    {"slug": "rustic-family-name-sign", "title": "Rustic Family Name Sign", "category": "Custom Signs",
     "technique": "ROUTER", "price": 79.0, "maker_slug": "iron-and-oak", "featured": True,
     "description": 'Custom family name sign in 3/4" oak. Up to 12 characters. Stained walnut finish.',
     "materials": ["3/4\" oak hardwood", "Walnut stain"], "dimensions": '24" × 8"',
     "images": [P_WOOD, P_MOUNTAIN]},
    {"slug": "custom-business-sign", "title": "Custom Business Sign", "category": "Custom Signs",
     "technique": "CUSTOM", "price": 325.0, "maker_slug": "metalart-pro", "featured": True,
     "description": 'Your business name and logo cut from 1/4" steel. Up to 36" wide. Multiple finishes.',
     "materials": ["1/4\" steel", "Powder coat"], "dimensions": 'Up to 36" wide',
     "images": [P_CNC, P_LASER]},
    {"slug": "industrial-address-numbers", "title": "Industrial Address Numbers", "category": "Wall Art",
     "technique": "LASER", "price": 59.0, "maker_slug": "metalart-pro", "featured": True,
     "description": "Laser-cut steel address numbers, 6\" tall. Powder coated matte black. Set of 4.",
     "materials": ["Steel", "Matte black powder coat"], "dimensions": '6" tall · set of 4',
     "images": [P_LASER, P_MOUNTAIN]},
    {"slug": "outdoor-compass-medallion", "title": "Outdoor Compass Medallion", "category": "Outdoor Art",
     "technique": "PLASMA", "price": 219.0, "maker_slug": "metalart-pro",
     "description": '24" diameter compass rose, weather-resistant powder coat. Rust-proof for life outdoors.',
     "materials": ["Cor-Ten steel", "Outdoor powder coat"], "dimensions": '24" diameter',
     "images": [P_CNC, P_MOUNTAIN]},
    {"slug": "carved-oak-wedding-monogram", "title": "Carved Oak Wedding Monogram", "category": "Custom Signs",
     "technique": "ROUTER", "price": 189.0, "maker_slug": "iron-and-oak",
     "description": "Hand-finished oak monogram with gold leaf inlay. Build to your initials.",
     "materials": ["Oak hardwood", "Gold leaf"], "dimensions": '20" × 20"',
     "images": [P_WOOD, P_LASER]},
]

SEED_REVIEWS = [
    {"name": "Sarah M.", "location": "Austin, TX", "rating": 5,
     "text": "The custom sign I ordered for our business exceeded every expectation. The metal work is absolutely stunning."},
    {"name": "James & Lia R.", "location": "Denver, CO", "rating": 5,
     "text": "Ordered a wedding monogram and it's the most beautiful piece in our home. Incredible craftsmanship."},
    {"name": "David K.", "location": "Nashville, TN", "rating": 5,
     "text": "Fast shipping, perfect quality. The CNC precision really shows — every cut is clean and intentional."},
    {"name": "Maria O.", "location": "Phoenix, AZ", "rating": 5,
     "text": "The compass medallion has held up two desert summers without a scratch. Quality is unreal."},
]

SEED_POSTS = [
    {"slug": "anatomy-of-a-cut", "title": "Anatomy Of A Cut", "author": "Iron & Oak Studio",
     "excerpt": "How a CAD vector becomes a kerf-corrected toolpath, step-by-step inside the workshop.",
     "body": "Every piece in the marketplace begins as a vector. We walk through how our makers translate a design into a kerf-corrected toolpath, then into a finished product — all without sacrificing the hand of the artisan.",
     "cover": P_CNC, "read_min": 6},
    {"slug": "plasma-vs-laser", "title": "Plasma vs. Laser: Picking The Right Tool", "author": "MetalArt Pro Shop",
     "excerpt": "The honest case for each technique — when to choose plasma, when to switch to laser.",
     "body": "Plasma cuts thicker steel faster but with a wider kerf. Laser is precise on thin sheet but slow on heavy stock. Here's how our makers choose between them — and what it means for the look of the finished piece.",
     "cover": P_LASER, "read_min": 5},
    {"slug": "the-finish-line", "title": "The Finish Line: Powder, Patina, Stain", "author": "Crafters Market",
     "excerpt": "A finish isn't just protection — it's identity. Three approaches, one philosophy.",
     "body": "Powder coats are tough and uniform. Patinas are alive and evolving. Stains pull grain forward. Knowing which to apply is half the artistry.",
     "cover": P_WOOD, "read_min": 4},
]

SEED_ACTIVITY = [
    {"kind": "sold", "text": "Mountain Range Silhouette sold to a buyer", "location": "Denver, CO"},
    {"kind": "shipped", "text": "Iron & Oak shipped a Family Name Sign", "location": "Austin, TX"},
    {"kind": "listed", "text": "MetalArt Pro Shop listed a new Compass Medallion", "location": "Austin, TX"},
    {"kind": "applied", "text": "A new maker applied to the program", "location": "Portland, OR"},
    {"kind": "sold", "text": "Industrial Address Numbers sold to a buyer", "location": "Nashville, TN"},
    {"kind": "shipped", "text": "MetalArt Pro shipped a Custom Business Sign", "location": "Houston, TX"},
]


async def seed_if_empty():
    if await db.makers.count_documents({}) == 0:
        for m in SEED_MAKERS:
            await db.makers.insert_one({**Maker(**m).model_dump()})
    if await db.products.count_documents({}) == 0:
        for p in SEED_PRODUCTS:
            await db.products.insert_one({**Product(**p).model_dump()})
    if await db.reviews.count_documents({}) == 0:
        for r in SEED_REVIEWS:
            await db.reviews.insert_one({**Review(**r).model_dump()})
    if await db.blog_posts.count_documents({}) == 0:
        for b in SEED_POSTS:
            await db.blog_posts.insert_one({**BlogPost(**b).model_dump()})
    if await db.activity_events.count_documents({}) == 0:
        for a in SEED_ACTIVITY:
            await db.activity_events.insert_one({**ActivityEvent(**a).model_dump()})


@app.on_event("startup")
async def on_startup():
    await seed_if_empty()
    logger.info("Crafters Market API ready (seed checked).")


# ---------- Routes ----------
@api.get("/")
async def root():
    return {"service": "crafters-market", "status": "ok"}


@api.get("/products", response_model=List[Product])
async def list_products(category: Optional[str] = None, technique: Optional[str] = None,
                        q: Optional[str] = None, featured: Optional[bool] = None,
                        maker: Optional[str] = None):
    query: Dict = {}
    if category: query["category"] = category
    if technique: query["technique"] = technique.upper()
    if featured is not None: query["featured"] = featured
    if maker: query["maker_slug"] = maker
    if q:
        query["$or"] = [{"title": {"$regex": q, "$options": "i"}},
                        {"description": {"$regex": q, "$options": "i"}}]
    docs = await db.products.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api.get("/products/{slug}", response_model=Product)
async def get_product(slug: str):
    doc = await db.products.find_one({"slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Product not found")
    return doc


@api.get("/makers", response_model=List[Maker])
async def list_makers():
    return await db.makers.find({}, {"_id": 0}).to_list(200)


@api.get("/makers/{slug}", response_model=Maker)
async def get_maker(slug: str):
    doc = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Maker not found")
    return doc


@api.get("/reviews", response_model=List[Review])
async def list_reviews(limit: int = 20):
    return await db.reviews.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


@api.get("/blog", response_model=List[BlogPost])
async def list_posts():
    return await db.blog_posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)


@api.get("/blog/{slug}", response_model=BlogPost)
async def get_post(slug: str):
    doc = await db.blog_posts.find_one({"slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Post not found")
    return doc


@api.post("/custom-orders", response_model=CustomOrder)
async def create_custom_order(payload: CustomOrderCreate, bg: BackgroundTasks):
    order = CustomOrder(**payload.model_dump())
    await db.custom_orders.insert_one(order.model_dump())
    await db.activity_events.insert_one(
        ActivityEvent(kind="applied",
                      text=f"New custom order — {payload.project_type}",
                      location="Custom queue").model_dump()
    )
    bg.add_task(send_ops_new_custom_order,
                payload.name, payload.email, payload.project_type,
                payload.material, payload.description, payload.budget)
    bg.add_task(send_buyer_custom_ack, payload.email, payload.name, payload.project_type)
    return order


@api.post("/maker-applications", response_model=MakerApplication)
async def create_maker_application(payload: MakerApplicationCreate, bg: BackgroundTasks):
    app_obj = MakerApplication(**payload.model_dump())
    await db.maker_applications.insert_one(app_obj.model_dump())
    await db.activity_events.insert_one(
        ActivityEvent(kind="applied",
                      text=f"{payload.studio_name} applied to the program",
                      location=payload.location).model_dump()
    )
    bg.add_task(send_ops_new_application,
                payload.name, payload.studio_name, payload.location,
                payload.email, payload.about)
    return app_obj


@api.get("/activity", response_model=List[ActivityEvent])
async def list_activity(limit: int = 20):
    return await db.activity_events.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


# ---------- SEO: sitemap & robots ----------
def _site_root(http_request: Request) -> str:
    """Public site origin for canonical URLs in the sitemap."""
    site = (os.environ.get("PUBLIC_SITE_URL") or PUBLIC_BACKEND_URL or "").rstrip("/")
    if site:
        return site
    fwd_host = http_request.headers.get("x-forwarded-host")
    fwd_proto = http_request.headers.get("x-forwarded-proto", "https")
    if fwd_host:
        return f"{fwd_proto}://{fwd_host}"
    return str(http_request.base_url).rstrip("/")


@api.get("/sitemap.xml")
async def sitemap_xml(http_request: Request):
    from fastapi.responses import Response
    root = _site_root(http_request)
    static_paths = ["/", "/shop", "/makers", "/custom-order", "/apply", "/journal"]
    products = await db.products.find({}, {"_id": 0, "slug": 1, "created_at": 1}).to_list(2000)
    makers = await db.makers.find({}, {"_id": 0, "slug": 1, "created_at": 1}).to_list(2000)
    posts = await db.blog_posts.find({}, {"_id": 0, "slug": 1, "created_at": 1}).to_list(2000)

    def _u(path: str, lastmod: str | None = None) -> str:
        lm = f"<lastmod>{lastmod[:10]}</lastmod>" if lastmod else ""
        return f"<url><loc>{root}{path}</loc>{lm}</url>"

    urls = [_u(p) for p in static_paths]
    urls += [_u(f"/shop/{p['slug']}", p.get("created_at")) for p in products]
    urls += [_u(f"/makers/{m['slug']}", m.get("created_at")) for m in makers]
    urls += [_u(f"/journal/{b['slug']}", b.get("created_at")) for b in posts]
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(urls) + "</urlset>"
    )
    return Response(content=xml, media_type="application/xml")


@api.get("/robots.txt")
async def robots_txt(http_request: Request):
    from fastapi.responses import PlainTextResponse
    root = _site_root(http_request)
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /maker/\n"
        "Disallow: /admin/\n"
        "Disallow: /checkout/\n"
        f"Sitemap: {root}/api/sitemap.xml\n"
    )
    return PlainTextResponse(body)


# ---------- Shipping helper ----------
SHIPPING_BY_CATEGORY = {
    "Wall Art": 25.0,
    "Custom Signs": 35.0,
    "Outdoor Art": 55.0,
}
DEFAULT_SHIPPING = 30.0
FREE_SHIPPING_THRESHOLD = 250.0


async def _resolve_cart(items: list) -> list[dict]:
    """Resolve cart items to product docs + qty. Raises 400 on invalid items."""
    out = []
    for ci in items:
        pid = ci.product_id if hasattr(ci, "product_id") else ci.get("product_id")
        qty = ci.quantity if hasattr(ci, "quantity") else ci.get("quantity", 1)
        prod = await db.products.find_one({"id": pid}, {"_id": 0})
        if not prod:
            prod = await db.products.find_one({"slug": pid}, {"_id": 0})
        if not prod:
            raise HTTPException(400, f"Invalid product: {pid}")
        out.append({"product": prod, "quantity": max(1, int(qty))})
    return out


def _quote_for(resolved: list[dict]) -> dict:
    subtotal = round(sum(r["product"]["price"] * r["quantity"] for r in resolved), 2)
    if subtotal >= FREE_SHIPPING_THRESHOLD:
        shipping = 0.0
    else:
        # use the highest shipping tier present in the cart (don't multiply by qty)
        shipping = max(
            (SHIPPING_BY_CATEGORY.get(r["product"]["category"], DEFAULT_SHIPPING)
             for r in resolved),
            default=DEFAULT_SHIPPING,
        )
    shipping = round(shipping, 2)
    return {
        "subtotal": subtotal,
        "shipping": shipping,
        "free_shipping_threshold": FREE_SHIPPING_THRESHOLD,
        "free_shipping_eligible": subtotal >= FREE_SHIPPING_THRESHOLD,
        "total_before_tax": round(subtotal + shipping, 2),
    }


@api.post("/cart/quote")
async def cart_quote(req: CheckoutRequest):
    if not req.items:
        return {"subtotal": 0.0, "shipping": 0.0,
                "free_shipping_threshold": FREE_SHIPPING_THRESHOLD,
                "free_shipping_eligible": False, "total_before_tax": 0.0}
    resolved = await _resolve_cart(req.items)
    return _quote_for(resolved)


# ---------- Stripe Checkout ----------
@api.post("/checkout/session")
async def create_checkout(req: CheckoutRequest, http_request: Request):
    if not req.items:
        raise HTTPException(400, "Cart is empty")
    resolved = await _resolve_cart(req.items)
    quote = _quote_for(resolved)
    if quote["total_before_tax"] <= 0:
        raise HTTPException(400, "Invalid total")

    host_url = _public_host(http_request)
    webhook_url = f"{host_url}/api/webhook/stripe"
    success_url = f"{req.origin_url}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{req.origin_url}/cart"

    # Build proper Stripe line items + shipping option using the native SDK
    import stripe as stripe_sdk
    stripe_sdk.api_key = STRIPE_API_KEY

    line_items = []
    for r in resolved:
        p = r["product"]
        line_items.append({
            "price_data": {
                "currency": "usd",
                "product_data": {
                    "name": p["title"],
                    "description": (p.get("description") or "")[:300],
                    "images": p.get("images", [])[:1],
                },
                "unit_amount": int(round(float(p["price"]) * 100)),
            },
            "quantity": r["quantity"],
        })

    shipping_options = []
    if quote["shipping"] > 0:
        shipping_options.append({
            "shipping_rate_data": {
                "display_name": "Standard shipping",
                "type": "fixed_amount",
                "fixed_amount": {
                    "amount": int(round(quote["shipping"] * 100)),
                    "currency": "usd",
                },
                "delivery_estimate": {
                    "minimum": {"unit": "business_day", "value": 5},
                    "maximum": {"unit": "business_day", "value": 10},
                },
            }
        })
    else:
        shipping_options.append({
            "shipping_rate_data": {
                "display_name": "Free shipping",
                "type": "fixed_amount",
                "fixed_amount": {"amount": 0, "currency": "usd"},
                "delivery_estimate": {
                    "minimum": {"unit": "business_day", "value": 5},
                    "maximum": {"unit": "business_day", "value": 10},
                },
            }
        })

    line_summary = " | ".join(f"{r['product']['title']} × {r['quantity']}" for r in resolved)

    session_kwargs = {
        "mode": "payment",
        "payment_method_types": ["card"],
        "line_items": line_items,
        "shipping_options": shipping_options,
        "shipping_address_collection": {"allowed_countries": ["US", "CA"]},
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": {
            "summary": line_summary[:480],
            "customer_email": req.customer_email or "",
        },
    }
    # Stripe Tax: enable if account is configured for it; gracefully fall back if not.
    try_with_tax = os.environ.get("STRIPE_AUTOMATIC_TAX", "true").lower() == "true"
    try:
        if try_with_tax:
            session_kwargs_tax = {**session_kwargs, "automatic_tax": {"enabled": True}}
            if req.customer_email:
                session_kwargs_tax["customer_email"] = req.customer_email
            session = stripe_sdk.checkout.Session.create(**session_kwargs_tax)
        else:
            raise RuntimeError("automatic_tax disabled by env")
    except Exception as e:  # pragma: no cover
        logger.warning("automatic_tax not available, retrying without it: %s", e)
        if req.customer_email:
            session_kwargs["customer_email"] = req.customer_email
        session = stripe_sdk.checkout.Session.create(**session_kwargs)

    total = quote["total_before_tax"]
    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": session.id,
        "amount": total,
        "subtotal": quote["subtotal"],
        "shipping": quote["shipping"],
        "currency": "usd",
        "items": [ci.model_dump() for ci in req.items],
        "summary": line_summary,
        "customer_email": req.customer_email,
        "payment_status": "initiated",
        "status": "open",
        "created_at": now_iso(),
    })
    return {"url": session.url, "session_id": session.id, "amount": total,
            "subtotal": quote["subtotal"], "shipping": quote["shipping"]}


@api.get("/checkout/status/{session_id}")
async def checkout_status(session_id: str, http_request: Request, bg: BackgroundTasks):
    host_url = _public_host(http_request)
    webhook_url = f"{host_url}/api/webhook/stripe"
    stripe = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)

    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    fallback_amount = int(round(float(tx["amount"]) * 100)) if tx and tx.get("amount") else 0

    try:
        import stripe as stripe_sdk
        stripe_sdk.api_key = STRIPE_API_KEY
        sess = stripe_sdk.checkout.Session.retrieve(session_id)
        result = {
            "status": sess.get("status") or "open",
            "payment_status": sess.get("payment_status") or "unpaid",
            "amount_total": sess.get("amount_total") or 0,
            "currency": sess.get("currency") or "usd",
        }
    except Exception as e:
        logger.warning("status retrieve failed (%s) — using local fallback", e)
        if not tx:
            return {"status": "open", "payment_status": "unpaid", "amount_total": 0, "currency": "usd"}
        result = {
            "status": tx.get("status", "open"),
            "payment_status": tx.get("payment_status", "unpaid"),
            "amount_total": fallback_amount,
            "currency": tx.get("currency", "usd"),
        }

    if tx and tx.get("payment_status") != result["payment_status"]:
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": result["payment_status"],
                      "status": result["status"],
                      "updated_at": now_iso()}}
        )
        if result["payment_status"] == "paid" and tx.get("payment_status") != "paid":
            summary = tx.get("summary", "Order")
            await db.activity_events.insert_one(
                ActivityEvent(kind="sold",
                              text=f"{summary} sold to a buyer",
                              location="Crafters Market").model_dump()
            )
            # enrich items with title for the email; group by maker
            email_items = []
            by_maker: dict[str, list] = {}
            for ci in tx.get("items", []):
                p = await db.products.find_one({"id": ci["product_id"]}, {"_id": 0}) \
                    or await db.products.find_one({"slug": ci["product_id"]}, {"_id": 0})
                if not p:
                    continue
                line = {"title": p["title"], "price": p["price"], "quantity": ci.get("quantity", 1)}
                email_items.append(line)
                by_maker.setdefault(p["maker_slug"], []).append(line)
            buyer = tx.get("customer_email")
            total_amount = float(tx.get("amount", 0))
            bg.add_task(send_ops_new_order, summary, total_amount, email_items, buyer)
            if buyer:
                bg.add_task(send_buyer_receipt, buyer, summary, total_amount, email_items)
            # per-maker alerts
            for maker_slug, lines in by_maker.items():
                m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
                if not m or not m.get("email"):
                    continue
                subtotal = sum(float(l["price"]) * int(l["quantity"]) for l in lines)
                bg.add_task(send_maker_new_order,
                            m["email"], m["name"], lines, subtotal, buyer)
    return result


@api.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    host_url = _public_host(request)
    webhook_url = f"{host_url}/api/webhook/stripe"
    stripe = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    try:
        evt = await stripe.handle_webhook(body, sig)
    except Exception as e:
        logger.exception("webhook fail: %s", e)
        return {"received": False}
    await db.payment_transactions.update_one(
        {"session_id": evt.session_id},
        {"$set": {"payment_status": evt.payment_status, "updated_at": now_iso()}}
    )
    return {"received": True}


# ---------- Maker Portal (magic-link auth) ----------
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


@api.post("/maker/auth/request")
async def maker_auth_request(payload: MakerLoginRequest, bg: BackgroundTasks):
    """Send a magic link if a maker with that email exists. Always returns 200 (no enumeration)."""
    email = payload.email.lower().strip()
    maker = await db.makers.find_one({"email": email}, {"_id": 0})
    if maker:
        token = issue_magic_token(email)
        link = f"{payload.origin_url.rstrip('/')}/maker/verify?token={token}"
        bg.add_task(send_maker_magic_link, email, maker["name"], link)
        logger.info("magic link issued for maker=%s", maker["slug"])
    else:
        logger.info("magic link requested for unknown email=%s (silent)", email)
    return {"sent": True, "message": "If that email matches a maker on file, a sign-in link is on its way."}


@api.post("/maker/auth/verify")
async def maker_auth_verify(payload: MakerVerifyRequest):
    email = verify_magic_token(payload.token)
    maker = await db.makers.find_one({"email": email}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker no longer exists.")
    jwt_token = issue_session_jwt(maker["slug"], email)
    return {"token": jwt_token, "maker": maker}


@api.get("/maker/me", response_model=Maker)
async def maker_me(slug: str = Depends(current_maker_slug)):
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found")
    return maker


@api.patch("/maker/profile", response_model=Maker)
async def maker_update_profile(
    payload: MakerProfileUpdate,
    slug: str = Depends(current_maker_slug),
):
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if updates:
        await db.makers.update_one({"slug": slug}, {"$set": updates})
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found")
    return maker


@api.get("/maker/products", response_model=List[Product])
async def maker_products(slug: str = Depends(current_maker_slug)):
    return await db.products.find({"maker_slug": slug}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.get("/maker/orders")
async def maker_orders(slug: str = Depends(current_maker_slug)):
    """Returns paid orders that include at least one product from this maker."""
    # Pre-fetch maker products keyed by id and slug for fast lookup
    products = await db.products.find({"maker_slug": slug}, {"_id": 0}).to_list(500)
    by_id = {p["id"]: p for p in products}
    by_slug = {p["slug"]: p for p in products}

    txs = await db.payment_transactions.find(
        {"payment_status": "paid"}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)

    out = []
    for tx in txs:
        my_lines = []
        for ci in tx.get("items", []):
            pid = ci.get("product_id")
            p = by_id.get(pid) or by_slug.get(pid)
            if not p:
                continue
            qty = int(ci.get("quantity", 1))
            my_lines.append({
                "product_slug": p["slug"],
                "title": p["title"],
                "price": p["price"],
                "quantity": qty,
                "subtotal": round(float(p["price"]) * qty, 2),
            })
        if not my_lines:
            continue
        out.append({
            "session_id": tx.get("session_id"),
            "buyer_email": tx.get("customer_email"),
            "created_at": tx.get("created_at"),
            "payment_status": tx.get("payment_status"),
            "items": my_lines,
            "maker_subtotal": round(sum(l["subtotal"] for l in my_lines), 2),
        })
    return out


# ---------- Admin Console (magic-link, single admin via OPS_EMAIL) ----------
ADMIN_EMAIL = (os.environ.get("OPS_EMAIL") or "").lower().strip()


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


@api.post("/admin/auth/request")
async def admin_auth_request(payload: AdminLoginRequest, bg: BackgroundTasks):
    """Issue an admin magic link only if the requested email matches OPS_EMAIL."""
    email = payload.email.lower().strip()
    if ADMIN_EMAIL and email == ADMIN_EMAIL:
        token = issue_admin_magic_token(email)
        link = f"{payload.origin_url.rstrip('/')}/admin/verify?token={token}"
        bg.add_task(send_admin_magic_link, email, link)
        logger.info("admin magic link issued")
    else:
        logger.info("admin link requested for non-admin email=%s (silent)", email)
    return {"sent": True, "message": "If that email is the operator on file, a sign-in link is on its way."}


@api.post("/admin/auth/verify")
async def admin_auth_verify(payload: AdminVerifyRequest):
    email = verify_admin_magic_token(payload.token)
    if not ADMIN_EMAIL or email != ADMIN_EMAIL:
        raise HTTPException(403, "Not an admin email.")
    jwt_token = issue_session_jwt("admin", email, role="admin")
    return {"token": jwt_token, "email": email}


@api.get("/admin/me")
async def admin_me(claims: dict = Depends(current_admin)):
    return {"email": claims["email"], "role": claims["role"]}


@api.get("/admin/maker-applications")
async def admin_maker_applications(_: dict = Depends(current_admin)):
    return await db.maker_applications.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.get("/admin/custom-orders")
async def admin_custom_orders(_: dict = Depends(current_admin)):
    return await db.custom_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.get("/admin/orders")
async def admin_orders(_: dict = Depends(current_admin)):
    """All paid orders, newest first."""
    return await db.payment_transactions.find(
        {"payment_status": "paid"}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)


@api.patch("/admin/maker-applications/{app_id}")
async def admin_decide_application(
    app_id: str, body: ApplicationDecision, bg: BackgroundTasks,
    _: dict = Depends(current_admin),
):
    appn = await db.maker_applications.find_one({"id": app_id}, {"_id": 0})
    if not appn:
        raise HTTPException(404, "Application not found")
    new_status = "approved" if body.approved else "rejected"
    await db.maker_applications.update_one(
        {"id": app_id},
        {"$set": {"status": new_status, "note": body.note, "decided_at": now_iso()}},
    )
    bg.add_task(
        send_application_decision,
        appn["email"], appn["name"], appn["studio_name"], body.approved, body.note or "",
    )
    appn["status"] = new_status
    appn["note"] = body.note
    appn["decided_at"] = now_iso()
    return appn


@api.patch("/admin/custom-orders/{order_id}")
async def admin_quote_custom_order(
    order_id: str, body: CustomOrderQuote, bg: BackgroundTasks,
    _: dict = Depends(current_admin),
):
    order = await db.custom_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Custom order not found")
    await db.custom_orders.update_one(
        {"id": order_id},
        {"$set": {"status": "quoted", "quote": body.quote, "quote_note": body.message,
                  "quoted_at": now_iso()}},
    )
    bg.add_task(
        send_custom_order_quote,
        order["email"], order["name"], order["project_type"], body.quote, body.message or "",
    )
    order["status"] = "quoted"
    order["quote"] = body.quote
    order["quote_note"] = body.message
    return order


# ---------- Wire up ----------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db():
    client.close()
