import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Download, Search, ShieldCheck, SlidersHorizontal, Store, UploadCloud, X } from "lucide-react";
import { http } from "../lib/api";
import { readConsent } from "../lib/consent";
import ProductCard from "../components/ProductCard";
import { CardSkeleton } from "../components/Skeleton";

const POPULAR = [
  ["SVG", "svg"], ["Laser", "laser"], ["CNC", "cnc"], ["3D Printing", "3d"],
  ["Embroidery", "embroidery"], ["Woodworking", "woodworking"], ["Printable", "printable"], ["eBook", "ebook"],
];

function analyticsAllowed() {
  const c = readConsent();
  return !!c && c.analytics_storage === "granted";
}

function track(event, payload = {}) {
  if (!analyticsAllowed()) return;
  try { http.post("/analytics/events", { event_type: event, path: window.location.pathname, metadata: payload }).catch(() => {}); } catch { /* noop */ }
}

function money(v) {
  const n = Number(v || 0);
  return n <= 0 ? "Free" : `$${n.toFixed(2).replace(/\.00$/, "")}`;
}

function productUrl(p) {
  return `/shop/${p.slug}`;
}

function Badge({ children }) {
  return <span className="border border-line bg-paper px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted">{children}</span>;
}

function ProductRail({ title, products, testId }) {
  if (!products || products.length === 0) return null;
  return (
    <section className="mt-16" data-testid={testId}>
      <div className="flex items-end justify-between gap-4 mb-5">
        <h2 className="font-display text-3xl text-ink">{title}</h2>
        <Link to="/digital-downloads?sort=popularity" className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand hover:underline">Browse catalog</Link>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {products.slice(0, 4).map((p, i) => <ProductCard key={p.slug} p={p} i={i} />)}
      </div>
    </section>
  );
}

function SearchBox({ onChoose }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]); setOpen(false); setBusy(false); return;
    }
    setBusy(true);
    timer.current = setTimeout(() => {
      http.get("/digital-downloads/search", { params: { q, limit: 8 } })
        .then((r) => { setResults(r.data.results || []); setOpen(true); track("digital_search", { query: q }); })
        .catch(() => { setResults([]); setOpen(true); })
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q]);

  const submit = () => {
    const term = q.trim();
    if (!term) return;
    onChoose?.(term);
    navigate(`/digital-downloads?q=${encodeURIComponent(term)}`);
  };

  const choose = (p) => {
    track("digital_search_result_click", { query: q, product_slug: p.slug, maker_slug: p.maker_slug });
    navigate(productUrl(p));
  };

  return (
    <div className="relative max-w-3xl" data-testid="digital-search-box">
      <label className="sr-only" htmlFor="digital-search-input">Search digital downloads</label>
      <div className="flex border border-line bg-paper focus-within:border-brand">
        <Search size={18} className="m-4 text-ink-muted" />
        <input
          id="digital-search-input"
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(-1); }}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (active >= 0 && results[active]) choose(results[active]); else submit();
            } else if (e.key === "ArrowDown") {
              e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); setOpen(true);
            } else if (e.key === "ArrowUp") {
              e.preventDefault(); setActive((i) => Math.max(-1, i - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search SVGs, laser files, plans, patterns, and more"
          className="w-full bg-transparent outline-none py-4 pr-4 font-mono text-sm text-ink placeholder:text-ink-muted"
          role="combobox"
          aria-expanded={open}
          aria-controls="digital-search-results"
          aria-autocomplete="list"
          data-testid="digital-search-input"
        />
        {q && <button type="button" onClick={() => { setQ(""); setResults([]); setOpen(false); }} className="px-3 text-ink-muted hover:text-brand" aria-label="Clear search"><X size={16} /></button>}
      </div>
      {open && (
        <div id="digital-search-results" role="listbox" className="absolute z-30 mt-2 w-full border border-line bg-paper shadow-xl" data-testid="digital-search-results">
          {busy ? <div className="p-4 font-mono text-xs text-ink-muted">Searching...</div> : results.length ? results.map((p, i) => (
            <button
              key={p.slug}
              type="button"
              role="option"
              aria-selected={active === i}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(p)}
              className={`w-full text-left p-3 flex gap-3 hover:bg-surface ${active === i ? "bg-surface" : ""}`}
              data-testid={`digital-search-result-${p.slug}`}
            >
              <img src={p.image || p.images?.[0]} alt="" className="h-14 w-14 object-cover border border-line bg-surface" />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-lg text-ink truncate">{p.title}</span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted truncate">{p.maker_name || "Independent maker"} · {p.category} · {money(p.price)}</span>
                <span className="mt-1 flex flex-wrap gap-1">{(p.file_formats || []).slice(0, 4).map((f) => <Badge key={f}>{f}</Badge>)}</span>
              </span>
            </button>
          )) : <div className="p-4 font-mono text-xs text-ink-muted" data-testid="digital-search-empty">No digital products found. Try SVG, PDF, laser, or printable.</div>}
        </div>
      )}
    </div>
  );
}

