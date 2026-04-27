import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Copy, Eye, Save, Send, Sparkles, Upload, X,
  Image as ImageIcon, Plus, Trash2, Tag,
} from "lucide-react";
import {
  fetchMakerMe, fetchMakerProducts, createMakerProduct,
  updateMakerProduct, aiListingCopy, duplicateMakerProduct, uploadMakerVideo,
} from "../lib/api";

/** Crafters Market — full-page Listing Editor.
 *  Used for both creating a new listing (`/maker/listings/new`) and editing an
 *  existing one (`/maker/listings/:slug/edit`). Layout structure follows the
 *  approved Etsy-style mock; palette stays on-brand (industrial dark + orange).
 */

// ---------- Reference enums ----------
const CATEGORIES = ["Wall Art", "Custom Signs", "Outdoor Art", "Home Decor", "Other"];
const TECHNIQUES = ["PLASMA", "LASER", "ROUTER", "FORGE", "CUSTOM"];
const WHO_MADE_IT = [
  ["i_made_it", "I made it"],
  ["shop_member", "A member of my shop"],
  ["another_company", "Another company or person"],
];
const CONDITIONS = [
  ["new", "New"],
  ["made_to_order", "Made to order"],
  ["vintage", "Vintage"],
  ["refurbished", "Refurbished"],
];
const DIM_UNITS = ["in", "cm"];
const COLORS = [
  "Black", "White", "Gray", "Silver", "Gold", "Bronze", "Copper", "Red", "Orange",
  "Yellow", "Green", "Blue", "Purple", "Brown", "Beige", "Natural", "Multi-color",
];
const OCCASIONS = [
  "Birthday", "Wedding", "Anniversary", "Housewarming", "Christmas", "Father's Day",
  "Mother's Day", "Valentine's Day", "Graduation", "Baby Shower", "Just Because",
  "Holiday", "Memorial",
];
const PROCESSING_TIMES = [
  "1-3 business days", "3-5 business days", "1-2 weeks", "2-4 weeks",
  "4-6 weeks", "6-8 weeks", "Custom — see description",
];
const DELIVERY_RANGES = [
  "3-5 business days", "5-7 business days", "7-10 business days",
  "10-14 business days", "2-4 weeks",
];
const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Other"];

const MAX_IMAGES = 10;
const MAX_TAGS = 13;
const MAX_IMG_W = 1600;
const MAX_IMG_KB = 130;

