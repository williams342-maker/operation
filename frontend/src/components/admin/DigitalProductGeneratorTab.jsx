import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, Eye, FileArchive, FileText, RefreshCw, Sparkles, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  adminGeneratedDigitalProductFileUrl,
  approveAdminGeneratedDigitalProduct,
  bulkApproveAdminGeneratedDigitalProducts,
  bulkArchiveAdminGeneratedDigitalProducts,
  bulkDeleteAdminGeneratedDigitalProducts,
  bulkPublishAdminGeneratedDigitalProducts,
  bulkRejectAdminGeneratedDigitalProducts,
  deleteAdminGeneratedDigitalProduct,
  fetchAdminGeneratedDigitalProductFileBlob,
  fetchAdminGeneratedDigitalProductFiles,
  fetchAdminGeneratedDigitalProducts,
  fetchAdminDigitalReviewQueue,
  fetchAdminDigitalQaReport,
  fetchAdminDigitalStarterPacks,
  generateAdminDigitalProducts,
  publishAdminGeneratedDigitalProduct,
  replaceAdminGeneratedDigitalFiles,
  replaceAdminGeneratedDigitalPreview,
  saveAdminGeneratedDigitalReviewNote,
  validateAdminGeneratedDigitalProductFiles,
  updateAdminGeneratedDigitalProduct,
} from "../../lib/api";

const PRODUCT_TYPES = ["SVG", "DXF", "Laser Project", "CNC Project", "Printable PDF", "Workshop Template", "Planner", "Business Resource", "Design Bundle"];
const THEMES = ["Nature", "Wildlife", "Farmhouse", "Nautical", "Geometric", "Seasonal", "Workshop", "Gardening", "Kitchen", "Holiday"];
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];
const MACHINES = ["Glowforge", "xTool", "LightBurn", "Plasma", "CNC Router", "Cricut", "Silhouette", "Universal"];
const LICENSES = ["Personal", "Commercial", "Extended Commercial"];
const COUNTS = [1, 5, 10, 20, 25, 30, 40, 50];
const BUNDLES = ["", "Beginner Laser Bundle", "CNC Starter Collection", "Workshop Planner Pack", "Holiday Ornament Collection", "Farmhouse Sign Bundle"];
const FALLBACK_STARTER_PACKS = [
  { key: "beginner-laser-pack", label: "Beginner Laser Pack", count: 25 },
  { key: "cnc-workshop-pack", label: "CNC Workshop Pack", count: 25 },
  { key: "holiday-ornament-pack", label: "Holiday Ornament Pack", count: 50 },
  { key: "farmhouse-collection", label: "Farmhouse Collection", count: 30 },
  { key: "address-sign-collection", label: "Address Sign Collection", count: 40 },
  { key: "garden-sign-collection", label: "Garden Sign Collection", count: 25 },
  { key: "wildlife-collection", label: "Wildlife Collection", count: 25 },
  { key: "monogram-collection", label: "Monogram Collection", count: 25 },
  { key: "workshop-organization-collection", label: "Workshop Organization Collection", count: 25 },
  { key: "printable-shop-forms-collection", label: "Printable Shop Forms Collection", count: 25 },
];

const initialForm = {
  product_type: "SVG",
  theme: "Nature",
  difficulty: "Beginner",
  intended_machine: "Universal",
  license: "Personal",
  count: 1,
  bundle_name: "",
  notes: "",
};

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] uppercase tracking-[0.24em] text-ink-muted mb-2">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options, label }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-none border border-line bg-paper px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
    >
      {options.map((o) => <option key={o} value={o}>{o || "None"}</option>)}
    </select>
  );
}

