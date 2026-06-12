import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { http } from "../lib/api";
import { useStructuredData } from "../lib/seo";
import Breadcrumbs from "../components/Breadcrumbs";
import { Download, Check, Loader2, ArrowRight } from "lucide-react";

const SITE_URL = "https://craftersmarket.org";

/**
 * FreeSvgPackPage (iter303 / Phase 4 Bundle C)
 * --------------------------------------------
 * Lead magnet — free CNC starter pack of SVG + DXF design files.
 *
 * SEO-friendly soft gate:
 *   • Entire page is publicly indexable (file list, previews, copy).
 *   • Only the actual ZIP download requires email submission.
 *
 * Schema:
 *   • CreativeWork → the starter pack as a downloadable asset
 *   • BreadcrumbList → Home › Free SVG Pack
 *   • FAQPage → 5-question FAQ accordion
 *   • HowTo → "how to use these files" 4-step guide
 *
 * Backend flow:
 *   POST /api/lead-magnet/starter-pack/subscribe → { download_url }
 *   GET  /api/lead-magnet/starter-pack/download/<token> → ZIP stream
 */

const FAQS = [
  {
    q: "Are these files really free? What's the catch?",
    a: "Yes, free — for personal AND commercial use. We built Crafters Market to support independent makers, and giving away a starter pack is the fastest way to introduce ourselves to people running CNC tables, laser engravers, and routers. The only thing we ask is your email so we can send the link to your inbox (and very occasionally, drop you a note about new free packs or features). No spam, no resale, no fine print.",
  },
  {
    q: "What formats are included?",
    a: "Every design ships in two formats: SVG (vector — opens in Illustrator, Inkscape, LightBurn, Fusion 360, basically anything that handles vector art) and DXF (CAD/CAM — drops straight into Fusion 360, Sheetcam, Mach3, LightBurn, and almost every plasma/laser/router controller on the market). Each file also has a preview JPG so you can browse the pack visually before opening every design.",
  },
  {
    q: "What machines will these work with?",
    a: "Designed for plasma tables, fiber lasers, CO2 lasers, and CNC routers. The cuts are intentionally tested against common kerf widths (0.060\" to 0.150\" for plasma; 0.005\" to 0.020\" for laser). They scale from 4 inches to 4 feet without losing detail. If you have a Glowforge, xTool, OMTech, Langmuir Crossfire, Plasmacam, Shapeoko, X-Carve, or basically any name-brand CNC machine, these will load and cut cleanly.",
  },
  {
    q: "Can I sell pieces I cut from these designs?",
    a: "Yes, absolutely — the license includes commercial use. Cut them in your home shop, sell at the farmer's market, list them on Etsy, mount them in your storefront. The only restriction is that you can't resell the digital files themselves as your own design pack. (Cutting a sign from the file and selling the physical sign is fine; bundling the SVG into your own \"starter pack\" download is not.)",
  },
  {
    q: "I want a CUSTOM piece, not a starter design. Where do I start?",
    a: "Head to /custom-order — fill out a brief in 3-5 minutes and we'll route it to a vetted American maker who runs the right tooling for your project. Or browse /makers to pick the artisan yourself. Custom pieces usually ship in 2-5 weeks with a written design proof before any cuts get made. The starter pack is the appetizer; the marketplace is the main course.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Drop your email",
    body: "Enter your email below. We'll generate a one-shot download link and reveal it on this page immediately — no clicking through to your inbox.",
  },
  {
    n: "02",
    title: "Download the ZIP (~2 MB)",
    body: "10 designs × 2 formats each = 20 files, plus a README and a preview JPG per design. The whole pack is about 2 MB.",
  },
  {
    n: "03",
    title: "Open in your design tool",
    body: "SVG opens in Illustrator/Inkscape/LightBurn for vector editing. DXF drops into Fusion 360/Sheetcam/your CAM workflow for tool-pathing.",
  },
  {
    n: "04",
    title: "Cut, finish, share",
    body: "Tag @crafters_market1 on Instagram when you post photos — we love seeing what people make. And if you decide you want a fully custom piece, the marketplace is one click away.",
  },
];

