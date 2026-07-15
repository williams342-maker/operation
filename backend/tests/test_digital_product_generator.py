import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

from routers import digital_product_generator as gen


class Result:
    def __init__(self, matched=1, modified=1):
        self.matched_count = matched
        self.modified_count = modified


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        self.rows = sorted(self.rows, key=lambda r: r.get("created_at", ""), reverse=True)
        return self

    def limit(self, n):
        self.rows = self.rows[:n]
        return self

    async def to_list(self, _n):
        return [dict(r) for r in self.rows]


class FakeProducts:
    def __init__(self):
        self.rows = []
        self.indexes = []

    async def find_one(self, q, projection=None):
        for row in self.rows:
            if self._match(row, q):
                return self._project(row, projection)
        return None

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    def find(self, q, projection=None):
        return Cursor([self._project(r, projection) for r in self.rows if self._match(r, q)])

    async def update_one(self, q, update):
        for row in self.rows:
            if self._match(row, q):
                row.update(update.get("$set", {}))
                for key, value in update.get("$push", {}).items():
                    row.setdefault(key, []).append(value)
                return Result(1, 1)
        return Result(0, 0)

    async def update_many(self, q, update):
        count = 0
        for row in self.rows:
            if self._match(row, q):
                row.update(update.get("$set", {}))
                count += 1
        return Result(count, count)

    async def create_index(self, spec):
        self.indexes.append(spec)

    def _project(self, row, projection):
        data = dict(row)
        if projection and projection.get("_id") == 0:
            data.pop("_id", None)
        return data

    def _match(self, row, q):
        for key, value in (q or {}).items():
            actual = row.get(key)
            if isinstance(value, dict) and "$in" in value:
                if actual not in value["$in"]:
                    return False
            elif actual != value:
                return False
        return True


class FakeAudit:
    def __init__(self):
        self.rows = []

    async def insert_one(self, doc):
        self.rows.append(dict(doc))


@pytest.fixture
def fake_db(monkeypatch):
    products = FakeProducts()
    audit = FakeAudit()
    monkeypatch.setattr(gen, "db", SimpleNamespace(products=products, audit_log=audit))
    monkeypatch.setattr(gen, "_upload_or_data_url", lambda data, key, content_type, public_preview=False: (f"local://{key}", key))
    return products, audit


def payload(**overrides):
    base = {
        "product_type": "SVG",
        "theme": "Nature",
        "difficulty": "Beginner",
        "intended_machine": "Universal",
        "license": "Personal",
        "count": 1,
        "bundle_name": None,
        "starter_pack": None,
        "notes": "original botanical file",
    }
    base.update(overrides)
    return gen.GenerateRequest(**base)


@pytest.mark.asyncio
async def test_generator_creates_draft_products_with_metadata_package_and_search_index(fake_db):
    products, audit = fake_db

    res = await gen.generate(payload(count=5, bundle_name="Beginner Laser Bundle"), {"email": "admin@example.test"})

    assert res["created"] == 5
    assert len(products.rows) == 5
    doc = products.rows[0]
    assert doc["status"] == "draft"
    assert doc["listing_type"] == "digital"
    assert doc["admin_generated_digital"] is True
    assert doc["generation_status"] == "draft_pending_review"
    assert doc["maker_slug"] == "crafters-market-workshop"
    assert doc["package_manifest"]
    assert any(f["filename"].endswith(".svg") for f in doc["package_manifest"])
    assert any(f["filename"].endswith(".dxf") for f in doc["package_manifest"])
    assert "LICENSE.txt" in doc["package_contents"]
    assert "CHANGELOG.md" in doc["package_contents"]
    assert len(doc["images"]) >= 3
    assert doc["quality_score"] >= 90
    assert "Suggested retail price needs review" in doc["quality_needs_review"]
    assert doc["digital_files"][0]["filename"].endswith(".zip")
    assert doc["digital_files"][0]["storage_key"].endswith(".zip")
    assert "nature" in doc["search_index_text"]
    assert audit.rows[-1]["type"] == "digital_product_generator.generate"
    assert "url" not in res["products"][0]["digital_files"][0]


