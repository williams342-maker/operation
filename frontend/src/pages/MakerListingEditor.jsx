import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Sparkles, X, Tag, AlertTriangle,
} from "lucide-react";
import {
  fetchMakerMe, fetchMakerProducts, createMakerProduct,
  updateMakerProduct, aiListingCopy, aiSeoTags,
  duplicateMakerProduct, uploadMakerVideo, uploadMakerListingImage,
  downloadProductStoryCard, fetchPresetShippingRates,
} from "../lib/api";
import ImageCropModal from "../components/ImageCropModal";
import ProcessingProfilePicker from "../components/ProcessingProfilePicker";
import { useConfirm } from "../hooks/useConfirm";
import {
  CATEGORIES, TECHNIQUES, WHO_MADE_IT, CONDITIONS, DIM_UNITS, COLORS,
  OCCASIONS, PROCESSING_TIMES, DELIVERY_RANGES, CARRIERS,
  MAX_IMAGES, MAX_TAGS, emptyForm,
  shippingHintForCategory,
  SHIPPING_PRESETS, defaultPresetIdForCategory,
} from "./MakerListingEditor/constants";
import {
  Section, Label, FieldError, NumInput, Select, ChipGrid, Toggle, ToggleRow,
  ActionButtons,
} from "./MakerListingEditor/FormControls";
import MediaSection from "./MakerListingEditor/MediaSection";
import AiAssistantSection from "./MakerListingEditor/AiAssistantSection";
import PricingSection from "./MakerListingEditor/PricingSection";
import PriceComparePanel from "./MakerListingEditor/PriceComparePanel";
import ListingTypeSection from "./MakerListingEditor/ListingTypeSection";
import GpcCombobox from "./MakerListingEditor/GpcCombobox";
import MerchantFeedSection from "./MakerListingEditor/MerchantFeedSection";
import { estimateShipping } from "../lib/shippingEstimator";

