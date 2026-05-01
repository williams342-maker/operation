import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Sparkles, X, Tag, AlertTriangle,
} from "lucide-react";
import {
  fetchMakerMe, fetchMakerProducts, createMakerProduct,
  updateMakerProduct, aiListingCopy, aiSeoTags,
  duplicateMakerProduct, uploadMakerVideo,
} from "../lib/api";
import ImageCropModal from "../components/ImageCropModal";
import {
  CATEGORIES, TECHNIQUES, WHO_MADE_IT, CONDITIONS, DIM_UNITS, COLORS,
  OCCASIONS, PROCESSING_TIMES, DELIVERY_RANGES, CARRIERS,
  MAX_IMAGES, MAX_TAGS, emptyForm,
} from "./MakerListingEditor/constants";
import {
  Section, Label, FieldError, NumInput, Select, ChipGrid, Toggle, ToggleRow,
  ActionButtons,
} from "./MakerListingEditor/FormControls";
import MediaSection from "./MakerListingEditor/MediaSection";
import AiAssistantSection from "./MakerListingEditor/AiAssistantSection";
import PricingSection from "./MakerListingEditor/PricingSection";
import { estimateShipping } from "../lib/shippingEstimator";

/** Crafters Market — full-page Listing Editor.
 *
 *  Used for both creating a new listing (`/maker/listings/new`) and editing
 *  an existing one (`/maker/listings/:slug/edit`). Layout structure follows
 *  the approved Etsy-style mock; palette stays on-brand (industrial dark +
 *  orange).
 *
 *  This file is the orchestrator: it owns all state, all side-effects, and
 *  the submit/clone/preview flows. Section JSX has been split out into
 *  presentational components under `./MakerListingEditor/` so that this
 *  file stays focused on behavior:
 *    - `constants.js`           — enums + empty-form factory
 *    - `FormControls.jsx`       — Section, Label, NumInput, Select, etc.
 *    - `MediaSection.jsx`       — Photos & Video (drag-reorder, R2 upload)
 *    - `AiAssistantSection.jsx` — Claude-backed listing copy
 *    - `PricingSection.jsx`     — Price + variations
 *
 *  The remaining inline sections (Listing Details, Item Details,
 *  Personalization, Shipping, Processing Time, Return Policy, SEO Tags,
 *  Contact) stay here because they're each <60 lines, share enums/state
 *  patterns, and there's no win in extracting them today.
 */