function ProductCard({ product, selected, onSelect, onPreview, onEdit, onApprove, onPublish, onDelete }) {
  const files = product.package_manifest || [];
  const isApproved = product.generation_status === "approved";
  const isPublished = product.status === "published";
  return (
    <article className="border border-line bg-paper p-4 space-y-3" data-testid="generated-digital-product-card">
      <div className="flex items-start gap-4">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-brand"
          checked={selected}
          onChange={(e) => onSelect(product.slug, e.target.checked)}
          aria-label={`Select ${product.title}`}
        />
        <button type="button" onClick={onPreview} className="w-24 h-20 border border-line bg-surface overflow-hidden shrink-0 focus:outline-none focus:ring-2 focus:ring-brand/30" aria-label={`Preview ${product.title}`}>
          {product.images?.[0] ? <img src={product.images[0]} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-ink-muted"><FileArchive size={18} /></div>}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">{product.generation_status || "draft"}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">{product.status}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">${Number(product.price || 0).toFixed(2)}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Quality Score: {product.quality_score ?? 0}%</span>
          </div>
          <h3 className="font-serif text-lg leading-tight text-ink truncate">{product.title}</h3>
          <p className="text-sm text-ink-muted line-clamp-2">{product.description}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(product.seo_tags || product.tags || []).slice(0, 6).map((tag) => <span key={tag} className="border border-line px-2 py-1 text-[11px] bg-surface">{tag}</span>)}
          </div>
        </div>
      </div>
      <div className="text-xs text-ink-muted">
        <span className="font-semibold text-ink">Package:</span> {files.length ? files.map((f) => f.filename).join(", ") : "No package manifest"}
        <div className="mt-2 grid sm:grid-cols-2 gap-1">{(product.quality_checks || []).slice(0, 6).map((check) => <span key={check.label} className={`font-mono text-[10px] uppercase tracking-[0.16em] ${check.ok ? "text-green-700" : "text-amber-700"}`}>{check.ok ? "OK" : "REVIEW"} {check.label}</span>)}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onPreview} className="btn-secondary text-xs inline-flex items-center gap-1"><Eye size={14} /> Preview</button>
        <button type="button" onClick={onEdit} className="btn-secondary text-xs">Edit</button>
        <button type="button" onClick={onApprove} disabled={isApproved || isPublished} className="btn-secondary text-xs disabled:opacity-50 inline-flex items-center gap-1"><Check size={14} /> Approve</button>
        <button type="button" onClick={onPublish} disabled={!isApproved || isPublished} className="btn-industrial text-xs disabled:opacity-50">Publish</button>
        <button type="button" onClick={onDelete} className="btn-secondary text-xs inline-flex items-center gap-1 text-red-700"><Trash2 size={14} /> Delete</button>
      </div>
    </article>
  );
}

