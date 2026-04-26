"""Public catalog: products, makers, reviews, blog, activity, custom-orders, maker-applications."""
from typing import Dict, List, Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException

from core import db
from email_service import (
    send_buyer_custom_ack, send_ops_new_application, send_ops_new_custom_order,
)
from models import (
    ActivityEvent, BlogPost, CustomOrder, CustomOrderCreate,
    Maker, MakerApplication, MakerApplicationCreate,
    Product, Review,
)

router = APIRouter()


@router.get("/")
async def root():
    return {"service": "crafters-market", "status": "ok"}


@router.get("/products", response_model=List[Product])
async def list_products(category: Optional[str] = None, technique: Optional[str] = None,
                        q: Optional[str] = None, featured: Optional[bool] = None,
                        maker: Optional[str] = None):
    # Exclude soft-deleted listings AND drafts. In Mongo, `field: None` matches
    # both missing-field AND explicit-null docs — covers Pydantic's habit of
    # serializing Optional fields as null. Backwards-compat: products predating
    # the `status` field have no `status` key, so we use $ne:"draft" instead of
    # status:"published" so they keep showing up.
    query: Dict = {"deleted_at": None, "status": {"$ne": "draft"}}
    if category:
        query["category"] = category
    if technique:
        query["technique"] = technique.upper()
    if featured is not None:
        query["featured"] = featured
    if maker:
        query["maker_slug"] = maker
    if q:
        query["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
        ]
    return await db.products.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.get("/products/{slug}", response_model=Product)
async def get_product(slug: str):
    doc = await db.products.find_one(
        {"slug": slug, "deleted_at": None, "status": {"$ne": "draft"}}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(404, "Product not found")
    return doc


@router.get("/makers", response_model=List[Maker])
async def list_makers():
    return await db.makers.find({}, {"_id": 0}).to_list(200)


@router.get("/makers/{slug}", response_model=Maker)
async def get_maker(slug: str):
    doc = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Maker not found")
    return doc


@router.get("/reviews", response_model=List[Review])
async def list_reviews(limit: int = 20):
    return await db.reviews.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.get("/blog", response_model=List[BlogPost])
async def list_posts():
    return await db.blog_posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)


@router.get("/blog/{slug}", response_model=BlogPost)
async def get_post(slug: str):
    doc = await db.blog_posts.find_one({"slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Post not found")
    return doc


@router.post("/custom-orders", response_model=CustomOrder)
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


@router.post("/maker-applications", response_model=MakerApplication)
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


@router.get("/activity", response_model=List[ActivityEvent])
async def list_activity(limit: int = 20):
    return await db.activity_events.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
