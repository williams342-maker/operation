"""iter454 — Digital Downloads marketplace landing (SEO destination).

GET /api/digital-downloads/summary → curated groups (SVG Files, Laser
Files, 3D Print Files, …) with live counts + sample products, all from
published digital/hybrid listings. Sanitization of file manifests is
handled by the Product model serializer.
"""
from fastapi import APIRouter

from core import db

router = APIRouter()

# key, label, blurb, matcher spec
GROUPS = [
    ("svg-files", "SVG Files", "Cut-ready vector art for Cricut, Silhouette & more",
     {"exts": {"svg"}}),
    ("laser-files", "Laser Files", "DXF / AI / EPS files tuned for laser cutters",
     {"exts": {"dxf", "ai", "eps"}}),
    ("cnc-files", "CNC Files", "Toolpath-ready DXF, DWG & STEP files for routers & plasma",
     {"exts": {"dxf", "dwg", "step", "stp"}}),
    ("3d-print-files", "3D Print Files", "STL & 3MF models ready to slice",
     {"exts": {"stl", "3mf"}}),
    ("embroidery-patterns", "Embroidery Patterns", "Stitch files & patterns for machine embroidery",
     {"text": ("embroider",)}),
    ("woodworking-plans", "Woodworking Plans", "Build plans, templates & cut lists",
     {"text": ("plan", "template", "blueprint"), "category": "Woodworking"}),
    ("printable-pdfs", "Printable PDFs", "Print-at-home art, patterns & guides",
     {"exts": {"pdf"}}),
    ("ebooks", "eBooks", "EPUB guides & books from makers",
     {"exts": {"epub"}}),
    ("audiobooks", "Audiobooks", "MP3 audio from creators",
     {"exts": {"mp3"}}),
]


def _matches(p: dict, spec: dict) -> bool:
    exts = {f.get("ext") for f in (p.get("digital_files") or [])}
    if spec.get("exts") and exts & spec["exts"]:
        return True
    hay = " ".join([p.get("title") or "", " ".join(p.get("tags") or []),
                    p.get("category") or ""]).lower()
    if spec.get("text") and any(t in hay for t in spec["text"]):
        if not spec.get("category") or p.get("category") == spec["category"]:
            return True
    if spec.get("category") and not spec.get("text") \
            and p.get("category") == spec["category"]:
        return True
    return False


@router.get("/digital-downloads/summary")
async def digital_downloads_summary():
    prods = await db.products.find(
        {"listing_type": {"$in": ["digital", "both"]}, "status": "published",
         "deleted_at": None},
        {"_id": 0, "slug": 1, "title": 1, "price": 1, "images": 1,
         "category": 1, "tags": 1, "maker_slug": 1, "maker_name": 1,
         "listing_type": 1, "digital_files.ext": 1}).to_list(3000)
    groups = []
    for key, label, blurb, spec in GROUPS:
        hits = [p for p in prods if _matches(p, spec)]
        groups.append({
            "key": key, "label": label, "blurb": blurb, "count": len(hits),
            "samples": [{"slug": p["slug"], "title": p["title"],
                         "price": p.get("price"),
                         "image": (p.get("images") or [None])[0],
                         "maker_name": p.get("maker_name")}
                        for p in hits[:4]],
        })
    return {"total_digital": len(prods), "groups": groups}