export default function MakerListingEditor() {
  const navigate = useNavigate();
  const { slug } = useParams();   // present when editing
  const isEdit = !!slug;
  const [form, setForm] = useState(emptyForm);
  const [maker, setMaker] = useState(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHidden, setAiHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!isEdit);

  // ---- Autosave state ----
  // `autoStatus` is the lifecycle for the indicator pill: idle (no edits
  // yet), saving (request in flight), saved (successful save), error
  // (last attempt failed — manual retry recommended).
  const [autoStatus, setAutoStatus] = useState("idle");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  // Slug of the draft auto-created on a brand-new listing. Once set, all
  // subsequent autosaves PATCH instead of creating duplicate drafts.
  const [autoSlug, setAutoSlug] = useState(null);
  // Bumps every 30s so the "Saved 3s ago" copy stays fresh without
  // re-rendering on every keystroke.
  const [agoTick, setAgoTick] = useState(0);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Auth gate + initial data load
  useEffect(() => {
    if (!localStorage.getItem("cm_maker_jwt")) {
      navigate("/maker/login", { replace: true });
      return;
    }
    (async () => {
      try {
        const me = await fetchMakerMe();
        setMaker(me);
        if (!form.contact_email) set({ contact_email: me?.email || "" });

        if (isEdit) {
          const all = await fetchMakerProducts();
          const found = all.find((p) => p.slug === slug);
          if (!found) {
            toast.error("Listing not found.");
            navigate("/maker/dashboard#listings", { replace: true });
            return;
          }
          setForm({
            ...emptyForm(),
            ...found,
            // Coerce nullables to strings for inputs
            length_in: found.length_in ?? "",
            width_in: found.width_in ?? "",
            height_in: found.height_in ?? "",
            weight_lbs: found.weight_lbs ?? 0,
            weight_oz: found.weight_oz ?? 0,
            shipping_domestic_usd: found.shipping_domestic_usd ?? "",
            shipping_international_usd: found.shipping_international_usd ?? "",
            shipping_carrier: found.shipping_carrier ?? "",
            shipping_est_delivery: found.shipping_est_delivery ?? "",
            packed_length_in: found.packed_length_in ?? "",
            packed_width_in: found.packed_width_in ?? "",
            packed_height_in: found.packed_height_in ?? "",
            personalization_instructions: found.personalization_instructions ?? "",
            video_url: found.video_url ?? "",
            contact_email: found.contact_email ?? me?.email ?? "",
            seo_tags: found.seo_tags || [],
            colors: found.colors || [],
            occasions: found.occasions || [],
            materials: found.materials || [],
            materials_input: "",
            seo_input: "",
            who_made_it: found.who_made_it || "i_made_it",
            condition: found.condition || "new",
            dim_unit: found.dim_unit || "in",
            processing_time: found.processing_time || "1-3 business days",
            variants: found.variants || [],
            status: found.status || "draft",
            // Backorders — preserve `null` (inherit from maker default)
            // distinct from explicit `false` (override off)
            accepts_backorders: found.accepts_backorders ?? null,
            backorder_lead_weeks: found.backorder_lead_weeks ?? null,
          });
          setLoaded(true);
        }
      } catch (e) {
        if (e?.response?.status === 401) {
          navigate("/maker/login", { replace: true });
        } else {
          toast.error(e?.response?.data?.detail || "Couldn't load editor.");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Photos ----
  const fileRef = useRef(null);
  // Crop queue: pending files waiting to go through the crop modal.
  const [cropQueue, setCropQueue] = useState([]);     // [dataUrl, ...]
  // When set, the head of cropQueue replaces an existing photo at this
  // index instead of appending. Used by the per-tile re-crop button.
  const [cropTargetIdx, setCropTargetIdx] = useState(null);
  const [seoBusy, setSeoBusy] = useState(false);

  const onPickPhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const room = MAX_IMAGES - form.images.length;
    if (room <= 0) {
      toast.error(`Max ${MAX_IMAGES} photos.`);
      return;
    }
    const taking = files.slice(0, room);
    if (files.length > room) toast.warning(`Only the first ${room} photos were added.`);
    // Read each file into a data URL to feed react-easy-crop, then queue.
    try {
      const rawDataUrls = await Promise.all(
        taking.map((f) => new Promise((res, rej) => {
          const r = new FileReader();
          r.onerror = () => rej(new Error("Could not read file"));
          r.onload = () => res(r.result);
          r.readAsDataURL(f);
        })),
      );
      setCropQueue((cur) => [...cur, ...rawDataUrls]);
    } catch (err) {
      toast.error("Could not read one of those images.");
    }
  };

  const onCropConfirm = (croppedDataUrl) => {
    setForm((f) => {
      // If the queue head was tagged with a target index, replace that
      // photo in-place (re-crop flow). Otherwise append (initial upload).
      const idx = cropTargetIdx;
      if (idx != null && idx >= 0 && idx < f.images.length) {
        const next = [...f.images];
        next[idx] = croppedDataUrl;
        return { ...f, images: next };
      }
      return { ...f, images: [...f.images, croppedDataUrl] };
    });
    setCropTargetIdx(null);
    setCropQueue((q) => q.slice(1));
  };
  const onCropCancel = () => {
    setCropTargetIdx(null);
    setCropQueue((q) => q.slice(1));   // skip — file is dropped
  };

  // Re-open the crop modal for an already-uploaded photo so the maker can
  // adjust crop / rotation after the fact. The current image data URL is
  // pushed onto the queue head and `cropTargetIdx` tracks which slot to
  // replace on confirm.
  const recropImage = (i) => {
    const src = form.images[i];
    if (!src) return;
    setCropTargetIdx(i);
    setCropQueue((q) => [src, ...q]);
  };
  const videoFileRef = useRef(null);
  const [videoUploading, setVideoUploading] = useState(0);   // 0..100
  const [videoErr, setVideoErr] = useState("");

  const onPickVideo = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setVideoErr("");
    if (f.size > 50 * 1024 * 1024) {
      setVideoErr("Video must be 50MB or smaller.");
      return;
    }
    if (!["video/mp4", "video/webm", "video/quicktime", "video/x-quicktime"].includes(f.type)
        && !/\.(mp4|webm|mov)$/i.test(f.name)) {
      setVideoErr("Only .mp4, .webm, or .mov files are supported.");
      return;
    }
    try {
      setVideoUploading(1);
      const r = await uploadMakerVideo(f, (e) => {
        if (e?.total) setVideoUploading(Math.round((e.loaded / e.total) * 100));
      });
      set({ video_url: r.url });
      toast.success("Video uploaded.");
    } catch (err) {
      const msg = err?.response?.data?.detail || "Video upload failed.";
      setVideoErr(msg);
      toast.error(msg);
    } finally {
      setVideoUploading(0);
    }
  };
  const removeVideo = () => set({ video_url: "" });
  const removeImage = (i) => set({ images: form.images.filter((_, idx) => idx !== i) });
  const promoteCover = (i) => {
    if (i === 0) return;
    const next = [...form.images];
    [next[0], next[i]] = [next[i], next[0]];
    set({ images: next });
  };

  // ---- Drag-to-reorder ----
  // Tracks the index currently being dragged and the index hovered over.
  // We commit the reorder on `onDrop` of the target tile.
  const [dragSrc, setDragSrc] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const onDragStart = (i) => (e) => {
    setDragSrc(i);
    e.dataTransfer.effectAllowed = "move";
    // Required for Firefox to actually fire dragover.
    try { e.dataTransfer.setData("text/plain", String(i)); } catch (_) { /* ignore */ }
  };
  const onDragOver = (i) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOver !== i) setDragOver(i);
  };
  const onDragLeaveTile = (i) => () => {
    if (dragOver === i) setDragOver(null);
  };
  const onDrop = (target) => (e) => {
    e.preventDefault();
    const src = dragSrc;
    setDragSrc(null);
    setDragOver(null);
    if (src == null || src === target) return;
    const next = [...form.images];
    const [moved] = next.splice(src, 1);
    next.splice(target, 0, moved);
    set({ images: next });
  };
  const onDragEnd = () => { setDragSrc(null); setDragOver(null); };

  // ---- AI Assistant ----
  const runAI = async () => {
    if (!aiPrompt.trim()) {
      toast.error("Describe your item first.");
      return;
    }
    setAiBusy(true);
    try {
      const r = await aiListingCopy({
        bullets: aiPrompt.trim(),
        category: form.category,
        target_price: form.price ? Number(form.price) : null,
      });
      // Backend returns { title, description, tags[] }
      set({
        title: r.title || form.title,
        description: r.description || form.description,
        seo_tags: Array.from(new Set([...(form.seo_tags || []), ...(r.tags || [])])).slice(0, MAX_TAGS),
      });
      toast.success("AI populated title, description, and SEO tags.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "AI generation failed.");
    } finally {
      setAiBusy(false);
    }
  };

  const runSeoAI = async () => {
    if (!form.title.trim()) {
      toast.error("Add a title first.");
      return;
    }
    setSeoBusy(true);
    try {
      const r = await aiSeoTags({
        title: form.title.trim(),
        description: form.description,
        category: form.category,
        existing_tags: form.seo_tags,
      });
      const merged = Array.from(new Set([...(form.seo_tags || []), ...(r.tags || [])])).slice(0, MAX_TAGS);
      set({ seo_tags: merged });
      toast.success(`Added ${merged.length - (form.seo_tags?.length || 0)} new SEO tag${merged.length === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "AI tag generation failed.");
    } finally {
      setSeoBusy(false);
    }
  };

  // ---- Tags ----
  const addTag = (raw) => {
    const cleaned = (raw || "").replace(/[#,]/g, "").trim().toLowerCase();
    if (!cleaned) return;
    if (form.seo_tags.length >= MAX_TAGS) {
      toast.error(
        `You've hit the ${MAX_TAGS}-tag limit. Remove a tag first to add "${cleaned}".`,
      );
      return;
    }
    if (form.seo_tags.includes(cleaned)) {
      toast.message(`"${cleaned}" is already in your tags.`);
      return;
    }
    set({ seo_tags: [...form.seo_tags, cleaned], seo_input: "" });
  };
  const removeTag = (t) => set({ seo_tags: form.seo_tags.filter((x) => x !== t) });

  // ---- Materials chips ----
  const addMaterial = (raw) => {
    const cleaned = (raw || "").trim();
    if (!cleaned || form.materials.includes(cleaned)) return;
    set({ materials: [...form.materials, cleaned], materials_input: "" });
  };
  const removeMaterial = (m) => set({ materials: form.materials.filter((x) => x !== m) });

  // ---- Color/Occasion toggles ----
  const toggleArr = (key, val) => {
    const cur = form[key] || [];
    set({ [key]: cur.includes(val) ? cur.filter((v) => v !== val) : [...cur, val] });
  };

  // ---- Variations ----
  const addVariant = () => {
    set({
      variants: [
        ...form.variants,
        { id: undefined, label: "", price_delta: 0, in_stock: 1 },
      ],
    });
  };
  const updateVariant = (i, patch) => {
    set({
      variants: form.variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)),
    });
  };
  const removeVariant = (i) =>
    set({ variants: form.variants.filter((_, idx) => idx !== i) });

  // ---- Validation ----
  const errors = useMemo(() => {
    const out = {};
    if (!form.title.trim()) out.title = "Title is required.";
    if (form.title.length > 100) out.title = "Max 100 characters.";
    if (!form.description.trim()) out.description = "Description is required.";
    if (!form.price || Number(form.price) <= 0) out.price = "Price must be > 0.";
    if (form.in_stock < 0) out.in_stock = "Quantity can't be negative.";
    if (!form.images.length) out.images = "At least one photo is required.";
    return out;
  }, [form]);
  const canPublish = Object.keys(errors).length === 0;

  // ---- Submit ----
  const buildPayload = (statusOverride) => ({
    title: form.title.trim(),
    category: form.category,
    technique: form.technique,
    price: Number(form.price) || 0,
    description: form.description.trim(),
    materials: form.materials,
    dimensions: [form.length_in, form.width_in, form.height_in].filter(Boolean).join(" × ") || null,
    images: form.images,
    video_url: form.video_url || null,
    in_stock: Math.max(0, Number(form.in_stock) || 0),
    variants: form.variants.map((v) => ({
      id: v.id, label: v.label.trim(),
      price_delta: Number(v.price_delta) || 0,
      in_stock: Math.max(0, Number(v.in_stock) || 0),
    })).filter((v) => v.label),
    variant_axis1_name: form.variant_axis1_name || null,
    variant_axis2_name: form.variant_axis2_name || null,
    status: statusOverride || form.status,
    who_made_it: form.who_made_it,
    condition: form.condition,
    length_in: form.length_in === "" ? null : Number(form.length_in),
    width_in: form.width_in === "" ? null : Number(form.width_in),
    height_in: form.height_in === "" ? null : Number(form.height_in),
    dim_unit: form.dim_unit,
    weight_lbs: Number(form.weight_lbs) || 0,
    weight_oz: Number(form.weight_oz) || 0,
    colors: form.colors,
    occasions: form.occasions,
    personalization_enabled: form.personalization_enabled,
    personalization_instructions: form.personalization_instructions || null,
    free_shipping: form.free_shipping,
    shipping_domestic_usd: form.shipping_domestic_usd === "" ? null : Number(form.shipping_domestic_usd),
    shipping_international_usd: form.shipping_international_usd === "" ? null : Number(form.shipping_international_usd),
    shipping_carrier: form.shipping_carrier || null,
    shipping_est_delivery: form.shipping_est_delivery || null,
    packed_length_in: form.packed_length_in === "" ? null : Number(form.packed_length_in),
    packed_width_in: form.packed_width_in === "" ? null : Number(form.packed_width_in),
    packed_height_in: form.packed_height_in === "" ? null : Number(form.packed_height_in),
    processing_time: form.processing_time,
    accept_returns: form.accept_returns,
    accept_exchanges: form.accept_exchanges,
    seo_tags: form.seo_tags,
    contact_email: form.contact_email || null,
    accepts_backorders: form.accepts_backorders,
    backorder_lead_weeks: form.backorder_lead_weeks ?? null,
  });

  const submit = async (statusOverride) => {
    if (statusOverride === "published" && !canPublish) {
      toast.error(Object.values(errors)[0]);
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload(statusOverride);
      let res;
      // If autosave already created a draft for this /new session, PATCH
      // it rather than POSTing a fresh row — otherwise we'd end up with
      // duplicate drafts whenever the maker types fast enough to trigger
      // autosave then immediately clicks Save Draft / Publish.
      const targetSlug = slug || autoSlug;
      if (targetSlug) {
        res = await updateMakerProduct(targetSlug, payload);
        toast.success(statusOverride === "published" ? "Listing published." : "Draft saved.");
      } else {
        res = await createMakerProduct(payload);
        toast.success(statusOverride === "published" ? "Listing published." : "Draft saved.");
      }
      navigate("/maker/dashboard#listings", { replace: true });
      return res;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const cloneListing = async () => {
    if (!isEdit) return;
    if (!window.confirm(`Duplicate "${form.title}" as a new draft?`)) return;
    setSaving(true);
    try {
      const newDoc = await duplicateMakerProduct(slug);
      toast.success("Listing cloned. Editing the new draft now.");
      navigate(`/maker/listings/${newDoc.slug}/edit`, { replace: true });
      // Reload editor with fresh data on the new slug — easiest is a full
      // reload because component state is keyed off `slug` from the URL.
      setTimeout(() => window.location.reload(), 60);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Clone failed.");
    } finally {
      setSaving(false);
    }
  };

  const previewListing = () => {
    if (!isEdit || form.status !== "published") {
      toast.info("Save & publish first to preview live.");
      return;
    }
    window.open(`/shop/${slug}`, "_blank");
  };

  // ---------------- Autosave ------------------------------------------------
  // Skip autosave when:
  //   • Loader is still hydrating an existing listing (initial setForm).
  //   • The user has typed nothing meaningful yet (no title) AND we have no
  //     existing slug to patch — there's nothing worth persisting.
  //   • A manual save is already in flight (avoid race).
  //
  // Behaviour:
  //   • Debounce 1500ms after the last form mutation.
  //   • If `slug` (existing edit) or `autoSlug` (already auto-created), PATCH.
  //   • Otherwise CREATE a new draft with status='draft' and stash the slug
  //     so subsequent edits patch in place (no duplicate drafts).
  const effectiveSlug = slug || autoSlug;

  useEffect(() => {
    if (!loaded) return;
    if (saving) return;
    if (!effectiveSlug && !form.title.trim()) return;
    const t = setTimeout(async () => {
      try {
        setAutoStatus("saving");
        const payload = buildPayload("draft");
        if (effectiveSlug) {
          await updateMakerProduct(effectiveSlug, payload);
        } else {
          const created = await createMakerProduct({ ...payload, status: "draft" });
          if (created?.slug) setAutoSlug(created.slug);
        }
        setLastSavedAt(new Date());
        setAutoStatus("saved");
      } catch (e) {
        // Swallow — silent failures show as a yellow indicator pill, the
        // maker still has the manual Save Draft button as a fallback.
        setAutoStatus("error");
      }
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, loaded, saving, effectiveSlug]);

  // Tick every 30s so the "Saved 3s ago" relative time updates without
  // redrawing the whole tree on every keystroke.
  useEffect(() => {
    const id = setInterval(() => setAgoTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!loaded) {
    return (
      <div className="pt-40 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
        ◆ Loading editor…
      </div>
    );
  }

  // ---------- Render ----------
  return (
    <div className="min-h-screen grain bg-[#0a0a0a] text-[#e5e5e5]" data-testid="maker-listing-editor">
      <div className="pt-32" />
      {/* Top action bar */}
      <header className="sticky top-[calc(var(--beta-banner-h,0px)+72px)] z-30 bg-[#0a0a0a]/95 backdrop-blur border-b border-[#262626]">
        <div className="max-w-[1300px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/maker/dashboard#listings"
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] inline-flex items-center gap-2"
              data-testid="editor-cancel"
            >
              <ArrowLeft size={12} /> Cancel
            </Link>
            <span className="font-mono text-[10px] text-[#525252]">·</span>
            <h1 className="font-display text-base md:text-xl truncate">
              {isEdit ? "Edit Listing" : "Create a New Listing"}
            </h1>
          </div>
          <ActionButtons
            isEdit={isEdit}
            saving={saving}
            canPublish={canPublish}
            errors={errors}
            autoStatus={autoStatus}
            lastSavedAt={lastSavedAt}
            agoTick={agoTick}
            onClone={cloneListing}
            onPreview={previewListing}
            onSaveDraft={() => submit("draft")}
            onPublish={() => submit("published")}
          />
        </div>
      </header>

      <div className="max-w-[1300px] mx-auto px-4 md:px-8 py-10 space-y-12 pb-32">

        <MediaSection
          form={form} errors={errors} set={set}
          fileRef={fileRef} onPickPhotos={onPickPhotos}
          removeImage={removeImage} promoteCover={promoteCover} recropImage={recropImage}
          dragSrc={dragSrc} dragOver={dragOver}
          onDragStart={onDragStart} onDragOver={onDragOver}
          onDragLeaveTile={onDragLeaveTile} onDrop={onDrop} onDragEnd={onDragEnd}
          videoFileRef={videoFileRef} onPickVideo={onPickVideo}
          videoUploading={videoUploading} videoErr={videoErr} removeVideo={removeVideo}
        />

        <AiAssistantSection
          aiHidden={aiHidden} setAiHidden={setAiHidden}
          aiPrompt={aiPrompt} setAiPrompt={setAiPrompt}
          aiBusy={aiBusy} runAI={runAI}
        />

        {/* ---------- Listing Details ---------- */}
        <Section
          eyebrow="◆ Listing"
          title="Listing Details"
          subtitle="Tell buyers about your item. Good titles and descriptions help buyers find your listing."
        >
          <Label>Title * <span className="text-[#525252]">{form.title.length}/100</span></Label>
          <input
            type="text" value={form.title} maxLength={100}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g. Custom Plasma Cut Metal Wall Art — Large Industrial Sign"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
            data-testid="editor-title"
          />
          {errors.title && <FieldError msg={errors.title} />}

          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div>
              <Label>Category *</Label>
              <Select value={form.category} onChange={(v) => set({ category: v })}
                options={CATEGORIES.map((c) => [c, c])} testid="editor-category" />
            </div>
            <div>
              <Label>Technique</Label>
              <Select value={form.technique} onChange={(v) => set({ technique: v })}
                options={TECHNIQUES.map((t) => [t, t])} testid="editor-technique" />
            </div>
          </div>

          <div className="mt-4">
            <Label>Materials (press Enter to add)</Label>
            <div className="flex gap-2 flex-wrap mb-2" data-testid="editor-materials-chips">
              {form.materials.map((m) => (
                <span key={m} className="inline-flex items-center gap-2 px-2 py-1 border border-[#262626] font-mono text-[11px]">
                  {m}
                  <button onClick={() => removeMaterial(m)} className="text-[#737373] hover:text-red-400" aria-label={`Remove ${m}`}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text" value={form.materials_input}
              onChange={(e) => set({ materials_input: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault(); addMaterial(form.materials_input);
                }
              }}
              placeholder="e.g. 14ga mild steel, oak, walnut stain"
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
              data-testid="editor-materials-input"
            />
          </div>

          <div className="mt-4">
            <Label>Description *</Label>
            <textarea
              rows={6} value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="Describe your item in detail. Include dimensions, finish, customization options, and what makes it special. Buyers love knowing the story behind the piece."
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm resize-y"
              data-testid="editor-description"
            />
            {errors.description && <FieldError msg={errors.description} />}
          </div>
        </Section>

        {/* ---------- Item Details ---------- */}
        <Section
          eyebrow="◆ Specs"
          title="Item Details"
          subtitle="Help buyers find your item and know exactly what they're getting. More detail = more trust."
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Who made it</Label>
              <Select value={form.who_made_it} onChange={(v) => set({ who_made_it: v })}
                options={WHO_MADE_IT} testid="editor-who-made-it" />
            </div>
            <div>
              <Label>Condition</Label>
              <Select value={form.condition} onChange={(v) => set({ condition: v })}
                options={CONDITIONS} testid="editor-condition" />
            </div>
          </div>

          <div className="mt-5">
            <Label>Dimensions</Label>
            <div className="grid grid-cols-4 gap-2">
              <NumInput value={form.length_in} onChange={(v) => set({ length_in: v })}
                placeholder="Length" testid="editor-length" />
              <NumInput value={form.width_in} onChange={(v) => set({ width_in: v })}
                placeholder="Width" testid="editor-width" />
              <NumInput value={form.height_in} onChange={(v) => set({ height_in: v })}
                placeholder="Height" testid="editor-height" />
              <Select value={form.dim_unit} onChange={(v) => set({ dim_unit: v })}
                options={DIM_UNITS.map((u) => [u, u])} testid="editor-dim-unit" />
            </div>
            <div className="grid grid-cols-4 gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#525252] mt-1 px-1">
              <span>L</span><span>W</span><span>H</span><span>Unit</span>
            </div>
          </div>

          <div className="mt-5">
            <Label>Weight</Label>
            <div className="grid grid-cols-4 gap-2 max-w-md">
              <NumInput value={form.weight_lbs} onChange={(v) => set({ weight_lbs: v })} placeholder="0" testid="editor-weight-lbs" />
              <span className="self-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">lbs</span>
              <NumInput value={form.weight_oz} onChange={(v) => set({ weight_oz: v })} placeholder="0" testid="editor-weight-oz" />
              <span className="self-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">oz</span>
            </div>
          </div>

          <div className="mt-5">
            <Label>Colors <span className="text-[#525252]">(select all that apply)</span></Label>
            <ChipGrid options={COLORS} selected={form.colors}
              onToggle={(v) => toggleArr("colors", v)} testidPrefix="editor-color" />
          </div>

          <div className="mt-5">
            <Label>Occasion <span className="text-[#525252]">(select all that apply)</span></Label>
            <ChipGrid options={OCCASIONS} selected={form.occasions}
              onToggle={(v) => toggleArr("occasions", v)} testidPrefix="editor-occasion" />
          </div>
        </Section>

        <PricingSection
          form={form} set={set} errors={errors}
          addVariant={addVariant} updateVariant={updateVariant} removeVariant={removeVariant}
        />

        {/* ---------- Personalization ---------- */}
        <Section
          eyebrow="◆ Customization"
          title="Personalization"
          subtitle="Let buyers send custom instructions — names, dates, measurements, or any special requests."
          right={
            <Toggle
              on={form.personalization_enabled}
              onChange={(v) => set({ personalization_enabled: v })}
              testid="editor-personalization-toggle"
              label={form.personalization_enabled ? "Personalization on" : "Personalization off"}
            />
          }
        >
          {form.personalization_enabled && (
            <>
              <Label>Instructions for the buyer</Label>
              <textarea
                rows={3} value={form.personalization_instructions}
                onChange={(e) => set({ personalization_instructions: e.target.value })}
                placeholder="e.g. Enter the names (max 12 characters each) you'd like carved, separated by commas."
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm resize-y"
                data-testid="editor-personalization-instructions"
              />
            </>
          )}
        </Section>

        {/* ---------- Shipping ---------- */}
        <Section
          eyebrow="◆ Logistics"
          title="Shipping"
          subtitle="Set shipping costs and estimated delivery. Offering free shipping can increase sales."
          right={
            <Toggle
              on={form.free_shipping}
              onChange={(v) => set({ free_shipping: v })}
              testid="editor-free-shipping"
              label="Free shipping"
            />
          }
        >
          {!form.free_shipping && (
            <div className="grid sm:grid-cols-2 gap-4 mb-5">
              <div>
                <Label>Domestic shipping ($)</Label>
                <NumInput value={form.shipping_domestic_usd} onChange={(v) => set({ shipping_domestic_usd: v })}
                  placeholder="$ 0.00" testid="editor-shipping-domestic" />
              </div>
              <div>
                <Label>International ($)</Label>
                <NumInput value={form.shipping_international_usd} onChange={(v) => set({ shipping_international_usd: v })}
                  placeholder="$ 0.00" testid="editor-shipping-international" />
              </div>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Carrier</Label>
              <Select value={form.shipping_carrier} onChange={(v) => set({ shipping_carrier: v })}
                options={[["", "Select carrier…"], ...CARRIERS.map((c) => [c, c])]}
                testid="editor-shipping-carrier" />
            </div>
            <div>
              <Label>Est. delivery</Label>
              <Select value={form.shipping_est_delivery} onChange={(v) => set({ shipping_est_delivery: v })}
                options={[["", "Select range…"], ...DELIVERY_RANGES.map((d) => [d, d])]}
                testid="editor-shipping-est-delivery" />
            </div>
          </div>

          {/* Calculated-shipping inputs — weight + packed size. Lets carriers
              quote real-time rates instead of the maker eyeballing a flat
              fee. Weight maps to the same `weight_lbs`/`weight_oz` fields
              from Item Details (single source of truth — typing here
              updates there and vice versa). */}
          <div className="mt-6 pt-6 border-t border-[#262626]" data-testid="editor-shipping-calc">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-2">
              ◆ Calculated shipping
            </div>
            <p className="font-mono text-xs text-[#a3a3a3] mb-5 max-w-2xl leading-relaxed">
              Weight and packed size let carriers quote live rates at checkout instead of the buyer paying your flat fee. Required for USPS / UPS / FedEx calculated profiles.
            </p>

            <div className="mb-5">
              <Label>Item weight *</Label>
              <div className="grid grid-cols-4 gap-2 max-w-md">
                <NumInput
                  value={form.weight_lbs}
                  onChange={(v) => set({ weight_lbs: v })}
                  placeholder="0" testid="editor-ship-weight-lbs"
                />
                <span className="self-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">lb</span>
                <NumInput
                  value={form.weight_oz}
                  onChange={(v) => set({ weight_oz: v })}
                  placeholder="0" testid="editor-ship-weight-oz"
                />
                <span className="self-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">oz</span>
              </div>
            </div>

            <div>
              <Label>Item size when packed *</Label>
              <p className="font-mono text-[10px] text-[#525252] mb-2 max-w-2xl">
                Size after the item's been prepped for packaging — e.g. folded, rolled, or padded — but before it goes into a box.
              </p>
              <div className="grid grid-cols-4 gap-2 max-w-2xl">
                <NumInput
                  value={form.packed_length_in}
                  onChange={(v) => set({ packed_length_in: v })}
                  placeholder="Length" testid="editor-packed-length"
                />
                <NumInput
                  value={form.packed_width_in}
                  onChange={(v) => set({ packed_width_in: v })}
                  placeholder="Width" testid="editor-packed-width"
                />
                <NumInput
                  value={form.packed_height_in}
                  onChange={(v) => set({ packed_height_in: v })}
                  placeholder="Height" testid="editor-packed-height"
                />
                <span className="self-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">in</span>
              </div>
              <div className="grid grid-cols-4 gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#525252] mt-1 px-1 max-w-2xl">
                <span>L</span><span>W</span><span>H</span><span>Unit</span>
              </div>
            </div>

            <ShippingEstimatePreview form={form} />
          </div>
        </Section>

        {/* ---------- Processing Time ---------- */}
        <Section
          eyebrow="◆ Lead time"
          title="Processing Time"
          subtitle="How long does it take to make and prepare your item before it ships? Buyers see this at checkout."
        >
          <Label>Time to ship after order</Label>
          <Select value={form.processing_time} onChange={(v) => set({ processing_time: v })}
            options={PROCESSING_TIMES.map((p) => [p, p])} testid="editor-processing-time" />
          <p className="font-mono text-[10px] text-[#525252] mt-2">
            ◆ Custom or made-to-order items often need longer processing time.
          </p>
        </Section>

        {/* ---------- Return Policy ---------- */}
        <Section
          eyebrow="◆ Policy"
          title="Return Policy"
          subtitle="Let buyers know if you accept returns or exchanges. Custom/personalized items are typically non-returnable."
        >
          <div className="space-y-3">
            <ToggleRow
              label="Accept returns"
              hint="Buyer can return for a refund."
              on={form.accept_returns}
              onChange={(v) => set({ accept_returns: v })}
              testid="editor-accept-returns"
            />
            <ToggleRow
              label="Accept exchanges"
              hint="Buyer can exchange for a different item or variation."
              on={form.accept_exchanges}
              onChange={(v) => set({ accept_exchanges: v })}
              testid="editor-accept-exchanges"
            />
          </div>
          <div className="mt-5 border border-[#262626] bg-[#0d0d0d] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
              ◆ Buyer will see
            </div>
            <p className="font-mono text-xs text-[#e5e5e5]" data-testid="editor-buyer-will-see">
              {(form.accept_returns || form.accept_exchanges)
                ? `This seller accepts ${[
                    form.accept_returns && "returns", form.accept_exchanges && "exchanges",
                  ].filter(Boolean).join(" and ")}.`
                : "This seller does not accept returns or exchanges."}
            </p>
          </div>
        </Section>

        {/* ---------- SEO Tags ---------- */}
        <Section
          eyebrow="◆ Discoverability"
          title="SEO Tags"
          subtitle="Tags help buyers discover your listing in search. Add up to 13 — one at a time, or let AI generate them from your title and description."
        >
          <button
            type="button" onClick={runSeoAI}
            disabled={seoBusy || !form.title.trim() || form.seo_tags.length >= MAX_TAGS}
            className="mb-4 inline-flex items-center gap-2 px-4 py-2 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="editor-seo-ai-btn"
          >
            <Sparkles size={14} /> {seoBusy ? "Generating…" : "✦ AI suggest tags"}
          </button>
          <p className="font-mono text-[10px] text-[#525252] -mt-2 mb-4">
            ◆ Uses your current title, category, and description. Won't duplicate tags you've already added.
          </p>
          {form.seo_tags.length >= MAX_TAGS && (
            <div
              className="flex items-start gap-2 px-3 py-2.5 mb-3 border border-amber-500/50 bg-amber-500/10"
              data-testid="editor-seo-max-banner"
              role="status"
            >
              <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="font-mono text-[11px] text-amber-300 leading-relaxed">
                <b>You've reached the maximum of {MAX_TAGS} tags.</b>
                <span className="text-amber-200/80"> Remove a tag below to add a new one.</span>
              </div>
            </div>
          )}
          <Label>
            Add tag{" "}
            <span
              className={`${
                form.seo_tags.length >= MAX_TAGS ? "text-amber-400 font-bold" : "text-[#525252]"
              }`}
              data-testid="editor-seo-counter"
            >
              {form.seo_tags.length}/{MAX_TAGS}
            </span>
          </Label>
          <div className="flex gap-2">
            <input
              type="text" value={form.seo_input}
              onChange={(e) => set({ seo_input: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault(); addTag(form.seo_input);
                }
              }}
              placeholder={
                form.seo_tags.length >= MAX_TAGS
                  ? "Limit reached — remove a tag first"
                  : "e.g. metal wall art"
              }
              disabled={form.seo_tags.length >= MAX_TAGS}
              className="flex-1 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="editor-seo-input"
            />
            <button
              type="button" onClick={() => addTag(form.seo_input)}
              disabled={!form.seo_input.trim() || form.seo_tags.length >= MAX_TAGS}
              className="px-4 py-2 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="editor-seo-add"
            >
              Add
            </button>
          </div>
          <p className="font-mono text-[10px] text-[#525252] mt-1">
            Press Enter or comma to add. Max {MAX_TAGS} tags.
          </p>
          {form.seo_tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3" data-testid="editor-seo-chips">
              {form.seo_tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-2 px-2 py-1 border border-[#ff4500]/50 bg-[#ff4500]/5 text-[#ff4500] font-mono text-[11px]">
                  <Tag size={10} /> {t}
                  <button onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* ---------- Contact ---------- */}
        <Section
          eyebrow="◆ Direct line"
          title="Contact"
          subtitle="Your contact email is shared only with buyers who reach out directly."
        >
          <Label>Contact email *</Label>
          <input
            type="email" value={form.contact_email}
            onChange={(e) => set({ contact_email: e.target.value })}
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
            data-testid="editor-contact-email"
          />
          <p className="font-mono text-[10px] text-[#525252] mt-1">
            Only shared with buyers who contact you directly.
          </p>
        </Section>

        {/* ---------- Bottom action bar ---------- */}
        <div className="flex items-center justify-between border-t border-[#262626] pt-6">
          <Link
            to="/maker/dashboard#listings"
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
            data-testid="editor-cancel-bottom"
          >
            ← Cancel
          </Link>
          <ActionButtons
            isEdit={isEdit}
            saving={saving}
            canPublish={canPublish}
            errors={errors}
            autoStatus={autoStatus}
            lastSavedAt={lastSavedAt}
            agoTick={agoTick}
            onClone={cloneListing}
            onPreview={previewListing}
            onSaveDraft={() => submit("draft")}
            onPublish={() => submit("published")}
          />
        </div>
      </div>

      {/* Crop modal — pops while there are pending files in the queue. */}
      {cropQueue.length > 0 && (
        <ImageCropModal
          src={cropQueue[0]}
          onCancel={onCropCancel}
          onConfirm={onCropConfirm}
        />
      )}
    </div>
  );
}


// Live shipping-rate preview shown directly under the packed-dimensions
// inputs. Uses a pure client-side estimator (`/app/frontend/src/lib/
// shippingEstimator.js`) so there's no API round-trip — the maker sees
// a realistic ballpark the moment they finish typing weight + size.
function ShippingEstimatePreview({ form }) {
  const est = useMemo(() => estimateShipping(form), [form]);
  if (!est) return null;
  const cheapest = est.options[0];
  const padding = parseFloat(est.dimLb) > parseFloat(est.actualLb);

  return (
    <div
      className="mt-6 border border-emerald-500/30 bg-emerald-500/5 p-4"
      data-testid="ship-estimate-preview"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400 mb-2">
        ◆ Estimated rates · zone-4 average
      </div>
      <div className="flex items-baseline gap-3 mb-3 flex-wrap">
        <span className="font-display text-2xl text-emerald-300" data-testid="ship-estimate-cheapest">
          ${cheapest.cost.toFixed(2)}
        </span>
        <span className="font-mono text-[11px] text-[#a3a3a3]">
          via {cheapest.carrier} {cheapest.service} · {cheapest.days} days
        </span>
      </div>

      <div className="space-y-1.5 mb-3" data-testid="ship-estimate-options">
        {est.options.map((opt, i) => (
          <div
            key={`${opt.carrier}-${opt.service}`}
            className={`grid grid-cols-[1fr_auto_auto] gap-3 px-2 py-1 font-mono text-[11px] ${
              i === 0 ? "text-emerald-300" : "text-[#a3a3a3]"
            }`}
            data-testid={`ship-estimate-row-${i}`}
          >
            <span className="truncate">
              {i === 0 && "✓ "}
              {opt.carrier} {opt.service}
            </span>
            <span className="text-[#525252]">{opt.days}d</span>
            <span className={i === 0 ? "text-emerald-300" : "text-[#e5e5e5]"}>
              ${opt.cost.toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[#737373]">
        <span>Actual <span className="text-[#a3a3a3]">{est.actualLb} lb</span></span>
        <span>Dim <span className="text-[#a3a3a3]">{est.dimLb} lb</span></span>
        <span>Billable <span className="text-emerald-400">{est.billableLb} lb</span></span>
      </div>
      {padding && (
        <p
          className="font-mono text-[10px] text-amber-400/90 mt-2 leading-relaxed"
          data-testid="ship-estimate-dim-warning"
        >
          ◇ Your package volume is driving the cost (carriers bill on the larger of actual vs. dim weight).
          Tighter packaging could lower this estimate.
        </p>
      )}
      <p className="font-mono text-[9px] text-[#525252] mt-3 leading-relaxed">
        Estimates are zone-4 averages from public 2026 rate tables — actual checkout costs vary by buyer ZIP. Carriers bill the larger of actual vs. dimensional (L×W×H ÷ 166) weight.
      </p>
    </div>
  );
}