// Mirrors `_google_product_category` in backend/routers/pinterest_feed.py
// so the maker sees the same default the feed would have shipped if they
// left `gpc_path` blank. Pure UX hint — the actual feed mapping lives
// server-side.
function _autoGpcHint(category) {
  const cat = (category || "").toLowerCase();
  if (cat.includes("sign")) return "Home & Garden > Decor > Signs";
  if (cat.includes("wall") || cat.includes("art"))
    return "Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork";
  if (cat.includes("shelf") || cat.includes("shelv"))
    return "Furniture > Cabinets & Storage > Storage Cabinets";
  if (cat.includes("furniture") || cat.includes("table"))
    return "Furniture > Tables > Accent Tables";
  if (cat.includes("jewel")) return "Apparel & Accessories > Jewelry > Necklaces";
  if (cat.includes("gift") || cat.includes("craft"))
    return "Arts & Entertainment > Hobbies & Creative Arts > Arts & Crafts";
  return "Home & Garden > Decor > Artwork > Sculptures & Statues";
}

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
  const [confirm, confirmModal] = useConfirm();

  // ---- Autosave state ----
  // `autoStatus` is the lifecycle for the indicator pill: idle (no edits
  // yet), saving (request in flight), saved (successful save), error
  // (last attempt failed — manual retry recommended).
  const [autoStatus, setAutoStatus] = useState("idle");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  // iter332 — Carrier-preset picker. Open/closed UI state for the chip
  // popover under Category; clicking a preset row fills the packed
  // dimensions + weight fields + sets shipping_domestic_usd in one shot.
  const [presetOpen, setPresetOpen] = useState(false);
  // iter334 — AI Price Check side panel.
  const [priceCheckOpen, setPriceCheckOpen] = useState(false);
  // iter334 — Live Shippo preset rates. Maps preset_id → { amount, provider,
  // servicelevel_name } once "Get live rates" is hit. While fetching,
  // `presetRatesLoading` is true and rows show a small spinner inline.
  // `presetRatesUsingDemoFrom` flags when we fell back to the platform's
  // demo ship-from so the UI can nudge the maker to save their address.
  const [presetRates, setPresetRates] = useState({});
  const [presetRatesLoading, setPresetRatesLoading] = useState(false);
  const [presetRatesUsingDemoFrom, setPresetRatesUsingDemoFrom] = useState(false);
  // iter334b — Which parcel fields the backend actually overrode (echo
  // of the maker's listing-actual dims). Used to label the picker
  // header so the maker knows whether the live rates are against the
  // preset's canonical box or their own dimensions.
  const [presetRatesOverrides, setPresetRatesOverrides] = useState([]);
  // Slug of the draft auto-created on a brand-new listing. Once set, all
  // subsequent autosaves PATCH instead of creating duplicate drafts.
  const [autoSlug, setAutoSlug] = useState(null);
  // Bumps every 30s so the "Saved 3s ago" copy stays fresh without
  // re-rendering on every keystroke.
  const [agoTick, setAgoTick] = useState(0);

  // iter367 bug fix — autosave fired on the hydration `setForm` itself,
  // PATCHing `status:"draft"` and silently UNPUBLISHING any published
  // listing whose editor was merely opened. `dirtyRef` flips true only
  // on real user mutations; hydration resets it.
  const dirtyRef = useRef(false);
  const set = (patch) => {
    dirtyRef.current = true;
    setForm((f) => ({ ...f, ...patch }));
  };

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
          dirtyRef.current = false;  // hydration is not a user edit
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
            gpc_path: found.gpc_path || "",
            // iter365 — Google Merchant feed controls.
            merchant_title: found.merchant_title || "",
            merchant_auto_optimize: found.merchant_auto_optimize !== false,
            merchant_exclude: !!found.merchant_exclude,
            who_made_it: found.who_made_it || "i_made_it",
            condition: found.condition || "new",
            dim_unit: found.dim_unit || "in",
            processing_time: found.processing_time || "1-3 business days",
            variants: (found.variants || []).map((v) => ({
              ...v,
              // iter334r — variants now carry an absolute `price`;
              // surface "" for the input when not yet set.
              price: v.price != null ? v.price : "",
              sku: v.sku || "",
              option_ids: v.option_ids || [],
            })),
            // iter364 — variation groups + required-upload flag.
            variant_groups: found.variant_groups || [],
            personalization_requires_upload: !!found.personalization_requires_upload,
            status: found.status || "draft",
            // Backorders — preserve `null` (inherit from maker default)
            // distinct from explicit `false` (override off)
            accepts_backorders: found.accepts_backorders ?? null,
            backorder_lead_weeks: found.backorder_lead_weeks ?? null,
            // Etsy-style renewal mode — default to "automatic" for legacy
            // listings that don't have the field set yet so the toggle
            // reflects the backend's default behaviour.
            renewal_option: found.renewal_option || "automatic",
            // iter327 — Digital/hybrid listing fields. Legacy listings
            // default to "physical" so existing rows behave exactly as
            // they did pre-upgrade.
            listing_type: found.listing_type || "physical",
            digital_files: found.digital_files || [],
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
  // AI tag review buffer — array of { tag, kept } objects shown after AI
  // suggestions are returned but BEFORE they're committed to form.seo_tags.
  // Lets the maker un-check filler tags so the 13-slot budget isn't wasted
  // on weak suggestions.
  const [aiTagReview, setAiTagReview] = useState([]);
  // Per-photo upload state keyed by the photo's `src` string. Tracks
  // `"uploading"` while a data URL is streaming to R2, and `"error"` when
  // the upload failed so we can surface a per-tile Retry button. Once a
  // photo's data URL is swapped for the resulting R2 URL the entry is
  // discarded — the keys go stale and we just drop them.
  //
  // Derived: `imageUploads` (the count of values === "uploading") is the
  // gate for blocking Save / Publish / autosave so we never ship an
  // unresolved data URL on the wire.
  const [uploadStatus, setUploadStatus] = useState({});       // { [src]: "uploading" | "error" }
  const imageUploads = useMemo(
    () => Object.values(uploadStatus).filter((v) => v === "uploading").length,
    [uploadStatus],
  );

  // Convert a data: URL to a typed Blob for multipart upload. JPEG by
  // default — the cropper outputs JPEG anyway. Returns null if the input
  // isn't a recognisable data URL.
  const _dataUrlToBlob = (dataUrl) => {
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
    if (!m) return null;
    const ct = m[1];
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: ct });
  };

  // Eagerly push a cropped data URL to R2 and swap the placeholder data
  // URL in form.images for the resulting CDN URL. Keeps the placeholder
  // (so the maker keeps seeing the preview) on failure, surfaces a toast,
  // and tags the tile as `"error"` so a per-tile Retry button appears.
  //
  // Auto-retry: up to 3 attempts with exponential backoff (1s, 2s) for
  // transient errors (network blips / 5xx). 4xx errors (oversized, bad
  // content type, auth) bail immediately since retrying won't help.
  const _uploadOneListingImage = async (dataUrl) => {
    const blob = _dataUrlToBlob(dataUrl);
    if (!blob) return;
    setUploadStatus((s) => ({ ...s, [dataUrl]: "uploading" }));
    const MAX_ATTEMPTS = 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const { url } = await uploadMakerListingImage(blob);
        if (!url) {
          setUploadStatus((s) => {
            const { [dataUrl]: _, ...rest } = s; return rest;
          });
          return;
        }
        dirtyRef.current = true;  // persist the swapped R2 URL on next autosave
        setForm((f) => ({
          ...f,
          images: f.images.map((s) => (s === dataUrl ? url : s)),
        }));
        setUploadStatus((s) => {
          const { [dataUrl]: _, ...rest } = s; return rest;
        });
        return;
      } catch (e) {
        lastErr = e;
        const status = e?.response?.status;
        // 4xx (except 408/429) won't succeed on retry — bail fast so the
        // maker sees the actionable error message right away instead of
        // staring at "Uploading…" for 3 seconds before failing anyway.
        const retriable = !status || status >= 500 || status === 408 || status === 429;
        if (!retriable || attempt === MAX_ATTEMPTS) break;
        // Backoff: 1s after attempt 1, 2s after attempt 2.
        await new Promise((res) => setTimeout(res, attempt * 1000));
      }
    }
    // All attempts exhausted — leave the data URL in form.images so the
    // maker can retry manually. The legacy in-line upload path on the
    // backend is still wired up as a safety net for the save call.
    const msg = lastErr?.response?.data?.detail || "Photo upload failed — tap retry, or remove and re-add.";
    toast.error(msg);
    setUploadStatus((s) => ({ ...s, [dataUrl]: "error" }));
  };

  // Per-tile Retry handler. Re-uploads `form.images[i]` if it's still a
  // data URL (i.e. never reached R2). No-op for already-uploaded URLs.
  const retryImageUpload = (i) => {
    const src = form.images[i];
    if (!src || !src.startsWith("data:")) return;
    _uploadOneListingImage(src);
  };

  // Bulk retry — kicks off a fresh upload for every tile currently tagged
  // as "error". Skips tiles that already succeeded or are mid-upload, so
  // it's safe to call repeatedly. Used by the "Retry all failed" button in
  // MediaSection (helps craft-fair makers recover from a flaky-wifi batch
  // upload in one click).
  const retryAllFailedUploads = () => {
    const failures = form.images.filter(
      (src) => src && src.startsWith("data:") && uploadStatus[src] === "error",
    );
    failures.forEach((src) => _uploadOneListingImage(src));
  };

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
    dirtyRef.current = true;
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
    // Fire-and-forget background upload — swaps the data URL for the R2
    // URL once done so save/autosave ship only small URL strings instead
    // of 10MB of base64. Blocks save while in flight.
    _uploadOneListingImage(croppedDataUrl);
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
      // Open the review tray instead of merging directly. Drops anything
      // that's already in seo_tags (would be a no-op anyway).
      const fresh = (r.tags || [])
        .map((t) => (t || "").trim().toLowerCase())
        .filter((t) => t && !form.seo_tags.includes(t));
      const slotsLeft = MAX_TAGS - form.seo_tags.length;
      if (!fresh.length) {
        toast.message("No new tag suggestions — your existing tags already cover the topic.");
      } else {
        // Pre-check the first `slotsLeft` items; the rest start unchecked
        // so the user has to actively make room for them.
        setAiTagReview(
          fresh.map((t, idx) => ({ tag: t, kept: idx < slotsLeft })),
        );
        toast.success(
          `${fresh.length} suggestion${fresh.length === 1 ? "" : "s"} ready — review below before applying.`,
        );
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "AI tag generation failed.");
    } finally {
      setSeoBusy(false);
    }
  };

  const toggleAiTag = (tag) => {
    setAiTagReview((rows) => rows.map((r) => r.tag === tag ? { ...r, kept: !r.kept } : r));
  };
  const applyAiTagReview = () => {
    const kept = aiTagReview.filter((r) => r.kept).map((r) => r.tag);
    if (!kept.length) {
      toast.error("Tick at least one tag to apply, or click Discard.");
      return;
    }
    const slots = MAX_TAGS - form.seo_tags.length;
    const truncated = kept.slice(0, slots);
    const merged = Array.from(new Set([...(form.seo_tags || []), ...truncated])).slice(0, MAX_TAGS);
    const added = merged.length - (form.seo_tags?.length || 0);
    set({ seo_tags: merged });
    setAiTagReview([]);
    if (kept.length > slots) {
      toast.warning(
        `Added ${added} tag${added === 1 ? "" : "s"} (${kept.length - slots} skipped — limit reached).`,
      );
    } else {
      toast.success(`Added ${added} tag${added === 1 ? "" : "s"} to your listing.`);
    }
  };
  const discardAiTagReview = () => {
    setAiTagReview([]);
    toast.message("AI suggestions discarded.");
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
        { id: undefined, label: "", price: "", price_delta: 0, in_stock: 1 },
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
    // iter334r — Allow base price 0 if any variant has its own absolute price.
    const variantHasPrice = (form.variants || []).some(
      (v) => v && v.label && Number(v.price) > 0,
    );
    if ((!form.price || Number(form.price) <= 0) && !variantHasPrice) {
      out.price = "Price must be > 0 (or set a price on at least one variant).";
    }
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
      // iter334r — Variants now carry an absolute `price`. Legacy
      // `price_delta` still serialized to keep older buyer pages happy
      // until they re-fetch a new Product schema.
      price: v.price !== "" && v.price != null ? Number(v.price) : null,
      price_delta: Number(v.price_delta) || 0,
      in_stock: Math.max(0, Number(v.in_stock) || 0),
      // iter364 — combos carry the composing option ids + optional SKU.
      sku: (v.sku || "").trim() || null,
      option_ids: v.option_ids || [],
      image: v.image || null,
    })).filter((v) => v.label),
    variant_axis1_name: form.variant_axis1_name || null,
    variant_axis2_name: form.variant_axis2_name || null,
    // iter364 — variation groups (only named groups with ≥1 labeled option).
    variant_groups: (form.variant_groups || [])
      .map((g) => ({
        id: g.id,
        name: (g.name || "").trim(),
        // iter380 — inventory strategy: tracked groups generate stock-counted
        // combos; customization-only groups are buyer picks with no SKU rows.
        tracks_inventory: g.tracks_inventory !== false,
        options: (g.options || [])
          .filter((o) => (o.label || "").trim())
          .map((o) => ({
            id: o.id,
            label: o.label.trim(),
            price_delta: Number(o.price_delta) || 0,
            image: o.image || null,
          })),
      }))
      .filter((g) => g.name && g.options.length),
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
    personalization_requires_upload: !!form.personalization_requires_upload,
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
    gpc_path: (form.gpc_path || "").trim(),
    // iter365 — Google Merchant feed controls (feed-only metadata).
    merchant_title: (form.merchant_title || "").trim() || null,
    merchant_auto_optimize: !!form.merchant_auto_optimize,
    merchant_exclude: !!form.merchant_exclude,
    accepts_backorders: form.accepts_backorders,
    backorder_lead_weeks: form.backorder_lead_weeks ?? null,
    renewal_option: form.renewal_option || "automatic",
    // iter327 — Digital/hybrid listing type. `digital_files` are NOT
    // included in this payload — they're uploaded via the dedicated
    // /maker/listings/{slug}/digital-files endpoint after save.
    listing_type: form.listing_type || "physical",
  });

  const submit = async (statusOverride) => {
    if (statusOverride === "published" && !canPublish) {
      toast.error(Object.values(errors)[0]);
      return;
    }
    if (imageUploads > 0) {
      toast.info(`Hang tight — ${imageUploads} photo${imageUploads === 1 ? "" : "s"} still uploading. Try again in a sec.`);
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
    const ok = await confirm({
      title: `Duplicate "${form.title}"?`,
      body: "Creates a new draft with the same photos, copy, and pricing. You can edit the new draft without affecting the original.",
      confirmLabel: "Duplicate",
      tone: "primary",
      testId: "confirm-duplicate-listing",
    });
    if (!ok) return;
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
    if (imageUploads > 0) return;
    if (!effectiveSlug && !form.title.trim()) return;
    // iter367 — only autosave after a REAL user mutation. The hydration
    // setForm used to trip this effect and demote published → draft.
    if (!dirtyRef.current) return;
    const t = setTimeout(async () => {
      try {
        setAutoStatus("saving");
        dirtyRef.current = false;
        // No status override — autosave preserves the listing's current
        // status (published listings stay published). Brand-new sessions
        // still create as draft below.
        const payload = buildPayload();
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
        dirtyRef.current = true;  // retry the unsaved changes next tick
        setAutoStatus("error");
      }
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, loaded, saving, effectiveSlug, imageUploads]);

  // Tick every 30s so the "Saved 3s ago" relative time updates without
  // redrawing the whole tree on every keystroke.
  useEffect(() => {
    const id = setInterval(() => setAgoTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // iter334 — Fetch live Shippo rates for every preset in parallel.
  // Triggered by the "Get live rates" button in the preset picker.
  // Each preset hits its own backend endpoint, which uses the maker's
  // saved ship-from (or a platform demo fallback) and a mid-US ZIP.
  // Failures per preset are swallowed silently so one carrier hiccup
  // doesn't break the whole list — the missing rows just show the
  // static $cost as before.
  //
  // iter334b — When the maker has filled in their own packed_* dims +
  // weight on the listing, we pass them as overrides so the quote
  // reflects the actual box being shipped. Partial overrides supported.
  const loadLivePresetRates = async () => {
    if (presetRatesLoading) return;
    // Build the override parcel from the form. Only include fields the
    // maker has actually set (truthy + numeric > 0). Backend ignores
    // missing fields and falls back to the preset value.
    const toNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const totalWeightLbs = (() => {
      const lbs = toNum(form.weight_lbs);
      const oz = toNum(form.weight_oz);
      if (lbs == null && oz == null) return null;
      return (lbs || 0) + ((oz || 0) / 16);
    })();
    const overrides = {
      length: toNum(form.packed_length_in),
      width: toNum(form.packed_width_in),
      height: toNum(form.packed_height_in),
      weight: totalWeightLbs,
    };
    // Drop nulls so the JSON payload is clean and overrides are obvious.
    const cleanOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v != null)
    );
    const hasOverrides = Object.keys(cleanOverrides).length > 0;

    setPresetRatesLoading(true);
    try {
      const results = await Promise.allSettled(
        SHIPPING_PRESETS.map((p) => fetchPresetShippingRates(
          p.id,
          null,
          hasOverrides ? cleanOverrides : null,
        ))
      );
      const next = {};
      let demoFrom = false;
      let overridesEcho = [];
      results.forEach((res, i) => {
        if (res.status === "fulfilled") {
          const pid = SHIPPING_PRESETS[i].id;
          const rate = (res.value.rates || [])[0];  // cheapest
          if (rate && rate.amount) {
            next[pid] = {
              amount: rate.amount,
              provider: rate.provider || "",
              servicelevel: rate.servicelevel_name || "",
              estimated_days: rate.estimated_days || null,
            };
          }
          if (res.value.using_demo_from) demoFrom = true;
          if (Array.isArray(res.value.parcel_overrides) && res.value.parcel_overrides.length > overridesEcho.length) {
            overridesEcho = res.value.parcel_overrides;
          }
        }
      });
      setPresetRates(next);
      setPresetRatesUsingDemoFrom(demoFrom);
      setPresetRatesOverrides(overridesEcho);
      const found = Object.keys(next).length;
      if (found === 0) {
        toast.error("Couldn't fetch live rates — Shippo may be unavailable.");
      } else {
        const usingDims = overridesEcho.length > 0;
        toast.success(`Live rates loaded for ${found} preset${found === 1 ? "" : "s"}.`, {
          description: usingDims
            ? `Quoted against your listing's ${overridesEcho.join(" + ")}.`
            : (demoFrom ? "Using demo ship-from. Save your address for accurate rates." : undefined),
        });
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't fetch live rates.");
    } finally {
      setPresetRatesLoading(false);
    }
  };

  if (!loaded) {
    return (
      <div className="pt-40 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
        ◆ Loading editor…
      </div>
    );
  }

  // ---------- Render ----------
  return (
    <div className="min-h-screen grain bg-paper text-ink" data-testid="maker-listing-editor">
      {confirmModal}
      {/* iter334 — AI Price Comparison side panel. Triggered from the
          ◆ AI Price Check button in PricingSection. Renders nothing
          unless `priceCheckOpen` is true. */}
      <PriceComparePanel
        open={priceCheckOpen}
        onClose={() => setPriceCheckOpen(false)}
        listingSlug={slug || autoSlug}
        listedPrice={form.price}
      />
      <div className="pt-32" />
      {/* Top action bar */}
      <header className="sticky top-[calc(var(--beta-banner-h,0px)+72px)] z-30 bg-paper/95 backdrop-blur border-b border-line">
        <div className="max-w-[1300px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/maker/dashboard#listings"
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand inline-flex items-center gap-2"
              data-testid="editor-cancel"
            >
              <ArrowLeft size={12} /> Cancel
            </Link>
            <span className="font-mono text-[10px] text-ink-muted">·</span>
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
            uploadingPhotos={imageUploads}
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
          uploadingPhotos={imageUploads}
          uploadStatus={uploadStatus}
          retryImageUpload={retryImageUpload}
          retryAllFailedUploads={retryAllFailedUploads}
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
          <Label>Title * <span className="text-ink-muted">{form.title.length}/100</span></Label>
          <input
            type="text" value={form.title} maxLength={100}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g. Custom Plasma Cut Metal Wall Art — Large Industrial Sign"
            className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
            data-testid="editor-title"
          />
          <p className="font-mono text-[10px] text-ink-muted mt-1 leading-relaxed">
            Lead with what it is, then a hook (size, technique, vibe). Etsy-style: short titles convert better than keyword stuffing.
          </p>
          {errors.title && <FieldError msg={errors.title} />}

          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div>
              <Label>Category *</Label>
              <Select value={form.category} onChange={(v) => set({ category: v })}
                options={CATEGORIES.map((c) => [c, c])} testid="editor-category" />
              <p className="font-mono text-[10px] text-ink-muted mt-1 leading-relaxed">
                The single best filter buyers use — pick the closest match.
              </p>
              {/* iter331/332 — Shipping-rate hint chip → clickable
                  button. Default state shows the per-category carrier
                  hint; clicking opens a popover with 6 carrier presets
                  (USPS envelope → USPS Priority small/medium/large box
                  → UPS Ground → Freight). Picking one fills the packed
                  dimensions, weight (in lbs/oz), and `shipping_domestic
                  _usd` in one click — Shippo-compatible defaults that
                  buyers see at checkout. Custom rate chip is unchanged
                  (no override of a deliberate maker choice). */}
              {form.category && (
                form.shipping_domestic_usd != null && form.shipping_domestic_usd !== ""
                  && !presetOpen ? (
                  <div
                    className="mt-2 inline-flex items-center gap-2 px-2.5 py-1.5 border border-brand/40 bg-brand/[0.06] font-mono text-[10px] uppercase tracking-[0.22em] text-brand"
                    data-testid="editor-shipping-hint-custom"
                  >
                    ◆ Ships at custom rate · ${Number(form.shipping_domestic_usd).toFixed(2)}
                  </div>
                ) : (
                  <div className="mt-2 relative inline-block">
                    <button
                      type="button"
                      onClick={() => setPresetOpen((v) => !v)}
                      className="inline-flex items-center gap-2 px-2.5 py-1.5 border border-line hover:border-brand bg-paper font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink transition"
                      title="Click to apply a Shippo-ready preset (fills dimensions + weight + ship cost)"
                      data-testid="editor-shipping-hint-default"
                      aria-expanded={presetOpen}
                    >
                      <span className="text-brand">◆</span> Ships in: {shippingHintForCategory(form.category)}
                      <span className="text-ink-muted">▾</span>
                    </button>

                    {presetOpen && (
                      <div
                        className="absolute z-30 mt-2 left-0 w-[440px] max-w-[calc(100vw-2rem)] border border-line bg-paper shadow-2xl"
                        data-testid="editor-shipping-preset-picker"
                      >
                        <div className="px-4 py-3 border-b border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted flex items-center justify-between">
                          <span>◆ One-click carrier preset</span>
                          <button
                            type="button"
                            onClick={() => setPresetOpen(false)}
                            className="text-ink-muted hover:text-brand"
                            aria-label="Close picker"
                            data-testid="editor-shipping-preset-close"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        {/* iter334 — Get live rates button. Calls Shippo
                            in parallel for all 6 presets and shows the
                            cheapest carrier rate on each row. */}
                        <div className="px-4 py-2.5 border-b border-line flex items-center justify-between gap-3 bg-paper">
                          <div className="font-mono text-[9.5px] text-ink-muted leading-tight" data-testid="editor-shipping-preset-header">
                            {Object.keys(presetRates).length > 0
                              ? (presetRatesOverrides.length > 0
                                  ? `◆ Live rates · using YOUR ${presetRatesOverrides.join(" + ")}`
                                  : `◆ Live USPS/UPS rates loaded${presetRatesUsingDemoFrom ? " (demo ship-from)" : ""}`)
                              : "Static rates shown — fetch live Shippo prices below"}
                          </div>
                          <button
                            type="button"
                            onClick={loadLivePresetRates}
                            disabled={presetRatesLoading}
                            className="px-2.5 py-1 border border-cyan-400/40 hover:border-cyan-300 text-cyan-300 font-mono text-[9.5px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-wait shrink-0"
                            data-testid="editor-shipping-preset-live-rates"
                          >
                            <Sparkles size={10} />
                            {presetRatesLoading ? "Fetching…" : (Object.keys(presetRates).length > 0 ? "Refresh" : "Get live rates")}
                          </button>
                        </div>
                        <ul className="max-h-[420px] overflow-y-auto">
                          {SHIPPING_PRESETS.map((p) => {
                            const isDefault = defaultPresetIdForCategory(form.category) === p.id;
                            const live = presetRates[p.id];
                            return (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const liveAmount = live?.amount;
                                    const finalCost = liveAmount && liveAmount > 0 ? Number(liveAmount.toFixed(2)) : p.cost;
                                    set({
                                      packed_length_in: p.length,
                                      packed_width_in: p.width,
                                      packed_height_in: p.height,
                                      weight_lbs: p.weight_lbs,
                                      weight_oz: p.weight_oz,
                                      shipping_domestic_usd: finalCost,
                                      shipping_carrier: live?.provider || form.shipping_carrier,
                                    });
                                    setPresetOpen(false);
                                    toast.success(`Applied: ${p.label}`, {
                                      description: live
                                        ? `Live ${live.provider} ${live.servicelevel} rate $${finalCost.toFixed(2)} applied.`
                                        : `Dimensions, weight, and $${p.cost.toFixed(2)} ship rate filled.`,
                                    });
                                  }}
                                  className="w-full text-left px-4 py-3 hover:bg-surface border-b border-line transition group"
                                  data-testid={`editor-shipping-preset-${p.id}`}
                                >
                                  <div className="flex items-baseline justify-between gap-3">
                                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink group-hover:text-brand flex items-center gap-2">
                                      {p.label}
                                      {isDefault && (
                                        <span className="px-1 py-px text-[8.5px] font-bold tracking-[0.18em] border border-brand/60 text-brand">
                                          DEFAULT
                                        </span>
                                      )}
                                    </div>
                                    <div className="font-mono shrink-0 text-right">
                                      {live ? (
                                        <>
                                          <div className="text-[12px] text-cyan-300 font-bold" data-testid={`editor-preset-live-${p.id}`}>
                                            ${live.amount.toFixed(2)} <span className="text-[8px] text-cyan-400/60">LIVE</span>
                                          </div>
                                          <div className="text-[9px] text-ink-muted line-through">${p.cost.toFixed(2)}</div>
                                        </>
                                      ) : (
                                        <div className="text-[12px] text-brand">${p.cost.toFixed(2)}</div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="font-mono text-[9.5px] text-ink-muted mt-1">
                                    {p.blurb}
                                  </div>
                                  <div className="font-mono text-[9.5px] text-ink-muted mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                                    <span>📦 {p.length}″ × {p.width}″ × {p.height}″</span>
                                    <span>⚖ {p.weight_lbs} lb {p.weight_oz} oz</span>
                                    {live && live.provider && (
                                      <span className="text-cyan-400/80">▸ {live.provider} {live.servicelevel}{live.estimated_days ? ` · ${live.estimated_days}d` : ""}</span>
                                    )}
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                        <div className="px-4 py-2 border-t border-line font-mono text-[9.5px] text-ink-muted leading-relaxed">
                          Applied values populate the Shipping section below — fine-tune any field after picking.
                        </div>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
            <div>
              <Label>Technique</Label>
              <Select value={form.technique} onChange={(v) => set({ technique: v })}
                options={TECHNIQUES.map((t) => [t, t])} testid="editor-technique" />
              <p className="font-mono text-[10px] text-ink-muted mt-1 leading-relaxed">
                How was it made? Powers technique-based discovery in search.
              </p>
            </div>
          </div>

          <div className="mt-4">
            <Label>Materials <span className="text-ink-muted normal-case">(press Enter to add)</span></Label>
            <div className="flex gap-2 flex-wrap mb-2" data-testid="editor-materials-chips">
              {form.materials.map((m) => (
                <span key={m} className="inline-flex items-center gap-2 px-2 py-1 border border-line font-mono text-[11px]">
                  {m}
                  <button onClick={() => removeMaterial(m)} className="text-ink-muted hover:text-red-400" aria-label={`Remove ${m}`}>
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
              className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
              data-testid="editor-materials-input"
            />
            <p className="font-mono text-[10px] text-ink-muted mt-1 leading-relaxed">
              List every material — many buyers filter by "solid wood", "stainless", etc. Add up to 8.
            </p>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Label>
                Description * <span className={`text-[10px] ml-1 ${form.description.length >= 1900 ? "text-brand" : "text-ink-muted"}`}>
                  {form.description.length}/2000
                </span>
              </Label>
              {/* Pre-fill the description with a structured 5-bullet
                  template the maker can fill in instead of staring at an
                  empty textarea. Disabled once they've started writing
                  so we don't accidentally clobber their copy — confirm
                  via dialog if they really want to overwrite. */}
              <button
                type="button"
                onClick={() => {
                  const template = (
                    "What it makes:\n  \n\n"
                    + "Dimensions / materials / finish:\n  \n\n"
                    + "Customization options (sizes, colors, names you can add):\n  \n\n"
                    + "Care notes / mounting hardware:\n  \n\n"
                    + "The story — why I made it, what makes it mine:\n  "
                  );
                  if (form.description.trim().length === 0) {
                    set({ description: template });
                    return;
                  }
                  // Use native confirm; matches the visual restraint of
                  // the editor (no full-screen modal needed for a tiny
                  // confirmation prompt). If you want a styled dialog
                  // here, swap in `useConfirm` from MakerDashboard.
                  if (window.confirm("Replace what you've written with the template?")) {
                    set({ description: template });
                  }
                }}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand hover:bg-brand/10 border border-brand/40 px-3 py-1.5 transition"
                data-testid="editor-description-template"
                title="Pre-fill the box with a 5-bullet structure. Just fill in the blanks."
              >
                ✦ Use template
              </button>
            </div>
            <textarea
              rows={6} value={form.description}
              maxLength={2000}
              onChange={(e) => set({ description: e.target.value })}
              placeholder={
                "Describe your item like you're showing it to a friend:\n"
                + "  • What it is and what it makes (e.g. 24\" mountain wall art for a living room)\n"
                + "  • Dimensions, materials, finish (e.g. 1/8\" mild steel, raw + clear coat)\n"
                + "  • Customization options (sizes, colors, names you can add)\n"
                + "  • Care notes / mounting hardware included?\n"
                + "  • The story — why you made it, what makes it yours."
              }
              className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm resize-y leading-relaxed"
              data-testid="editor-description"
            />
            <p className="font-mono text-[10px] text-ink-muted mt-1 leading-relaxed">
              Tip: listings with 4+ paragraphs convert ~2× better. Hit each bullet above if you can — buyers reward detail.
              Or click <strong className="text-ink-muted">✦ Use template</strong> above to pre-fill the structure.
            </p>
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
            <div className="grid grid-cols-4 gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted mt-1 px-1">
              <span>L</span><span>W</span><span>H</span><span>Unit</span>
            </div>
          </div>

          <div className="mt-5">
            <Label>Weight</Label>
            <div className="grid grid-cols-4 gap-2 max-w-md">
              <NumInput value={form.weight_lbs} onChange={(v) => set({ weight_lbs: v })} placeholder="0" testid="editor-weight-lbs" />
              <span className="self-center font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">lbs</span>
              <NumInput value={form.weight_oz} onChange={(v) => set({ weight_oz: v })} placeholder="0" testid="editor-weight-oz" />
              <span className="self-center font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">oz</span>
            </div>
          </div>

          <div className="mt-5">
            <Label>Colors <span className="text-ink-muted">(select all that apply)</span></Label>
            <ChipGrid options={COLORS} selected={form.colors}
              onToggle={(v) => toggleArr("colors", v)} testidPrefix="editor-color" />
          </div>

          <div className="mt-5">
            <Label>Occasion <span className="text-ink-muted">(select all that apply)</span></Label>
            <ChipGrid options={OCCASIONS} selected={form.occasions}
              onToggle={(v) => toggleArr("occasions", v)} testidPrefix="editor-occasion" />
          </div>
        </Section>

        <PricingSection
          form={form} set={set} errors={errors}
          addVariant={addVariant} updateVariant={updateVariant} removeVariant={removeVariant}
          canPriceCheck={!!(slug || autoSlug)}
          onOpenPriceCheck={() => setPriceCheckOpen(true)}
        />

        {/* iter327 — Listing type (physical/digital/both) + digital file
            uploads. Uploads hit the backend directly via the dedicated
            endpoint, so the section state is the source of truth for
            `form.digital_files` without needing to bundle them in the
            main create/update payload. */}
        <ListingTypeSection
          form={form} set={set}
          productSlug={slug}
          api={process.env.REACT_APP_BACKEND_URL}
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
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm resize-y"
                data-testid="editor-personalization-instructions"
              />
              {/* iter364 — Required customer photo upload. When on, buyers
                  can't add to cart until they've attached at least one
                  photo (fingerprints, pet nose prints, memorial art…). */}
              <label
                className="mt-4 flex items-start gap-3 cursor-pointer select-none"
                data-testid="editor-personalization-requires-upload"
              >
                <input
                  type="checkbox"
                  checked={!!form.personalization_requires_upload}
                  onChange={(e) => set({ personalization_requires_upload: e.target.checked })}
                  className="mt-0.5 accent-[var(--brand)]"
                  data-testid="editor-personalization-requires-upload-checkbox"
                />
                <span>
                  <span className="block font-mono text-xs text-ink">Requires customer photo upload</span>
                  <span className="block font-mono text-[10px] text-ink-muted mt-0.5 leading-relaxed">
                    Buyers must attach 1–10 photos (JPG/PNG/WEBP/HEIC, max 25 MB each) before
                    adding to cart — ideal for engravings, fingerprints, pet portraits, and memorial pieces.
                  </span>
                </span>
              </label>
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
          <div className="mt-6 pt-6 border-t border-line" data-testid="editor-shipping-calc">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-2">
              ◆ Calculated shipping
            </div>
            <p className="font-mono text-xs text-ink-muted mb-5 max-w-2xl leading-relaxed">
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
                <span className="self-center font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">lb</span>
                <NumInput
                  value={form.weight_oz}
                  onChange={(v) => set({ weight_oz: v })}
                  placeholder="0" testid="editor-ship-weight-oz"
                />
                <span className="self-center font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">oz</span>
              </div>
            </div>

            <div>
              <Label>Item size when packed *</Label>
              <p className="font-mono text-[10px] text-ink-muted mb-2 max-w-2xl">
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
                <span className="self-center font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">in</span>
              </div>
              <div className="grid grid-cols-4 gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted mt-1 px-1 max-w-2xl">
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
          subtitle="How long does it take to make and prepare your item before it ships? Pick a profile or create your own."
        >
          <ProcessingProfilePicker
            value={form.processing_time}
            onChange={(v) => set({ processing_time: v })}
            maker={maker}
            onMakerUpdated={setMaker}
          />
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
          <div className="mt-5 border border-line bg-surface p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">
              ◆ Buyer will see
            </div>
            <p className="font-mono text-xs text-ink" data-testid="editor-buyer-will-see">
              {(form.accept_returns || form.accept_exchanges)
                ? `This seller accepts ${[
                    form.accept_returns && "returns", form.accept_exchanges && "exchanges",
                  ].filter(Boolean).join(" and ")}.`
                : "This seller does not accept returns or exchanges."}
            </p>
          </div>
        </Section>

        {/* ---------- Renewal Options ---------- */}
        <Section
          eyebrow="◆ Lifecycle"
          title="Renewal Options"
          subtitle="Listings live for 4 months after publish. Choose what happens when this listing reaches the end of that window."
        >
          <div className="space-y-3" data-testid="editor-renewal-options">
            {[
              {
                value: "automatic",
                label: "Automatic",
                hint: "We'll keep your listing live without any pings. Free for Founders and Plus members within their monthly listing quota; standard $0.20 renewal fee otherwise.",
              },
              {
                value: "manual",
                label: "Manual",
                hint: "Your listing flips to draft when it expires. We'll email you 7 days before so you can decide whether to renew.",
              },
            ].map((opt) => {
              const active = (form.renewal_option || "automatic") === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set({ renewal_option: opt.value })}
                  className={`w-full text-left border p-4 flex gap-3 items-start transition-colors ${
                    active
                      ? "border-brand bg-brand/5"
                      : "border-line bg-surface hover:border-line"
                  }`}
                  data-testid={`editor-renewal-${opt.value}`}
                  aria-pressed={active}
                >
                  <span
                    className={`mt-1 inline-block w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                      active ? "border-brand" : "border-line"
                    }`}
                  >
                    {active && (
                      <span className="block w-1.5 h-1.5 rounded-full bg-brand m-[3px]" />
                    )}
                  </span>
                  <span className="flex-1">
                    <span className={`block font-display uppercase text-base tracking-wide ${
                      active ? "text-brand" : "text-ink"
                    }`}>
                      {opt.label}
                    </span>
                    <span className="block font-mono text-xs text-ink-muted mt-1 leading-relaxed">
                      {opt.hint}
                    </span>
                  </span>
                </button>
              );
            })}
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
            className="mb-4 inline-flex items-center gap-2 px-4 py-2 border border-brand text-brand hover:bg-brand/10 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="editor-seo-ai-btn"
          >
            <Sparkles size={14} /> {seoBusy ? "Generating…" : "✦ AI suggest tags"}
          </button>
          <p className="font-mono text-[10px] text-ink-muted -mt-2 mb-4">
            ◆ Uses your current title, category, and description. Won't duplicate tags you've already added.
          </p>
          {aiTagReview.length > 0 && (
            <div
              className="border border-brand/50 bg-brand/5 p-4 mb-4 space-y-3"
              data-testid="ai-tag-review"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
                    ✦ Review AI suggestions
                  </div>
                  <p className="font-mono text-[11px] text-ink-muted mt-1 leading-relaxed">
                    Tick the ones that fit your listing — only checked tags get added. {(() => {
                      const kept = aiTagReview.filter((r) => r.kept).length;
                      const slots = MAX_TAGS - form.seo_tags.length;
                      return (
                        <span className={kept > slots ? "text-amber-400" : "text-ink-muted"}>
                          {kept} selected · {slots} slot{slots === 1 ? "" : "s"} available
                          {kept > slots && " — only the first " + slots + " will be applied"}
                        </span>
                      );
                    })()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={discardAiTagReview}
                    className="px-3 py-1.5 border border-line hover:border-[#a3a3a3] font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink"
                    data-testid="ai-tag-review-discard"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={applyAiTagReview}
                    className="px-3 py-1.5 border border-brand bg-brand/10 hover:bg-brand/20 font-mono text-[10px] uppercase tracking-[0.22em] text-brand"
                    data-testid="ai-tag-review-apply"
                  >
                    Apply selected →
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2" data-testid="ai-tag-review-list">
                {aiTagReview.map((row) => (
                  <button
                    key={row.tag}
                    type="button"
                    onClick={() => toggleAiTag(row.tag)}
                    data-testid={`ai-tag-${row.tag}`}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 border font-mono text-[11px] transition ${
                      row.kept
                        ? "border-brand bg-brand/15 text-brand"
                        : "border-line text-ink-muted line-through hover:text-ink-muted"
                    }`}
                    aria-pressed={row.kept}
                  >
                    <span className="text-[10px]">{row.kept ? "✓" : "○"}</span>
                    {row.tag}
                  </button>
                ))}
              </div>
            </div>
          )}
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
                form.seo_tags.length >= MAX_TAGS ? "text-amber-400 font-bold" : "text-ink-muted"
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
              className="flex-1 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="editor-seo-input"
            />
            <button
              type="button" onClick={() => addTag(form.seo_input)}
              disabled={!form.seo_input.trim() || form.seo_tags.length >= MAX_TAGS}
              className="px-4 py-2 border border-brand text-brand hover:bg-brand/10 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="editor-seo-add"
            >
              Add
            </button>
          </div>
          <p className="font-mono text-[10px] text-ink-muted mt-1">
            Press Enter or comma to add. Max {MAX_TAGS} tags.
          </p>
          {form.seo_tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3" data-testid="editor-seo-chips">
              {form.seo_tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-2 px-2 py-1 border border-brand/50 bg-brand/5 text-brand font-mono text-[11px]">
                  <Tag size={10} /> {t}
                  <button onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* ---------- Catalog Category (GPC override) ---------- */}
        <Section
          eyebrow="◆ External catalogs"
          title="Catalog Category"
          subtitle="Google Product Category path used by the Pinterest, Google Merchant, and Meta catalog feeds. Leave blank to inherit the auto-derived path. Override here if Pinterest flags your listing with alert 126 (shallow category)."
        >
          <Label>
            GPC path <span className="text-ink-muted normal-case">(optional override)</span>
          </Label>
          <GpcCombobox
            value={form.gpc_path}
            onChange={(v) => set({ gpc_path: v })}
            autoPlaceholder={_autoGpcHint(form.category)}
            testid="editor-gpc"
          />
          <p className="font-mono text-[10px] text-ink-muted mt-2 leading-relaxed">
            Pick a preset or paste any verbatim path from the{" "}
            <a
              href="https://www.google.com/basepages/producttype/taxonomy.en-US.txt"
              target="_blank"
              rel="noreferrer"
              className="text-ink-muted hover:text-brand underline"
            >
              Google Product Taxonomy
            </a>
            . Aim for ≥ 3 levels (e.g. <span className="text-ink-muted">Home &amp; Garden &gt; Decor &gt; Signs</span>) so Pinterest doesn&apos;t collapse it.
          </p>
        </Section>

        {/* ---------- Google Merchant feed controls (iter365) ---------- */}
        <MerchantFeedSection form={form} set={set} />

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
            className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
            data-testid="editor-contact-email"
          />
          <p className="font-mono text-[10px] text-ink-muted mt-1">
            Only shared with buyers who contact you directly.
          </p>
        </Section>

        {/* ---------- Story template (only on published edits) ----------
            Lets a maker grab a 1080×1920 PNG with hero image + price + QR
            for the listing in one click. Drives organic IG/TikTok reach
            without forcing them into the dedicated Marketing tab. */}
        {isEdit && form.status === "published" && (
          <Section
            eyebrow="◆ Share kit"
            title="Instagram & TikTok Story"
            subtitle="Download a ready-to-post 9:16 image with your hero shot, price, and a scan-to-shop QR code. Updates automatically when you swap photos."
          >
            <button
              type="button"
              onClick={() => {
                downloadProductStoryCard(slug);
                toast.success("Story template downloading — drop it in IG or TikTok stories.");
              }}
              className="border border-line hover:border-brand hover:text-brand px-4 py-2.5 font-mono text-xs uppercase tracking-[0.22em] transition flex items-center gap-2"
              data-testid="editor-download-story-template"
            >
              ↓ Download story template
            </button>
          </Section>
        )}

        {/* ---------- Bottom action bar ---------- */}
        <div className="flex items-center justify-between border-t border-line pt-6">
          <Link
            to="/maker/dashboard#listings"
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand"
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
            uploadingPhotos={imageUploads}
          />
        </div>
      </div>

      {/* Crop modal — pops while there are pending files in the queue. */}
      {cropQueue.length > 0 && (
        <ImageCropModal
          src={cropQueue[0]}
          defaultAspect={4 / 5}
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
        <span className="font-mono text-[11px] text-ink-muted">
          via {cheapest.carrier} {cheapest.service} · {cheapest.days} days
        </span>
      </div>

      <div className="space-y-1.5 mb-3" data-testid="ship-estimate-options">
        {est.options.map((opt, i) => (
          <div
            key={`${opt.carrier}-${opt.service}`}
            className={`grid grid-cols-[1fr_auto_auto] gap-3 px-2 py-1 font-mono text-[11px] ${
              i === 0 ? "text-emerald-300" : "text-ink-muted"
            }`}
            data-testid={`ship-estimate-row-${i}`}
          >
            <span className="truncate">
              {i === 0 && "✓ "}
              {opt.carrier} {opt.service}
            </span>
            <span className="text-ink-muted">{opt.days}d</span>
            <span className={i === 0 ? "text-emerald-300" : "text-ink"}>
              ${opt.cost.toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-ink-muted">
        <span>Actual <span className="text-ink-muted">{est.actualLb} lb</span></span>
        <span>Dim <span className="text-ink-muted">{est.dimLb} lb</span></span>
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
      <p className="font-mono text-[9px] text-ink-muted mt-3 leading-relaxed">
        Estimates are zone-4 averages from public 2026 rate tables — actual checkout costs vary by buyer ZIP. Carriers bill the larger of actual vs. dimensional (L×W×H ÷ 166) weight.
      </p>
    </div>
  );
}