export default function DigitalDownloadsPage() {
  const { categorySlug } = useParams();
  const [params, setParams] = useSearchParams();
  const [summary, setSummary] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [sections, setSections] = useState(null);
  const [err, setErr] = useState("");
  const q = params.get("q") || "";
  const format = params.get("format") || "";
  const price = params.get("price") || "all";
  const license = params.get("license") || "";
  const sort = params.get("sort") || "newest";
  const page = Number(params.get("page") || 1);
  const category = categorySlug || params.get("category") || "";

  useEffect(() => {
    document.title = "Digital Downloads | Crafters Market";
    track("digital_landing_view");
    http.get("/digital-downloads/summary").then((r) => setSummary(r.data)).catch(() => setSummary({ groups: [] }));
    http.get("/digital-downloads/sections").then((r) => setSections(r.data)).catch(() => setSections({ sections: {} }));
  }, []);

  useEffect(() => {
    setCatalog(null); setErr("");
    const req = { q: q || undefined, category: category || undefined, format: format || undefined, price, license: license || undefined, sort, page, per_page: 24 };
    http.get("/digital-downloads/catalog", { params: req })
      .then((r) => setCatalog(r.data))
      .catch((e) => { setErr(e?.response?.data?.detail || "Could not load digital products."); setCatalog({ items: [], facets: { formats: [], categories: [] }, total: 0 }); });
    if (category) track("digital_category_view", { category });
  }, [q, category, format, price, license, sort, page]);

  const groups = summary?.groups || [];
  const currentGroup = groups.find((g) => g.key === category);
  const update = (next) => {
    const sp = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => { if (!v || v === "all") sp.delete(k); else sp.set(k, v); });
    sp.delete("page");
    setParams(sp);
  };
  const chips = useMemo(() => POPULAR, []);
  const makerCta = localStorage.getItem("cm_maker_jwt") ? "/maker/dashboard?tab=listings" : "/apply";

  return (
    <div className="pt-32 pb-24 min-h-screen grain" data-testid="digital-downloads-page">
      <div className="max-w-6xl mx-auto px-4">
        <section className="mb-12">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-3">Digital marketplace · secure instant delivery</div>
          <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl text-ink mb-4">Digital Downloads</h1>
          <p className="font-mono text-sm text-ink-muted leading-relaxed max-w-2xl mb-6">Professional files, plans, patterns, and resources from independent makers.</p>
          <SearchBox onChoose={(term) => update({ q: term })} />
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Popular digital searches">
            {chips.map(([label, term]) => (
              <Link key={label} to={`/digital-downloads?q=${encodeURIComponent(term)}`} onClick={() => track("digital_filter_used", { filter: "popular", value: term })} className="border border-line bg-paper hover:border-brand px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-brand" data-testid={`digital-popular-${term}`}>
                {label}
              </Link>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2 text-ink-muted">
            <Badge><Download size={11} className="inline mr-1" />Downloaded after payment</Badge>
            <Badge><ShieldCheck size={11} className="inline mr-1" />Secure file delivery</Badge>
            <Badge>No shipping required for digital-only orders</Badge>
            {summary && <Badge>{summary.total_digital || 0} live listings</Badge>}
          </div>
        </section>

        <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="digital-groups-grid">
          {!summary ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="border border-line bg-paper p-5 h-48 animate-pulse" />) : groups.map((g) => (
            <Link key={g.key} to={g.count > 0 ? `/digital-downloads/category/${g.key}` : makerCta} className="group border border-line hover:border-brand bg-paper p-5 transition flex flex-col" data-testid={`digital-group-${g.key}`}>
              <div className="flex items-start justify-between mb-2">
                <h2 className="font-display text-2xl text-ink group-hover:text-brand transition">{g.label}</h2>
                <ArrowUpRight size={16} className="text-ink-muted group-hover:text-brand transition shrink-0 mt-1" />
              </div>
              <p className="font-mono text-[10px] text-ink-muted leading-relaxed mb-3 flex-1">{g.blurb}</p>
              {g.samples?.length > 0 && <div className="flex gap-1.5 mb-3">{g.samples.map((s) => s.image && <img key={s.slug} src={s.image} alt={s.title} className="w-12 h-12 object-cover border border-line" loading="lazy" />)}</div>}
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted space-y-1">
                <div className={g.count > 0 ? "text-brand" : "text-ink-muted"}>{g.count > 0 ? `${g.count} active listing${g.count === 1 ? "" : "s"}` : "Be the first to upload"}</div>
                {g.new_7d > 0 && <div className="text-emerald-700">{g.new_7d} new this week</div>}
                <div>{g.count > 0 ? "Browse category" : "Start selling digital products"}</div>
              </div>
            </Link>
          ))}
        </section>

        <section className="mt-16 border-y border-line py-8" data-testid="digital-catalog-section">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-5">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand mb-2"><SlidersHorizontal size={12} className="inline mr-1" /> Catalog</div>
              <h2 className="font-display text-3xl text-ink">{currentGroup?.label || (q ? `Results for ${q}` : "Browse Digital Products")}</h2>
            </div>
            <div className="grid grid-cols-2 md:flex gap-2">
              <select aria-label="File format" value={format} onChange={(e) => { update({ format: e.target.value }); track("digital_filter_used", { filter: "format", value: e.target.value }); }} className="bg-paper border border-line px-3 py-2 font-mono text-xs">
                <option value="">All formats</option>
                {(catalog?.facets?.formats || []).map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <select aria-label="Price" value={price} onChange={(e) => { update({ price: e.target.value }); track("digital_filter_used", { filter: "price", value: e.target.value }); }} className="bg-paper border border-line px-3 py-2 font-mono text-xs">
                <option value="all">All prices</option><option value="free">Free</option><option value="paid">Paid</option>
              </select>
              <select aria-label="License" value={license} onChange={(e) => { update({ license: e.target.value }); track("digital_filter_used", { filter: "license", value: e.target.value }); }} className="bg-paper border border-line px-3 py-2 font-mono text-xs">
                <option value="">All licenses</option><option value="personal">Personal use</option><option value="commercial">Commercial use</option>
              </select>
              <select aria-label="Sort" value={sort} onChange={(e) => update({ sort: e.target.value })} className="bg-paper border border-line px-3 py-2 font-mono text-xs">
                <option value="newest">Newest</option><option value="popularity">Popularity</option><option value="rating">Rating</option><option value="price_asc">Price low to high</option><option value="price_desc">Price high to low</option>
              </select>
            </div>
          </div>
          {err && <div className="border border-red-300 bg-red-50 p-3 font-mono text-xs text-red-700 mb-4" data-testid="digital-catalog-error">{err}</div>}
          {!catalog ? <CardSkeleton count={8} /> : catalog.items.length === 0 ? (
            <div className="border border-line bg-paper p-6 font-mono text-xs text-ink-muted" data-testid="digital-catalog-empty">No digital products match these filters. Clear a filter or start with a popular search.</div>
          ) : (
            <>
              <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">{catalog.total} result{catalog.total === 1 ? "" : "s"}</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="digital-catalog-grid">
                {catalog.items.map((p, i) => <div key={p.slug} onClick={() => track("digital_product_click", { product_slug: p.slug, maker_slug: p.maker_slug })}><ProductCard p={p} i={i} /></div>)}
              </div>
            </>
          )}
        </section>

        {sections?.featured_collections?.length > 0 && (
          <section className="border border-line bg-paper p-4" data-testid="digital-featured-collections">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand mb-3">Featured Collections</div>
            <div className="flex flex-wrap gap-2">
              {sections.featured_collections.map((c) => <Link key={c.href} to={c.href} className="btn-secondary text-xs">{c.label}</Link>)}
            </div>
          </section>
        )}
        <ProductRail title="Trending Digital Downloads" products={sections?.sections?.trending} testId="digital-trending-section" />
        <ProductRail title="New This Week" products={sections?.sections?.new_this_week} testId="digital-new-week-section" />
        <ProductRail title="Popular Laser & CNC Files" products={sections?.sections?.laser_cnc} testId="digital-laser-cnc-section" />
        <ProductRail title="Printable Projects" products={sections?.sections?.printable_projects} testId="digital-printable-section" />
        <ProductRail title="Staff Picks" products={sections?.sections?.staff_picks} testId="digital-staff-picks-section" />
        <ProductRail title="Free Downloads" products={sections?.sections?.free_downloads} testId="digital-free-downloads-section" />
        <ProductRail title="Recently Updated" products={sections?.sections?.recently_updated} testId="digital-recently-updated-section" />
        <ProductRail title="Recommended for You" products={sections?.sections?.recommended_for_you} testId="digital-recommended-section" />
        <ProductRail title="Bundle Highlights" products={sections?.sections?.bundle_highlights} testId="digital-bundles-section" />

        {sections?.featured_creator && (
          <section className="mt-16 border border-line bg-paper p-6" data-testid="digital-featured-creator">
            <div className="grid md:grid-cols-[160px,1fr] gap-5 items-center">
              <img src={sections.featured_creator.maker.portrait || sections.featured_creator.maker.cover} alt="" className="w-full aspect-square object-cover border border-line bg-surface" />
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand mb-2">Featured Digital Creator</div>
                <h2 className="font-display text-3xl text-ink">{sections.featured_creator.maker.name}</h2>
                <p className="font-mono text-xs text-ink-muted leading-relaxed mt-2 max-w-2xl">{sections.featured_creator.maker.bio || `${sections.featured_creator.digital_count} active digital products available now.`}</p>
                <Link to={`/makers/${sections.featured_creator.maker.slug}`} onClick={() => track("digital_store_click", { maker_slug: sections.featured_creator.maker.slug })} className="btn-industrial btn-primary inline-flex items-center gap-2 mt-4"><Store size={14} /> View maker store</Link>
              </div>
            </div>
          </section>
        )}

        <section className="mt-16 border border-line bg-paper p-6 md:p-8" data-testid="digital-seller-cta">
          <div className="grid md:grid-cols-[1fr,auto] gap-5 items-center">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand mb-2">For makers</div>
              <h2 className="font-display text-3xl text-ink">Sell Your Digital Creations</h2>
              <p className="font-mono text-xs text-ink-muted leading-relaxed mt-2">Upload files, set your license, and reach buyers looking for ready-to-make projects.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={makerCta} onClick={() => track("digital_seller_cta_click", { cta: "start" })} className="btn-industrial btn-primary inline-flex items-center gap-2"><UploadCloud size={14} /> Start Selling Digital Products</Link>
              <Link to="/maker/dashboard?tab=listings" onClick={() => track("digital_seller_cta_click", { cta: "manage" })} className="btn-industrial inline-flex items-center gap-2">Manage Digital Listings</Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