export default function FreeSvgPackPage() {
  const [preview, setPreview] = useState(null);
  const [email, setEmail] = useState("");
  const [consentMarketing, setConsentMarketing] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    http.get("/lead-magnet/starter-pack/preview")
      .then((r) => setPreview(r.data))
      .catch(() => setPreview({ files: [], file_count: 10, approx_size_mb: 2.0 }));
  }, []);

  useStructuredData({
    title: "Free CNC Starter Pack — 10 SVG & DXF Designs · Crafters Market",
    description:
      "Download 10 free, commercial-use SVG + DXF designs for plasma tables, fiber lasers, CO2 lasers, and CNC routers. Hand-picked starter files from the Crafters Market design library.",
    url: `${SITE_URL}/free-svg-pack`,
    image: `${SITE_URL}/seed-designs/mountain-range-silhouette/preview.jpg`,
    imageAlt: "Free CNC starter pack — SVG and DXF design files",
    ogType: "article",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "CreativeWork",
          "@id": `${SITE_URL}/free-svg-pack#pack`,
          name: "Crafters Market Free CNC Starter Pack",
          description:
            "10 SVG + DXF designs for plasma, laser, and CNC router. Free for commercial and personal use.",
          url: `${SITE_URL}/free-svg-pack`,
          image: `${SITE_URL}/seed-designs/mountain-range-silhouette/preview.jpg`,
          author: { "@type": "Organization", name: "Crafters Market" },
          license: `${SITE_URL}/free-svg-pack#license`,
          encodingFormat: ["image/svg+xml", "application/dxf"],
          isAccessibleForFree: true,
          inLanguage: "en-US",
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
            { "@type": "ListItem", position: 2, name: "Free SVG Pack", item: `${SITE_URL}/free-svg-pack` },
          ],
        },
        {
          "@type": "FAQPage",
          "@id": `${SITE_URL}/free-svg-pack#faq`,
          mainEntity: FAQS.map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        },
        {
          "@type": "HowTo",
          "@id": `${SITE_URL}/free-svg-pack#howto`,
          name: "How to download and use the Crafters Market starter pack",
          totalTime: "PT2M",
          step: STEPS.map((s, i) => ({
            "@type": "HowToStep",
            position: i + 1,
            name: s.title,
            text: s.body,
          })),
        },
      ],
    },
  });

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !/.+@.+\..+/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await http.post("/lead-magnet/starter-pack/subscribe", {
        email: email.trim(),
        consent_marketing: consentMarketing,
        source: "organic",
        medium: "lead-magnet",
        campaign: "free-svg-pack",
      });
      // Trigger download immediately + reveal the persistent link.
      const url = res.data.download_url;
      setDownloadUrl(url);
      // Auto-start the download — the GET fires the browser's "Save As".
      window.location.href = url;
    } catch (err) {
      setError(err?.response?.data?.detail || "Something went wrong. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pb-24 grain min-h-screen" data-testid="free-svg-pack">
      <div className="w-full max-w-[1400px] mx-auto px-4 md:px-8 pt-16 md:pt-24">
        <Breadcrumbs
          items={[
            { name: "Home", to: "/" },
            { name: "Free SVG Pack" },
          ]}
          testId="lead-magnet-breadcrumbs"
        />
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
          ◆ Free Download · Starter Pack
        </div>
        <h1
          className="font-display text-[44px] sm:text-[64px] md:text-[88px] lg:text-[112px] leading-[0.92] mb-8"
          data-testid="lead-magnet-h1"
        >
          10 Free CNC Designs. SVG &amp; DXF.
        </h1>

        <p className="font-mono text-base text-ink max-w-3xl leading-relaxed mb-4">
          Hand-picked from the Crafters Market design library. Ready for plasma
          tables, fiber lasers, CO2 lasers, and CNC routers. Commercial use
          included — cut them, sell them, modify them.
        </p>
        <p className="font-mono text-sm text-ink-muted max-w-3xl leading-relaxed mb-10">
          Drop your email below and we&apos;ll unlock the ~{preview?.approx_size_mb || 2} MB ZIP
          right here on this page. No fluff, no spam — just the files.
        </p>

        {/* Email gate */}
        <div
          id="download-form"
          className="border border-line bg-paper p-6 md:p-8 max-w-2xl mb-16"
          data-testid="lead-magnet-form-wrap"
        >
          {downloadUrl ? (
            <div data-testid="lead-magnet-success">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-brand grid place-items-center">
                  <Check size={20} className="text-black" strokeWidth={3} />
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
                    ◆ Unlocked
                  </div>
                  <div className="font-display text-2xl">Your pack is downloading.</div>
                </div>
              </div>
              <p className="font-mono text-sm text-ink-muted mb-4 leading-relaxed">
                If the download didn&apos;t start automatically, click below.
                Bookmark this page — the link stays valid so you can come back.
              </p>
              <a
                href={downloadUrl}
                className="btn-industrial btn-primary inline-flex items-center gap-2"
                data-testid="lead-magnet-download-again"
              >
                <Download size={16} /> Download the ZIP
              </a>
            </div>
          ) : (
            <form onSubmit={submit} data-testid="lead-magnet-form">
              <label
                htmlFor="lm-email"
                className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2"
              >
                Email address
              </label>
              <input
                id="lm-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm mb-4"
                data-testid="lead-magnet-email-input"
              />
              <label className="flex items-start gap-2 mb-5 cursor-pointer" data-testid="lead-magnet-consent-wrap">
                <input
                  type="checkbox"
                  checked={consentMarketing}
                  onChange={(e) => setConsentMarketing(e.target.checked)}
                  className="mt-1 accent-[#ff4500]"
                  data-testid="lead-magnet-consent"
                />
                <span className="font-mono text-[11px] text-ink-muted leading-relaxed">
                  Send me occasional updates about new free packs and maker features. (Unsubscribe anytime; no spam.)
                </span>
              </label>
              {error && (
                <div
                  className="mb-4 border border-red-500/40 bg-red-500/5 p-3 font-mono text-[11px] text-red-600"
                  data-testid="lead-magnet-error"
                >
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-60"
                data-testid="lead-magnet-submit"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Unlocking…
                  </>
                ) : (
                  <>
                    <Download size={16} /> Unlock the pack →
                  </>
                )}
              </button>
              <p className="font-mono text-[10px] text-ink-muted mt-4">
                ◆ One-click download · No payment · Commercial use included
              </p>
            </form>
          )}
        </div>

        {/* What's inside — file grid */}
        <div className="border-t border-line pt-12 mb-20">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ Inside the pack
          </div>
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-8">
            {preview?.file_count || 10} designs · 2 formats each
          </h2>
          {!preview ? (
            <div className="font-mono text-sm text-ink-muted">Loading file list…</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {preview.files.map((f, idx) => (
                <div
                  key={idx}
                  className="border border-line bg-paper overflow-hidden"
                  data-testid={`lead-magnet-file-${idx}`}
                >
                  <div className="aspect-square bg-surface overflow-hidden">
                    <img
                      src={f.preview_image}
                      alt={`${f.title} — SVG and DXF design preview`}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-3">
                    <div className="font-display text-sm leading-tight mb-1">
                      {f.title}
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted mb-1">
                      SVG · DXF
                    </div>
                    <div className="font-mono text-[10px] text-ink-muted leading-relaxed line-clamp-2">
                      {f.use_case}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* HowTo */}
        <div className="border-t border-line pt-12 mb-20" data-testid="lead-magnet-howto">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ How to use these files
          </div>
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-10">
            From download to first cut.
          </h2>
          <div className="space-y-10">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="grid grid-cols-[70px_1fr] md:grid-cols-[110px_1fr] gap-6"
                data-testid={`lead-magnet-step-${s.n}`}
              >
                <div className="font-display text-4xl md:text-6xl text-brand leading-none">
                  {s.n}
                </div>
                <div>
                  <h3 className="font-display text-xl md:text-3xl uppercase mb-2">
                    {s.title}
                  </h3>
                  <p className="font-mono text-sm md:text-base text-ink-muted leading-relaxed max-w-2xl">
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="border-t border-line pt-12 mb-20" data-testid="lead-magnet-faq">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ FAQ
          </div>
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-8">
            Common questions
          </h2>
          <div className="max-w-3xl space-y-4">
            {FAQS.map(({ q, a }, idx) => (
              <details
                key={idx}
                className="border border-line bg-paper open:border-brand transition"
                data-testid={`lead-magnet-faq-item-${idx}`}
              >
                <summary className="cursor-pointer list-none p-4 flex items-start justify-between gap-4 font-mono text-sm text-ink hover:text-brand">
                  <span className="flex-1">{q}</span>
                  <span className="font-display text-xl shrink-0">+</span>
                </summary>
                <div className="px-4 pb-4 pt-2 border-t border-line font-mono text-sm text-ink-muted leading-relaxed">
                  {a}
                </div>
              </details>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="border-t border-line pt-12 text-center">
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-4">
            Want a custom piece?
          </h2>
          <p className="font-mono text-sm text-ink-muted max-w-xl mx-auto mb-8 leading-relaxed">
            The starter pack is a great way to break in your machine. When you&apos;re
            ready for something built to your spec by a vetted American maker,
            the marketplace is one click away.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/custom-order" className="btn-industrial btn-primary inline-flex items-center gap-2" data-testid="lead-magnet-cta-custom">
              Start a custom order <ArrowRight size={16} />
            </Link>
            <Link to="/shop" className="btn-industrial btn-secondary">
              Browse the catalog →
            </Link>
            <Link to="/guides/plasma-vs-laser-vs-router" className="btn-industrial btn-secondary">
              Read the CNC guides →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
