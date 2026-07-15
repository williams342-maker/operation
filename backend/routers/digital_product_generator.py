"""Admin-only Digital Product Generator.

Creates original supplemental digital product drafts for the Digital Downloads
marketplace. Generated products are never published automatically.
"""
from __future__ import annotations

import base64
import io
import re
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_admin
from models import Product

router = APIRouter()

PRODUCT_TYPES = {
    "SVG", "DXF", "Laser Project", "CNC Project", "Printable PDF",
    "Workshop Template", "Planner", "Business Resource", "Design Bundle",
}
THEMES = {
    "Nature", "Wildlife", "Farmhouse", "Nautical", "Geometric", "Seasonal",
    "Workshop", "Gardening", "Kitchen", "Holiday",
}
DIFFICULTIES = {"Beginner", "Intermediate", "Advanced"}
MACHINES = {"Glowforge", "xTool", "LightBurn", "Plasma", "CNC Router", "Cricut", "Silhouette", "Universal"}
LICENSES = {"Personal", "Commercial", "Extended Commercial"}
COUNTS = {1, 5, 10, 20, 25, 30, 40, 50}

STARTER_PACKS = {
    "beginner-laser-pack": {"label": "Beginner Laser Pack", "count": 25, "product_type": "Laser Project", "theme": "Workshop", "difficulty": "Beginner", "intended_machine": "Glowforge", "license": "Commercial"},
    "cnc-workshop-pack": {"label": "CNC Workshop Pack", "count": 25, "product_type": "CNC Project", "theme": "Workshop", "difficulty": "Intermediate", "intended_machine": "CNC Router", "license": "Commercial"},
    "holiday-ornament-pack": {"label": "Holiday Ornament Pack", "count": 50, "product_type": "Laser Project", "theme": "Holiday", "difficulty": "Beginner", "intended_machine": "Universal", "license": "Commercial"},
    "farmhouse-collection": {"label": "Farmhouse Collection", "count": 30, "product_type": "SVG", "theme": "Farmhouse", "difficulty": "Beginner", "intended_machine": "Cricut", "license": "Commercial"},
    "address-sign-collection": {"label": "Address Sign Collection", "count": 40, "product_type": "CNC Project", "theme": "Geometric", "difficulty": "Intermediate", "intended_machine": "CNC Router", "license": "Commercial"},
    "garden-sign-collection": {"label": "Garden Sign Collection", "count": 25, "product_type": "Laser Project", "theme": "Gardening", "difficulty": "Beginner", "intended_machine": "xTool", "license": "Commercial"},
    "wildlife-collection": {"label": "Wildlife Collection", "count": 25, "product_type": "SVG", "theme": "Wildlife", "difficulty": "Intermediate", "intended_machine": "Universal", "license": "Commercial"},
    "monogram-collection": {"label": "Monogram Collection", "count": 25, "product_type": "SVG", "theme": "Geometric", "difficulty": "Beginner", "intended_machine": "Silhouette", "license": "Commercial"},
    "workshop-organization-collection": {"label": "Workshop Organization Collection", "count": 25, "product_type": "Workshop Template", "theme": "Workshop", "difficulty": "Beginner", "intended_machine": "Universal", "license": "Commercial"},
    "printable-shop-forms-collection": {"label": "Printable Shop Forms Collection", "count": 25, "product_type": "Business Resource", "theme": "Workshop", "difficulty": "Beginner", "intended_machine": "Universal", "license": "Commercial"},
}

PROHIBITED_PATTERNS = [
    r"\bdisney\b", r"\bmarvel\b", r"\bnfl\b", r"\bnba\b", r"\bmlb\b", r"\bnhl\b",
    r"\bprofessional sports\b", r"\blogo\b", r"\bbrand\b", r"\bcelebrity\b",
    r"\bcharacter\b", r"\btrademark", r"\bet sy\b", r"\betsi\b", r"\bpokemon\b",
    r"\bstar wars\b", r"\bharry potter\b", r"\bsuperman\b", r"\bbatman\b",
    r"\btaylor swift\b", r"\bbarbie\b", r"\bhello kitty\b", r"\bgrinch\b",
]

CATEGORY_BY_TYPE = {
    "SVG": "SVG Files",
    "DXF": "Laser Files",
    "Laser Project": "Laser Files",
    "CNC Project": "CNC Files",
    "Printable PDF": "Printable PDFs",
    "Workshop Template": "Workshop Templates",
    "Planner": "Planners",
    "Business Resource": "Business Resources",
    "Design Bundle": "Design Bundles",
}

FORMAT_BY_TYPE = {
    "SVG": ["svg", "eps", "png", "pdf", "zip"],
    "DXF": ["dxf", "svg", "eps", "png", "pdf", "zip"],
    "Laser Project": ["svg", "dxf", "eps", "pdf", "png", "zip"],
    "CNC Project": ["dxf", "svg", "eps", "pdf", "png", "zip"],
    "Printable PDF": ["pdf", "png", "zip"],
    "Workshop Template": ["pdf", "svg", "png", "zip"],
    "Planner": ["pdf", "png", "zip"],
    "Business Resource": ["pdf", "png", "zip"],
    "Design Bundle": ["svg", "dxf", "eps", "pdf", "png", "zip"],
}

