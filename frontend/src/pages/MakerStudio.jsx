/**
 * Maker Studio · /studio
 *
 * iter235 — AI-powered SVG/DXF design tool. The user types a prompt, the
 * AI emits structured design JSON, our backend renders a clean black-on-white
 * SVG silhouette, and the user can tweak size + download SVG/DXF or publish
 * straight into the community design files feed.
 *
 * Designed to feel like a creation engine, not a form. Dark industrial
 * aesthetic to match the rest of the marketplace.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, Download, Share2, Loader2, Lock, FileDown, RotateCw, Plus, Trash2, Pencil, Square, Type as TypeIcon, ChevronDown } from "lucide-react";
import { http } from "../lib/api";
import { toast } from "sonner";
import { useStructuredData } from "../lib/seo";

// Pre-built prompt examples to demystify the tool for first-timers.
const EXAMPLE_PROMPTS = [
  "Rustic cabin sign with mountains and pine trees that says Lake House",
  "Wedding heart sign with the names A & M in script font",
  "American flag with eagle and bold serif text Land Of The Free",
  "Hunting cabin deer silhouette sign — The Smiths · Est. 1998",
  "Sunshine welcome sign — round border, kid-friendly",
  "Memorial cross with name John Doe in western font",
];

const SHAPE_VOCAB = [
  "mountains", "pine_trees", "deer", "heart", "star", "flag", "cross",
  "sun_rays", "eagle", "antlers", "rooster", "anchor", "compass_rose", "treble_clef",
];

function jwt() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("cm_maker_jwt") || localStorage.getItem("cm_buyer_jwt") || null;
}

function authHeaders() {
  const t = jwt();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function MakerStudio() {
  useStructuredData({
    title: "Maker Studio · AI SVG & DXF Design Tool · Crafters Market",
    description: "Generate clean CNC-ready SVG and DXF design files with AI. Type a prompt, tweak the size, download laser- and plasma-ready vectors in seconds.",
    url: "https://craftersmarket.org/studio",
  });

  const signedIn = !!jwt();
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPTS[0]);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [width, setWidth] = useState(14);
  const [height, setHeight] = useState(6);
  const [design, setDesign] = useState(null);
  const [svg, setSvg] = useState("");
  const [quota, setQuota] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [engraveOnly, setEngraveOnly] = useState(false);
  // iter238 — parametric machining controls
  const [materials, setMaterials] = useState([]);
  const [material, setMaterial] = useState("wood");
  const [units, setUnits] = useState("inches");
  const [materialDepth, setMaterialDepth] = useState(0.25);
  const [machineType, setMachineType] = useState(null); // router | laser | plasma — auto by default
  const [cam, setCam] = useState(null);
  const [userKits, setUserKits] = useState([]);
  const [lastPublishedFileId, setLastPublishedFileId] = useState(null);
  const previewRef = useRef(null);

  // Templates are PUBLIC — load even when signed-out so visitors can browse.
  useEffect(() => {
    http.get("/studio/templates")
      .then((r) => setTemplates(r.data?.templates || []))
      .catch(() => {});
    http.get("/studio/materials")
      .then((r) => setMaterials(r.data?.materials || []))
      .catch(() => {});
  }, []);

  // iter237 — Remix support. If the URL contains `?remix=<file_id>`, fetch
  // the original prompt + design and pre-fill the studio. Requires auth.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const remixId = searchParams.get("remix");
    if (!remixId || !signedIn) return;
    http.get(`/studio/remix/${remixId}`, { headers: authHeaders() })
      .then((r) => {
        const data = r.data;
        if (data?.design) {
          setDesign(data.design);
          setWidth(data.design.width || 14);
          setHeight(data.design.height || 6);
          setEngraveOnly(!!data.design.engrave_only);
          setPrompt(data.prompt ? `Edit this: ${data.prompt}` : prompt);
          toast.success(`Remixing — “${data.title || "design"}” · tweak the prompt and regenerate`);
        }
        // Clear the param so refreshes don't re-fire
        searchParams.delete("remix");
        setSearchParams(searchParams, { replace: true });
      })
      .catch(() => toast.error("Could not load remix source"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    http.get("/studio/quota", { headers: authHeaders() })
      .then((r) => setQuota(r.data))
      .catch(() => {});
    http.get("/studio/kits", { headers: authHeaders() })
      .then((r) => setUserKits(r.data?.mine || []))
      .catch(() => {});
  }, [signedIn]);

  // iter243 — Scroll the preview canvas into view the first time a design
  // is loaded so first-time visitors immediately see the rendered SVG +
  // can drag elements. Only runs on the design transitioning from null
  // to a real value, not on subsequent re-renders during editing.
  const prevDesignRef = useRef(null);
  useEffect(() => {
    if (!design || prevDesignRef.current) {
      prevDesignRef.current = design;
      return;
    }
    prevDesignRef.current = design;
    // Defer one frame so the SVG has mounted before we scroll.
    setTimeout(() => {
      previewRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }, [design]);
  useEffect(() => {
    if (!design) return;
    const payload = {
      ...design,
      width: Number(width),
      height: Number(height),
      engrave_only: engraveOnly,
      material,
      units,
      material_depth: Number(materialDepth),
    };
    http.post("/studio/render", { design: payload }, { headers: authHeaders() })
      .then((r) => setSvg(r.data?.svg || ""))
      .catch(() => {});
  }, [design, width, height, engraveOnly, material, units, materialDepth]);

  // iter239 — CAM strategy. Public endpoint, refreshes whenever the
  // material / depth / units / mode / machine change. No auth required so
  // the suggestion card stays visible to anonymous browsers too.
  useEffect(() => {
    const params = new URLSearchParams({
      material,
      depth: String(materialDepth),
      units,
      engrave_only: String(engraveOnly),
    });
    if (machineType) params.set("machine", machineType);
    http.get(`/studio/cam-strategy?${params.toString()}`)
      .then((r) => setCam(r.data))
      .catch(() => setCam(null));
  }, [material, materialDepth, units, engraveOnly, machineType]);

  const useTemplate = (tpl) => {
    setDesign(tpl.design);
    setPrompt(tpl.prompt);
    setWidth(tpl.design.width);
    setHeight(tpl.design.height);
    setEngraveOnly(!!tpl.design.engrave_only);
    if (tpl.design.material) setMaterial(tpl.design.material);
    if (tpl.design.units) setUnits(tpl.design.units);
    if (tpl.design.material_depth) setMaterialDepth(tpl.design.material_depth);
    toast.success(`Loaded template — “${tpl.name}”`);
  };

  // Compose the design payload sent to publish/export endpoints — keeps the
  // material/units/depth params in lockstep across all 4 actions.
  const designPayload = () => ({
    ...design,
    width: Number(width),
    height: Number(height),
    engrave_only: engraveOnly,
    material,
    units,
    material_depth: Number(materialDepth),
  });

  const refine = async () => {
    if (!design) return;
    if (refinePrompt.trim().length < 3) {
      toast.error("Tweak instruction is too short");
      return;
    }
    setRefining(true);
    try {
      const r = await http.post(
        "/studio/refine",
        { design: designPayload(), instruction: refinePrompt.trim() },
        { headers: authHeaders() },
      );
      setDesign(r.data.design);
      setQuota(r.data.quota);
      setRefinePrompt("");
      toast.success("Design refined");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Refine failed");
    } finally {
      setRefining(false);
    }
  };

  const generate = async () => {
    if (!signedIn) {
      toast.error("Sign in to use Maker Studio");
      return;
    }
    if (prompt.trim().length < 3) {
      toast.error("Prompt is too short");
      return;
    }
    setBusy(true);
    try {
      const r = await http.post(
        "/studio/generate",
        { prompt: prompt.trim(), width, height },
        { headers: authHeaders() },
      );
      const generated = { ...r.data.design, engrave_only: engraveOnly };
      setDesign(generated);
      setQuota(r.data.quota);
      toast.success("Design generated");
    } catch (e) {
      const msg = e?.response?.data?.detail || "AI generation failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const downloadFile = async (kind) => {
    if (!design) return;
    const payload = { design: designPayload() };
    try {
      const r = await http.post(`/studio/export-${kind}`, payload, {
        headers: authHeaders(),
        responseType: "blob",
      });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${design?.operations?.find((o) => o.kind === "text")?.content || "design"}.${kind}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`${kind.toUpperCase()} download failed`);
    }
  };

  const publish = async () => {
    if (!design) return;
    setPublishing(true);
    try {
      const r = await http.post(
        "/studio/publish",
        { design: designPayload(), prompt: prompt.trim() },
        { headers: authHeaders() },
      );
      const fileId = r.data?.file?.id;
      setLastPublishedFileId(fileId);
      // Reload kits so the dropdown reflects the latest list
      http.get("/studio/kits", { headers: authHeaders() })
        .then((kr) => setUserKits(kr.data?.mine || []))
        .catch(() => {});
      toast.success(`Published — “${r.data?.file?.title}” · in the community feed`);
    } catch (e) {
      toast.error("Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  const addToKit = async (kitId) => {
    if (!lastPublishedFileId) return;
    try {
      await http.post(
        `/studio/kits/${kitId}/add`,
        { file_id: lastPublishedFileId },
        { headers: authHeaders() },
      );
      toast.success("Added to kit");
    } catch {
      toast.error("Couldn't add to kit");
    }
  };

  const createKitAndAdd = async () => {
    const title = (window.prompt("Name your kit", "Untitled Pack") || "").trim();
    if (!title) return;
    try {
      const r = await http.post(
        "/studio/kits",
        { title, description: "", visibility: "public" },
        { headers: authHeaders() },
      );
      setUserKits((prev) => [r.data, ...prev]);
      if (lastPublishedFileId) {
        await http.post(
          `/studio/kits/${r.data.id}/add`,
          { file_id: lastPublishedFileId },
          { headers: authHeaders() },
        );
      }
      toast.success(`Kit created — share: /kits/${r.data.slug}`);
    } catch {
      toast.error("Could not create kit");
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] pt-32 pb-24">
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        {/* Header */}
        <div className="mb-10">
          <div className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.32em] text-[#00ffff] mb-3">
            ◆ Maker Studio · AI Design Engine
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[0.95] mb-4">
            From prompt to <span className="text-outline-orange">cut file</span>
            <br /> in seconds.
          </h1>
          <p className="font-mono text-sm text-[#a3a3a3] max-w-2xl leading-relaxed">
            Describe your sign. The AI converts it to clean black-on-white silhouette
            geometry. Download print-ready SVG or CNC-ready DXF — or publish it
            straight into the community design files feed.
          </p>
        </div>

        {/* Template gallery — quick-start curated designs */}
        {templates.length > 0 && (
          <TemplateGallery templates={templates} onPick={useTemplate} />
        )}

        {/* Two-column workshop */}
        <div className="grid lg:grid-cols-[400px_1fr] gap-6 lg:gap-10">
          {/* LEFT — Controls */}
          <div className="space-y-6">
            {/* Quota pill */}
            {signedIn && quota && (
              <div className="flex items-center justify-between border border-[#262626] bg-[#0a0a0a] px-4 py-3"
                   data-testid="studio-quota-pill">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                  ◆ Today
                </span>
                <span className="font-mono text-xs text-[#e5e5e5]">
                  <span className={quota.remaining <= 1 ? "text-[#ff4500]" : ""}>
                    {quota.remaining}
                  </span>{" "}
                  / {quota.cap} prompts left
                </span>
              </div>
            )}

            {!signedIn && (
              <div className="border border-[#262626] bg-[#0a0a0a] p-4 flex items-start gap-3">
                <Lock size={16} className="text-[#ff4500] mt-1 shrink-0" />
                <div>
                  <p className="font-mono text-xs text-[#e5e5e5] mb-2">
                    Sign in to generate designs (5 free prompts/day).
                  </p>
                  <Link to="/signin" className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] hover:text-[#fff]" data-testid="studio-signin-link">
                    Sign in →
                  </Link>
                </div>
              </div>
            )}

            {/* Prompt input */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-2">
                ◆ Describe your design
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                maxLength={400}
                placeholder="A cabin sign with mountains, pine trees, and the text Lake House"
                className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#00ffff] outline-none px-3 py-3 font-mono text-sm text-[#e5e5e5] resize-y"
                data-testid="studio-prompt-input"
              />
              <div className="mt-2 flex justify-between text-[10px] font-mono text-[#525252]">
                <span>{prompt.length} / 400</span>
                <span>Gemini Flash</span>
              </div>
            </div>

            {/* Example prompts */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-2">
                ◆ Try one
              </label>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPrompt(p)}
                    className="px-2.5 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] text-[#a3a3a3] hover:text-[#fff] text-left"
                    data-testid={`studio-example-${i}`}
                  >
                    {p.length > 40 ? p.slice(0, 38) + "…" : p}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate button */}
            <button
              type="button"
              onClick={generate}
              disabled={busy || !signedIn}
              className="w-full px-4 py-3 border border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-xs uppercase tracking-[0.22em] flex items-center justify-center gap-2 transition"
              data-testid="studio-generate-btn"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {busy ? "Generating…" : "Generate design"}
            </button>

            {/* Size sliders + engrave-only toggle (only useful once a design exists) */}
            {design && (
              <div className="space-y-4 border-t border-[#262626] pt-5">
                <div>
                  <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                    <span>◆ Width</span>
                    <span className="text-[#e5e5e5]">{width}″</span>
                  </div>
                  <input
                    type="range" min="6" max="36" step="0.5"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                    className="w-full accent-[#ff4500]"
                    data-testid="studio-width-slider"
                  />
                </div>
                <div>
                  <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                    <span>◆ Height</span>
                    <span className="text-[#e5e5e5]">{height}″</span>
                  </div>
                  <input
                    type="range" min="3" max="24" step="0.5"
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value))}
                    className="w-full accent-[#ff4500]"
                    data-testid="studio-height-slider"
                  />
                </div>

                {/* Engrave-only toggle — when ON, DXF routes all shapes to the
                    ENGRAVE layer (no outer cut). Preview shows the border as
                    a dashed grey guide so the user can tell the difference. */}
                <label
                  className={`flex items-center justify-between cursor-pointer select-none border px-3 py-2.5 transition ${
                    engraveOnly ? "border-[#00ffff] bg-[#00ffff]/5" : "border-[#262626] hover:border-[#525252]"
                  }`}
                  data-testid="studio-engrave-toggle"
                >
                  <div>
                    <div className={`font-mono text-[10px] uppercase tracking-[0.22em] ${engraveOnly ? "text-[#00ffff]" : "text-[#e5e5e5]"}`}>
                      ◆ Engrave-only mode
                    </div>
                    <div className="font-mono text-[9px] text-[#737373] mt-0.5">
                      Skip outer cut · ENGRAVE layer only
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={engraveOnly}
                    onChange={(e) => setEngraveOnly(e.target.checked)}
                    className="accent-[#00ffff] w-4 h-4"
                    data-testid="studio-engrave-checkbox"
                  />
                </label>

                {/* iter238 — Parametric machining controls (material, depth, units).
                    These are stamped onto the SVG as data-* attributes and into the
                    DXF as a NOTES-layer text entity so CAM operators see machine
                    setup intent inside the file. */}
                <ParametricControls
                  materials={materials}
                  material={material} setMaterial={setMaterial}
                  units={units} setUnits={setUnits}
                  materialDepth={materialDepth} setMaterialDepth={setMaterialDepth}
                />

                {/* iter242 — Elements editor. Direct, free, AI-quota-free
                    manipulation of every shape / text / border / hole on the
                    canvas. The AI is great for the initial concept; this is
                    where the maker actually dials in the finished design. */}
                <ElementsEditor design={design} setDesign={setDesign} />

                {/* iter238 — Refine-with-AI box. Apply a small tweak to the
                    existing design without re-prompting from scratch. Costs 1
                    daily-quota prompt. */}
                <div data-testid="studio-refine">
                  <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-2">
                    ◆ Refine with AI
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={refinePrompt}
                      onChange={(e) => setRefinePrompt(e.target.value)}
                      placeholder="e.g. make the heart bigger"
                      className="flex-1 min-w-0 bg-[#0a0a0a] border border-[#262626] focus:border-[#00ffff] outline-none px-2.5 py-2 font-mono text-xs text-[#e5e5e5]"
                      maxLength={200}
                      data-testid="studio-refine-input"
                    />
                    <button
                      type="button"
                      onClick={refine}
                      disabled={refining || !refinePrompt.trim()}
                      className="px-3 py-2 border border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 disabled:opacity-40 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5"
                      data-testid="studio-refine-btn"
                    >
                      {refining ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
                      Refine
                    </button>
                  </div>
                  <div className="font-mono text-[9px] text-[#525252] mt-1">
                    Uses 1 prompt · keeps the rest of your design intact
                  </div>
                </div>
              </div>
            )}

            {/* Export + Publish actions */}
            {design && (
              <div className="space-y-2 border-t border-[#262626] pt-5">
                <button
                  type="button"
                  onClick={() => downloadFile("svg")}
                  className="w-full px-4 py-2.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] flex items-center justify-center gap-2"
                  data-testid="studio-download-svg"
                >
                  <Download size={13} /> Download SVG
                </button>
                <button
                  type="button"
                  onClick={() => downloadFile("dxf")}
                  className="w-full px-4 py-2.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] flex items-center justify-center gap-2"
                  data-testid="studio-download-dxf"
                >
                  <FileDown size={13} /> Download DXF (CNC)
                </button>
                <button
                  type="button"
                  onClick={publish}
                  disabled={publishing}
                  className="w-full px-4 py-2.5 bg-[#ff4500] text-white hover:bg-[#ff5e1f] disabled:opacity-50 font-mono text-[11px] uppercase tracking-[0.22em] flex items-center justify-center gap-2"
                  data-testid="studio-publish-btn"
                >
                  {publishing ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
                  Publish to community
                </button>

                {/* iter240 — Save to kit. Surfaces ONLY after a successful publish.
                    Lets the maker bundle the design into a shareable kit URL
                    (`/kits/<slug>`) without leaving the studio. */}
                {lastPublishedFileId && (
                  <div className="border-t border-[#00ffff]/30 pt-3 mt-3 space-y-2" data-testid="studio-save-to-kit">
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#00ffff]">
                      ◆ Save into a kit
                    </div>
                    {userKits.length > 0 && (
                      <select
                        onChange={(e) => e.target.value && addToKit(e.target.value)}
                        defaultValue=""
                        className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#00ffff] outline-none px-2.5 py-2 font-mono text-[11px] text-[#e5e5e5]"
                        data-testid="studio-kit-select"
                      >
                        <option value="">Add to an existing kit…</option>
                        {userKits.map((k) => (
                          <option key={k.id} value={k.id}>{k.title}</option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={createKitAndAdd}
                      className="w-full px-3 py-2 border border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center justify-center gap-1.5"
                      data-testid="studio-create-kit-btn"
                    >
                      <Sparkles size={11} /> Start a new kit
                    </button>
                    {userKits.length > 0 && (
                      <div className="font-mono text-[9px] text-[#525252]">
                        Public kits get shareable URLs at <span className="text-[#a3a3a3]">/kits/&lt;slug&gt;</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT — Preview canvas */}
          <div className="space-y-4">
            <div
              ref={previewRef}
              className="aspect-[2/1] bg-white border border-[#262626] flex items-center justify-center overflow-hidden relative select-none"
              data-testid="studio-preview"
            >
              {svg ? (
                <motion.div
                  key={svg.slice(0, 40)}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
                  className="w-full h-full flex items-center justify-center p-6 [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:h-auto"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <div className="text-center text-[#737373] font-mono text-xs uppercase tracking-[0.22em] p-6">
                  {busy ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin text-[#ff4500]" />
                      Generating design…
                    </span>
                  ) : (
                    "◆ Preview · type a prompt and hit Generate"
                  )}
                </div>
              )}
              {/* iter243 — drag-to-position overlay. Lives above the SVG.
                  Invisible until hovered; commits only on pointer-up so the
                  backend gets one render call per drag, not one per mousemove. */}
              {design && svg && (
                <DragOverlay
                  design={design}
                  setDesign={setDesign}
                  containerRef={previewRef}
                  svgKey={svg.slice(0, 40)}
                />
              )}
            </div>

            {/* Design summary */}
            {design && (
              <DesignSummary design={design} width={width} height={height} />
            )}

            {design && svg && (
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] -mt-2 flex items-center gap-1.5" data-testid="studio-drag-hint">
                <Sparkles size={10} className="text-[#00ffff]" /> Drag any element on the canvas to reposition
              </div>
            )}

            {/* iter239 — CAM Strategy card. Always visible (even pre-design)
                so the user can shop materials and see machining intent up
                front. Refetches on every material / depth / mode change. */}
            {cam && (
              <CamStrategyCard
                cam={cam}
                machineType={machineType}
                setMachineType={setMachineType}
              />
            )}

            <ShapeLegend />
          </div>
        </div>
      </div>
    </div>
  );
}

function DesignSummary({ design, width, height }) {
  const shapes = (design.operations || []).filter((o) => o.kind === "shape").map((o) => o.primitive);
  const text = (design.operations || []).find((o) => o.kind === "text")?.content;
  const holes = design.holes?.count || 0;
  return (
    <div className="border border-[#262626] bg-[#0a0a0a] p-4 grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-[10px]" data-testid="studio-design-summary">
      <SummaryItem label="Size" value={`${width}″ × ${height}″`} />
      <SummaryItem label="Border" value={design.border || "none"} />
      <SummaryItem label="Text" value={text || "—"} truncate />
      <SummaryItem label="Shapes" value={shapes.join(", ") || "—"} />
      <SummaryItem label="Holes" value={holes ? `${holes} · ${design.holes?.placement || ""}` : "none"} />
      <SummaryItem label="Cut layer" value="Outline + holes" />
      <SummaryItem label="Engrave" value={text ? "1 line" : "—"} />
      <SummaryItem label="Format" value="SVG · DXF" />
    </div>
  );
}

function SummaryItem({ label, value, truncate }) {
  return (
    <div>
      <div className="text-[#525252] uppercase tracking-[0.22em] text-[9px] mb-1">{label}</div>
      <div className={`text-[#e5e5e5] ${truncate ? "truncate" : ""}`}>{value}</div>
    </div>
  );
}

// iter239 — CAM Strategy card. Deterministic feed/RPM/tool recommendation
// driven by /api/studio/cam-strategy. Includes a machine-type switcher
// (router/laser/plasma) so the maker can preview different setups without
// changing material.
function CamStrategyCard({ cam, machineType, setMachineType }) {
  const MACHINES = ["router", "laser", "plasma"];
  return (
    <div className="border border-[#262626] bg-[#0a0a0a] p-4 space-y-3" data-testid="studio-cam-card">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#ff4500]">
          ◆ CAM Strategy <span className="text-[#525252]">· {cam.tier}</span>
        </div>
        <div className="flex gap-1">
          {MACHINES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMachineType(machineType === m ? null : m)}
              className={`px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] border ${
                (machineType === m || (!machineType && cam.machine === m))
                  ? "border-[#ff4500] text-[#ff4500]"
                  : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
              }`}
              data-testid={`studio-cam-machine-${m}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-[10px]">
        <SummaryItem label="Tool" value={cam.tool} truncate />
        {cam.rpm != null && <SummaryItem label="Spindle" value={`${cam.rpm.toLocaleString()} RPM`} />}
        <SummaryItem label="Feed" value={`${cam.feed_rate} ${cam.feed_unit}`} />
        {cam.plunge_rate != null && <SummaryItem label="Plunge" value={`${cam.plunge_rate} ${cam.feed_unit}`} />}
        <SummaryItem label="Passes" value={String(cam.passes)} />
        <SummaryItem label="Depth/pass" value={`${cam.depth_per_pass} ${cam.depth_unit}`} />
        {cam.chipload != null && <SummaryItem label="Chipload" value={`${cam.chipload}\" / tooth`} />}
        <SummaryItem label="Mode" value={cam.engrave_only ? "ENGRAVE" : "CUT + ENGRAVE"} />
      </div>

      {cam.notes && (
        <div className="border-t border-[#262626] pt-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252] mb-1.5">
            ◆ Operator notes
          </div>
          <p className="font-mono text-[10px] text-[#a3a3a3] leading-relaxed">
            {cam.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function ShapeLegend() {
  return (
    <div className="border border-[#262626] bg-[#0a0a0a] p-4" data-testid="studio-shape-legend">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mb-3">
        ◆ Shape vocabulary the AI can compose ({SHAPE_VOCAB.length})
      </div>
      <div className="flex flex-wrap gap-2">
        {SHAPE_VOCAB.map((s) => (
          <span key={s} className="px-2 py-1 border border-[#262626] font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.18em]">
            {s.replace(/_/g, " ")}
          </span>
        ))}
        <span className="px-2 py-1 border border-[#262626] font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.18em]">
          + custom text (4 fonts)
        </span>
        <span className="px-2 py-1 border border-[#262626] font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.18em]">
          + 5 border styles
        </span>
        <span className="px-2 py-1 border border-[#00ffff]/60 font-mono text-[10px] text-[#00ffff] uppercase tracking-[0.18em]">
          + engrave-only mode
        </span>
        <span className="px-2 py-1 border border-[#00ffff]/60 font-mono text-[10px] text-[#00ffff] uppercase tracking-[0.18em]">
          + 5 materials · units · depth
        </span>
      </div>
    </div>
  );
}

function TemplateGallery({ templates, onPick }) {
  return (
    <div className="mb-10" data-testid="studio-template-gallery">
      <div className="flex items-baseline justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#a3a3a3]">
          ◆ Start from a template <span className="text-[#525252]">· {templates.length} curated</span>
        </div>
        <span className="font-mono text-[10px] text-[#525252]">No prompt used · free</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3 -mx-4 px-4 snap-x snap-mandatory">
        {templates.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => onPick(tpl)}
            className="shrink-0 w-[200px] text-left border border-[#262626] hover:border-[#ff4500] bg-[#0a0a0a] p-3 transition group snap-start"
            data-testid={`studio-template-${tpl.id}`}
          >
            <TemplateThumb design={tpl.design} />
            <div className="mt-2.5 space-y-1">
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">
                {tpl.category}
              </div>
              <div className="font-mono text-[11px] text-[#e5e5e5] group-hover:text-[#ff4500] line-clamp-1">
                {tpl.name}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// iter238 — Parametric machining controls. Material chips + units toggle +
// depth presets driven by the selected material's depth list. Selections are
// threaded into render, generate, refine, download, publish payloads.
function ParametricControls({ materials, material, setMaterial, units, setUnits, materialDepth, setMaterialDepth }) {
  const current = materials.find((m) => m.key === material);
  const depths = current?.depths || [0.25, 0.5];
  return (
    <div className="space-y-3" data-testid="studio-parametric">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">◆ Material</span>
          <button
            type="button"
            onClick={() => setUnits(units === "inches" ? "mm" : "inches")}
            className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252] hover:text-[#00ffff] border border-[#262626] hover:border-[#00ffff] px-2 py-0.5"
            data-testid="studio-units-toggle"
          >
            {units === "inches" ? "in" : "mm"} ↻
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {materials.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                setMaterial(m.key);
                if (!m.depths.includes(materialDepth)) setMaterialDepth(m.depths[0]);
              }}
              className={`px-2 py-1.5 border font-mono text-[10px] uppercase tracking-[0.18em] ${
                material === m.key ? "border-[#00ffff] text-[#00ffff] bg-[#00ffff]/5"
                  : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
              }`}
              data-testid={`studio-material-${m.key}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">◆ Depth</span>
          <span className="font-mono text-[10px] text-[#e5e5e5]">
            {materialDepth}{units === "inches" ? "″" : "mm"}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {depths.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setMaterialDepth(d)}
              className={`px-2 py-1.5 border font-mono text-[10px] ${
                Math.abs(materialDepth - d) < 0.001
                  ? "border-[#ff4500] text-[#ff4500] bg-[#ff4500]/5"
                  : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
              }`}
              data-testid={`studio-depth-${d}`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Tiny inline SVG thumbnail rendered from a small subset of the design intent
// so the gallery looks alive without hitting the backend for each card.
function TemplateThumb({ design }) {
  const w = 200;
  const h = 100;
  const dW = design.width || 12;
  const dH = design.height || 6;
  const aspect = dW / dH;
  const fitH = Math.min(h, w / aspect);
  const fitW = fitH * aspect;
  // Build a quick SVG with just the first shape + text using inline fragments.
  const shape = (design.operations || []).find((o) => o.kind === "shape");
  const text = (design.operations || []).find((o) => o.kind === "text");
  return (
    <div className="bg-white aspect-[2/1] flex items-center justify-center overflow-hidden border border-[#171717]">
      <svg viewBox={`0 0 ${fitW} ${fitH}`} width={fitW} height={fitH} className="w-full h-full">
        {design.border && design.border !== "none" && (
          <rect x="4" y="4" width={fitW - 8} height={fitH - 8} rx={design.border === "rounded" ? 8 : 0}
                fill="none" stroke="#000" strokeWidth="3" />
        )}
        {shape && (
          <text x={fitW / 2} y={fitH * 0.45} textAnchor="middle"
                fontFamily="Anton, Impact, sans-serif"
                fontSize={fitH * 0.18} fill="#000">
            ◇ {shape.primitive.replace(/_/g, " ")}
          </text>
        )}
        {text && (
          <text x={fitW / 2} y={fitH * 0.78} textAnchor="middle"
                fontFamily="Anton, Impact, sans-serif"
                fontWeight="900"
                fontSize={fitH * 0.20} fill="#000">
            {text.content}
          </text>
        )}
      </svg>
    </div>
  );
}


// iter242 — Elements editor. Direct, AI-quota-free manipulation of every
// shape / text / border / hole. Mutating design.operations triggers the
// existing render effect so the preview updates instantly.
const SHAPE_OPTIONS = [
  "mountains", "pine_trees", "deer", "heart", "star", "flag", "cross",
  "sun_rays", "eagle", "antlers", "rooster", "anchor", "compass_rose", "treble_clef",
];
const FONT_OPTIONS = ["bold_serif", "script", "western", "sans"];
const BORDER_OPTIONS = ["none", "rectangle", "rounded", "circle", "oval"];
const HOLE_PLACEMENTS = ["top_corners", "bottom_corners", "four_corners", "top_center"];

function ElementsEditor({ design, setDesign }) {
  const [openIdx, setOpenIdx] = useState(null);
  const ops = design?.operations || [];
  const opCount = ops.length;
  const atCap = opCount >= 4;

  const updateOp = (idx, patch) => {
    const next = ops.map((o, i) => (i === idx ? { ...o, ...patch } : o));
    setDesign({ ...design, operations: next });
  };

  const removeOp = (idx) => {
    const next = ops.filter((_, i) => i !== idx);
    setDesign({ ...design, operations: next });
    setOpenIdx(null);
    toast.success("Element removed");
  };

  const addShape = () => {
    if (atCap) { toast.error("Max 4 elements per design"); return; }
    const newOp = { kind: "shape", primitive: "star", x: 0.5, y: 0.5, w: 0.4, h: 0.4 };
    setDesign({ ...design, operations: [...ops, newOp] });
    setOpenIdx(ops.length);
  };

  const addText = () => {
    if (atCap) { toast.error("Max 4 elements per design"); return; }
    const newOp = { kind: "text", content: "Your text", font: "bold_serif", size: 0.2, x: 0.5, y: 0.5 };
    setDesign({ ...design, operations: [...ops, newOp] });
    setOpenIdx(ops.length);
  };

  const setBorder = (patch) => {
    setDesign({ ...design, ...patch });
  };

  const setHoles = (patch) => {
    setDesign({ ...design, holes: { ...(design.holes || { count: 0, diameter: 0.25, placement: "top_corners" }), ...patch } });
  };

  const holes = design?.holes || { count: 0, diameter: 0.25, placement: "top_corners" };

  return (
    <div className="space-y-3" data-testid="studio-elements-editor">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          ◆ Elements <span className="text-[#525252]">· {opCount}/4</span>
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={addShape}
            disabled={atCap}
            className="inline-flex items-center gap-1 px-2 py-1 border border-[#262626] hover:border-[#00ffff] disabled:opacity-40 font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#00ffff]"
            data-testid="studio-add-shape"
          >
            <Plus size={10} /> <Square size={10} /> Shape
          </button>
          <button
            type="button"
            onClick={addText}
            disabled={atCap}
            className="inline-flex items-center gap-1 px-2 py-1 border border-[#262626] hover:border-[#00ffff] disabled:opacity-40 font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#00ffff]"
            data-testid="studio-add-text"
          >
            <Plus size={10} /> <TypeIcon size={10} /> Text
          </button>
        </div>
      </div>

      {ops.length === 0 && (
        <div className="border border-dashed border-[#262626] p-3 font-mono text-[10px] text-[#525252] text-center">
          No elements yet — add a shape or text above.
        </div>
      )}

      <div className="space-y-2">
        {ops.map((op, idx) => {
          const isOpen = openIdx === idx;
          const label = op.kind === "shape"
            ? (op.primitive || "shape").replace(/_/g, " ")
            : (op.content || "(empty)");
          return (
            <div key={idx} className={`border ${isOpen ? "border-[#00ffff]" : "border-[#262626]"} bg-[#0a0a0a]`}>
              <div className="flex items-center gap-2 px-2.5 py-2">
                <span className={`font-mono text-[9px] uppercase tracking-[0.22em] px-1.5 py-0.5 border ${
                  op.kind === "shape" ? "border-[#ff4500] text-[#ff4500]" : "border-[#00ffff] text-[#00ffff]"
                }`}>
                  {op.kind === "shape" ? <Square size={9} className="inline -mt-0.5 mr-0.5" /> : <TypeIcon size={9} className="inline -mt-0.5 mr-0.5" />}
                  {op.kind}
                </span>
                <span className="flex-1 font-mono text-[11px] text-[#e5e5e5] truncate">{label}</span>
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : idx)}
                  className="p-1 text-[#a3a3a3] hover:text-[#00ffff]"
                  data-testid={`studio-element-edit-${idx}`}
                  aria-label="Edit element"
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => removeOp(idx)}
                  className="p-1 text-[#a3a3a3] hover:text-[#ff4500]"
                  data-testid={`studio-element-delete-${idx}`}
                  aria-label="Delete element"
                >
                  <Trash2 size={11} />
                </button>
              </div>
              {isOpen && (
                <div className="border-t border-[#262626] p-3 space-y-2.5" data-testid={`studio-element-panel-${idx}`}>
                  {op.kind === "shape" ? (
                    <SelectRow label="Shape" value={op.primitive} options={SHAPE_OPTIONS}
                               onChange={(v) => updateOp(idx, { primitive: v })}
                               testId={`studio-element-${idx}-primitive`} />
                  ) : (
                    <>
                      <label className="block">
                        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1">Content</span>
                        <input
                          type="text"
                          value={op.content || ""}
                          onChange={(e) => updateOp(idx, { content: e.target.value.slice(0, 80) })}
                          maxLength={80}
                          className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#00ffff] outline-none px-2 py-1.5 font-mono text-[11px] text-[#e5e5e5]"
                          data-testid={`studio-element-${idx}-content`}
                        />
                      </label>
                      <SelectRow label="Font" value={op.font || "bold_serif"} options={FONT_OPTIONS}
                                 onChange={(v) => updateOp(idx, { font: v })}
                                 testId={`studio-element-${idx}-font`} />
                      <SliderRow label="Text size" min={0.05} max={0.5} step={0.01}
                                 value={op.size ?? 0.2}
                                 onChange={(v) => updateOp(idx, { size: v })}
                                 testId={`studio-element-${idx}-size`} suffix="" />
                    </>
                  )}
                  <div className="grid grid-cols-2 gap-2.5">
                    <SliderRow label="X" min={0} max={1} step={0.01}
                               value={op.x ?? 0.5}
                               onChange={(v) => updateOp(idx, { x: v })}
                               testId={`studio-element-${idx}-x`} />
                    <SliderRow label="Y" min={0} max={1} step={0.01}
                               value={op.y ?? 0.5}
                               onChange={(v) => updateOp(idx, { y: v })}
                               testId={`studio-element-${idx}-y`} />
                  </div>
                  {op.kind === "shape" && (
                    <div className="grid grid-cols-2 gap-2.5">
                      <SliderRow label="Width" min={0.1} max={1} step={0.01}
                                 value={op.w ?? 0.5}
                                 onChange={(v) => updateOp(idx, { w: v })}
                                 testId={`studio-element-${idx}-w`} />
                      <SliderRow label="Height" min={0.1} max={1} step={0.01}
                                 value={op.h ?? 0.5}
                                 onChange={(v) => updateOp(idx, { h: v })}
                                 testId={`studio-element-${idx}-h`} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Border + Holes — top-level design fields, not operations */}
      <details className="border border-[#262626] group" data-testid="studio-border-section">
        <summary className="px-2.5 py-2 cursor-pointer flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#e5e5e5] select-none">
          <span>◆ Border · <span className="text-[#525252]">{design.border || "none"}</span></span>
          <ChevronDown size={11} className="group-open:rotate-180 transition-transform" />
        </summary>
        <div className="border-t border-[#262626] p-3 space-y-2.5">
          <SelectRow label="Style" value={design.border || "none"} options={BORDER_OPTIONS}
                     onChange={(v) => setBorder({ border: v })}
                     testId="studio-border-style" />
          {(design.border && design.border !== "none") && (
            <SliderRow label="Thickness" min={0.05} max={0.5} step={0.01}
                       value={design.border_thickness ?? 0.2}
                       onChange={(v) => setBorder({ border_thickness: v })}
                       testId="studio-border-thickness" />
          )}
        </div>
      </details>

      <details className="border border-[#262626] group" data-testid="studio-holes-section">
        <summary className="px-2.5 py-2 cursor-pointer flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#e5e5e5] select-none">
          <span>◆ Mounting holes · <span className="text-[#525252]">{holes.count} × {holes.diameter}″</span></span>
          <ChevronDown size={11} className="group-open:rotate-180 transition-transform" />
        </summary>
        <div className="border-t border-[#262626] p-3 space-y-2.5">
          <div>
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1">Count</span>
            <div className="grid grid-cols-5 gap-1.5">
              {[0, 1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setHoles({ count: n })}
                  className={`px-2 py-1.5 border font-mono text-[10px] ${
                    holes.count === n
                      ? "border-[#00ffff] text-[#00ffff] bg-[#00ffff]/5"
                      : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
                  }`}
                  data-testid={`studio-holes-count-${n}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          {holes.count > 0 && (
            <>
              <SliderRow label="Diameter" min={0.1} max={0.6} step={0.01}
                         value={holes.diameter}
                         onChange={(v) => setHoles({ diameter: v })}
                         testId="studio-holes-diameter" suffix="″" />
              <SelectRow label="Placement" value={holes.placement || "top_corners"} options={HOLE_PLACEMENTS}
                         onChange={(v) => setHoles({ placement: v })}
                         testId="studio-holes-placement" />
            </>
          )}
        </div>
      </details>
    </div>
  );
}

function SelectRow({ label, value, options, onChange, testId }) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#00ffff] outline-none px-2 py-1.5 font-mono text-[11px] text-[#e5e5e5] capitalize"
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
        ))}
      </select>
    </label>
  );
}

function SliderRow({ label, min, max, step, value, onChange, testId, suffix = "" }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</span>
        <span className="font-mono text-[9px] text-[#e5e5e5]">
          {Number(value).toFixed(2)}{suffix}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#ff4500]"
        data-testid={testId}
      />
    </div>
  );
}

// iter243 — Drag-to-position overlay. Renders an absolutely-positioned
// transparent hit-box on top of each design operation. The user drags a
// hit-box to reposition the underlying shape/text. Only a ghost outline
// tracks the pointer during drag; the final position commits to design
// state on pointer-up, triggering exactly ONE backend render call per drag.
function DragOverlay({ design, setDesign, containerRef, svgKey }) {
  const [bounds, setBounds] = useState(null); // SVG's rendered bounds inside the container (px)
  const [dragging, setDragging] = useState(null); // { idx, startX, startY, origX, origY }
  const [ghost, setGhost] = useState(null); // { idx, x, y } during drag

  // Measure the inner <svg>'s rendered bounding box relative to the container.
  // Re-measure when the SVG content changes or the viewport resizes.
  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const container = containerRef.current;
      if (!container) return;
      const svgEl = container.querySelector("svg");
      if (!svgEl) { setBounds(null); return; }
      const cRect = container.getBoundingClientRect();
      const sRect = svgEl.getBoundingClientRect();
      setBounds({
        left: sRect.left - cRect.left,
        top: sRect.top - cRect.top,
        width: sRect.width,
        height: sRect.height,
      });
    };
    measure();
    // SVG mounts via dangerouslySetInnerHTML — settle on next frame + after fonts.
    const t1 = setTimeout(measure, 80);
    const t2 = setTimeout(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t1); clearTimeout(t2);
      window.removeEventListener("resize", measure);
    };
  }, [svgKey, containerRef]);

  const ops = design?.operations || [];
  if (!bounds || ops.length === 0) return null;

  const onPointerDown = (e, idx) => {
    e.preventDefault();
    const op = ops[idx];
    setDragging({
      idx,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: op.x ?? 0.5,
      origY: op.y ?? 0.5,
    });
    setGhost({ idx, x: op.x ?? 0.5, y: op.y ?? 0.5 });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = (e.clientX - dragging.startX) / bounds.width;
    const dy = (e.clientY - dragging.startY) / bounds.height;
    const newX = Math.max(0, Math.min(1, dragging.origX + dx));
    const newY = Math.max(0, Math.min(1, dragging.origY + dy));
    setGhost({ idx: dragging.idx, x: newX, y: newY });
  };

  const finishDrag = () => {
    if (dragging && ghost) {
      const next = ops.map((o, i) =>
        i === dragging.idx ? { ...o, x: ghost.x, y: ghost.y } : o,
      );
      setDesign({ ...design, operations: next });
    }
    setDragging(null);
    setGhost(null);
  };

  // Per-op visible-size estimate — used to size the hit-box visually so the
  // user can target it. Text width is hard to estimate without rendering, so
  // we just give text a generous central box scaled to its `size`.
  const opBox = (op, fallbackXY) => {
    const x = fallbackXY?.x ?? op.x ?? 0.5;
    const y = fallbackXY?.y ?? op.y ?? 0.5;
    if (op.kind === "shape") {
      const w = (op.w ?? 0.4) * bounds.width;
      const h = (op.h ?? 0.4) * bounds.height;
      return {
        left: bounds.left + x * bounds.width - w / 2,
        top:  bounds.top  + y * bounds.height - h / 2,
        width: w,
        height: h,
      };
    }
    // text — approximate: width ∝ content length × size, height = size × canvas
    const content = op.content || "";
    const textH = (op.size ?? 0.2) * bounds.height;
    const textW = Math.max(50, Math.min(bounds.width * 0.95, content.length * textH * 0.55));
    return {
      left: bounds.left + x * bounds.width - textW / 2,
      top:  bounds.top  + y * bounds.height - textH / 2,
      width: textW,
      height: textH,
    };
  };

  return (
    <div
      className="absolute inset-0"
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      style={{ pointerEvents: dragging ? "auto" : "none" }}
      data-testid="studio-drag-layer"
    >
      {ops.map((op, idx) => {
        const isDragging = dragging?.idx === idx;
        const liveGhost = isDragging && ghost?.idx === idx ? { x: ghost.x, y: ghost.y } : null;
        const box = opBox(op, liveGhost);
        const isShape = op.kind === "shape";
        return (
          <div
            key={idx}
            onPointerDown={(e) => onPointerDown(e, idx)}
            className={`absolute group cursor-move touch-none transition-all duration-100 ${
              isDragging ? "ring-2 ring-[#ff4500] bg-[#ff4500]/5" : "ring-1 ring-transparent hover:ring-[#00ffff] hover:bg-[#00ffff]/5"
            }`}
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              minWidth: 24,
              minHeight: 24,
              pointerEvents: "auto",
            }}
            data-testid={`studio-drag-handle-${idx}`}
            title={isShape ? `Drag to move ${(op.primitive || "shape").replace(/_/g, " ")}` : "Drag to move text"}
          >
            <span
              className={`absolute -top-5 left-0 font-mono text-[9px] uppercase tracking-[0.22em] px-1.5 py-0.5 bg-[#0a0a0a] text-[#00ffff] whitespace-nowrap pointer-events-none transition ${
                isDragging ? "opacity-100 text-[#ff4500]" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              {isShape
                ? `◇ ${(op.primitive || "shape").replace(/_/g, " ")}`
                : `T · ${(op.content || "").slice(0, 14)}`}
              {isDragging && ghost && ` · ${Math.round(ghost.x * 100)},${Math.round(ghost.y * 100)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

