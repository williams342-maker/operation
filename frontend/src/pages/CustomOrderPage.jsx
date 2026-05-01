import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Layers, FileText, Flame, Zap, Star, Package, Box,
  Search, CheckCircle2, Upload as UploadIcon, ArrowLeft, ArrowRight,
} from "lucide-react";
import {
  fetchMakers, submitCustomOrder, uploadCustomOrderDesign,
} from "../lib/api";
import { useStructuredData } from "../lib/seo";
import PolicyConsent, { usePolicyConsent } from "../components/PolicyConsent";

// ============================================================
//  Category catalog — 7 piece types incl. 3D Printing
// ============================================================
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
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2 truncate">
              {s.label}
            </div>
            <div className="relative flex items-center">
              <div
                className={`w-9 h-9 flex items-center justify-center font-mono text-xs ${
                  done
                    ? "bg-[#ff4500] text-[#0a0a0a]"
                    : active
                    ? "bg-[#1a1a1a] text-[#ff4500] border border-[#ff4500]"
                    : "bg-transparent text-[#525252] border border-[#262626]"
                }`}
                data-testid={`step-marker-${s.id}`}
              >
                {done ? <CheckCircle2 size={16} /> : s.id}
              </div>
              <div className={`flex-1 h-px ml-2 ${done ? "bg-[#ff4500]" : "bg-[#262626]"}`} />
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
      <p className="font-mono text-sm text-[#a3a3a3] max-w-2xl mb-10">
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
                  ? "border-[#ff4500] bg-[#1a0a05]"
                  : "border-[#262626] hover:border-[#525252] bg-[#0f0f0f]"
              }`}
              data-testid={`category-card-${c.id.replace(/[\s/]/g, "-").toLowerCase()}`}
            >
              <div
                className={`w-12 h-12 flex items-center justify-center mb-5 ${
                  selected ? "bg-[#ff4500] text-[#0a0a0a]" : "bg-[#1a1a1a] text-[#ff4500]"
                }`}
              >
                <Icon size={20} />
              </div>
              <div className="font-display text-2xl mb-2 leading-tight">{c.id}</div>
              <div className="font-mono text-xs text-[#a3a3a3] mb-5 leading-relaxed">{c.blurb}</div>
              <div className="flex flex-wrap gap-2">
                {c.materials.map((m) => (
                  <span
                    key={m}
                    className="font-mono text-[10px] uppercase tracking-[0.22em] px-2.5 py-1 border border-[#262626] text-[#a3a3a3]"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
        {/* Coming-soon teasers — disabled cards rounding out the grid
            to a clean 3×3. Clicking them does nothing except a
            gentle toast so users know we're listening. */}
        {COMING_SOON.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toast(`${c.id} — ${c.tease}`, { description: "We'll ping you when it's live." })}
              className="text-left border border-dashed border-[#262626] bg-[#0a0a0a]/70 p-6 opacity-60 hover:opacity-90 hover:border-[#525252] transition-all duration-200 relative cursor-pointer"
              data-testid={`category-card-coming-soon-${c.id.replace(/[\s/]/g, "-").toLowerCase()}`}
            >
              <span className="absolute top-3 right-3 font-mono text-[9px] uppercase tracking-[0.22em] px-2 py-0.5 border border-[#ff4500]/40 text-[#ff4500]/80 bg-[#ff4500]/5">
                Coming Soon
              </span>
              <div className="w-12 h-12 flex items-center justify-center mb-5 bg-[#1a1a1a] text-[#525252]">
                <Icon size={20} />
              </div>
              <div className="font-display text-2xl mb-2 leading-tight text-[#a3a3a3]">{c.id}</div>
              <div className="font-mono text-xs text-[#525252] mb-5 leading-relaxed">{c.blurb}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]/60 italic">
                ◇ {c.tease}
              </div>
            </button>
          );
        })}
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
      <p className="font-mono text-sm text-[#a3a3a3] max-w-2xl mb-10">
        Tell us about your{" "}
        <span className="text-[#ff4500]">{category}</span>. The more detail you
        give, the better makers can quote and plan your project.
      </p>

      <Field label="Describe your vision *" full>
        <textarea
          required rows={6} value={form.description} onChange={set("description")}
          placeholder="Describe what you want — size, style, text, finish, purpose, reference images…"
          className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none p-4 font-mono text-sm text-[#e5e5e5] placeholder:text-[#525252] resize-none"
          data-testid="co-description"
        />
      </Field>

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <Field label="Preferred material">
          <select
            value={form.material} onChange={set("material")}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm text-[#e5e5e5]"
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
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm text-[#e5e5e5] placeholder:text-[#525252]"
            data-testid="co-size"
          />
        </Field>

        <Field label="Quantity">
          <select
            value={form.quantity} onChange={set("quantity")}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm text-[#e5e5e5]"
            data-testid="co-quantity"
          >
            {QUANTITIES.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </Field>

        <Field label="Budget range">
          <select
            value={form.budget} onChange={set("budget")}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm text-[#e5e5e5]"
            data-testid="co-budget"
          >
            {BUDGETS.map((b) => <option key={b} value={b === BUDGETS[0] ? "" : b}>{b}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3] mb-3">Timeline</div>
        <div className="flex flex-wrap gap-2">
          {TIMELINES.map((t) => (
            <button
              key={t} type="button"
              onClick={() => setForm({ ...form, timeline: t })}
              className={`font-mono text-[11px] uppercase tracking-[0.22em] px-4 py-2 border transition ${
                form.timeline === t
                  ? "bg-[#ff4500] text-[#0a0a0a] border-[#ff4500]"
                  : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500]"
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
function StepMaker({ value, onPick }) {
  const [makers, setMakers] = useState([]);
  const [q, setQ] = useState("");
  const [specialty, setSpecialty] = useState("");

  useEffect(() => {
    fetchMakers().then(setMakers).catch(() => {});
  }, []);

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
      <p className="font-mono text-sm text-[#a3a3a3] max-w-2xl mb-10">
        Pick a specific maker to send your request to — or leave it open and
        we'll match you with the best fit.
      </p>

      {/* Filters */}
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <div className="relative">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#525252]" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search makers by name, specialty, location…"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none pl-10 pr-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-[#e5e5e5] placeholder:text-[#525252]"
            data-testid="co-maker-search"
          />
        </div>
        <select
          value={specialty} onChange={(e) => setSpecialty(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-xs uppercase tracking-[0.18em] text-[#e5e5e5]"
          data-testid="co-maker-specialty"
        >
          <option value="">All Specialties</option>
          {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Let Any Maker Respond — featured */}
      <button
        type="button"
        onClick={() => onPick(null)}
        className={`w-full text-left border p-6 mb-6 flex items-center gap-5 transition ${
          value === null
            ? "border-[#ff4500] bg-[#1a0a05]"
            : "border-[#262626] hover:border-[#525252] bg-[#0f0f0f]"
        }`}
        data-testid="co-maker-any"
      >
        <div className={`w-12 h-12 flex items-center justify-center ${
          value === null ? "bg-[#ff4500] text-[#0a0a0a]" : "bg-[#1a1a1a] text-[#ff4500]"
        }`}>
          <Star size={20} />
        </div>
        <div className="flex-1">
          <div className="font-display text-2xl">Let Any Maker Respond</div>
          <div className="font-mono text-xs text-[#a3a3a3] mt-1">
            Post to all makers — we'll match you with the best fit
          </div>
        </div>
        {value === null && <CheckCircle2 size={22} className="text-[#ff4500]" />}
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
                  ? "border-[#ff4500] bg-[#1a0a05]"
                  : "border-[#262626] hover:border-[#525252] bg-[#0f0f0f]"
              }`}
              data-testid={`co-maker-${m.slug}`}
            >
              <div className="flex items-start gap-4 mb-3">
                <div className="w-12 h-12 rounded-full border border-[#262626] flex items-center justify-center font-mono text-sm text-[#a3a3a3] flex-shrink-0">
                  {initials || "M"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-xl truncate">{m.name}</div>
                  <div className="font-mono text-[11px] text-[#a3a3a3] mt-1">◇ {m.location || "—"}</div>
                </div>
                {selected && <CheckCircle2 size={20} className="text-[#ff4500] flex-shrink-0" />}
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {(m.specialties || []).slice(0, 2).map((s) => (
                  <span key={s} className="font-mono text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 bg-[#1a1a1a] text-[#a3a3a3]">
                    {s}
                  </span>
                ))}
              </div>
              {m.bio && <p className="font-mono text-[11px] text-[#525252] mt-2 line-clamp-2">{m.bio}</p>}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="md:col-span-2 text-center py-12 font-mono text-xs text-[#525252]">
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
      <p className="font-mono text-sm text-[#a3a3a3] max-w-2xl mb-10">
        Upload your design file, sketch, or reference image. Supported formats:
        {" "}<span className="text-[#ff4500]">JPG · PNG · SVG · PDF · DXF</span> — max 10 MB.
      </p>

      {value ? (
        <div className="border border-[#262626] p-8 text-center" data-testid="co-upload-success">
          <CheckCircle2 size={40} className="mx-auto text-emerald-400 mb-4" />
          <div className="font-display text-2xl mb-2">Design uploaded</div>
          <div className="font-mono text-xs text-[#a3a3a3] mb-6 break-all">{value.name}</div>
          <div className="flex gap-3 justify-center">
            <a
              href={value.url} target="_blank" rel="noreferrer"
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-sky-400 hover:text-sky-300"
            >
              ↗ View file
            </a>
            <button
              type="button"
              onClick={() => onPick(null)}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
              data-testid="co-upload-replace"
            >
              ✕ Replace
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor="co-upload-input"
          className="block border-2 border-dashed border-[#262626] hover:border-[#ff4500] transition cursor-pointer p-12 md:p-16 text-center"
          data-testid="co-upload-zone"
        >
          <div className="w-16 h-16 mx-auto mb-5 flex items-center justify-center bg-[#1a1a1a] text-[#ff4500]">
            <UploadIcon size={24} />
          </div>
          <div className="font-display text-2xl mb-1">
            {uploading ? "Uploading…" : "Drop your file here"}
          </div>
          <div className="font-mono text-xs text-[#a3a3a3] mb-4">or click to browse</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
            JPG · PNG · SVG · PDF · DXF · Max 10 MB
          </div>
          <input
            id="co-upload-input"
            type="file"
            accept=".jpg,.jpeg,.png,.svg,.pdf,.dxf,.webp"
            onChange={(e) => handleFile(e.target.files?.[0])}
            disabled={uploading}
            className="hidden"
          />
        </label>
      )}

      <p className="font-mono text-[11px] text-[#525252] mt-6 italic">
        No design file? No problem — you can describe everything in words and the maker will work with you from there.
      </p>
    </div>
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
      <p className="font-mono text-sm text-[#a3a3a3] max-w-2xl mb-10">
        Almost there — how should the maker reach you?
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        <Field label="Your name *">
          <input
            required value={form.name} onChange={set("name")}
            name="name" autoComplete="name"
            placeholder="Jane Smith"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm text-[#e5e5e5] placeholder:text-[#525252]"
            data-testid="co-name"
          />
        </Field>
        <Field label="Email address *">
          <input
            required type="email" value={form.email} onChange={set("email")}
            name="email" autoComplete="email"
            placeholder="jane@example.com"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm text-[#e5e5e5] placeholder:text-[#525252]"
            data-testid="co-email"
          />
        </Field>
        <Field label="Phone (optional)" full>
          <input
            type="tel" value={form.phone} onChange={set("phone")}
            name="phone" autoComplete="tel"
            placeholder="(555) 123-4567"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm text-[#e5e5e5] placeholder:text-[#525252]"
            data-testid="co-phone"
          />
        </Field>
      </div>

      {/* Order summary */}
      <div className="border border-[#262626] bg-[#0f0f0f] p-6 mt-10" data-testid="co-summary">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#a3a3a3] mb-4">Order Summary</div>
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
      <dt className="text-[#525252] uppercase tracking-[0.22em] text-[10px]">{label}</dt>
      <dd className="text-[#e5e5e5]">{value || "—"}</dd>
    </>
  );
}

// ============================================================
//  Shared bits
// ============================================================
function Headline({ eyebrow, title }) {
  return (
    <div className="mb-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#525252] mb-3">
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
      <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">{label}</span>
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
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    project_type: "",
    description: "",
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
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="pt-40 pb-24 grain min-h-screen text-center px-4" data-testid="custom-order-done">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ Order Received</div>
        <h1 className="font-display text-6xl md:text-8xl mb-6">We've Got It.</h1>
        <p className="font-mono text-sm text-[#a3a3a3] max-w-md mx-auto">
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
        <div className="sticky bottom-0 -mx-4 md:-mx-8 mt-16 z-30 bg-[#0a0a0a]/95 supports-[backdrop-filter]:bg-[#0a0a0a]/80 backdrop-blur-md border-t border-[#262626]">
          <div className="flex items-center justify-between gap-4 px-4 md:px-8 py-4">
            <button
              type="button"
              onClick={back}
              disabled={step === 1}
              className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] disabled:opacity-30 disabled:hover:text-[#a3a3a3] transition"
              data-testid="co-back"
            >
              <ArrowLeft size={14} /> Back
            </button>

            <div className="hidden sm:block font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
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
