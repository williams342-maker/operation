import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Layers, FileText, Flame, Zap, Star, Package, Box,
  Search, CheckCircle2, Upload as UploadIcon, ArrowLeft, ArrowRight,
} from "lucide-react";
import {
  fetchMakers, submitCustomOrder, uploadCustomOrderDesign, aiMatchMakers,
} from "../lib/api";
import { useStructuredData } from "../lib/seo";
import PolicyConsent, { usePolicyConsent } from "../components/PolicyConsent";
import { trackConversion } from "../lib/googleAdsConversions";

// ============================================================
//  Category catalog — 7 piece types incl. 3D Printing
// ============================================================
// API base for the inline waitlist form on the Coming-Soon cards.
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CATEGORIES = [
  { id: "Wall Art",        icon: Layers,   blurb: "Decorative panels, murals, sculptures",  materials: ["Metal", "Wood", "Acrylic"] },
  { id: "Custom Sign",     icon: FileText, blurb: "Business, home, event signage",          materials: ["Metal", "Wood", "Acrylic"] },
  { id: "Plasma Cut Piece",icon: Flame,    blurb: "Intricate steel & metal cutwork",         materials: ["Steel", "Iron", "Copper"] },
  { id: "Laser Engraving", icon: Zap,      blurb: "Precision etching on any surface",        materials: ["Wood", "Leather", "Glass"] },
  { id: "Outdoor Piece",   icon: Star,     blurb: "Weather-treated exterior installations",  materials: ["Steel", "Corten", "Aluminum"] },
  { id: "Gift / Keepsake", icon: Package,  blurb: "Personalised commemorative items",        materials: ["Wood", "Leather", "Metal"] },
  { id: "3D Printed Piece",icon: Box,      blurb: "Functional & decorative additive prints", materials: ["PLA", "PETG", "Resin", "Nylon"] },
];

// Coming-soon placeholders — fill out the Step 1 grid into a clean 3×3
// layout and tease categories we'll unlock once enough makers request
// them. Disabled cards (can't be selected); shown greyed-out with a
// subtle "Coming Soon" chip + witty blurb so the page feels alive
// rather than half-built.
const COMING_SOON = [
  {
    id: "Neon & Light",
    icon: Zap,
    blurb: "Hand-bent neon and LED pieces. Sparks fly soon.",
    tease: "Warming up the glass.",
  },
  {
    id: "Furniture",
    icon: Box,
    blurb: "Tables, benches, shelving built to your exact dimensions.",
    tease: "Gluing the clamps.",
  },
];

const TIMELINES = ["ASAP", "1-2 weeks", "2-4 weeks", "1-2 months", "3+ months", "Flexible"];
const QUANTITIES = ["1", "2-5", "6-10", "11-25", "26-100", "100+"];
const BUDGETS = [
  "— Prefer not to say —", "< $250", "$250 – $500", "$500 – $1,000",
  "$1,000 – $2,500", "$2,500 – $5,000", "$5,000+",
];

const STEPS = [
  { id: 1, label: "Order Type" },
  { id: 2, label: "Describe" },
  { id: 3, label: "Select Maker" },
  { id: 4, label: "Upload Design" },
  { id: 5, label: "Submit" },
];