@pytest.mark.asyncio
async def test_generator_rejects_copyright_and_trademark_requests(fake_db):
    with pytest.raises(HTTPException) as exc:
        await gen.generate(payload(theme="Nature", notes="make a Disney style logo"), {"email": "admin@example.test"})
    assert exc.value.status_code == 400
    assert "refused" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_admin_approval_publish_delete_flow(fake_db):
    products, _audit = fake_db
    res = await gen.generate(payload(), {"email": "admin@example.test"})
    slug = res["products"][0]["slug"]

    blocked = await _raises(lambda: gen.publish(slug, {"email": "admin@example.test"}))
    assert blocked.status_code == 400

    approved = await gen.approve(slug, None, {"email": "admin@example.test"})
    assert approved["ok"] is True
    assert products.rows[0]["generation_status"] == "approved"

    published = await gen.publish(slug, {"email": "admin@example.test"})
    assert published["ok"] is True
    assert products.rows[0]["status"] == "published"
    assert products.rows[0]["generation_status"] == "published"

    deleted = await gen.delete(slug, {"email": "admin@example.test"})
    assert deleted["ok"] is True
    assert products.rows[0]["deleted_at"]
    assert products.rows[0]["status"] == "draft"


@pytest.mark.asyncio
async def test_edit_replace_files_and_indexes(fake_db):
    products, _audit = fake_db
    res = await gen.generate(payload(), {"email": "admin@example.test"})
    slug = res["products"][0]["slug"]

    updated = await gen.update_product(slug, gen.UpdateRequest(title="Original Garden SVG Pack", price=6.5, tags=["garden", "svg"]), {"email": "admin@example.test"})
    assert updated["product"]["title"] == "Original Garden SVG Pack"
    assert products.rows[0]["price"] == 6.5

    files = [{"filename": "replacement.svg", "ext": "svg", "size_bytes": 1234, "url": "admin-replaced://safe"}]
    replaced = await gen.replace_files(slug, gen.ReplaceFilesRequest(files=files), {"email": "admin@example.test"})
    assert replaced["files"][0]["ext"] == "svg"
    assert products.rows[0]["digital_files"][0]["scan"]["status"] == "admin_replaced_pending_scan"

    await gen.ensure_digital_generator_indexes()
    assert products.indexes


async def _raises(fn):
    try:
        await fn()
    except HTTPException as exc:
        return exc
    raise AssertionError("Expected HTTPException")

@pytest.mark.asyncio
async def test_starter_pack_generates_curated_collection(fake_db):
    products, audit = fake_db

    res = await gen.generate(gen.GenerateRequest(starter_pack="holiday-ornament-pack"), {"email": "admin@example.test"})

    assert res["created"] == 50
    assert len(products.rows) == 50
    first = products.rows[0]
    assert first["bundle_name"] == "Holiday Ornament Pack"
    assert first["product_type"] == "Laser Project"
    assert first["theme"] == "Holiday"
    assert audit.rows[-1]["starter_pack"] == "holiday-ornament-pack"


@pytest.mark.asyncio
async def test_starter_pack_catalog_endpoint():
    body = await gen.starter_packs({"email": "admin@example.test"})
    labels = {p["label"] for p in body["starter_packs"]}
    assert "Beginner Laser Pack" in labels
    assert "Address Sign Collection" in labels
    assert "Printable Shop Forms Collection" in labels


@pytest.mark.asyncio
async def test_review_queue_qa_report_and_bulk_actions(fake_db):
    products, _audit = fake_db
    res = await gen.generate(payload(count=5, bundle_name="Review Queue Pack"), {"email": "admin@example.test"})
    slugs = [p["slug"] for p in res["products"]]

    queue = await gen.review_queue(collection="Review Queue Pack", review_status="draft_pending_review", admin={"email": "admin@example.test"})
    assert queue["qa_report"]["total"] == 5
    assert queue["products"][0]["status"] == "draft"

    approved = await gen.bulk_approve(gen.BulkReviewAction(slugs=slugs[:2], reason="QA pass"), {"email": "admin@example.test"})
    assert approved["updated"] == 2
    assert sum(1 for row in products.rows if row.get("generation_status") == "approved") == 2

    rejected = await gen.bulk_reject(gen.BulkReviewAction(slugs=slugs[2:3], reason="Needs redesign"), {"email": "admin@example.test"})
    archived = await gen.bulk_archive(gen.BulkReviewAction(slugs=slugs[3:4], reason="Hold"), {"email": "admin@example.test"})
    deleted = await gen.bulk_delete(gen.BulkReviewAction(slugs=slugs[4:], reason="Duplicate"), {"email": "admin@example.test"})
    assert rejected["updated"] == 1
    assert archived["updated"] == 1
    assert deleted["updated"] == 1
    assert products.rows[-1]["generation_status"] == "deleted"

    report = await gen.qa_report({"email": "admin@example.test"})
    assert "duplicate_titles" in report["report"]
    assert "missing_package_files" in report["report"]


