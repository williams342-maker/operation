import React, { useEffect, useState } from "react";
import { Sparkles, Search, TrendingUp, Tag, Camera, FileText, Hash, DollarSign, Wand2, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  aiListingCopy, aiSeoAudit, aiSeoBulk,
  fetchDiscountCodes, createDiscountCode, toggleDiscountCode, deleteDiscountCode,
} from "../../lib/api";

const TIPS = [
  { icon: Camera, title: "First photo is everything", body: "60% of click-through is decided by the hero image alone. Sharp, lit, centered, no clutter." },
  { icon: FileText, title: "Title formula that works", body: "[Material] + [Item] + [Style/Use Case]. Example: 'Walnut Cutting Board · Live Edge · Kitchen Gift'." },
  { icon: Hash, title: "Tags are search ammunition", body: "Use 13 tags. Mix specific (walnut, live-edge) and broad (kitchen, housewarming). Repeat words from your title." },
  { icon: TrendingUp, title: "List on Tuesdays around 1pm ET", body: "Buyer browsing peaks Tue–Wed afternoons. New listings get a 24h discoverability boost." },
  { icon: Tag, title: "Run a 10–15% discount on day 1", body: "Drives early sales, builds review velocity, signals to the algorithm that the listing converts." },
  { icon: DollarSign, title: "Round prices to .00 or .50", body: "Ending in .99 reads cheap on handmade. .00 and .50 read confident and intentional." },
];

/** Marketing tab — real AI Copy Generator + SEO Recommender + Discount Codes + Tips. */
export default function MarketingTab() {
  return (
    <div className="space-y-12" data-testid="marketing-tab">
      <header className="pb-6 border-b border-[#262626]">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Marketing.</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl">
          AI tools, discount codes, and tactics to drive demand for your shop.
        </p>
      </header>

      <ListingCopyGenerator />
      <SeoRecommender />
      <BulkSeoGenerator />
      <DiscountCodes />
      <MarketingTips />
    </div>
  );
}