// ============================================================
//  Stepper — top progress bar (matches mockup screens 4 & 5)
// ============================================================
function Stepper({ current }) {
  return (
    <div className="grid grid-cols-5 gap-2 md:gap-4 mb-12" data-testid="custom-order-stepper">
      {STEPS.map((s) => {
        const done = s.id < current;
        const active = s.id === current;
        return (
          <div key={s.id} className="flex flex-col items-stretch">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2 truncate">
              {s.label}
            </div>
            <div className="relative flex items-center">
              <div
                className={`w-9 h-9 flex items-center justify-center font-mono text-xs ${
                  done
                    ? "bg-brand text-[#0a0a0a]"
                    : active
                    ? "bg-surface text-brand border border-brand"
                    : "bg-transparent text-ink-muted border border-line"
                }`}
                data-testid={`step-marker-${s.id}`}
              >
                {done ? <CheckCircle2 size={16} /> : s.id}
              </div>
              <div className={`flex-1 h-px ml-2 ${done ? "bg-brand" : "bg-surface"}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
//  Step 1 — Category cards
// ============================================================
function StepCategory({ value, onPick }) {
  return (
    <div data-testid="step-category">
      <Headline eyebrow="Step 1 of 5" title="What are you making?" />
      <p className="font-mono text-sm text-ink-muted max-w-2xl mb-10">
        What kind of custom piece are you looking to create? Pick the category
        that best describes your vision — you can refine the brief on the next step.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const selected = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c)}
              className={`text-left border p-6 transition-all duration-200 ${
                selected
                  ? "border-brand bg-brand/10"
                  : "border-line hover:border-line bg-paper"
              }`}
              data-testid={`category-card-${c.id.replace(/[\s/]/g, "-").toLowerCase()}`}
            >
              <div
                className={`w-12 h-12 flex items-center justify-center mb-5 ${
                  selected ? "bg-brand text-[#0a0a0a]" : "bg-surface text-brand"
                }`}
              >
                <Icon size={20} />
              </div>
              <div className="font-display text-2xl mb-2 leading-tight">{c.id}</div>
              <div className="font-mono text-xs text-ink-muted mb-5 leading-relaxed">{c.blurb}</div>
              <div className="flex flex-wrap gap-2">
                {c.materials.map((m) => (
                  <span
                    key={m}
                    className="font-mono text-[10px] uppercase tracking-[0.22em] px-2.5 py-1 border border-line text-ink-muted"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
        {/* Coming-soon teasers — disabled cards rounding out the grid
            to a clean 3×3. Clicking them opens an inline waitlist
            capture so we can notify users when each category launches. */}
        {COMING_SOON.map((c) => (
          <ComingSoonCard key={c.id} category={c} />
        ))}
      </div>
    </div>
  );
}

// ============================================================
//  Step 2 — Describe your piece
// ============================================================
function StepDescribe({ category, form, setForm }) {
  // Functional updater — prevents fast-typed keystrokes from using a
  // stale `form` snapshot and clobbering other fields. See BetaPage /
  // ApplyPage for the same fix.
  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((c) => ({ ...c, [k]: v }));
  };
  const cat = CATEGORIES.find((c) => c.id === category);
  return (
    <div data-testid="step-describe">
      <Headline eyebrow="Step 2 of 5" title="Describe your piece" />
      <p className="font-mono text-sm text-ink-muted max-w-2xl mb-10">
        Tell us about your{" "}
        <span className="text-brand">{category}</span>. The more detail you
        give, the better makers can quote and plan your project.
      </p>

      <Field label="Describe your vision *" full>
        <textarea
          required rows={6} value={form.description} onChange={set("description")}
          placeholder="Describe what you want — size, style, text, finish, purpose, reference images…"
          className="w-full bg-transparent border border-line focus:border-brand outline-none p-4 font-mono text-sm text-ink placeholder:text-ink-muted resize-none"
          data-testid="co-description"
        />
      </Field>

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <Field label="Preferred material">
          <select
            value={form.material} onChange={set("material")}
            className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm text-ink"
            data-testid="co-material"
          >
            <option value="">— Any / Maker's choice —</option>
            {(cat?.materials || []).map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="Other">Other / Mixed</option>
          </select>
        </Field>

        <Field label="Dimensions / size">
          <input
            value={form.size} onChange={set("size")}
            placeholder='e.g. 24" × 36" or "roughly A2"'
            className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm text-ink placeholder:text-ink-muted"
            data-testid="co-size"
          />
        </Field>

        <Field label="Quantity">
          <select
            value={form.quantity} onChange={set("quantity")}
            className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm text-ink"
            data-testid="co-quantity"
          >
            {QUANTITIES.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </Field>

        <Field label="Budget range">
          <select
            value={form.budget} onChange={set("budget")}
            className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm text-ink"
            data-testid="co-budget"
          >
            {BUDGETS.map((b) => <option key={b} value={b === BUDGETS[0] ? "" : b}>{b}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-muted mb-3">Timeline</div>
        <div className="flex flex-wrap gap-2">
          {TIMELINES.map((t) => (
            <button
              key={t} type="button"
              onClick={() => setForm({ ...form, timeline: t })}
              className={`font-mono text-[11px] uppercase tracking-[0.22em] px-4 py-2 border transition ${
                form.timeline === t
                  ? "bg-brand text-[#0a0a0a] border-brand"
                  : "border-line text-ink-muted hover:border-brand"
              }`}
              data-testid={`co-timeline-${t.toLowerCase().replace(/[\s+]/g, "-")}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  Step 3 — Choose a maker (or skip = "any maker")
// ============================================================
function StepMaker({ value, onPick, description, projectType }) {
  const [makers, setMakers] = useState([]);
  const [q, setQ] = useState("");
  const [specialty, setSpecialty] = useState("");
  // AI maker matching. Auto-fires once when the visitor lands on Step 3
  // with a sufficiently detailed brief — surfaces the top 3 picks
  // before they scroll through the full directory.
  const [aiMatches, setAiMatches] = useState(null);  // null = not loaded · [] = loaded but empty
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    fetchMakers().then(setMakers).catch(() => {});
  }, []);

  useEffect(() => {
    const desc = (description || "").trim();
    if (desc.length < 30 || aiMatches !== null) return;
    setAiBusy(true);
    aiMatchMakers({ description: desc, project_type: projectType || null })
      .then((r) => setAiMatches(Array.isArray(r.matches) ? r.matches : []))
      .catch(() => setAiMatches([]))
      .finally(() => setAiBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, projectType]);

  const specialties = useMemo(() => {
    const set = new Set();
    makers.forEach((m) => (m.specialties || []).forEach((s) => set.add(s)));
    return Array.from(set).sort();
  }, [makers]);

  const filtered = useMemo(() => {
    return makers.filter((m) => {
      if (specialty && !(m.specialties || []).includes(specialty)) return false;
      if (q) {
        const hay = `${m.name || ""} ${m.location || ""} ${(m.specialties || []).join(" ")}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [makers, q, specialty]);

  return (
    <div data-testid="step-maker">
      <Headline eyebrow="Step 3 of 5" title="Choose a maker" />
      <p className="font-mono text-sm text-ink-muted max-w-2xl mb-10">
        Pick a specific maker to send your request to — or leave it open and
        we'll match you with the best fit.
      </p>

      {/* Filters */}
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <div className="relative">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search makers by name, specialty, location…"
            className="w-full bg-transparent border border-line focus:border-brand outline-none pl-10 pr-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-ink placeholder:text-ink-muted"
            data-testid="co-maker-search"
          />
        </div>
        <select
          value={specialty} onChange={(e) => setSpecialty(e.target.value)}
          className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-3 font-mono text-xs uppercase tracking-[0.18em] text-ink"
          data-testid="co-maker-specialty"
        >
          <option value="">All Specialties</option>
          {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* AI-suggested matches — auto-fires once the brief is detailed
          enough. Stays above the "any maker" CTA so the recommended
          picks are the first faces the visitor sees. */}
      {(aiBusy || (aiMatches && aiMatches.length > 0)) && (
        <div
          className="border border-brand/40 bg-brand/5 p-5 mb-6"
          data-testid="co-ai-maker-suggestions"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-3 inline-flex items-center gap-2">
            ◆ AI-suggested makers for your brief
          </div>
          {aiBusy && (
            <div className="font-mono text-[11px] text-ink-muted">Reading your brief…</div>
          )}
          {!aiBusy && aiMatches?.length > 0 && (
            <div className="grid md:grid-cols-3 gap-3">
              {aiMatches.map((m) => {
                const picked = value === m.slug;
                return (
                  <button
                    type="button"
                    key={m.slug}
                    onClick={() => onPick(m.slug)}
                    className={`text-left border p-4 transition ${
                      picked
                        ? "border-brand bg-brand/10"
                        : "border-line hover:border-brand bg-paper"
                    }`}
                    data-testid={`co-ai-suggested-${m.slug}`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-12 h-12 bg-surface overflow-hidden flex-shrink-0">
                        {m.portrait
                          ? <img src={m.portrait} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full bg-gradient-to-br from-[#ff4500] to-[#cc3700] flex items-center justify-center text-white font-display">{(m.name || "").slice(0, 2).toUpperCase()}</div>}
                      </div>
                      <div className="min-w-0">
                        <div className="font-display text-base leading-tight line-clamp-1">{m.name}</div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted line-clamp-1">
                          {m.location || ""}
                        </div>
                      </div>
                      {picked && <CheckCircle2 size={18} className="text-brand ml-auto flex-shrink-0" />}
                    </div>
                    {m.match_reason && (
                      <div
                        className="border-l-2 border-brand pl-2 text-[11px] text-ink-muted leading-snug italic"
                        data-testid={`co-ai-suggested-${m.slug}-reason`}
                      >
                        {m.match_reason}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Let Any Maker Respond — featured */}
      <button
        type="button"
        onClick={() => onPick(null)}
        className={`w-full text-left border p-6 mb-6 flex items-center gap-5 transition ${
          value === null
            ? "border-brand bg-brand/10"
            : "border-line hover:border-line bg-paper"
        }`}
        data-testid="co-maker-any"
      >
        <div className={`w-12 h-12 flex items-center justify-center ${
          value === null ? "bg-brand text-[#0a0a0a]" : "bg-surface text-brand"
        }`}>
          <Star size={20} />
        </div>
        <div className="flex-1">
          <div className="font-display text-2xl">Let Any Maker Respond</div>
          <div className="font-mono text-xs text-ink-muted mt-1">
            Post to all makers — we'll match you with the best fit
          </div>
        </div>
        {value === null && <CheckCircle2 size={22} className="text-brand" />}
      </button>

      {/* Maker cards */}
      <div className="grid md:grid-cols-2 gap-4" data-testid="co-maker-list">
        {filtered.map((m) => {
          const selected = value === m.slug;
          const initials = (m.name || "").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
          return (
            <button
              key={m.slug}
              type="button"
              onClick={() => onPick(m.slug)}
              className={`text-left border p-5 transition ${
                selected
                  ? "border-brand bg-brand/10"
                  : "border-line hover:border-line bg-paper"
              }`}
              data-testid={`co-maker-${m.slug}`}
            >
              <div className="flex items-start gap-4 mb-3">
                <div className="w-12 h-12 rounded-full border border-line flex items-center justify-center font-mono text-sm text-ink-muted flex-shrink-0">
                  {initials || "M"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-xl truncate">{m.name}</div>
                  <div className="font-mono text-[11px] text-ink-muted mt-1">◇ {m.location || "—"}</div>
                </div>
                {selected && <CheckCircle2 size={20} className="text-brand flex-shrink-0" />}
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {(m.specialties || []).slice(0, 2).map((s) => (
                  <span key={s} className="font-mono text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 bg-surface text-ink-muted">
                    {s}
                  </span>
                ))}
              </div>
              {m.bio && <p className="font-mono text-[11px] text-ink-muted mt-2 line-clamp-2">{m.bio}</p>}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="md:col-span-2 text-center py-12 font-mono text-xs text-ink-muted">
            No makers match those filters.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
//  Step 4 — Upload design
// ============================================================
function StepUpload({ value, onPick }) {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File is over the 10 MB limit.");
      return;
    }
    setUploading(true);
    try {
      const res = await uploadCustomOrderDesign(file);
      onPick({ url: res.url, name: res.filename });
      toast.success("Design uploaded.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed. Try a different file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div data-testid="step-upload">
      <Headline eyebrow="Step 4 of 5" title="Upload your design" />
      <p className="font-mono text-sm text-ink-muted max-w-2xl mb-10">
        Upload your design file, sketch, or reference image. Supported formats:
        {" "}<span className="text-brand">JPG · PNG · SVG · PDF · DXF</span> — max 10 MB.
      </p>

      {value ? (
        <div className="border border-line p-8 text-center" data-testid="co-upload-success">
          <CheckCircle2 size={40} className="mx-auto text-emerald-700 mb-4" />
          <div className="font-display text-2xl mb-2">Design uploaded</div>
          <div className="font-mono text-xs text-ink-muted mb-6 break-all">{value.name}</div>
          <div className="flex gap-3 justify-center">
            <a
              href={value.url} target="_blank" rel="noreferrer"
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-blue-700 hover:text-blue-700"
            >
              ↗ View file
            </a>
            <button
              type="button"
              onClick={() => onPick(null)}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand"
              data-testid="co-upload-replace"
            >
              ✕ Replace
            </button>
          </div>
        </div>
      ) : (
        <CoDropZone
          uploading={uploading}
          onFile={handleFile}
        />
      )}

      <p className="font-mono text-[11px] text-ink-muted mt-6 italic">
        No design file? No problem — you can describe everything in words and the maker will work with you from there.
      </p>
    </div>
  );
}

// iter313d — Real drag-and-drop zone for the custom-order reference
// file. The previous `<label>` claimed "Drop your file here" but had no
// onDrop handler — a pure click-only fallback. Buyers dragging a file
// onto the page would get a browser default behavior (the file opens
// in a new tab) instead of an upload. This component is a thin shell
// that supports both drag-drop AND click-to-browse with consistent
// visual feedback.
function CoDropZone({ uploading, onFile }) {
  const [dragOver, setDragOver] = React.useState(false);
  return (
    <label
      htmlFor="co-upload-input"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`block border-2 border-dashed transition cursor-pointer p-12 md:p-16 text-center ${
        dragOver
          ? "border-brand bg-brand/5"
          : "border-line hover:border-brand"
      }`}
      data-testid="co-upload-zone"
    >
      <div className="w-16 h-16 mx-auto mb-5 flex items-center justify-center bg-surface text-brand">
        <UploadIcon size={24} />
      </div>
      <div className="font-display text-2xl mb-1">
        {uploading ? "Uploading…" : dragOver ? "Release to upload" : "Drop your file here"}
      </div>
      <div className="font-mono text-xs text-ink-muted mb-4">or click to browse</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
        JPG · PNG · SVG · PDF · DXF · Max 10 MB
      </div>
      <input
        id="co-upload-input"
        type="file"
        accept=".jpg,.jpeg,.png,.svg,.pdf,.dxf,.webp"
        onChange={(e) => onFile(e.target.files?.[0])}
        disabled={uploading}
        className="hidden"
      />
    </label>
  );
}

// ============================================================
//  Step 5 — Contact info + order summary
// ============================================================
function StepContact({ form, setForm, summary, consent }) {
  // Functional updater — prevents stale-closure "data bounces back to
  // another field" bug when typing email/phone fast.
  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((c) => ({ ...c, [k]: v }));
  };
  return (
    <div data-testid="step-contact">
      <Headline eyebrow="Step 5 of 5" title="Contact information" />
      <p className="font-mono text-sm text-ink-muted max-w-2xl mb-10">
        Almost there — how should the maker reach you?
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        <Field label="Your name *">
          <input
            required value={form.name} onChange={set("name")}
            name="name" autoComplete="name"
            placeholder="Jane Smith"
            className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm text-ink placeholder:text-ink-muted"
            data-testid="co-name"
          />
        </Field>
        <Field label="Email address *">
          <input
            required type="email" value={form.email} onChange={set("email")}
            name="email" autoComplete="email"
            placeholder="jane@example.com"
            className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm text-ink placeholder:text-ink-muted"
            data-testid="co-email"
          />
        </Field>
        <Field label="Phone (optional)" full>
          <input
            type="tel" value={form.phone} onChange={set("phone")}
            name="phone" autoComplete="tel"
            placeholder="(555) 123-4567"
            className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm text-ink placeholder:text-ink-muted"
            data-testid="co-phone"
          />
        </Field>
      </div>

      {/* Order summary */}
      <div className="border border-line bg-paper p-6 mt-10" data-testid="co-summary">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted mb-4">Order Summary</div>
        <dl className="grid grid-cols-[100px_1fr] gap-y-3 gap-x-6 font-mono text-xs">
          <SummaryRow label="Type" value={summary.type} />
          <SummaryRow label="Material" value={summary.material} />
          <SummaryRow label="Dimensions" value={summary.size} />
          <SummaryRow label="Quantity" value={summary.quantity} />
          <SummaryRow label="Budget" value={summary.budget} />
          <SummaryRow label="Timeline" value={summary.timeline} />
          <SummaryRow label="Maker" value={summary.maker} />
          <SummaryRow label="Design" value={summary.design} />
        </dl>
      </div>

      <div className="mt-6">
        <PolicyConsent consent={consent} testId="custom-order-policy" />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <>
      <dt className="text-ink-muted uppercase tracking-[0.22em] text-[10px]">{label}</dt>
      <dd className="text-ink">{value || "—"}</dd>
    </>
  );
}

// ============================================================
//  Shared bits
// ============================================================
function Headline({ eyebrow, title }) {
  return (
    <div className="mb-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-muted mb-3">
        {eyebrow}
      </div>
      <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-[0.92] tracking-[-0.01em]">
        {title}
      </h1>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-muted">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

// ============================================================
//  Wizard shell
// ============================================================
export default function CustomOrderPage() {
  useStructuredData({
    title: "Custom Orders · CNC, Wood, Metal & 3D Printing · Crafters Market",
    description: "Get a free custom quote for one-of-a-kind CNC art, custom signs, 3D-printed pieces, monograms, and bespoke gifts. Five-step brief, free quote in 24h, no commitment.",
    url: "https://craftersmarket.org/custom-order",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Custom Order — Crafters Market",
      provider: { "@id": "https://craftersmarket.org/#org" },
      areaServed: { "@type": "Country", name: "United States" },
      serviceType: "Custom CNC, woodworking, metal, and 3D-printing fabrication",
    },
  });

  const consent = usePolicyConsent();
  const [searchParams] = useSearchParams();
  // `?ref={slug}` deep-link from the homepage Featured Builds rail.
  // Lands on Step 2 with the description pre-seeded with a reference
  // link so the maker brief starts in motion the moment the visitor
  // arrives — minimum friction between "I want one of those" and the
  // form. Slug is sanitized before being woven into the textarea so a
  // malicious ?ref= can't render HTML/JS.
  const refSlug = (searchParams.get("ref") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 80);
  const [step, setStep] = useState(refSlug ? 2 : 1);
  const [form, setForm] = useState({
    project_type: refSlug ? "Wall Art" : "",
    description: refSlug
      ? `I'm interested in something inspired by this featured example: https://craftersmarket.org/shop/${refSlug}\n\nPlease tell us the size, finish, customizations, and any deadline.`
      : "",
    material: "",
    size: "",
    quantity: "1",
    budget: "",
    timeline: "Flexible",
    preferred_maker_slug: null,
    name: "",
    email: "",
    phone: "",
    design_file_url: "",
    design_file_name: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const stepValid = (s) => {
    if (s === 1) return !!form.project_type;
    if (s === 2) return !!form.description.trim();
    if (s === 3) return true;  // null is "any maker" — also valid
    if (s === 4) return true;  // upload optional
    if (s === 5) return !!form.name.trim() && /\S+@\S+/.test(form.email) && consent.accepted;
    return false;
  };

  const next = () => {
    if (!stepValid(step)) {
      toast.error("Fill the required fields before continuing.");
      return;
    }
    setStep((s) => Math.min(s + 1, 5));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const back = () => {
    setStep((s) => Math.max(s - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    if (!stepValid(5)) {
      toast.error(consent.accepted
        ? "Add your name and a valid email."
        : "Please review and accept the Site Policies to submit.");
      return;
    }
    setSubmitting(true);
    try {
      await submitCustomOrder({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone || null,
        project_type: form.project_type,
        material: form.material || "Any",
        size: form.size || null,
        budget: form.budget || null,
        description: form.description.trim(),
        quantity: form.quantity,
        timeline: form.timeline,
        preferred_maker_slug: form.preferred_maker_slug || null,
        design_file_url: form.design_file_url || null,
        design_file_name: form.design_file_name || null,
        policy_accepted: true,
        policy_version: consent.version,
      });
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      // iter413ac — Google Ads `lead_custom_order` conversion. Budget
      // band is the highest-signal qualifier we have at this stage so
      // it's surfaced as event_label for Ads bidding optimization.
      try {
        trackConversion("lead_custom_order", {
          event_label: form.budget || "unspecified",
          value: 1,
        });
      } catch { /* analytics best-effort */ }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="pt-40 pb-24 grain min-h-screen text-center px-4" data-testid="custom-order-done">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">◆ Order Received</div>
        <h1 className="font-display text-6xl md:text-8xl mb-6">We've Got It.</h1>
        <p className="font-mono text-sm text-ink-muted max-w-md mx-auto">
          Expect a free quote in your inbox within 24 hours. Until then — keep dreaming up sharp things.
        </p>
      </div>
    );
  }

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="custom-order-page">
      <div className="w-full max-w-[1100px] mx-auto px-4 md:px-8">
        <Stepper current={step} />

        {step === 1 && (
          <StepCategory
            value={form.project_type}
            onPick={(c) => {
              setForm({
                ...form,
                project_type: c.id,
                material: form.material && c.materials.includes(form.material) ? form.material : "",
              });
            }}
          />
        )}
        {step === 2 && <StepDescribe category={form.project_type} form={form} setForm={setForm} />}
        {step === 3 && (
          <StepMaker
            value={form.preferred_maker_slug}
            onPick={(slug) => setForm({ ...form, preferred_maker_slug: slug })}
            description={form.description}
            projectType={form.project_type}
          />
        )}
        {step === 4 && (
          <StepUpload
            value={form.design_file_url ? { url: form.design_file_url, name: form.design_file_name } : null}
            onPick={(file) => setForm({
              ...form,
              design_file_url: file?.url || "",
              design_file_name: file?.name || "",
            })}
          />
        )}
        {step === 5 && (
          <StepContact
            form={form}
            setForm={setForm}
            consent={consent}
            summary={{
              type: form.project_type,
              material: form.material || "Any / Maker's choice",
              size: form.size,
              quantity: form.quantity,
              budget: form.budget,
              timeline: form.timeline,
              maker: form.preferred_maker_slug || "Any maker",
              design: form.design_file_name || "None — described in brief",
            }}
          />
        )}

        {/* Footer nav — sticky so the Continue button follows the user
            through every step (each "window" always has a visible CTA).
            Backdrop blur + solid fallback keeps content legible behind. */}
        <div className="sticky bottom-0 -mx-4 md:-mx-8 mt-16 z-30 bg-paper/95 supports-[backdrop-filter]:bg-paper/80 backdrop-blur-md border-t border-line">
          <div className="flex items-center justify-between gap-4 px-4 md:px-8 py-4">
            <button
              type="button"
              onClick={back}
              disabled={step === 1}
              className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand disabled:opacity-30 disabled:hover:text-ink-muted transition"
              data-testid="co-back"
            >
              <ArrowLeft size={14} /> Back
            </button>

            <div className="hidden sm:block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Step {step} of 5
            </div>

            {step < 5 ? (
              <button
                type="button"
                onClick={next}
                disabled={!stepValid(step)}
                className="btn-industrial btn-primary disabled:opacity-50 flex items-center gap-2"
                data-testid="co-next"
              >
                Continue <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !stepValid(5)}
                className="btn-industrial btn-primary disabled:opacity-50 flex items-center gap-2"
                data-testid="co-submit"
              >
                {submitting ? "Submitting…" : "Submit Order"} <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// -------------------- ComingSoonCard --------------------
// Captures email signups against the teased categories (Neon & Light,
// Furniture). Three states: idle card → expanded with email input → done.
function ComingSoonCard({ category }) {
  const Icon = category.icon;
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const slugId = category.id.replace(/[\s/]/g, "-").toLowerCase();

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/coming-soon/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), category: category.id }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data.ok) {
        setDone(true);
        toast(`On the list for ${category.id}.`, { description: "We'll ping you when it goes live." });
      } else {
        toast.error("That doesn't look like a valid email.");
      }
    } catch {
      toast.error("Couldn't subscribe. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div
        className="text-left border border-brand/40 bg-gradient-to-br from-[#1a0a05] to-[#0f0f0f] p-6 relative"
        data-testid={`category-card-coming-soon-${slugId}-done`}
      >
        <span className="absolute top-3 right-3 font-mono text-[9px] uppercase tracking-[0.22em] px-2 py-0.5 border border-brand/40 text-brand bg-brand/10">
          On the list
        </span>
        <div className="w-12 h-12 flex items-center justify-center mb-5 bg-brand/15 text-brand">
          <Icon size={20} />
        </div>
        <div className="font-display text-2xl mb-2 leading-tight text-ink">{category.id}</div>
        <div className="font-mono text-xs text-ink-muted mb-1 leading-relaxed">
          You'll be the first to hear when this ships.
        </div>
      </div>
    );
  }

  return (
    <div
      className={`text-left border ${open ? "border-brand/60" : "border-dashed border-line"} bg-paper/70 p-6 ${open ? "" : "opacity-70 hover:opacity-95 hover:border-line"} transition-all duration-200 relative`}
      data-testid={`category-card-coming-soon-${slugId}`}
    >
      <span className="absolute top-3 right-3 font-mono text-[9px] uppercase tracking-[0.22em] px-2 py-0.5 border border-brand/40 text-brand/80 bg-brand/5">
        Coming Soon
      </span>
      <div className="w-12 h-12 flex items-center justify-center mb-5 bg-surface text-ink-muted">
        <Icon size={20} />
      </div>
      <div className="font-display text-2xl mb-2 leading-tight text-ink-muted">{category.id}</div>
      <div className="font-mono text-xs text-ink-muted mb-3 leading-relaxed">{category.blurb}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand/60 italic mb-4">
        ◇ {category.tease}
      </div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand hover:text-brand-hover transition border-b border-brand/40 pb-1"
          data-testid={`coming-soon-notify-btn-${slugId}`}
        >
          Notify me →
        </button>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2" data-testid={`coming-soon-form-${slugId}`}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            disabled={busy}
            maxLength={200}
            className="bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-muted"
            data-testid={`coming-soon-email-${slugId}`}
            autoFocus
          />
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="btn-industrial btn-primary font-mono text-[10px] uppercase tracking-[0.22em] py-2 disabled:opacity-50"
            data-testid={`coming-soon-submit-${slugId}`}
          >
            {busy ? "Saving…" : "Add me to the list"}
          </button>
        </form>
      )}
    </div>
  );
}