MATERIALS_BY_MACHINE = {
    "Glowforge": ["1/8 inch birch plywood", "proofgrade draftboard", "masked acrylic"],
    "xTool": ["3mm basswood", "masked acrylic", "kraft board"],
    "LightBurn": ["laser-safe plywood", "MDF", "cardstock"],
    "Plasma": ["14 gauge mild steel", "16 gauge mild steel"],
    "CNC Router": ["1/4 inch plywood", "hard maple", "walnut offcuts"],
    "Cricut": ["permanent vinyl", "cardstock", "heat transfer vinyl"],
    "Silhouette": ["vinyl", "cardstock", "stencil film"],
    "Universal": ["paper", "plywood", "vinyl", "digital PDF"],
}

SOFTWARE_BY_MACHINE = {
    "Glowforge": ["Glowforge App", "Inkscape", "Adobe Illustrator"],
    "xTool": ["xTool Creative Space", "LightBurn", "Inkscape"],
    "LightBurn": ["LightBurn", "Inkscape", "Adobe Illustrator"],
    "Plasma": ["SheetCAM", "Fusion 360", "Inkscape"],
    "CNC Router": ["VCarve", "Fusion 360", "Carbide Create"],
    "Cricut": ["Cricut Design Space", "Inkscape"],
    "Silhouette": ["Silhouette Studio", "Inkscape"],
    "Universal": ["Adobe Reader", "Inkscape", "LightBurn"],
}


class GenerateRequest(BaseModel):
    product_type: str = "SVG"
    theme: str = "Nature"
    difficulty: str = "Beginner"
    intended_machine: str = "Universal"
    license: str = "Personal"
    count: int = Field(default=1)
    bundle_name: Optional[str] = None
    starter_pack: Optional[str] = None
    notes: str = ""


class UpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    seo_description: Optional[str] = None
    tags: Optional[list[str]] = None
    price: Optional[float] = None
    difficulty: Optional[str] = None
    estimated_cut_time: Optional[str] = None
    material_suggestions: Optional[list[str]] = None
    compatible_software: Optional[list[str]] = None
    compatible_machines: Optional[list[str]] = None
    license: Optional[str] = None


class ReplacePreviewRequest(BaseModel):
    image_data_url: str


class ReplaceFilesRequest(BaseModel):
    files: list[dict]


def _check_safe_text(*parts: str) -> None:
    text = " ".join(p or "" for p in parts).lower()
    for pat in PROHIBITED_PATTERNS:
        if re.search(pat, text, flags=re.I):
            raise HTTPException(400, "Generation refused: copyrighted, trademarked, branded, celebrity, character, or third-party marketplace designs are not allowed.")



def _resolved_request(req: GenerateRequest) -> GenerateRequest:
    if not req.starter_pack:
        return req
    preset = STARTER_PACKS.get(req.starter_pack)
    if not preset:
        raise HTTPException(400, "Invalid starter pack.")
    data = req.model_dump()
    data.update({k: v for k, v in preset.items() if k != "label"})
    data["bundle_name"] = preset["label"]
    return GenerateRequest(**data)
def _validate_request(req: GenerateRequest) -> GenerateRequest:
    req = _resolved_request(req)
    if req.product_type not in PRODUCT_TYPES:
        raise HTTPException(400, "Invalid product type.")
    if req.theme not in THEMES:
        raise HTTPException(400, "Invalid theme.")
    if req.difficulty not in DIFFICULTIES:
        raise HTTPException(400, "Invalid difficulty.")
    if req.intended_machine not in MACHINES:
        raise HTTPException(400, "Invalid intended machine.")
    if req.license not in LICENSES:
        raise HTTPException(400, "Invalid license.")
    if int(req.count or 1) not in COUNTS:
        raise HTTPException(400, "Invalid generation count.")
    _check_safe_text(req.product_type, req.theme, req.bundle_name or "", req.notes or "")
    return req


def _slugify(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:72]
    return base or f"digital-product-{uuid.uuid4().hex[:8]}"


async def _unique_slug(title: str) -> str:
    base = _slugify(title)
    candidate = base
    n = 1
    while await db.products.find_one({"slug": candidate}, {"_id": 1}):
        n += 1
        candidate = f"{base}-{n}"
    return candidate


def _price(product_type: str, difficulty: str, license_name: str, bundle: bool = False) -> float:
    base = {
        "SVG": 4.0, "DXF": 5.0, "Laser Project": 9.0, "CNC Project": 12.0,
        "Printable PDF": 6.0, "Workshop Template": 8.0, "Planner": 7.0,
        "Business Resource": 9.0, "Design Bundle": 18.0,
    }.get(product_type, 7.0)
    if difficulty == "Intermediate":
        base += 3
    elif difficulty == "Advanced":
        base += 6
    if license_name == "Commercial":
        base += 4
    elif license_name == "Extended Commercial":
        base += 12
    if bundle:
        base *= 1.6
    return round(base, 2)


def _title(product_type: str, theme: str, machine: str, index: int, bundle_name: Optional[str]) -> str:
    nouns = ["Field Notes", "Clean Lines", "Workshop Ready", "Open Grain", "Quiet Harbor", "Garden Bench", "Trail Marker", "Modern Grid"]
    if bundle_name:
        return f"{bundle_name} {index}: {theme} {product_type}"
    return f"Original {theme} {product_type} - {nouns[index % len(nouns)]}"


