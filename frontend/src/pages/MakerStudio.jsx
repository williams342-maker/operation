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
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, Download, Share2, Loader2, Lock, FileDown } from "lucide-react";
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
  const [width, setWidth] = useState(14);
  const [height, setHeight] = useState(6);
  const [design, setDesign] = useState(null);
  const [svg, setSvg] = useState("");
  const [quota, setQuota] = useState(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    http.get("/studio/quota", { headers: authHeaders() })
      .then((r) => setQuota(r.data))
      .catch(() => {});
  }, [signedIn]);

  // Re-render SVG whenever the design or canvas size changes (debounced via
  // simple effect — backend handles the sanitization).
  useEffect(() => {
    if (!design) return;
    const payload = { ...design, width: Number(width), height: Number(height) };
    http.post("/studio/render", { design: payload }, { headers: authHeaders() })
      .then((r) => setSvg(r.data?.svg || ""))
      .catch(() => {});
  }, [design, width, height]);

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
      setDesign(r.data.design);
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
    const payload = { design: { ...design, width: Number(width), height: Number(height) } };
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
        { design: { ...design, width: Number(width), height: Number(height) } },
        { headers: authHeaders() },
      );
      toast.success(`Published to community — “${r.data?.file?.title}”`);
    } catch (e) {
      toast.error("Publish failed");
    } finally {
      setPublishing(false);
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

            {/* Size sliders (only useful once a design exists) */}
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
              </div>
            )}
          </div>

          {/* RIGHT — Preview canvas */}
          <div className="space-y-4">
            <div
              className="aspect-[2/1] bg-white border border-[#262626] flex items-center justify-center overflow-hidden"
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
            </div>

            {/* Design summary */}
            {design && (
              <DesignSummary design={design} width={width} height={height} />
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

function ShapeLegend() {
  const SHAPES = [
    "mountains", "pine_trees", "deer", "heart",
    "star", "flag", "cross", "sun_rays",
  ];
  return (
    <div className="border border-[#262626] bg-[#0a0a0a] p-4" data-testid="studio-shape-legend">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mb-3">
        ◆ Shape vocabulary the AI can compose
      </div>
      <div className="flex flex-wrap gap-2">
        {SHAPES.map((s) => (
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
      </div>
    </div>
  );
}
