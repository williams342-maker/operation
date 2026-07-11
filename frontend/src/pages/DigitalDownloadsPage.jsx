/**
 * iter454 — Digital Downloads marketplace landing (SEO destination).
 * Curated collections (SVG, Laser, CNC, 3D-Print, PDFs, eBooks …) with
 * live counts + sample products, all deep-linking into /shop?type=digital.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, ArrowUpRight } from "lucide-react";
import { http } from "../lib/api";

const GROUP_QUERY = {
  "svg-files": "svg", "laser-files": "laser", "cnc-files": "cnc",
  "3d-print-files": "3d", "embroidery-patterns": "embroidery",
  "woodworking-plans": "plans", "printable-pdfs": "printable",
  "ebooks": "ebook", "audiobooks": "audio",
};

export default function DigitalDownloadsPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    document.title = "Digital Downloads — SVG, Laser, CNC & 3D Print Files | Crafters Market";
    const meta = document.querySelector('meta[name="description"]');
    const prev = meta?.getAttribute("content");
    meta?.setAttribute("content",
      "Instant-download digital files from American makers — SVG cut files, laser & CNC files, 3D print models, woodworking plans, printable PDFs, eBooks and more.");
    http.get("/digital-downloads/summary").then((r) => setData(r.data)).catch(() => setData({ groups: [] }));
    return () => { if (prev) meta?.setAttribute("content", prev); };
  }, []);

  return (
    <div className="pt-32 pb-24 min-h-screen grain" data-testid="digital-downloads-page">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-12 max-w-2xl">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ Instant delivery · buy once, download forever
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl text-ink mb-4">
            Digital Downloads.
          </h1>
          <p className="font-mono text-xs text-ink-muted leading-relaxed">
            Cut files, print files, plans and patterns made by real American
            makers. Files arrive the moment payment clears — and stay in your
            library forever.
          </p>
          <div className="mt-6 flex gap-3 flex-wrap">
            <Link to="/shop?type=digital" className="btn-industrial btn-primary inline-flex items-center gap-2"
                  data-testid="digital-browse-all-btn">
              <Download size={14} /> Browse all digital products
            </Link>
            {data && (
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted self-center">
                {data.total_digital || 0} live digital listing{data.total_digital === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        {!data ? (
          <p className="font-mono text-xs text-ink-muted">Loading collections…</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="digital-groups-grid">
            {data.groups.map((g) => (
              <Link key={g.key}
                    to={g.count > 0 ? `/shop?type=digital&q=${GROUP_QUERY[g.key] || ""}` : "/shop?type=digital"}
                    className="group border border-line hover:border-brand bg-paper p-5 transition flex flex-col"
                    data-testid={`digital-group-${g.key}`}>
                <div className="flex items-start justify-between mb-2">
                  <h2 className="font-display text-2xl text-ink group-hover:text-brand transition">{g.label}</h2>
                  <ArrowUpRight size={16} className="text-ink-muted group-hover:text-brand transition shrink-0 mt-1" />
                </div>
                <p className="font-mono text-[10px] text-ink-muted leading-relaxed mb-3 flex-1">{g.blurb}</p>
                {g.samples.length > 0 && (
                  <div className="flex gap-1.5 mb-3">
                    {g.samples.map((s) => s.image && (
                      <img key={s.slug} src={s.image} alt={s.title}
                           className="w-12 h-12 object-cover border border-line" loading="lazy" />
                    ))}
                  </div>
                )}
                <span className={`font-mono text-[9px] uppercase tracking-[0.18em] ${g.count > 0 ? "text-brand" : "text-ink-muted"}`}>
                  {g.count > 0 ? `${g.count} listing${g.count === 1 ? "" : "s"} →` : "Coming soon — makers are uploading"}
                </span>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-16 border border-line/70 p-6 max-w-3xl" data-testid="digital-how-it-works">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand mb-4">◆ How it works</h2>
          <ol className="space-y-2 font-mono text-xs text-ink-muted leading-relaxed list-decimal list-inside">
            <li>Buy a digital listing — no shipping, no waiting.</li>
            <li>Download links appear instantly on your confirmation page + email.</li>
            <li>Your files live in <Link to="/purchases" className="text-brand hover:underline">My Downloads</Link> forever — re-download anytime, on any device.</li>
            <li>Every file is security-scanned before it reaches you.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
