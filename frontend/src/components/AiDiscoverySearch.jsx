/* eslint-disable react-hooks/exhaustive-deps */
import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, Loader2, ArrowUpRight } from "lucide-react";
import { aiDiscoverySearch } from "../lib/api";

/**
 * "Describe what you want" AI discovery search.
 *
 * Big natural-language input box. Visitor types something like
 *   "rustic mountain themed metal sign"
 * and the backend asks Gemini Flash to rank the catalog by intent
 * match, returning up to 6 results each with a short "why this matches"
 * sentence. Renders results inline so the search feels conversational —
 * no full-page reload, no jarring grid switch.
 *
 * Cycling placeholder hints (3-sec rotation) seed the buyer's mental
 * model — they see real example queries and instantly understand "oh,
 * I can talk to this search box like a person."
 */
const EXAMPLE_QUERIES = [
  "Rustic mountain-themed metal sign",
  "Industrial Edison lamp for my office",
  "Live-edge wood table with deep blue epoxy",
  "Heirloom cutting board for a wedding gift",
  "Hand-forged garden tool with walnut handle",
  "Memorial plaque with tree of life motif",
];

export default function AiDiscoverySearch({ testId = "home-ai-discovery", compact = false }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);   // null = no search yet · [] = no matches
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  // Rotating placeholder — cycles every 3.5s. Stops once the visitor
  // starts typing so we don't change the field they're filling in.
  const [phIdx, setPhIdx] = useState(0);
  React.useEffect(() => {
    if (q) return;
    const t = setInterval(() => setPhIdx((i) => (i + 1) % EXAMPLE_QUERIES.length), 3500);
    return () => clearInterval(t);
  }, [q]);

  const runSearch = async (queryText) => {
    const cleaned = (queryText || "").trim();
    if (cleaned.length < 3) {
      setError("Type at least 3 characters.");
      return;
    }
    setBusy(true); setError("");
    try {
      const r = await aiDiscoverySearch(cleaned);
      setResults(Array.isArray(r.results) ? r.results : []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Search failed — try again in a moment.");
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    runSearch(q);
  };

  const handleExampleClick = (example) => {
    setQ(example);
    runSearch(example);
    inputRef.current?.focus();
  };

  return (
    <section
      className={`w-full ${compact ? "py-8 md:py-10" : "py-14 md:py-20"} bg-paper ${compact ? "" : "border-b border-amber-900/20"} relative overflow-hidden`}
      data-testid={testId}
    >
      {/* Soft copper/orange ambient glow — signals the "smart" surface
          and pulls the eye into the section. Replaced the purple +
          orange dual-glow with a Forge-palette copper-only setup. */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] h-[60%] bg-amber-500 opacity-[0.05] blur-[120px] rounded-full" />
        <div className="absolute top-1/3 left-1/4 w-[35%] h-[40%] bg-brand opacity-[0.06] blur-[100px] rounded-full" />
      </div>

      <div className={`w-full ${compact ? "max-w-[1100px]" : "max-w-[1100px]"} mx-auto px-4 md:px-8 relative z-10`}>
        <div className={`text-center ${compact ? "mb-4" : "mb-6"}`}>
          <div className={`font-mono text-[11px] uppercase tracking-[0.3em] text-brand ${compact ? "mb-1" : "mb-3"} inline-flex items-center gap-2 justify-center`}>
            <Sparkles size={12} className="text-brand" />
            ◆ AI Discovery · Beta
          </div>
          {!compact && (
            <>
              <h2 className="font-display text-3xl md:text-5xl lg:text-6xl mb-3">
                Describe what you want.
              </h2>
              <p className="font-mono text-[12px] text-ink-muted max-w-xl mx-auto">
                Plain language. No filters to click. Tell us the piece you have in your head —
                our AI scans the catalog and surfaces the closest matches with a one-line reason for each.
              </p>
            </>
          )}
          {compact && (
            <h2 className="font-display text-xl md:text-2xl mb-1">
              Or describe what you're looking for
            </h2>
          )}
        </div>

        <form onSubmit={handleSubmit} className="relative mb-4" data-testid={`${testId}-form`}>
          <div className="flex items-center border border-line focus-within:border-brand transition-colors bg-surface shadow-sm">
            <Sparkles size={16} className="text-brand ml-4 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => { setQ(e.target.value); setError(""); }}
              placeholder={q ? "" : EXAMPLE_QUERIES[phIdx]}
              className="flex-1 bg-transparent px-4 py-4 md:py-5 text-base md:text-lg font-display placeholder:text-ink-muted focus:outline-none"
              maxLength={300}
              data-testid={`${testId}-input`}
            />
            <button
              type="submit"
              disabled={busy || q.trim().length < 3}
              className="m-1 px-4 py-3 md:px-5 md:py-3 bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-white font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2 transition"
              data-testid={`${testId}-submit`}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {busy ? "Searching" : "Search"}
            </button>
          </div>
          {error && (
            <div className="font-mono text-[11px] text-red-400 mt-2" data-testid={`${testId}-error`}>{error}</div>
          )}
        </form>

        {/* Example chips — quick-start buttons. Hide once the visitor
            has run a real search so they don't crowd the results. */}
        {!results && !busy && (
          <div className="flex flex-wrap gap-2 justify-center mb-2" data-testid={`${testId}-examples`}>
            {EXAMPLE_QUERIES.slice(0, 4).map((ex) => (
              <button
                key={ex}
                onClick={() => handleExampleClick(ex)}
                className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand text-ink-muted font-mono text-[10px] uppercase tracking-[0.18em] transition"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {/* Results grid */}
        <AnimatePresence mode="wait">
          {results !== null && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="mt-10"
              data-testid={`${testId}-results`}
            >
              {results.length === 0 ? (
                <div className="text-center py-10 border border-line" data-testid={`${testId}-empty`}>
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-muted mb-2">◇ Nothing matched</div>
                  <p className="text-ink-muted text-sm">
                    Try a different angle — material ("walnut"), use case ("wedding gift"),
                    or a style word ("rustic", "industrial", "modern").
                  </p>
                </div>
              ) : (
                <>
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted mb-5 text-center">
                    ◆ {results.length} match{results.length === 1 ? "" : "es"} for &quot;{q}&quot;
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {results.map((p, i) => (
                      <ResultCard key={p.slug} p={p} i={i} testId={`${testId}-result-${p.slug}`} />
                    ))}
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function ResultCard({ p, i, testId }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.06, duration: 0.4 }}
      className="bg-surface border border-line hover:border-brand transition-colors duration-500 flex flex-col"
      data-testid={testId}
    >
      <Link to={`/shop/${p.slug}`} className="block group">
        <div className="relative aspect-square overflow-hidden">
          <img
            src={p.images?.[0]}
            alt={p.title}
            className="absolute inset-0 w-full h-full object-cover media-img group-hover:scale-105 transition duration-700"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          {p.featured_example && (
            <span className="tag absolute top-2 left-2 text-amber-300 border-amber-400/70 bg-paper/70 text-[9px]">
              ✦ EXAMPLE
            </span>
          )}
          <span className="tag absolute top-2 right-2 text-brand border-brand bg-paper/70 text-[9px]">
            {p.technique}
          </span>
        </div>
        <div className="p-4">
          <div className="font-display text-lg leading-tight line-clamp-2 mb-1">{p.title}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
            {p.category} · ${p.price?.toFixed(0)}
          </div>
          {p.match_reason && (
            <div
              className="border-l-2 border-brand pl-3 mb-3 text-[12px] text-ink-muted leading-relaxed italic"
              data-testid={`${testId}-reason`}
            >
              <span className="text-brand font-mono text-[9px] uppercase tracking-[0.22em] not-italic block mb-1">
                ◆ Why this matches
              </span>
              {p.match_reason}
            </div>
          )}
          <div className="flex items-center justify-end pt-2 border-t border-line">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand inline-flex items-center gap-1 group-hover:gap-2 transition-all">
              View listing <ArrowUpRight size={12} />
            </span>
          </div>
        </div>
      </Link>
    </motion.article>
  );
}