// ---------- Image compression ----------
function compressImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMG_W / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const tryEncode = (mime, q) => canvas.toDataURL(mime, q);
        let mime = "image/webp";
        let dataUrl = tryEncode(mime, 0.86);
        if (!dataUrl.startsWith(`data:${mime}`)) {
          mime = "image/jpeg";
          dataUrl = tryEncode(mime, 0.86);
        }
        let q = 0.86;
        while (dataUrl.length / 1024 > MAX_IMG_KB && q > 0.4) {
          q -= 0.12;
          dataUrl = tryEncode(mime, q);
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Default state ----------
const emptyForm = () => ({
  title: "", category: CATEGORIES[0], technique: TECHNIQUES[0],
  description: "", price: "", in_stock: 1,
  images: [], video_url: "",
  who_made_it: "i_made_it", condition: "new",
  length_in: "", width_in: "", height_in: "", dim_unit: "in",
  weight_lbs: 0, weight_oz: 0,
  colors: [], occasions: [],
  materials: [], materials_input: "",
  variants: [], variant_axis1_name: "", variant_axis2_name: "",
  personalization_enabled: false, personalization_instructions: "",
  free_shipping: false,
  shipping_domestic_usd: "", shipping_international_usd: "",
  shipping_carrier: "", shipping_est_delivery: "",
  processing_time: "1-3 business days",
  accept_returns: false, accept_exchanges: false,
  seo_tags: [], seo_input: "",
  contact_email: "",
  status: "draft",
});

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
    try {
      const dataUrls = await Promise.all(taking.map(compressImageToDataUrl));
      set({ images: [...form.images, ...dataUrls] });
    } catch (err) {
      toast.error("Could not process one of those images.");
    }
  };
  const removeImage = (i) => set({ images: form.images.filter((_, idx) => idx !== i) });
  const promoteCover = (i) => {
    if (i === 0) return;
    const next = [...form.images];
    [next[0], next[i]] = [next[i], next[0]];
    set({ images: next });
  };

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

  // ---- Tags ----
  const addTag = (raw) => {
    const cleaned = (raw || "").replace(/[#,]/g, "").trim().toLowerCase();
    if (!cleaned) return;
    if (form.seo_tags.length >= MAX_TAGS) {
      toast.error(`Max ${MAX_TAGS} tags.`);
      return;
    }
    if (form.seo_tags.includes(cleaned)) return;
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
    processing_time: form.processing_time,
    accept_returns: form.accept_returns,
    accept_exchanges: form.accept_exchanges,
    seo_tags: form.seo_tags,
    contact_email: form.contact_email || null,
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
      if (isEdit) {
        res = await updateMakerProduct(slug, payload);
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
            onClone={cloneListing}
            onPreview={previewListing}
            onSaveDraft={() => submit("draft")}
            onPublish={() => submit("published")}
          />
        </div>
      </header>

      <div className="max-w-[1300px] mx-auto px-4 md:px-8 py-10 space-y-12 pb-32">

        {/* ---------- Photos & Video ---------- */}
        <Section
          eyebrow="◆ Media"
          title="Photos & Video"
          subtitle="Add up to 10 photos. The first image is your cover photo. Click 'Set as cover' on any thumbnail to promote it."
          counter={`${form.images.length}/${MAX_IMAGES} photos · ${form.video_url ? "1/1" : "0/1"} video`}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {form.images.map((src, i) => (
              <div
                key={i}
                className={`relative aspect-square border ${i === 0 ? "border-[#ff4500]" : "border-[#262626]"} group overflow-hidden`}
                data-testid={`editor-image-${i}`}
              >
                <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                {i === 0 && (
                  <span className="absolute top-1 left-1 bg-[#ff4500] text-[#0a0a0a] text-[9px] font-mono px-1.5 py-0.5 uppercase tracking-[0.18em]">
                    ◆ Cover
                  </span>
                )}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                  {i !== 0 && (
                    <button
                      onClick={() => promoteCover(i)}
                      className="px-2 py-1 border border-[#ff4500] text-[#ff4500] font-mono text-[9px] uppercase tracking-[0.18em] hover:bg-[#ff4500]/10"
                      data-testid={`editor-set-cover-${i}`}
                    >
                      Set as cover
                    </button>
                  )}
                  <button
                    onClick={() => removeImage(i)}
                    className="p-1.5 border border-[#262626] hover:border-red-500 text-red-400"
                    data-testid={`editor-remove-image-${i}`}
                    aria-label="Remove"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            {form.images.length < MAX_IMAGES && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="aspect-square border border-dashed border-[#404040] hover:border-[#ff4500] hover:text-[#ff4500] text-[#737373] flex flex-col items-center justify-center gap-2 transition"
                data-testid="editor-add-photo"
              >
                <Upload size={20} />
                <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
                  {form.images.length === 0 ? "Add cover" : "Add photo"}
                </span>
              </button>
            )}
          </div>
          <input
            ref={fileRef} type="file" accept="image/*" multiple hidden
            onChange={onPickPhotos} data-testid="editor-photo-input"
          />
          {errors.images && <FieldError msg={errors.images} />}

          <div className="mt-6 pt-6 border-t border-[#262626]">
            <Label>Video <span className="text-[#525252]">(optional · MP4 / WebM / MOV up to 50MB)</span></Label>

            {form.video_url ? (
              <div className="border border-[#262626] p-3" data-testid="editor-video-preview">
                <video
                  src={form.video_url} controls preload="metadata"
                  className="w-full max-h-64 bg-black"
                />
                <div className="flex items-center justify-between mt-3 gap-3">
                  <span className="font-mono text-[10px] text-[#737373] truncate">{form.video_url}</span>
                  <button
                    type="button" onClick={removeVideo}
                    className="px-2 py-1 border border-[#262626] hover:border-red-400 hover:text-red-400 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1"
                    data-testid="editor-video-remove"
                  >
                    <Trash2 size={10} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <button
                    type="button" onClick={() => videoFileRef.current?.click()}
                    disabled={!!videoUploading}
                    className="border border-dashed border-[#404040] hover:border-[#ff4500] hover:text-[#ff4500] text-[#a3a3a3] flex items-center justify-center gap-2 py-6 transition disabled:opacity-50"
                    data-testid="editor-video-upload"
                  >
                    <Upload size={16} />
                    <span className="font-mono text-[11px] uppercase tracking-[0.22em]">
                      {videoUploading ? `Uploading… ${videoUploading}%` : "Upload from computer"}
                    </span>
                  </button>
                  <div className="flex items-center justify-center font-mono text-[10px] text-[#525252] uppercase tracking-[0.22em]">
                    — or paste URL —
                  </div>
                </div>
                <input
                  type="url" value={form.video_url}
                  onChange={(e) => set({ video_url: e.target.value })}
                  placeholder="https://… or hosted YouTube/Vimeo link"
                  className="w-full mt-3 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
                  data-testid="editor-video-url"
                />
              </>
            )}
            <input
              ref={videoFileRef} type="file" hidden
              accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
              onChange={onPickVideo} data-testid="editor-video-input"
            />
            {videoErr && <FieldError msg={videoErr} />}
            <p className="font-mono text-[10px] text-[#525252] mt-2">
              ◆ JPG · PNG · GIF · WEBP · max 5MB per photo. Videos served from R2 CDN — no transcoding.
            </p>
          </div>
        </Section>

        {/* ---------- AI Assistant ---------- */}
        <Section
          eyebrow="◆ Powered by Claude"
          title="AI Assistant"
          subtitle="Describe your item in plain language and the AI will draft your title, description, tags, and suggest a price."
          right={
            <button
              type="button" onClick={() => setAiHidden((v) => !v)}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
              data-testid="editor-ai-toggle"
            >
              {aiHidden ? "Show" : "Hide"}
            </button>
          }
        >
          {!aiHidden && (
            <>
              <Label>Describe your item *</Label>
              <textarea
                rows={5} value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. Plasma cut Texas longhorn skull from 11ga steel, powder coated matte black, 24x18 inches, ready to hang with keyhole brackets. Great for man caves, ranches, bars."
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm resize-y"
                data-testid="editor-ai-prompt"
              />
              <p className="font-mono text-[10px] text-[#525252] mt-2">
                The more detail you provide, the better the output. Include size, material, finish, and use case.
              </p>
              <button
                type="button" onClick={runAI} disabled={aiBusy || !aiPrompt.trim()}
                className="btn-industrial btn-primary mt-4 inline-flex items-center gap-2 disabled:opacity-50"
                data-testid="editor-ai-generate"
              >
                <Sparkles size={14} /> {aiBusy ? "Generating…" : "Generate Listing"}
              </button>
              <p className="font-mono text-[10px] text-[#525252] mt-3">
                ✦ AI-generated content will fill in Title, Description, Tags, and Price below. You can edit anything before publishing.
              </p>
            </>
          )}
        </Section>

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

        {/* ---------- Pricing ---------- */}
        <Section
          eyebrow="◆ Pricing"
          title="Pricing"
          subtitle="Set a price for your item. Crafters Market charges a platform commission on completed sales."
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Price *</Label>
              <div className="flex items-center border border-[#262626] focus-within:border-[#ff4500]">
                <span className="px-3 font-mono text-sm text-[#a3a3a3]">$</span>
                <input
                  type="number" min="0" step="0.01" value={form.price}
                  onChange={(e) => set({ price: e.target.value })}
                  placeholder="0.00"
                  className="flex-1 bg-transparent outline-none px-2 py-2 font-mono text-sm"
                  data-testid="editor-price"
                />
              </div>
              {errors.price && <FieldError msg={errors.price} />}
            </div>
            <div>
              <Label>Quantity *</Label>
              <input
                type="number" min="0" step="1" value={form.in_stock}
                onChange={(e) => set({ in_stock: e.target.value })}
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
                data-testid="editor-quantity"
              />
              <p className="font-mono text-[10px] text-[#525252] mt-1">units available</p>
            </div>
          </div>
        </Section>

        {/* ---------- Variations ---------- */}
        <Section
          eyebrow="◆ Options"
          title="Variations"
          subtitle="Add options buyers can choose — like size, color, or finish. You can also add a price difference per option."
        >
          {form.variants.length === 0 ? (
            <div className="border border-dashed border-[#262626] p-8 text-center" data-testid="editor-variants-empty">
              <p className="font-mono text-xs text-[#737373] mb-1">No variations yet.</p>
              <p className="font-mono text-[10px] text-[#525252]">e.g. Size: Small, Medium, Large</p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="editor-variants">
              {form.variants.map((v, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`editor-variant-${i}`}>
                  <input
                    className="col-span-6 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
                    placeholder="Label (e.g. Large · Walnut)"
                    value={v.label}
                    onChange={(e) => updateVariant(i, { label: e.target.value })}
                  />
                  <input
                    type="number" step="0.01"
                    className="col-span-3 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
                    placeholder="±$"
                    value={v.price_delta}
                    onChange={(e) => updateVariant(i, { price_delta: e.target.value })}
                  />
                  <input
                    type="number" min="0" step="1"
                    className="col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
                    placeholder="Qty"
                    value={v.in_stock}
                    onChange={(e) => updateVariant(i, { in_stock: e.target.value })}
                  />
                  <button
                    onClick={() => removeVariant(i)}
                    className="col-span-1 p-2 text-[#737373] hover:text-red-400 justify-self-center"
                    aria-label="Remove variant"
                    data-testid={`editor-variant-remove-${i}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button" onClick={addVariant}
            className="mt-4 px-4 py-2 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2"
            data-testid="editor-add-variant"
          >
            <Plus size={12} /> Add variation
          </button>
        </Section>

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
          subtitle="Tags help buyers discover your listing in search. Add up to 13 — one at a time."
        >
          <Label>Add tag <span className="text-[#525252]">{form.seo_tags.length}/{MAX_TAGS}</span></Label>
          <div className="flex gap-2">
            <input
              type="text" value={form.seo_input}
              onChange={(e) => set({ seo_input: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault(); addTag(form.seo_input);
                }
              }}
              placeholder="e.g. metal wall art"
              className="flex-1 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
              data-testid="editor-seo-input"
            />
            <button
              type="button" onClick={() => addTag(form.seo_input)}
              disabled={!form.seo_input.trim() || form.seo_tags.length >= MAX_TAGS}
              className="px-4 py-2 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
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
            onClone={cloneListing}
            onPreview={previewListing}
            onSaveDraft={() => submit("draft")}
            onPublish={() => submit("published")}
          />
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Sub-components ─────────────────────────
function Section({ eyebrow, title, subtitle, counter, right, children }) {
  return (
    <section className="grid md:grid-cols-[280px_1fr] gap-6 md:gap-12 pb-12 border-b border-[#1f1f1f]">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
          {eyebrow}
        </div>
        <h2 className="font-display text-2xl md:text-3xl uppercase">{title}</h2>
        {subtitle && <p className="font-mono text-xs text-[#a3a3a3] mt-3 leading-relaxed">{subtitle}</p>}
        {counter && <p className="font-mono text-[10px] text-[#525252] mt-3 uppercase tracking-[0.22em]">{counter}</p>}
      </div>
      <div className="space-y-1">
        {right && <div className="flex justify-end mb-3">{right}</div>}
        {children}
      </div>
    </section>
  );
}

function Label({ children }) {
  return (
    <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1.5">
      {children}
    </label>
  );
}

function FieldError({ msg }) {
  return (
    <p className="font-mono text-[11px] text-red-400 mt-1" data-testid="editor-field-error">{msg}</p>
  );
}

function NumInput({ value, onChange, placeholder, testid }) {
  return (
    <input
      type="number" step="any" value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
      data-testid={testid}
    />
  );
}

function Select({ value, onChange, options, testid }) {
  return (
    <select
      value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
      data-testid={testid}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  );
}

function ChipGrid({ options, selected, onToggle, testidPrefix }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            key={opt} type="button" onClick={() => onToggle(opt)}
            className={`px-3 py-1.5 border font-mono text-[11px] transition ${
              on
                ? "border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500]"
                : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
            }`}
            data-testid={`${testidPrefix}-${opt.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on, onChange, label, testid }) {
  return (
    <button
      type="button" onClick={() => onChange(!on)}
      className="inline-flex items-center gap-3"
      data-testid={testid}
    >
      <span className={`w-9 h-5 border ${on ? "border-[#ff4500] bg-[#ff4500]/20" : "border-[#262626] bg-[#1a1a1a]"} relative transition`}>
        <span className={`absolute top-0.5 transition-all ${on ? "right-0.5 bg-[#ff4500]" : "left-0.5 bg-[#525252]"} w-3.5 h-3.5`} />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</span>
    </button>
  );
}

function ToggleRow({ label, hint, on, onChange, testid }) {
  return (
    <div className="flex items-start justify-between gap-4 border border-[#1f1f1f] p-4">
      <div className="min-w-0">
        <div className="font-mono text-xs uppercase tracking-[0.22em] text-[#e5e5e5]">{label}</div>
        {hint && <p className="font-mono text-[11px] text-[#737373] mt-1">{hint}</p>}
      </div>
      <Toggle on={on} onChange={onChange} testid={testid} label="" />
    </div>
  );
}

function ActionButtons({ isEdit, saving, canPublish, onClone, onPreview, onSaveDraft, onPublish }) {
  return (
    <div className="flex items-center gap-2">
      {isEdit && (
        <button
          type="button" onClick={onClone}
          className="hidden sm:inline-flex px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] items-center gap-2"
          data-testid="editor-clone-btn"
        >
          <Copy size={12} /> Clone
        </button>
      )}
      <button
        type="button" onClick={onPreview}
        className="hidden sm:inline-flex px-3 py-1.5 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[10px] uppercase tracking-[0.22em] items-center gap-2"
        data-testid="editor-preview-btn"
      >
        <Eye size={12} /> Preview
      </button>
      <button
        type="button" onClick={onSaveDraft} disabled={saving}
        className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2 disabled:opacity-50"
        data-testid="editor-save-draft-btn"
      >
        <Save size={12} /> {saving ? "Saving…" : "Save Draft"}
      </button>
      <button
        type="button" onClick={onPublish} disabled={saving || !canPublish}
        className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50 px-4 py-1.5"
        data-testid="editor-publish-btn"
      >
        <Send size={12} /> {saving ? "Publishing…" : "Publish Listing"}
      </button>
    </div>
  );
}