@pytest.mark.asyncio
async def test_file_validation_blocks_approval_until_override_and_audits(fake_db):
    products, audit = fake_db
    res = await gen.generate(payload(), {"email": "admin@example.test"})
    slug = res["products"][0]["slug"]
    products.rows[0]["package_manifest"] = [f for f in products.rows[0]["package_manifest"] if f["filename"].lower() != "license.txt"]

    blocked = await _raises(lambda: gen.approve(slug, None, {"email": "admin@example.test"}))
    assert blocked.status_code == 400
    assert products.rows[0]["file_validation"]["status"] == "failed"
    assert any("Missing license.txt" in issue for issue in products.rows[0]["quality_needs_review"])

    override = await gen.approve(slug, gen.ApproveRequest(override_validation=True, override_reason="Manual file review passed"), {"email": "admin@example.test"})
    assert override["ok"] is True
    assert products.rows[0]["generation_status"] == "approved"
    assert products.rows[0]["validation_override"] is True
    assert audit.rows[-1]["type"] == "digital_product_generator.validation_override"
    assert audit.rows[-1]["reason"] == "Manual file review passed"


@pytest.mark.asyncio
async def test_file_validation_file_access_and_review_notes(fake_db):
    products, _audit = fake_db
    res = await gen.generate(payload(), {"email": "admin@example.test"})
    slug = res["products"][0]["slug"]
    svg_name = next(f["filename"] for f in products.rows[0]["package_manifest"] if f["filename"].endswith(".svg"))

    validation = await gen.validate_product(slug, {"email": "admin@example.test"})
    assert validation["validation"]["status"] == "passed"
    assert validation["validation"]["issues"] == []

    listing = await gen.product_files(slug, {"email": "admin@example.test"})
    assert any(f["filename"] == svg_name for f in listing["files"])

    response = await gen.product_file(slug, svg_name, {"email": "admin@example.test"})
    assert response.media_type == "image/svg+xml"
    assert b"<svg" in response.body

    unsafe = await _raises(lambda: gen.product_file(slug, "../secret.txt", {"email": "admin@example.test"}))
    assert unsafe.status_code == 400

    saved = await gen.save_review_note(slug, gen.ReviewNoteRequest(note="Looks clean", reason="QA pass"), {"email": "admin@example.test"})
    assert saved["ok"] is True
    assert products.rows[0]["review_note"] == "Looks clean"
    assert products.rows[0]["review_notes"][-1]["reason"] == "QA pass"


@pytest.mark.asyncio
async def test_bulk_approve_blocks_validation_failures(fake_db):
    products, _audit = fake_db
    res = await gen.generate(payload(count=5), {"email": "admin@example.test"})
    bad_slug = res["products"][0]["slug"]
    good_slug = res["products"][1]["slug"]
    products.rows[0]["package_manifest"] = [f for f in products.rows[0]["package_manifest"] if not f["filename"].endswith(".dxf")]

    result = await gen.bulk_approve(gen.BulkReviewAction(slugs=[bad_slug, good_slug], reason="QA pass"), {"email": "admin@example.test"})
    assert result["updated"] == 1
    assert result["blocked"][0]["slug"] == bad_slug
    assert next(r for r in products.rows if r["slug"] == good_slug)["generation_status"] == "approved"
    assert next(r for r in products.rows if r["slug"] == bad_slug)["generation_status"] == "draft_pending_review"