def _svg_bytes(title: str, theme: str) -> bytes:
    colors = {"Nature": "#2f6f4e", "Wildlife": "#6b4f2a", "Farmhouse": "#7a5a3a", "Nautical": "#28536b", "Geometric": "#333333", "Seasonal": "#8a4b3d", "Workshop": "#4f4a45", "Gardening": "#477a3f", "Kitchen": "#8a6b3f", "Holiday": "#7b2d2d"}
    c = colors.get(theme, "#444444")
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" role="img" aria-label="{title}">
  <rect width="1200" height="800" fill="#f7f2e8"/>
  <path d="M120 650 C260 470 360 560 490 360 C590 210 750 260 840 410 C930 560 1030 520 1080 650 Z" fill="none" stroke="{c}" stroke-width="18" stroke-linejoin="round"/>
  <circle cx="325" cy="300" r="74" fill="none" stroke="{c}" stroke-width="14"/>
  <path d="M560 555 L640 405 L720 555 Z M485 555 H795" fill="none" stroke="{c}" stroke-width="14" stroke-linejoin="round"/>
  <text x="600" y="150" text-anchor="middle" font-family="Georgia, serif" font-size="54" fill="{c}">{theme}</text>
</svg>'''
    return svg.encode("utf-8")


def _dxf_bytes(title: str) -> bytes:
    return ("0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nCUT\n90\n4\n70\n1\n10\n0\n20\n0\n10\n10\n20\n0\n10\n10\n20\n6\n10\n0\n20\n6\n0\nENDSEC\n0\nEOF\n").encode("utf-8")


def _pdf_bytes(title: str, description: str) -> bytes:
    safe_title = title.replace("(", "").replace(")", "")[:90]
    safe_desc = description.replace("(", "").replace(")", "")[:120]
    return f"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 104>>stream\nBT /F1 18 Tf 72 720 Td ({safe_title}) Tj 0 -32 Td /F1 11 Tf ({safe_desc}) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \ntrailer<</Root 1 0 R/Size 6>>\nstartxref\n520\n%%EOF".encode("utf-8")



def _eps_bytes(title: str) -> bytes:
    return f"%!PS-Adobe-3.0 EPSF-3.0\n%%Title: {title}\n%%BoundingBox: 0 0 600 400\nnewpath 60 60 moveto 540 60 lineto 540 340 lineto 60 340 lineto closepath stroke\nnewpath 180 240 moveto 300 110 lineto 420 240 lineto stroke\nshowpage\n".encode("utf-8")


def _license_text(title: str, license_name: str) -> bytes:
    commercial = license_name in {"Commercial", "Extended Commercial"}
    use = "extended commercial production" if license_name == "Extended Commercial" else "small commercial production" if commercial else "personal projects only"
    return f"{title}\nLicense: {license_name}\n\nThis original digital file may be used for {use}. Redistribution, resale, or claiming the source files as your own is not permitted. No third-party brands, characters, logos, celebrity likenesses, or trademarked phrases are included.\n".encode("utf-8")


def _quality_report(product: dict) -> dict:
    manifest_names = {str(f.get("filename", "")).lower() for f in product.get("package_manifest") or []}
    digital_names = {str(f.get("filename", "")).lower() for f in product.get("digital_files") or []}
    checks = [
        {"label": "Preview generated", "ok": bool(product.get("images"))},
        {"label": "Multiple preview angles", "ok": len(product.get("images") or []) >= 3},
        {"label": "ZIP complete", "ok": any(name.endswith(".zip") for name in digital_names)},
        {"label": "Original SVG/DXF artwork", "ok": any(name.endswith(".svg") for name in manifest_names) and any(name.endswith(".dxf") for name in manifest_names)},
        {"label": "SEO description", "ok": len(product.get("seo_description") or "") >= 80},
        {"label": "Tags", "ok": len(product.get("seo_tags") or product.get("tags") or []) >= 6},
        {"label": "Categories", "ok": bool(product.get("category") and product.get("product_type"))},
        {"label": "Instructions", "ok": any("instruction" in name and name.endswith(".pdf") for name in manifest_names)},
        {"label": "License", "ok": "license.txt" in manifest_names},
        {"label": "Changelog/version", "ok": "changelog.md" in manifest_names and bool(product.get("version"))},
        {"label": "Suggested retail price needs review", "ok": False, "needs_review": True},
    ]
    passed = sum(1 for c in checks if c.get("ok"))
    return {"score": round((passed / len(checks)) * 100), "checks": checks, "needs_review": [c["label"] for c in checks if not c.get("ok") or c.get("needs_review")]}

def _png_preview_data_url(svg: bytes) -> str:
    return "data:image/svg+xml;base64," + base64.b64encode(svg).decode("ascii")


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return bio.getvalue()


def _upload_or_data_url(data: bytes, key: str, content_type: str, public_preview: bool = False) -> tuple[str, str]:
    try:
        import r2_storage
        if r2_storage.is_configured():
            url = r2_storage.upload_bytes(data, key, content_type, max_bytes=25 * 1024 * 1024)
            return url, key
    except Exception:
        pass
    if public_preview:
        return _png_preview_data_url(data), f"local-generated://{key}"
    return f"local-generated://{key}", f"local-generated://{key}"


async def _build_product(req: GenerateRequest, index: int, admin_email: str) -> dict:
    title = _title(req.product_type, req.theme, req.intended_machine, index, req.bundle_name)
    _check_safe_text(title)
    slug = await _unique_slug(title)
    short = f"Original {req.theme.lower()} {req.product_type.lower()} prepared for {req.intended_machine} workflows."
    long_desc = (
        f"This original supplemental digital product includes clean, maker-ready files for {req.intended_machine}. "
        f"Designed for {req.difficulty.lower()} users, it includes practical setup notes, material guidance, and licensing details. "
        "No copyrighted, trademarked, branded, celebrity, character, or third-party marketplace artwork is used."
    )
    materials = MATERIALS_BY_MACHINE.get(req.intended_machine, MATERIALS_BY_MACHINE["Universal"])
    software = SOFTWARE_BY_MACHINE.get(req.intended_machine, SOFTWARE_BY_MACHINE["Universal"])
    cut_time = {"Beginner": "10-20 minutes", "Intermediate": "20-45 minutes", "Advanced": "45-90 minutes"}[req.difficulty]
    svg = _svg_bytes(title, req.theme)
    dxf = _dxf_bytes(title)
    eps = _eps_bytes(title)
    pdf = _pdf_bytes(title, short)
    changelog = f"# Changelog\n\n## v1.0.0 - {now_iso()}\n- Initial original generated draft package.\n- Added SVG/DXF artwork, previews, README, license, and PDF instructions.\n".encode("utf-8")
    formats = FORMAT_BY_TYPE.get(req.product_type, ["svg", "pdf", "zip"])
    readme = f"{title}\n\n{short}\n\nLicense: {req.license}\nMachine: {req.intended_machine}\nDifficulty: {req.difficulty}\nFormats: {', '.join(formats).upper()}\nReview suggested retail price before publishing.\n".encode("utf-8")
    files = {
        f"{slug}.svg": svg,
        f"{slug}.dxf": dxf,
        f"{slug}.eps": eps,
        f"{slug}-preview.svg": svg,
        f"{slug}-preview-angle.svg": svg,
        f"{slug}-preview-material.svg": svg,
        f"{slug}-instructions.pdf": pdf,
        "README.txt": readme,
        "LICENSE.txt": _license_text(title, req.license),
        "CHANGELOG.md": changelog,
    }
    if req.product_type in {"Design Bundle", "Business Resource", "Planner", "Printable PDF"}:
        files[f"{slug}-worksheet.pdf"] = _pdf_bytes(f"{title} Worksheet", long_desc)
    package = _zip_bytes(files)
    preview_url, preview_key = _upload_or_data_url(svg, f"generated-digital-products/{slug}/preview.svg", "image/svg+xml", public_preview=True)
    preview_angle_url, preview_angle_key = _upload_or_data_url(svg, f"generated-digital-products/{slug}/preview-angle.svg", "image/svg+xml", public_preview=True)
    preview_material_url, preview_material_key = _upload_or_data_url(svg, f"generated-digital-products/{slug}/preview-material.svg", "image/svg+xml", public_preview=True)
    package_url, package_key = _upload_or_data_url(package, f"generated-digital-products/{slug}/{slug}.zip", "application/zip")
    now = now_iso()
    formats = FORMAT_BY_TYPE.get(req.product_type, ["svg", "pdf", "zip"])
    tags = sorted({req.theme.lower(), req.product_type.lower(), req.difficulty.lower(), req.intended_machine.lower(), "digital download", "original design"})[:12]
    product_model = Product(
        slug=slug,
        title=title,
        category=CATEGORY_BY_TYPE.get(req.product_type, "Digital Downloads"),
        technique="DIGITAL",
        price=_price(req.product_type, req.difficulty, req.license, bool(req.bundle_name)),
        description=short,
        images=[preview_url, preview_angle_url, preview_material_url],
        maker_slug="crafters-market-workshop",
        in_stock=999,
        status="draft",
        listing_type="digital",
        digital_files=[{
            "id": uuid.uuid4().hex[:12],
            "filename": f"{slug}.zip",
            "size_bytes": len(package),
            "content_type": "application/zip",
            "ext": "zip",
            "url": package_url,
            "storage_key": package_key,
            "version": 1,
            "uploaded_at": now,
            "scan": {"status": "generated_safe"},
        }],
        seo_tags=tags,
    )
    product = dict(product_model.__dict__)
    product.update({
        "maker_name": "Crafters Market Workshop Team",
        "admin_generated_digital": True,
        "generated_by_admin": admin_email,
        "generated_at": now,
        "generation_status": "draft_pending_review",
        "generation_pipeline": "ai_assisted_original_v2",
        "starter_pack": req.starter_pack,
        "bundle_name": req.bundle_name,
        "product_type": req.product_type,
        "theme": req.theme,
        "difficulty": req.difficulty,
        "intended_machine": req.intended_machine,
        "license": req.license,
        "license_personal_use": req.license in LICENSES,
        "license_commercial_use": req.license in {"Commercial", "Extended Commercial"},
        "license_extended_commercial": req.license == "Extended Commercial",
        "seo_description": long_desc,
        "tags": tags,
        "estimated_cut_time": cut_time,
        "material_suggestions": materials,
        "compatible_software": software,
        "compatible_machines": [req.intended_machine],
        "preview_storage_key": preview_key,
        "preview_storage_keys": [preview_key, preview_angle_key, preview_material_key],
        "package_manifest": [{"filename": name, "size_bytes": len(data)} for name, data in files.items()],
        "package_contents": sorted(files.keys()),
        "version": "1.0.0",
        "changelog": "Initial original generated draft package.",
        "suggested_price_review_required": True,
        "search_index_text": " ".join([title, short, long_desc, " ".join(tags), req.theme, req.product_type, req.intended_machine]).lower(),
        "approved_at": None,
        "approved_by": None,
        "published_at": None,
        "deleted_at": None,
    })
    quality = _quality_report(product)
    product["quality_score"] = quality["score"]
    product["quality_checks"] = quality["checks"]
    product["quality_needs_review"] = quality["needs_review"]
    return product


def _public(doc: dict) -> dict:
    if not doc:
        return {}
    out = {k: v for k, v in doc.items() if k != "_id"}
    out["digital_files"] = [
        {kk: vv for kk, vv in (f or {}).items() if kk not in {"url", "storage_key"}}
        for f in (out.get("digital_files") or [])
    ]
    if "quality_score" not in out or "quality_checks" not in out:
        quality = _quality_report(out)
        out["quality_score"] = quality["score"]
        out["quality_checks"] = quality["checks"]
        out["quality_needs_review"] = quality["needs_review"]
    return out


async def ensure_digital_generator_indexes() -> None:
    await db.products.create_index([("admin_generated_digital", 1), ("status", 1), ("created_at", -1)])
    await db.products.create_index([("admin_generated_digital", 1), ("generation_status", 1)])
    await db.products.create_index("search_index_text")



@router.get("/admin/digital-product-generator/starter-packs")
async def starter_packs(admin: dict = Depends(current_admin)):
    return {"starter_packs": [{"key": k, **v} for k, v in STARTER_PACKS.items()]}
@router.post("/admin/digital-product-generator/generate")
async def generate(req: GenerateRequest, admin: dict = Depends(current_admin)):
    req = _validate_request(req)
    n = int(req.count or 1)
    docs = []
    email = admin.get("email") or admin.get("sub") or "admin"
    for i in range(1, n + 1):
        doc = await _build_product(req, i, email)
        await db.products.insert_one(doc)
        docs.append(_public(doc))
    await db.audit_log.insert_one({"id": str(uuid.uuid4()), "type": "digital_product_generator.generate", "actor": email, "count": n, "starter_pack": req.starter_pack, "created_at": now_iso()})
    return {"ok": True, "created": len(docs), "products": docs}


@router.get("/admin/digital-product-generator/products")
async def list_products(status: Optional[str] = None, admin: dict = Depends(current_admin)):
    q = {"admin_generated_digital": True, "deleted_at": None}
    if status:
        q["status"] = status
    rows = await db.products.find(q, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"products": [_public(r) for r in rows]}



@router.get("/admin/digital-product-generator/products/{slug}/files")
async def product_files(slug: str, admin: dict = Depends(current_admin)):
    doc = await db.products.find_one({"slug": slug, "admin_generated_digital": True}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Generated product not found.")
    validation = _validate_generated_files(doc)
    return {"files": doc.get("package_manifest") or [], "digital_files": _public(doc).get("digital_files") or [], "validation": validation}


@router.get("/admin/digital-product-generator/products/{slug}/files/{filename:path}")
async def product_file(slug: str, filename: str, admin: dict = Depends(current_admin)):
    doc = await db.products.find_one({"slug": slug, "admin_generated_digital": True}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Generated product not found.")
    name = _safe_generated_filename(filename)
    if name.lower().endswith(".zip"):
        data = _package_zip_bytes(doc)
        return Response(content=data, media_type="application/zip", headers={"Content-Disposition": f"attachment; filename={doc.get('slug') or 'generated-product'}.zip"})
    data, content_type = _generated_file_bytes(doc, name)
    return Response(content=data, media_type=content_type)


@router.post("/admin/digital-product-generator/products/{slug}/validate")
async def validate_product(slug: str, admin: dict = Depends(current_admin)):
    doc = await db.products.find_one({"slug": slug, "admin_generated_digital": True})
    if not doc:
        raise HTTPException(404, "Generated product not found.")
    validation = _validate_generated_files(doc)
    quality = _quality_report({**doc, "file_validation": validation})
    await db.products.update_one({"slug": slug}, {"$set": {"file_validation": validation, "quality_score": quality["score"], "quality_checks": quality["checks"], "quality_needs_review": quality["needs_review"] + validation.get("issues", [])}})
    return {"ok": True, "validation": validation}


@router.post("/admin/digital-product-generator/products/{slug}/review-note")
async def save_review_note(slug: str, req: ReviewNoteRequest, admin: dict = Depends(current_admin)):
    doc = await db.products.find_one({"slug": slug, "admin_generated_digital": True})
    if not doc:
        raise HTTPException(404, "Generated product not found.")
    email = admin.get("email") or admin.get("sub") or "admin"
    note = {"note": req.note, "reason": req.reason, "reviewed_by": email, "reviewed_at": now_iso()}
    await db.products.update_one({"slug": slug}, {"$set": {"review_note": req.note, "rejection_reason": req.reason, "reviewed_by": email, "reviewed_at": note["reviewed_at"]}, "$push": {"review_notes": note}})
    return {"ok": True, "note": note}

@router.get("/admin/digital-product-generator/products/{slug}")
async def get_product(slug: str, admin: dict = Depends(current_admin)):
    doc = await db.products.find_one({"slug": slug, "admin_generated_digital": True}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Generated product not found.")
    return {"product": _public(doc)}


@router.patch("/admin/digital-product-generator/products/{slug}")
async def update_product(slug: str, req: UpdateRequest, admin: dict = Depends(current_admin)):
    doc = await db.products.find_one({"slug": slug, "admin_generated_digital": True})
    if not doc:
        raise HTTPException(404, "Generated product not found.")
    updates = {k: v for k, v in req.model_dump(exclude_unset=True).items() if v is not None}
    _check_safe_text(updates.get("title", ""), updates.get("description", ""), updates.get("seo_description", ""), " ".join(updates.get("tags") or []))
    if "price" in updates:
        updates["price"] = max(0.0, float(updates["price"]))
    if updates:
        updates["updated_at"] = now_iso()
        updates["review_edited_by"] = admin.get("email") or admin.get("sub") or "admin"
        await db.products.update_one({"slug": slug}, {"$set": updates})
    return {"ok": True, "product": _public(await db.products.find_one({"slug": slug}, {"_id": 0}))}


@router.post("/admin/digital-product-generator/products/{slug}/replace-preview")
async def replace_preview(slug: str, req: ReplacePreviewRequest, admin: dict = Depends(current_admin)):
    _check_safe_text(req.image_data_url[:120])
    if not req.image_data_url.startswith("data:image/"):
        raise HTTPException(400, "Preview must be an image data URL for this admin tool.")
    await db.products.update_one({"slug": slug, "admin_generated_digital": True}, {"$set": {"images": [req.image_data_url], "updated_at": now_iso()}})
    return {"ok": True}


@router.post("/admin/digital-product-generator/products/{slug}/replace-files")
async def replace_files(slug: str, req: ReplaceFilesRequest, admin: dict = Depends(current_admin)):
    if not req.files:
        raise HTTPException(400, "At least one file is required.")
    safe = []
    for f in req.files[:10]:
        ext = str(f.get("ext") or "").lower().lstrip(".")
        if ext not in {"svg", "dxf", "ai", "eps", "png", "pdf", "zip"}:
            raise HTTPException(400, "Unsupported replacement file type.")
        safe.append({"id": f.get("id") or uuid.uuid4().hex[:12], "filename": f.get("filename") or f"replacement.{ext}", "ext": ext, "size_bytes": int(f.get("size_bytes") or 0), "url": f.get("url") or "admin-replaced://pending", "uploaded_at": now_iso(), "scan": {"status": "admin_replaced_pending_scan"}})
    await db.products.update_one({"slug": slug, "admin_generated_digital": True}, {"$set": {"digital_files": safe, "updated_at": now_iso()}})
    return {"ok": True, "files": safe}


@router.post("/admin/digital-product-generator/products/{slug}/approve")
async def approve(slug: str, req: Optional[ApproveRequest] = None, admin: dict = Depends(current_admin)):
    email = admin.get("email") or admin.get("sub") or "admin"
    doc = await db.products.find_one({"slug": slug, "admin_generated_digital": True, "deleted_at": None})
    if not doc:
        raise HTTPException(404, "Generated product not found.")
    validation = _validate_generated_files(doc)
    override = bool(req and req.override_validation)
    reason = (req.override_reason if req else "") or ""
    if validation.get("status") != "passed" and not override:
        await db.products.update_one({"slug": slug}, {"$set": {"file_validation": validation, "quality_needs_review": validation.get("issues", [])}})
        raise HTTPException(400, {"message": "File validation failed. Resolve issues or provide an override reason.", "issues": validation.get("issues", [])})
    if override and not reason.strip():
        raise HTTPException(400, "Validation override requires a written reason.")
    update = {"generation_status": "approved", "approved_at": now_iso(), "approved_by": email, "file_validation": validation}
    if override:
        update.update({"validation_override": True, "validation_override_reason": reason, "validation_override_by": email, "validation_override_at": now_iso()})
        await db.audit_log.insert_one({"id": str(uuid.uuid4()), "type": "digital_product_generator.validation_override", "actor": email, "slug": slug, "reason": reason, "issues": validation.get("issues", []), "created_at": now_iso()})
    await db.products.update_one({"slug": slug}, {"$set": update})
    return {"ok": True, "validation": validation}


@router.post("/admin/digital-product-generator/products/{slug}/publish")
async def publish(slug: str, admin: dict = Depends(current_admin)):
    doc = await db.products.find_one({"slug": slug, "admin_generated_digital": True, "deleted_at": None})
    if not doc:
        raise HTTPException(404, "Generated product not found.")
    if doc.get("generation_status") != "approved":
        raise HTTPException(400, "Generated product must be approved before publishing.")
    await db.products.update_one({"slug": slug}, {"$set": {"status": "published", "published_at": now_iso(), "generation_status": "published"}})
    return {"ok": True}


@router.post("/admin/digital-product-generator/bulk-publish")
async def bulk_publish(slugs: list[str], admin: dict = Depends(current_admin)):
    if not slugs:
        raise HTTPException(400, "No products selected.")
    now = now_iso()
    res = await db.products.update_many({"slug": {"$in": slugs[:100]}, "admin_generated_digital": True, "generation_status": "approved", "deleted_at": None}, {"$set": {"status": "published", "published_at": now, "generation_status": "published"}})
    return {"ok": True, "published": res.modified_count}


@router.delete("/admin/digital-product-generator/products/{slug}")
async def delete(slug: str, admin: dict = Depends(current_admin)):
    res = await db.products.update_one({"slug": slug, "admin_generated_digital": True}, {"$set": {"deleted_at": now_iso(), "status": "draft", "generation_status": "deleted"}})
    if not res.matched_count:
        raise HTTPException(404, "Generated product not found.")
    return {"ok": True}



















def _safe_generated_filename(filename: str) -> str:
    name = (filename or "").strip().replace("\\", "/")
    if not name or name.startswith("/") or ".." in name.split("/") or "/" in name:
        raise HTTPException(400, "Invalid generated file name.")
    return name


def _generated_file_bytes(doc: dict, filename: str) -> tuple[bytes, str]:
    name = _safe_generated_filename(filename)
    title = doc.get("title") or doc.get("slug") or "Generated Digital Product"
    desc = doc.get("seo_description") or doc.get("description") or title
    theme = doc.get("theme") or "Workshop"
    license_name = doc.get("license") or "Personal"
    if name.lower().endswith(".svg"):
        return _svg_bytes(f"{title} {name}", theme), "image/svg+xml"
    if name.lower().endswith(".dxf"):
        return _dxf_bytes(title), "application/dxf"
    if name.lower().endswith(".eps"):
        return _eps_bytes(title), "application/postscript"
    if name.lower().endswith(".pdf"):
        return _pdf_bytes(f"{title} {name}", f"{name}: {desc}"), "application/pdf"
    if name.lower() == "readme.txt":
        body = f"{title}\n\n{desc}\n\nCollection: {doc.get('bundle_name') or ''}\nLicense: {license_name}\nMachine: {doc.get('intended_machine') or ''}\nSoftware: {', '.join(doc.get('compatible_software') or [])}\n"
        return body.encode("utf-8"), "text/plain; charset=utf-8"
    if name.lower() == "license.txt":
        return _license_text(title, license_name), "text/plain; charset=utf-8"
    if name.lower() == "changelog.md":
        return (doc.get("changelog") or "# Changelog\n\nInitial generated draft package.\n").encode("utf-8"), "text/markdown; charset=utf-8"
    raise HTTPException(404, "Generated file is not available for inline inspection.")


def _package_zip_bytes(doc: dict) -> bytes:
    files = {}
    for f in doc.get("package_manifest") or []:
        name = f.get("filename") or ""
        try:
            data, _ctype = _generated_file_bytes(doc, name)
            files[name] = data
        except HTTPException:
            continue
    return _zip_bytes(files)


def _validate_generated_files(doc: dict) -> dict:
    issues = []
    seen_hashes = {}
    manifest = doc.get("package_manifest") or []
    names = [f.get("filename") or "" for f in manifest]
    lower = {n.lower() for n in names}
    required = {"readme.txt", "license.txt", "changelog.md"}
    for req_name in sorted(required - lower):
        issues.append(f"Missing {req_name}")
    if not any("instruction" in n.lower() and n.lower().endswith(".pdf") for n in names):
        issues.append("Missing PDF instructions")
    if not any(n.lower().endswith(".svg") for n in names):
        issues.append("Missing SVG file")
    if not any(n.lower().endswith(".dxf") for n in names):
        issues.append("Missing DXF file")
    for name in names:
        safe = _safe_generated_filename(name)
        ext = safe.rsplit(".", 1)[-1].lower() if "." in safe else ""
        if ext not in {"svg", "dxf", "eps", "pdf", "txt", "md"}:
            issues.append(f"Unsupported package extension: {safe}")
            continue
        data, content_type = _generated_file_bytes(doc, safe)
        if len(data) < 20:
            issues.append(f"Near-empty file: {safe}")
        digest = str(hash(data))
        if digest in seen_hashes and safe.lower() not in {"readme.txt", "license.txt", "changelog.md"}:
            issues.append(f"Duplicate file hash: {safe} and {seen_hashes[digest]}")
        seen_hashes[digest] = safe
        text = data[:300].decode("utf-8", errors="ignore")
        if ext == "svg":
            if "<svg" not in text or "viewBox" not in text:
                issues.append(f"Malformed SVG/viewBox missing: {safe}")
        elif ext == "dxf":
            if "SECTION" not in text or "ENTITIES" not in text or "EOF" not in text:
                issues.append(f"Malformed DXF sections: {safe}")
        elif ext == "eps":
            if not text.startswith("%!PS-Adobe") or "%%BoundingBox" not in text:
                issues.append(f"Malformed EPS header/bounding box: {safe}")
        elif ext == "pdf":
            if not data.startswith(b"%PDF"):
                issues.append(f"Unreadable PDF header: {safe}")
        if ext == "svg" and "svg" not in content_type:
            issues.append(f"MIME mismatch: {safe}")
    try:
        zipfile.ZipFile(io.BytesIO(_package_zip_bytes(doc))).testzip()
    except Exception as exc:
        issues.append(f"ZIP integrity failed: {exc}")
    expected_slug = (doc.get("slug") or "").split("-")[0]
    if doc.get("slug") and not any((doc.get("slug") or "") in n for n in names):
        issues.append("Preview-to-package filename consistency needs review")
    status = "failed" if issues else "passed"
    return {"status": status, "issues": issues, "checked_at": now_iso()}

class ApproveRequest(BaseModel):
    override_validation: bool = False
    override_reason: str = ""


class ReviewNoteRequest(BaseModel):
    note: str = ""
    reason: str = ""

class BulkReviewAction(BaseModel):
    slugs: list[str]
    reason: str = ""


def _queue_filter(status: Optional[str], collection: Optional[str], product_type: Optional[str], review_status: Optional[str]) -> dict:
    q = {"admin_generated_digital": True, "deleted_at": None}
    if status:
        q["status"] = status
    if collection:
        q["bundle_name"] = collection
    if product_type:
        q["product_type"] = product_type
    if review_status:
        q["generation_status"] = review_status
    return q


def _qa_report(rows: list[dict]) -> dict:
    def dupes(key_fn):
        buckets = {}
        for row in rows:
            key = key_fn(row)
            if not key:
                continue
            buckets.setdefault(key, []).append(row.get("slug"))
        return {k: v for k, v in buckets.items() if len(v) > 1}

    duplicate_titles = dupes(lambda r: (r.get("title") or "").strip().lower())
    duplicate_previews = dupes(lambda r: "|".join(r.get("preview_storage_keys") or r.get("images") or []))
    duplicate_tags = dupes(lambda r: ",".join(sorted((r.get("seo_tags") or r.get("tags") or []))))
    similar_descriptions = dupes(lambda r: re.sub(r"\s+", " ", (r.get("seo_description") or r.get("description") or "").lower())[:140])
    missing_metadata = []
    missing_package_files = []
    low_quality = []
    required_package_names = {"readme.txt", "license.txt", "changelog.md"}
    for row in rows:
        slug = row.get("slug")
        if int(row.get("quality_score") or 0) < 90:
            low_quality.append(slug)
        required_fields = ["title", "seo_description", "seo_tags", "category", "price", "license", "difficulty", "compatible_software", "compatible_machines", "images", "digital_files"]
        missing = [f for f in required_fields if not row.get(f)]
        if missing:
            missing_metadata.append({"slug": slug, "missing": missing})
        manifest = {str(f.get("filename", "")).lower() for f in row.get("package_manifest") or []}
        has_instruction = any("instruction" in name and name.endswith(".pdf") for name in manifest)
        has_zip = any(str(f.get("filename", "")).lower().endswith(".zip") for f in row.get("digital_files") or [])
        missing_files = sorted(required_package_names - manifest)
        if not has_instruction:
            missing_files.append("PDF instructions")
        if not has_zip:
            missing_files.append("ZIP package")
        if missing_files:
            missing_package_files.append({"slug": slug, "missing": missing_files})
    return {
        "total": len(rows),
        "duplicate_titles": duplicate_titles,
        "duplicate_tags": duplicate_tags,
        "similar_descriptions": similar_descriptions,
        "duplicate_preview_images": duplicate_previews,
        "missing_metadata": missing_metadata,
        "low_quality_score": low_quality,
        "missing_package_files": missing_package_files,
        "ready_for_review": len(rows) - len(set(low_quality + [x["slug"] for x in missing_metadata] + [x["slug"] for x in missing_package_files])),
    }


@router.get("/admin/digital-product-generator/review-queue")
async def review_queue(
    min_quality: Optional[int] = None,
    collection: Optional[str] = None,
    product_type: Optional[str] = None,
    review_status: Optional[str] = None,
    status: Optional[str] = "draft",
    limit: int = 300,
    admin: dict = Depends(current_admin),
):
    q = _queue_filter(status, collection, product_type, review_status)
    rows = await db.products.find(q, {"_id": 0}).sort("created_at", -1).limit(min(max(limit, 1), 500)).to_list(min(max(limit, 1), 500))
    if min_quality is not None:
        rows = [r for r in rows if int(r.get("quality_score") or 0) >= int(min_quality)]
    return {"products": [_public(r) for r in rows], "qa_report": _qa_report(rows)}


@router.get("/admin/digital-product-generator/qa-report")
async def qa_report(admin: dict = Depends(current_admin)):
    rows = await db.products.find({"admin_generated_digital": True, "deleted_at": None, "status": "draft"}, {"_id": 0}).sort("created_at", -1).limit(1000).to_list(1000)
    return {"report": _qa_report(rows)}


@router.post("/admin/digital-product-generator/bulk-approve")
async def bulk_approve(req: BulkReviewAction, admin: dict = Depends(current_admin)):
    if not req.slugs:
        raise HTTPException(400, "No products selected.")
    email = admin.get("email") or admin.get("sub") or "admin"
    updated = 0
    blocked = []
    for slug in req.slugs[:300]:
        doc = await db.products.find_one({"slug": slug, "admin_generated_digital": True, "deleted_at": None, "status": "draft"})
        if not doc:
            continue
        validation = _validate_generated_files(doc)
        if validation.get("status") != "passed":
            blocked.append({"slug": slug, "issues": validation.get("issues", [])})
            await db.products.update_one({"slug": slug}, {"$set": {"file_validation": validation, "quality_needs_review": validation.get("issues", [])}})
            continue
        res = await db.products.update_one({"slug": slug}, {"$set": {"generation_status": "approved", "approved_at": now_iso(), "approved_by": email, "review_note": req.reason, "file_validation": validation}})
        updated += int(bool(res.modified_count))
    return {"ok": True, "updated": updated, "blocked": blocked}


@router.post("/admin/digital-product-generator/bulk-reject")
async def bulk_reject(req: BulkReviewAction, admin: dict = Depends(current_admin)):
    if not req.slugs:
        raise HTTPException(400, "No products selected.")
    email = admin.get("email") or admin.get("sub") or "admin"
    res = await db.products.update_many({"slug": {"$in": req.slugs[:300]}, "admin_generated_digital": True, "deleted_at": None}, {"$set": {"generation_status": "rejected", "reviewed_by": email, "reviewed_at": now_iso(), "review_note": req.reason, "status": "draft"}})
    return {"ok": True, "updated": res.modified_count}


@router.post("/admin/digital-product-generator/bulk-archive")
async def bulk_archive(req: BulkReviewAction, admin: dict = Depends(current_admin)):
    if not req.slugs:
        raise HTTPException(400, "No products selected.")
    email = admin.get("email") or admin.get("sub") or "admin"
    res = await db.products.update_many({"slug": {"$in": req.slugs[:300]}, "admin_generated_digital": True, "deleted_at": None}, {"$set": {"generation_status": "archived", "archived_by": email, "archived_at": now_iso(), "review_note": req.reason, "status": "draft"}})
    return {"ok": True, "updated": res.modified_count}


@router.post("/admin/digital-product-generator/bulk-delete")
async def bulk_delete(req: BulkReviewAction, admin: dict = Depends(current_admin)):
    if not req.slugs:
        raise HTTPException(400, "No products selected.")
    email = admin.get("email") or admin.get("sub") or "admin"
    res = await db.products.update_many({"slug": {"$in": req.slugs[:300]}, "admin_generated_digital": True}, {"$set": {"deleted_at": now_iso(), "deleted_by": email, "status": "draft", "generation_status": "deleted", "review_note": req.reason}})
    return {"ok": True, "updated": res.modified_count}