// ───────────────────── Listing Copy Generator ─────────────────────
function ListingCopyGenerator() {
  const [bullets, setBullets] = useState("");
  const [category, setCategory] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (bullets.trim().length < 10) {
      setErr("Add a few bullets describing the piece (materials, dimensions, what makes it special).");
      return;
    }
    setErr(""); setBusy(true);
    try {
      const r = await aiListingCopy({
        bullets: bullets.trim(),
        category: category.trim() || null,
        target_price: target ? parseFloat(target) : null,
      });
      setOut(r);
    } catch (e) {
      setErr(e?.response?.data?.detail || "AI is busy — please retry in a few seconds.");
    } finally { setBusy(false); }
  };

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <section data-testid="ai-listing-copy" className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 md:p-6">
      <div className="flex items-start gap-3 mb-4">
        <Sparkles size={20} className="text-[#ff4500] mt-1" />
        <div>
          <h3 className="font-display text-xl md:text-2xl uppercase">AI Listing Copy</h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-1">
            Drop in a few bullets. Get a polished title, description, and 13 tags in 5 seconds.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <textarea
          value={bullets}
          onChange={(e) => setBullets(e.target.value)}
          placeholder="• Walnut, oil finish, live edge&#10;• 18×12in, 1.5in thick&#10;• Hand-routed juice groove on one side&#10;• Cured + sanded to 320 grit"
          rows={5}
          className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-4 py-3 font-mono text-xs outline-none resize-y"
          data-testid="ai-copy-bullets"
          maxLength={2000}
        />
        <div className="grid grid-cols-2 gap-3">
          <input value={category} onChange={(e) => setCategory(e.target.value)}
            placeholder="Category (e.g. cutting-boards)"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-xs outline-none"
            data-testid="ai-copy-category" />
          <input value={target} onChange={(e) => setTarget(e.target.value)}
            placeholder="Target price ($)" type="number" min="1" step="1"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-xs outline-none"
            data-testid="ai-copy-target" />
        </div>
        <button type="submit" disabled={busy}
          className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          data-testid="ai-copy-submit">
          <Wand2 size={14} /> {busy ? "Drafting…" : "Generate copy →"}
        </button>
        {err && <p className="font-mono text-xs text-red-400" data-testid="ai-copy-err">{err}</p>}
      </form>

      {out && (
        <div className="mt-6 space-y-4 border-t border-[#262626] pt-5" data-testid="ai-copy-output">
          <Field label="Title" value={out.title} onCopy={() => copy(out.title, "Title")} testid="ai-copy-out-title" />
          <Field label="Description" value={out.description} onCopy={() => copy(out.description, "Description")} testid="ai-copy-out-desc" multiline />
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Tags ({out.tags.length})</div>
              <button onClick={() => copy(out.tags.join(", "), "Tags")} className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] hover:underline" data-testid="ai-copy-out-tags-copy">
                <Copy size={11} className="inline" /> Copy all
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {out.tags.map((t, i) => (
                <span key={i} className="px-2 py-1 border border-[#262626] bg-[#0a0a0a] font-mono text-[11px] text-[#e5e5e5]" data-testid={`ai-copy-tag-${i}`}>{t}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, value, onCopy, multiline, testid }) {
  return (
    <div data-testid={testid}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</div>
        <button onClick={onCopy} className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] hover:underline">
          <Copy size={11} className="inline" /> Copy
        </button>
      </div>
      <div className={`bg-[#0a0a0a] border border-[#262626] p-3 font-mono text-xs text-[#e5e5e5] leading-relaxed ${multiline ? "whitespace-pre-wrap" : "truncate"}`}>
        {value}
      </div>
    </div>
  );
}

// ───────────────────── SEO Recommender ─────────────────────
function SeoRecommender() {
  const [state, setState] = useState({ status: "idle", data: null, err: "" });

  const run = async () => {
    setState({ status: "loading", data: null, err: "" });
    try { setState({ status: "done", data: await aiSeoAudit(), err: "" }); }
    catch (e) { setState({ status: "error", data: null, err: e?.response?.data?.detail || "Audit failed." }); }
  };

  return (
    <section data-testid="ai-seo-audit" className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 md:p-6">
      <div className="flex items-start gap-3 mb-4">
        <Search size={20} className="text-[#ff4500] mt-1" />
        <div className="flex-1">
          <h3 className="font-display text-xl md:text-2xl uppercase">SEO Recommender</h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-1">
            Audits your active listings and surfaces missing keywords + 3 high-impact title rewrites. Cached for 15 minutes.
          </p>
        </div>
        <button onClick={run} disabled={state.status === "loading"}
          className="btn-industrial inline-flex items-center gap-2 disabled:opacity-50 shrink-0"
          data-testid="ai-seo-run">
          <Wand2 size={14} /> {state.status === "loading" ? "Auditing…" : "Run audit"}
        </button>
      </div>
      {state.err && <p className="font-mono text-xs text-red-400" data-testid="ai-seo-err">{state.err}</p>}
      {state.data && (
        <div className="space-y-4 border-t border-[#262626] pt-5 mt-2" data-testid="ai-seo-output">
          <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed">{state.data.summary}</p>
          {!!state.data.missing_keywords?.length && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                Missing Keywords ({state.data.missing_keywords.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {state.data.missing_keywords.map((k, i) => (
                  <span key={i} className="px-2 py-1 border border-[#ff4500]/40 bg-[#ff4500]/5 font-mono text-[11px] text-[#ff4500]">{k}</span>
                ))}
              </div>
            </div>
          )}
          {!!state.data.title_rewrites?.length && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">Title Rewrites</div>
              <div className="space-y-2">
                {state.data.title_rewrites.map((r, i) => (
                  <div key={i} className="border border-[#262626] p-3" data-testid={`seo-rewrite-${i}`}>
                    <div className="font-mono text-[10px] text-[#737373] line-through truncate">{r.current}</div>
                    <div className="font-mono text-xs text-[#e5e5e5] mt-1">{r.suggested}</div>
                    <div className="font-mono text-[10px] text-[#a3a3a3] mt-1.5 italic">→ {r.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}


// ───────────────────── Bulk SEO Generator ─────────────────────
/** Scans every published, non-deleted listing in the maker's shop, picks the
 *  ones with fewer than `threshold` SEO tags, and tops them up via Claude.
 *  Writes happen inline — most makers want this one-click after migrating
 *  from Etsy/Shopify (where tags are short or missing entirely). */
function BulkSeoGenerator() {
  const [threshold, setThreshold] = useState(8);
  const [maxListings, setMaxListings] = useState(50);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!window.confirm(`Run AI tag generator across up to ${maxListings} listings missing tags? Listings with ${threshold}+ tags will be skipped. Existing tags are preserved.`)) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await aiSeoBulk({
        max_listings: parseInt(maxListings, 10),
        min_tags_threshold: parseInt(threshold, 10),
      });
      setResult(r);
      if (r.scanned === 0) {
        toast.info("No listings needed tags — every published listing already meets the threshold.");
      } else {
        toast.success(`Tagged ${r.scanned} listings · added ${r.total_added} new tags total.`);
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Bulk SEO failed.";
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="ai-seo-bulk" className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 md:p-6">
      <div className="flex items-start gap-3 mb-4">
        <Wand2 size={20} className="text-[#ff4500] mt-1" />
        <div>
          <h3 className="font-display text-xl md:text-2xl uppercase">Bulk SEO Tag Generator</h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-1">
            Run AI across every published listing in your shop. Listings with fewer
            than the threshold get topped up to 13 tags automatically.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1.5">Tag threshold</span>
          <select
            value={threshold} onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
            data-testid="seo-bulk-threshold"
          >
            <option value={0}>Listings with 0 tags only</option>
            <option value={4}>Listings with &lt; 4 tags</option>
            <option value={8}>Listings with &lt; 8 tags (recommended)</option>
            <option value={13}>Every published listing (top up all)</option>
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1.5">Max listings per run</span>
          <select
            value={maxListings} onChange={(e) => setMaxListings(parseInt(e.target.value, 10))}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
            data-testid="seo-bulk-max"
          >
            {[10, 25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <button
        onClick={run} disabled={busy}
        className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
        data-testid="seo-bulk-run-btn"
      >
        <Sparkles size={14} /> {busy ? "Generating tags…" : "✦ Run bulk SEO"}
      </button>

      {err && (
        <div className="mt-4 border border-red-500/40 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-300">
          {err}
        </div>
      )}

      {result && (
        <div className="mt-5 border border-[#262626] bg-[#0a0a0a]" data-testid="seo-bulk-result">
          <div className="px-4 py-3 border-b border-[#262626] flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em]">
            <span className="text-[#a3a3a3]">
              ◆ {result.scanned} listings scanned · <span className="text-[#ff4500]">{result.total_added}</span> new tags added
            </span>
          </div>
          {result.results.length === 0 ? (
            <div className="px-4 py-6 font-mono text-[11px] text-[#737373] text-center">
              No listings matched the threshold.
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {result.results.map((r) => (
                <div key={r.slug} className="px-4 py-3 border-b border-[#1a1a1a] flex items-start justify-between gap-3" data-testid={`seo-bulk-row-${r.slug}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[12px] text-[#e5e5e5] truncate">{r.title}</div>
                    {r.added_tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.added_tags.map((t) => (
                          <span key={t} className="font-mono text-[10px] px-1.5 py-0.5 border border-[#ff4500]/40 text-[#ff4500] bg-[#ff4500]/5">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-[#737373] uppercase tracking-[0.18em] shrink-0 text-right">
                    +{r.added_count}
                    <div className="text-[9px] text-[#525252] normal-case mt-0.5">{r.total_tags_after}/13 total</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}


// ───────────────────── Discount Codes ─────────────────────
function DiscountCodes() {
  const [codes, setCodes] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: "", kind: "percent", amount: "10", min_order_total: "0",
    max_uses: "", expires_at: "", notes: "",
  });
  const [busy, setBusy] = useState(false);

  const refresh = () => fetchDiscountCodes()
    .then((d) => setCodes(d.codes || []))
    .catch(() => setCodes([]));
  useEffect(() => { refresh(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createDiscountCode({
        code: form.code,
        kind: form.kind,
        amount: parseFloat(form.amount) || 0,
        min_order_total: parseFloat(form.min_order_total) || 0,
        max_uses: form.max_uses ? parseInt(form.max_uses, 10) : null,
        expires_at: form.expires_at || null,
        notes: form.notes || null,
      });
      toast.success(`Code created: ${form.code.toUpperCase()}`);
      setForm({ ...form, code: "", notes: "" });
      setShowForm(false);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create code.");
    } finally { setBusy(false); }
  };

  const toggle = async (c) => {
    try { await toggleDiscountCode(c.id, !c.active); await refresh(); }
    catch { toast.error("Could not toggle code."); }
  };
  const remove = async (c) => {
    if (!window.confirm(`Delete code "${c.code}"? This cannot be undone.`)) return;
    try { await deleteDiscountCode(c.id); toast.success(`Deleted ${c.code}`); await refresh(); }
    catch { toast.error("Could not delete code."); }
  };

  return (
    <section data-testid="discount-codes" className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <Tag size={20} className="text-[#ff4500] mt-1" />
          <div>
            <h3 className="font-display text-xl md:text-2xl uppercase">Discount Codes</h3>
            <p className="font-mono text-xs text-[#a3a3a3] mt-1">
              Create promo codes for your shop. Codes apply at checkout when buyers paste them in.
            </p>
            <p className="font-mono text-[10px] text-[#737373] mt-1.5 italic">
              Note: Phase 2 ships maker-side CRUD. Buyer-side checkout application lands in the next iteration.
            </p>
          </div>
        </div>
        <button onClick={() => setShowForm((s) => !s)}
          className="btn-industrial inline-flex shrink-0"
          data-testid="discount-new-btn">
          {showForm ? "Cancel" : "+ New Code"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={create} className="border border-[#262626] p-4 mb-4 grid md:grid-cols-2 gap-3" data-testid="discount-form">
          <input value={form.code} onChange={(e) => setForm({...form, code: e.target.value})}
            placeholder="CODE (e.g. SUMMER15)" required minLength={3} maxLength={32}
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none uppercase"
            data-testid="discount-code" />
          <select value={form.kind} onChange={(e) => setForm({...form, kind: e.target.value})}
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none"
            data-testid="discount-kind">
            <option value="percent">Percent off</option>
            <option value="fixed">Fixed dollar off</option>
            <option value="free_shipping">Free shipping</option>
          </select>
          <input value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})}
            placeholder={form.kind === "percent" ? "% off (1–100)" : "$ amount"}
            type="number" min="0" step="0.01" required={form.kind !== "free_shipping"}
            disabled={form.kind === "free_shipping"}
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none disabled:opacity-50"
            data-testid="discount-amount" />
          <input value={form.min_order_total} onChange={(e) => setForm({...form, min_order_total: e.target.value})}
            placeholder="Min order $ (0 = no min)" type="number" min="0" step="0.01"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none"
            data-testid="discount-min" />
          <input value={form.max_uses} onChange={(e) => setForm({...form, max_uses: e.target.value})}
            placeholder="Max uses (blank = unlimited)" type="number" min="1"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none"
            data-testid="discount-maxuses" />
          <input value={form.expires_at} onChange={(e) => setForm({...form, expires_at: e.target.value})}
            placeholder="Expires (YYYY-MM-DD, optional)" type="date"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none"
            data-testid="discount-expires" />
          <textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})}
            placeholder="Internal notes (optional, 200 char max)" maxLength={200} rows={2}
            className="md:col-span-2 bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-xs outline-none resize-none"
            data-testid="discount-notes" />
          <button type="submit" disabled={busy}
            className="md:col-span-2 btn-industrial btn-primary disabled:opacity-50"
            data-testid="discount-submit">
            {busy ? "Creating…" : "Create code"}
          </button>
        </form>
      )}

      {codes === null ? (
        <p className="font-mono text-xs text-[#737373] py-4">Loading…</p>
      ) : codes.length === 0 ? (
        <p className="font-mono text-xs text-[#737373] py-4">No codes yet — create your first promo above.</p>
      ) : (
        <div className="space-y-2" data-testid="discount-list">
          {codes.map((c) => (
            <div key={c.id}
              className={`border p-3 flex items-center justify-between gap-3 ${c.active ? "border-[#262626]" : "border-[#1f1f1f] opacity-50"}`}
              data-testid={`discount-row-${c.code}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-base text-[#ff4500]">{c.code}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                    {c.kind === "percent" ? `${c.amount}% off`
                      : c.kind === "fixed" ? `$${c.amount} off`
                      : "Free shipping"}
                  </span>
                  {c.min_order_total > 0 && (
                    <span className="font-mono text-[10px] text-[#737373]">· min ${c.min_order_total}</span>
                  )}
                  {c.max_uses && (
                    <span className="font-mono text-[10px] text-[#737373]">· {c.uses_count}/{c.max_uses} used</span>
                  )}
                </div>
                {c.notes && <div className="font-mono text-[10px] text-[#737373] mt-0.5 truncate">{c.notes}</div>}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => toggle(c)}
                  className="px-2 py-1 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em]"
                  data-testid={`discount-toggle-${c.code}`}>
                  {c.active ? "Disable" : "Enable"}
                </button>
                <button onClick={() => remove(c)}
                  className="px-2 py-1 border border-red-800 hover:border-red-500 hover:text-red-300 font-mono text-[10px] uppercase tracking-[0.22em]"
                  data-testid={`discount-delete-${c.code}`}>
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ───────────────────── Tips ─────────────────────
function MarketingTips() {
  return (
    <section data-testid="marketing-tips">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
        ◆ Tactics that compound
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TIPS.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.title} className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 flex gap-4"
              data-testid={`tip-${t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
              <Icon size={20} className="text-[#ff4500] shrink-0 mt-0.5" />
              <div>
                <h4 className="font-display text-base uppercase mb-1.5">{t.title}</h4>
                <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">{t.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