export default function DigitalProductGeneratorTab() {
  const [form, setForm] = useState(initialForm);
  const [products, setProducts] = useState([]);
  const [starterPacks, setStarterPacks] = useState(FALLBACK_STARTER_PACKS);
  const [selected, setSelected] = useState({});
  const [active, setActive] = useState(null);
  const [draft, setDraft] = useState(null);
  const [previewDataUrl, setPreviewDataUrl] = useState("");
  const [filesJson, setFilesJson] = useState("[]");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queueFilters, setQueueFilters] = useState({ min_quality: "", collection: "", product_type: "", review_status: "draft_pending_review" });
  const [qaReport, setQaReport] = useState(null);
  const [reviewReason, setReviewReason] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [fileInfo, setFileInfo] = useState(null);
  const [reviewNote, setReviewNote] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 40;

  const selectedSlugs = useMemo(() => Object.entries(selected).filter(([, v]) => v).map(([k]) => k), [selected]);
  const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
  const pagedProducts = useMemo(() => products.slice((page - 1) * pageSize, page * pageSize), [products, page]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = {
        min_quality: queueFilters.min_quality || undefined,
        collection: queueFilters.collection || undefined,
        product_type: queueFilters.product_type || undefined,
        review_status: queueFilters.review_status || undefined,
        status: "draft",
        limit: 300,
      };
      const [data, packs] = await Promise.all([
        fetchAdminDigitalReviewQueue(params).catch(() => fetchAdminGeneratedDigitalProducts()),
        fetchAdminDigitalStarterPacks().catch(() => ({ starter_packs: FALLBACK_STARTER_PACKS })),
      ]);
      setProducts(data.products || []);
      setQaReport(data.qa_report || null);
      setStarterPacks(packs.starter_packs || FALLBACK_STARTER_PACKS);
    } catch (e) {
      setError(e?.response?.data?.detail || "Unable to load generated products.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [queueFilters.min_quality, queueFilters.collection, queueFilters.product_type, queueFilters.review_status]);

  const updateForm = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const updateQueueFilter = (key, value) => setQueueFilters((f) => ({ ...f, [key]: value }));
  const applyStarterPack = (key) => {
    const pack = starterPacks.find((p) => p.key === key);
    setForm((f) => ({ ...f, starter_pack: key, bundle_name: pack?.label || "", count: pack?.count || f.count }));
  };

  const generate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { ...form, count: Number(form.count), bundle_name: form.bundle_name || null, starter_pack: form.starter_pack || null };
      const data = await generateAdminDigitalProducts(payload);
      toast.success(`Created ${data.created} draft digital product${data.created === 1 ? "" : "s"}.`);
      setProducts((prev) => [...(data.products || []), ...prev]);
      setActive((data.products || [])[0] || null);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Generation failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (product) => {
    setActive(product);
    setDraft({
      title: product.title || "",
      description: product.description || "",
      seo_description: product.seo_description || "",
      tags: (product.seo_tags || product.tags || []).join(", "),
      price: product.price || 0,
      difficulty: product.difficulty || "Beginner",
      estimated_cut_time: product.estimated_cut_time || "",
      material_suggestions: (product.material_suggestions || []).join(", "),
      compatible_software: (product.compatible_software || []).join(", "),
      compatible_machines: (product.compatible_machines || []).join(", "),
      license: product.license || "Personal",
    });
    setPreviewDataUrl("");
    setFilesJson(JSON.stringify(product.digital_files || [], null, 2));
  };

  const saveEdit = async () => {
    if (!active || !draft) return;
    setBusy(true);
    try {
      const payload = {
        title: draft.title,
        description: draft.description,
        seo_description: draft.seo_description,
        tags: draft.tags.split(",").map((s) => s.trim()).filter(Boolean),
        price: Number(draft.price || 0),
        difficulty: draft.difficulty,
        estimated_cut_time: draft.estimated_cut_time,
        material_suggestions: draft.material_suggestions.split(",").map((s) => s.trim()).filter(Boolean),
        compatible_software: draft.compatible_software.split(",").map((s) => s.trim()).filter(Boolean),
        compatible_machines: draft.compatible_machines.split(",").map((s) => s.trim()).filter(Boolean),
        license: draft.license,
      };
      const data = await updateAdminGeneratedDigitalProduct(active.slug, payload);
      setProducts((prev) => prev.map((p) => (p.slug === active.slug ? data.product : p)));
      setActive(data.product);
      toast.success("Draft updated.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Unable to update draft.");
    } finally {
      setBusy(false);
    }
  };

  const action = async (label, fn) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Action failed.");
    } finally {
      setBusy(false);
    }
  };



  const openReview = async (product) => {
    setActive(product);
    setDraft(null);
    setModalOpen(true);
    setGalleryIndex(0);
    setReviewNote(product.review_note || "");
    setRejectionReason(product.rejection_reason || "");
    setOverrideReason("");
    setFileInfo(null);
    try {
      const data = await fetchAdminGeneratedDigitalProductFiles(product.slug);
      setFileInfo(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Unable to load package files.");
    }
  };

  const moveReview = (direction) => {
    if (!active || !products.length) return;
    const index = products.findIndex((p) => p.slug === active.slug);
    const next = products[(index + direction + products.length) % products.length];
    if (next) openReview(next);
  };

  const validateActive = async () => {
    if (!active) return;
    await action("File validation completed.", async () => {
      const data = await validateAdminGeneratedDigitalProductFiles(active.slug);
      setFileInfo((prev) => ({ ...(prev || {}), validation: data.validation }));
    });
  };

  const saveReviewMetadata = async () => {
    if (!active) return;
    await action("Review notes saved.", () => saveAdminGeneratedDigitalReviewNote(active.slug, { note: reviewNote, reason: rejectionReason }));
  };

  const approveActive = async (override = false) => {
    if (!active) return;
    await action("Draft approved.", () => approveAdminGeneratedDigitalProduct(active.slug, { override_validation: override, override_reason: overrideReason }));
    setModalOpen(false);
  };

  const singleReviewAction = async (label, fn, confirmText) => {
    if (!active) return;
    if (confirmText && !window.confirm(confirmText)) return;
    await action(label, () => fn([active.slug], rejectionReason || reviewNote));
    setModalOpen(false);
  };

  const openPackageFile = async (filename, mode = "view") => {
    if (!active || !filename) return;
    try {
      const blob = await fetchAdminGeneratedDigitalProductFileBlob(active.slug, filename);
      const url = URL.createObjectURL(blob);
      if (mode === "download") {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Unable to open package file.");
    }
  };
  const bulkReview = async (label, fn, confirmText = "") => {
    if (!selectedSlugs.length) return;
    if (confirmText && !window.confirm(confirmText)) return;
    await action(label, () => fn(selectedSlugs, reviewReason));
    setSelected({});
  };
  const savePreview = async () => {
    if (!active || !previewDataUrl.trim()) return;
    await action("Preview replaced.", () => replaceAdminGeneratedDigitalPreview(active.slug, previewDataUrl.trim()));
  };

  const saveFiles = async () => {
    if (!active) return;
    let parsed;
    try { parsed = JSON.parse(filesJson); } catch { toast.error("Files must be valid JSON."); return; }
    await action("Files replaced.", () => replaceAdminGeneratedDigitalFiles(active.slug, parsed));
  };

  return (
    <section className="space-y-6" data-testid="digital-product-generator-tab">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand">Content</p>
        <h2 className="font-serif text-3xl text-ink">Digital Product Generator</h2>
        <p className="text-sm text-ink-muted max-w-3xl">Generate original supplemental digital products for marketplace seeding. Every product is saved as a draft until an admin reviews, approves, and publishes it.</p>
      </div>

      <form onSubmit={generate} className="border border-line bg-surface p-4 grid md:grid-cols-4 gap-4">
        <Field label="Product Type"><Select label="Product Type" value={form.product_type} onChange={(v) => updateForm("product_type", v)} options={PRODUCT_TYPES} /></Field>
        <Field label="Theme"><Select label="Theme" value={form.theme} onChange={(v) => updateForm("theme", v)} options={THEMES} /></Field>
        <Field label="Difficulty"><Select label="Difficulty" value={form.difficulty} onChange={(v) => updateForm("difficulty", v)} options={DIFFICULTIES} /></Field>
        <Field label="Intended Machine"><Select label="Intended Machine" value={form.intended_machine} onChange={(v) => updateForm("intended_machine", v)} options={MACHINES} /></Field>
        <Field label="License"><Select label="License" value={form.license} onChange={(v) => updateForm("license", v)} options={LICENSES} /></Field>
        <Field label="Number"><Select label="Number of products" value={String(form.count)} onChange={(v) => updateForm("count", Number(v))} options={COUNTS.map(String)} /></Field>
        <Field label="Starter Bundle"><Select label="Starter Bundle" value={form.bundle_name} onChange={(v) => updateForm("bundle_name", v)} options={BUNDLES} /></Field>
        <Field label="Admin Notes">
          <input value={form.notes} onChange={(e) => updateForm("notes", e.target.value)} className="w-full rounded-none border border-line bg-paper px-3 py-2 text-sm" placeholder="Optional originality constraints" />
        </Field>
        <div className="md:col-span-4 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className="btn-industrial inline-flex items-center gap-2 disabled:opacity-50"><Sparkles size={16} /> Generate Drafts</button>
          <p className="text-xs text-ink-muted">Requests for brands, characters, celebrities, sports, logos, trademarks, or third-party marketplace designs are refused.</p>
        </div>
      </form>

      {error && <div className="border border-red-300 bg-red-50 text-red-800 px-4 py-3 text-sm" role="alert">{error}</div>}
      <div className="border border-line bg-paper p-4 space-y-4" data-testid="digital-review-queue">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Min Quality"><input value={queueFilters.min_quality} onChange={(e) => updateQueueFilter("min_quality", e.target.value)} className="w-28 border border-line bg-surface px-3 py-2 text-sm" placeholder="90" /></Field>
          <Field label="Collection"><Select label="Collection filter" value={queueFilters.collection} onChange={(v) => updateQueueFilter("collection", v)} options={["", ...starterPacks.map((p) => p.label)]} /></Field>
          <Field label="Product Type"><Select label="Product type filter" value={queueFilters.product_type} onChange={(v) => updateQueueFilter("product_type", v)} options={["", ...PRODUCT_TYPES]} /></Field>
          <Field label="Review Status"><Select label="Review status filter" value={queueFilters.review_status} onChange={(v) => updateQueueFilter("review_status", v)} options={["", "draft_pending_review", "approved", "rejected", "archived"]} /></Field>
          <Field label="Review Note"><input value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} className="w-48 border border-line bg-surface px-3 py-2 text-sm" placeholder="Optional reason" /></Field>
        </div>
        {qaReport && (
          <div className="grid md:grid-cols-4 gap-3 text-sm" data-testid="digital-qa-report">
            <div className="border border-line bg-surface p-3"><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">Drafts</div><div className="font-serif text-2xl">{qaReport.total}</div></div>
            <div className="border border-line bg-surface p-3"><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">Low Quality</div><div className="font-serif text-2xl">{qaReport.low_quality_score?.length || 0}</div></div>
            <div className="border border-line bg-surface p-3"><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">Missing Files</div><div className="font-serif text-2xl">{qaReport.missing_package_files?.length || 0}</div></div>
            <div className="border border-line bg-surface p-3"><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">Ready</div><div className="font-serif text-2xl">{qaReport.ready_for_review}</div></div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!selectedSlugs.length || busy} onClick={() => bulkReview("Selected drafts approved.", bulkApproveAdminGeneratedDigitalProducts)} className="btn-secondary text-xs disabled:opacity-50">Approve Selected</button>
          <button type="button" disabled={!selectedSlugs.length || busy} onClick={() => bulkReview("Selected drafts rejected.", bulkRejectAdminGeneratedDigitalProducts, "Reject selected drafts?")} className="btn-secondary text-xs disabled:opacity-50">Reject Selected</button>
          <button type="button" disabled={!selectedSlugs.length || busy} onClick={() => bulkReview("Selected drafts archived.", bulkArchiveAdminGeneratedDigitalProducts, "Archive selected drafts?")} className="btn-secondary text-xs disabled:opacity-50">Archive Selected</button>
          <button type="button" disabled={!selectedSlugs.length || busy} onClick={() => bulkReview("Selected drafts deleted.", bulkDeleteAdminGeneratedDigitalProducts, "Delete selected drafts? This cannot be undone.")} className="btn-secondary text-xs disabled:opacity-50 text-red-700">Delete Selected</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-ink-muted">Generated Draft Queue</div>
        <button type="button" disabled={!selectedSlugs.length || busy} onClick={() => action("Approved selections published.", () => bulkPublishAdminGeneratedDigitalProducts(selectedSlugs))} className="btn-secondary text-xs disabled:opacity-50">Bulk publish approved ({selectedSlugs.length})</button>
      </div>

      {loading ? (
        <div className="border border-line bg-paper p-6 text-sm text-ink-muted">Loading generated products...</div>
      ) : products.length === 0 ? (
        <div className="border border-line bg-paper p-6 text-sm text-ink-muted">No generated digital products yet.</div>
      ) : (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_420px] gap-6 items-start">
          <div className="space-y-4">
            <div className="flex items-center justify-between border border-line bg-surface px-4 py-3 text-sm">
              <span className="text-ink-muted">Showing page {page} of {totalPages} ({products.length} drafts)</span>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary text-xs" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
                <button type="button" className="btn-secondary text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
              </div>
            </div>
            {pagedProducts.map((product) => (
              <ProductCard
                key={product.slug}
                product={product}
                selected={!!selected[product.slug]}
                onSelect={(slug, checked) => setSelected((s) => ({ ...s, [slug]: checked }))}
                onPreview={() => openReview(product)}
                onEdit={() => startEdit(product)}
                onApprove={() => action("Draft approved.", () => approveAdminGeneratedDigitalProduct(product.slug))}
                onPublish={() => action("Product published.", () => publishAdminGeneratedDigitalProduct(product.slug))}
                onDelete={() => action("Product deleted.", () => deleteAdminGeneratedDigitalProduct(product.slug))}
              />
            ))}
          </div>

          <aside className="border border-line bg-paper p-4 space-y-4 sticky top-24" data-testid="digital-generator-preview-panel">
            {active ? (
              <>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-brand">Review</p>
                  <h3 className="font-serif text-2xl text-ink leading-tight">{active.title}</h3>
                  <p className="text-sm text-ink-muted">{active.seo_description || active.description}</p>
                </div>
                {active.images?.[0] && <img src={active.images[0]} alt="Generated product preview" className="w-full border border-line bg-surface" />}
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-ink-muted">Type</dt><dd>{active.product_type}</dd></div>
                  <div><dt className="text-ink-muted">Machine</dt><dd>{active.intended_machine}</dd></div>
                  <div><dt className="text-ink-muted">License</dt><dd>{active.license}</dd></div>
                  <div><dt className="text-ink-muted">Cut time</dt><dd>{active.estimated_cut_time}</dd></div>
                </dl>
                {draft && (
                  <div className="space-y-3 border-t border-line pt-4">
                    <Field label="Title"><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-full border border-line bg-surface px-3 py-2 text-sm" /></Field>
                    <Field label="Short Description"><textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={3} className="w-full border border-line bg-surface px-3 py-2 text-sm" /></Field>
                    <Field label="SEO Description"><textarea value={draft.seo_description} onChange={(e) => setDraft({ ...draft, seo_description: e.target.value })} rows={4} className="w-full border border-line bg-surface px-3 py-2 text-sm" /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Price"><input type="number" min="0" step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className="w-full border border-line bg-surface px-3 py-2 text-sm" /></Field>
                      <Field label="Difficulty"><Select label="Edit difficulty" value={draft.difficulty} onChange={(v) => setDraft({ ...draft, difficulty: v })} options={DIFFICULTIES} /></Field>
                    </div>
                    <Field label="Tags"><input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} className="w-full border border-line bg-surface px-3 py-2 text-sm" /></Field>
                    <Field label="Materials"><input value={draft.material_suggestions} onChange={(e) => setDraft({ ...draft, material_suggestions: e.target.value })} className="w-full border border-line bg-surface px-3 py-2 text-sm" /></Field>
                    <Field label="Software"><input value={draft.compatible_software} onChange={(e) => setDraft({ ...draft, compatible_software: e.target.value })} className="w-full border border-line bg-surface px-3 py-2 text-sm" /></Field>
                    <button type="button" disabled={busy} onClick={saveEdit} className="btn-industrial w-full disabled:opacity-50">Save edits</button>
                  </div>
                )}
                <div className="space-y-3 border-t border-line pt-4">
                  <Field label="Replace Preview Data URL"><textarea value={previewDataUrl} onChange={(e) => setPreviewDataUrl(e.target.value)} rows={2} className="w-full border border-line bg-surface px-3 py-2 text-xs font-mono" placeholder="data:image/..." /></Field>
                  <button type="button" disabled={busy || !previewDataUrl.trim()} onClick={savePreview} className="btn-secondary text-xs disabled:opacity-50 inline-flex items-center gap-1"><Upload size={14} /> Replace preview</button>
                </div>
                <div className="space-y-3 border-t border-line pt-4">
                  <Field label="Replace Files JSON"><textarea value={filesJson} onChange={(e) => setFilesJson(e.target.value)} rows={5} className="w-full border border-line bg-surface px-3 py-2 text-xs font-mono" /></Field>
                  <button type="button" disabled={busy} onClick={saveFiles} className="btn-secondary text-xs disabled:opacity-50 inline-flex items-center gap-1"><RefreshCw size={14} /> Replace files</button>
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-muted">Select a generated product to preview and review it.</p>
            )}
          </aside>
        </div>
      )}
      {modalOpen && active && (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 md:p-8 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Digital product review modal" data-testid="digital-review-modal">
          <div className="mx-auto max-w-6xl bg-paper border border-line shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-line p-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-brand">Large Preview</p>
                <h3 className="font-serif text-2xl md:text-3xl text-ink leading-tight">{active.title}</h3>
                <p className="text-sm text-ink-muted">{active.bundle_name || active.collection || "Starter catalog"} · Quality Score: {active.quality_score ?? 0}% · ${Number(active.price || 0).toFixed(2)}</p>
              </div>
              <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => setModalOpen(false)} aria-label="Close review modal"><X size={16} /> Close</button>
            </div>
            <div className="grid lg:grid-cols-[minmax(0,1.25fr)_420px] gap-0">
              <div className="p-4 md:p-6 space-y-4">
                <div className="aspect-[4/3] border border-line bg-surface grid place-items-center overflow-hidden">
                  {active.images?.length ? <img src={active.images[Math.min(galleryIndex, active.images.length - 1)]} alt="Generated product preview" className="w-full h-full object-contain" /> : <FileArchive size={40} className="text-ink-muted" />}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => setGalleryIndex((i) => Math.max(0, i - 1))} disabled={galleryIndex <= 0}><ChevronLeft size={14} /> Previous Image</button>
                    <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => setGalleryIndex((i) => Math.min((active.images?.length || 1) - 1, i + 1))} disabled={galleryIndex >= (active.images?.length || 1) - 1}>Next Image <ChevronRight size={14} /></button>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary text-xs" onClick={() => moveReview(-1)}>Previous Product</button>
                    <button type="button" className="btn-secondary text-xs" onClick={() => moveReview(1)}>Next Product</button>
                  </div>
                </div>
                <div className="grid md:grid-cols-3 gap-3 text-sm">
                  <div className="border border-line bg-surface p-3"><dt className="text-ink-muted">Collection</dt><dd>{active.bundle_name || active.collection || "Starter catalog"}</dd></div>
                  <div className="border border-line bg-surface p-3"><dt className="text-ink-muted">License</dt><dd>{active.license}</dd></div>
                  <div className="border border-line bg-surface p-3"><dt className="text-ink-muted">Difficulty</dt><dd>{active.difficulty}</dd></div>
                  <div className="border border-line bg-surface p-3"><dt className="text-ink-muted">Machines</dt><dd>{(active.compatible_machines || [active.intended_machine]).join(", ")}</dd></div>
                  <div className="border border-line bg-surface p-3"><dt className="text-ink-muted">Software</dt><dd>{(active.compatible_software || []).join(", ")}</dd></div>
                  <div className="border border-line bg-surface p-3"><dt className="text-ink-muted">Cut time</dt><dd>{active.estimated_cut_time || "Needs review"}</dd></div>
                </div>
                <div className="border border-line bg-surface p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-serif text-xl text-ink">Package Files</h4>
                    <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={validateActive}><RefreshCw size={14} /> Validate Files</button>
                  </div>
                  <div className="text-xs text-ink-muted">Validation: <span className={fileInfo?.validation?.status === "failed" ? "text-red-700" : "text-green-700"}>{fileInfo?.validation?.status || active.file_validation?.status || "not checked"}</span></div>
                  {(fileInfo?.validation?.issues || active.file_validation?.issues || []).length > 0 && <ul className="text-xs text-red-700 list-disc pl-5">{(fileInfo?.validation?.issues || active.file_validation?.issues || []).map((issue) => <li key={issue}>{issue}</li>)}</ul>}
                  <div className="divide-y divide-line border border-line bg-paper">
                    {((fileInfo?.files || active.package_manifest || [])).map((file) => (
                      <div key={file.filename} className="grid md:grid-cols-[1fr_auto_auto_auto] gap-2 items-center p-3 text-sm">
                        <div className="min-w-0"><div className="font-medium truncate">{file.filename}</div><div className="text-xs text-ink-muted">{(file.ext || file.filename?.split(".").pop() || "file").toUpperCase()} · {Number(file.size_bytes || 0).toLocaleString()} bytes</div></div>
                        {String(file.filename).toLowerCase().endsWith(".svg") && <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => openPackageFile(file.filename)}><Eye size={14} /> View SVG</button>}
                        {(String(file.filename).toLowerCase().endsWith(".pdf") || ["readme.txt", "license.txt", "changelog.md"].includes(String(file.filename).toLowerCase())) && <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => openPackageFile(file.filename)}><FileText size={14} /> View</button>}
                        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => openPackageFile(file.filename, "download")}><Download size={14} /> Download</button>
                      </div>
                    ))}
                    <div className="p-3"><button type="button" className="btn-industrial text-xs inline-flex items-center gap-1" onClick={() => openPackageFile(`${active.slug}.zip`, "download")}><Download size={14} /> Download ZIP</button></div>
                  </div>
                </div>
              </div>
              <aside className="border-t lg:border-t-0 lg:border-l border-line p-4 md:p-6 space-y-4">
                <div>
                  <h4 className="font-serif text-xl text-ink">Review Notes</h4>
                  <p className="text-sm text-ink-muted">Record reviewer notes or a rejection reason before changing status.</p>
                </div>
                <Field label="Reviewer Notes"><textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={4} className="w-full border border-line bg-surface px-3 py-2 text-sm" /></Field>
                <Field label="Rejection Reason"><textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={3} className="w-full border border-line bg-surface px-3 py-2 text-sm" /></Field>
                <button type="button" className="btn-secondary text-xs" onClick={saveReviewMetadata}>Save Review Notes</button>
                <div className="border-t border-line pt-4 space-y-3">
                  <button type="button" disabled={busy} className="btn-industrial w-full disabled:opacity-50" onClick={() => approveActive(false)}>Approve</button>
                  <Field label="Override Reason"><textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2} className="w-full border border-line bg-surface px-3 py-2 text-sm" placeholder="Required only to override failed validation" /></Field>
                  <button type="button" disabled={busy || !overrideReason.trim()} className="btn-secondary w-full disabled:opacity-50" onClick={() => approveActive(true)}>Approve With Validation Override</button>
                  <button type="button" disabled={busy} className="btn-secondary w-full disabled:opacity-50" onClick={() => singleReviewAction("Draft rejected.", bulkRejectAdminGeneratedDigitalProducts, "Reject this draft?")}>Reject</button>
                  <button type="button" disabled={busy} className="btn-secondary w-full disabled:opacity-50" onClick={() => singleReviewAction("Draft archived.", bulkArchiveAdminGeneratedDigitalProducts, "Archive this draft?")}>Archive</button>
                  <button type="button" disabled={busy} className="btn-secondary w-full text-red-700 disabled:opacity-50" onClick={() => singleReviewAction("Draft deleted.", bulkDeleteAdminGeneratedDigitalProducts, "Delete this draft? This cannot be undone.")}>Delete</button>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}    </section>
  );
}
