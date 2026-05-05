import React, { useState } from "react";
import { Copy, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { aiListingCopy, aiSeoAudit, aiSeoBulk } from "../../../lib/api";
import { useConfirm } from "../useConfirm";
import Section from "./Section";

/**
 * AI / SEO toolset rendered inside the Marketing → Ads tab.
 *
 * Three side-by-side panels:
 *   - ListingCopyGenerator: bullets in → polished title/description/13 tags out
 *   - SeoRecommender:       full-shop audit with missing keywords + title rewrites
 *   - BulkSeoGenerator:     batch top-up tags across every published listing
 *
 * Default export renders all three so the parent (AdsSection) can mount a
 * single component instead of remembering to import each one. Individual
 * named exports kept for tests that want to mount a single panel.
 *
 * Extracted from MarketingTab.jsx in iter131 — three panels were ~250
 * lines combined and didn't share state with the rest of the marketing
 * tab beyond the shared <Section>.
 */
export default function AICopyTools() {
  return (
    <>
      <ListingCopyGenerator />
      <SeoRecommender />
      <BulkSeoGenerator />
    </>
  );
}

export function ListingCopyGenerator() {
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
    <Section title="AI Listing Copy" testId="ai-listing-copy">
      <p className="font-mono text-xs text-[#a3a3a3] mb-4">
        Drop in a few bullets. Get a polished title, description, and 13 tags in 5 seconds.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <textarea value={bullets} onChange={(e) => setBullets(e.target.value)}
          placeholder="• Walnut, oil finish, live edge&#10;• 18×12in, 1.5in thick&#10;• Hand-routed juice groove on one side"
          rows={5} maxLength={2000}
          className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-4 py-3 font-mono text-xs outline-none resize-y"
          data-testid="ai-copy-bullets" />
        <div className="grid grid-cols-2 gap-3">
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-xs outline-none"
            data-testid="ai-copy-category" />
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target price ($)"
            type="number" min="1" step="1"
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
              <button onClick={() => copy(out.tags.join(", "), "Tags")} className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] hover:underline">
                <Copy size={11} className="inline" /> Copy all
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {out.tags.map((t, i) => (
                <span key={i} className="px-2 py-1 border border-[#262626] bg-[#0a0a0a] font-mono text-[11px] text-[#e5e5e5]">{t}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Section>
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

export function SeoRecommender() {
  const [state, setState] = useState({ status: "idle", data: null, err: "" });
  const run = async () => {
    setState({ status: "loading", data: null, err: "" });
    try { setState({ status: "done", data: await aiSeoAudit(), err: "" }); }
    catch (e) { setState({ status: "error", data: null, err: e?.response?.data?.detail || "Audit failed." }); }
  };
  return (
    <Section title="SEO Recommender" testId="ai-seo-audit">
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="font-mono text-xs text-[#a3a3a3] flex-1">
          Audits your active listings and surfaces missing keywords + 3 high-impact title rewrites. Cached for 15 minutes.
        </p>
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
    </Section>
  );
}

export function BulkSeoGenerator() {
  const [threshold, setThreshold] = useState(8);
  const [maxListings, setMaxListings] = useState(50);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [confirm, confirmModal] = useConfirm();

  const run = async () => {
    const ok = await confirm({
      title: `Run AI tag generator on up to ${maxListings} listings?`,
      body: `Listings with ${threshold}+ tags are skipped. Existing tags are preserved — only NEW tags are added. Uses your AI quota.`,
      confirmLabel: "Run AI",
      tone: "primary",
      testId: "confirm-ai-seo-bulk",
    });
    if (!ok) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await aiSeoBulk({ max_listings: parseInt(maxListings, 10), min_tags_threshold: parseInt(threshold, 10) });
      setResult(r);
      if (r.scanned === 0) toast.info("No listings needed tags — every published listing already meets the threshold.");
      else toast.success(`Tagged ${r.scanned} listings · added ${r.total_added} new tags total.`);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Bulk SEO failed.";
      setErr(msg); toast.error(msg);
    } finally { setBusy(false); }
  };

  return (
    <Section title="Bulk SEO Tag Generator" testId="ai-seo-bulk">
      {confirmModal}
      <p className="font-mono text-xs text-[#a3a3a3] mb-4">
        Run AI across every published listing. Listings with fewer than the threshold get topped up to 13 tags automatically.
      </p>
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1.5">Tag threshold</span>
          <select value={threshold} onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
            data-testid="seo-bulk-threshold">
            <option value={0}>Listings with 0 tags only</option>
            <option value={4}>Listings with &lt; 4 tags</option>
            <option value={8}>Listings with &lt; 8 tags (recommended)</option>
            <option value={13}>Every published listing (top up all)</option>
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1.5">Max listings per run</span>
          <select value={maxListings} onChange={(e) => setMaxListings(parseInt(e.target.value, 10))}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
            data-testid="seo-bulk-max">
            {[10, 25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <button onClick={run} disabled={busy}
        className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
        data-testid="seo-bulk-run-btn">
        <Sparkles size={14} /> {busy ? "Generating tags…" : "✦ Run bulk SEO"}
      </button>
      {err && <div className="mt-4 border border-red-500/40 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-300">{err}</div>}
      {result && (
        <div className="mt-5 border border-[#262626] bg-[#0a0a0a]" data-testid="seo-bulk-result">
          <div className="px-4 py-3 border-b border-[#262626] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            ◆ {result.scanned} listings scanned · <span className="text-[#ff4500]">{result.total_added}</span> new tags added
          </div>
          {result.results.length === 0 ? (
            <div className="px-4 py-6 font-mono text-[11px] text-[#737373] text-center">No listings matched the threshold.</div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {result.results.map((r) => (
                <div key={r.slug} className="px-4 py-3 border-b border-[#1a1a1a] flex items-start justify-between gap-3" data-testid={`seo-bulk-row-${r.slug}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[12px] text-[#e5e5e5] truncate">{r.title}</div>
                    {r.added_tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.added_tags.map((t) => (
                          <span key={t} className="font-mono text-[10px] px-1.5 py-0.5 border border-[#ff4500]/40 text-[#ff4500] bg-[#ff4500]/5">{t}</span>
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
    </Section>
  );
}
