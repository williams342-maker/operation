/**
 * iter451 — "Search this Store" (Phase 2). Section-aware, scoped to one
 * maker. Debounced live search, autocomplete dropdown with section hits on
 * top, match highlighting, recent (localStorage) + popular (per-store)
 * searches, zero-result section suggestions, full keyboard navigation.
 * Never leaves the current storefront.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Folder, Clock, TrendingUp } from "lucide-react";
import { http } from "../lib/api";

const RECENT_KEY = (slug) => `cm_store_recent_${slug}`;

const readRecent = (slug) => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY(slug))) || []; }
  catch { return []; }
};
const pushRecent = (slug, q) => {
  try {
    const next = [q, ...readRecent(slug).filter((x) => x !== q)].slice(0, 5);
    localStorage.setItem(RECENT_KEY(slug), JSON.stringify(next));
  } catch { /* noop */ }
};

export const Highlight = ({ text, q }) => {
  if (!q) return text;
  const i = (text || "").toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-brand/25 text-inherit rounded-none">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
};

export default function StoreSearch({ makerSlug, makerName }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // highlighted row index
  const [popular, setPopular] = useState([]);
  const [recent, setRecent] = useState(() => readRecent(makerSlug));
  const boxRef = useRef(null);
  const debRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    http.get(`/makers/${makerSlug}/search/meta`)
      .then((r) => setPopular(r.data.popular || []))
      .catch(() => {});
  }, [makerSlug]);

  useEffect(() => {
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const run = useCallback((term) => {
    if (!term.trim()) { setRes(null); return; }
    http.get(`/makers/${makerSlug}/search`, { params: { q: term } })
      .then((r) => { setRes(r.data); setHi(-1); })
      .catch(() => setRes(null));
  }, [makerSlug]);

  const onInput = (v) => {
    setQ(v);
    setOpen(true);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => run(v), 220); // debounced live search
  };

  // Flat list of navigable rows for keyboard support.
  const rows = useMemo(() => {
    if (!q.trim()) {
      return [
        ...recent.map((t) => ({ kind: "recent", term: t })),
        ...popular.filter((t) => !recent.includes(t)).map((t) => ({ kind: "popular", term: t })),
      ];
    }
    if (!res) return [];
    return [
      ...res.sections.map((s) => ({ kind: "section", ...s })),
      ...res.products.map((p) => ({ kind: "product", ...p })),
      ...(res.suggestions || []).map((s) => ({ kind: "suggestion", ...s })),
    ];
  }, [q, res, recent, popular]);

  function go(row) {
    setOpen(false);
    if (!row) return;
    if (row.kind === "section" || row.kind === "suggestion") {
      pushRecent(makerSlug, row.name.toLowerCase());
      setRecent(readRecent(makerSlug));
      navigate(`/makers/${makerSlug}/${row.slug}`);
    } else if (row.kind === "product") {
      pushRecent(makerSlug, q.trim().toLowerCase());
      setRecent(readRecent(makerSlug));
      navigate(`/shop/${row.slug}`);
    } else {
      onInput(row.term);
      setOpen(true);
    }
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); go(rows[hi] || rows[0]); }
    else if (e.key === "Escape") { setOpen(false); }
  }

  const rowCls = (i) =>
    `w-full text-left px-3 py-2 flex items-center gap-3 transition cursor-pointer ${
      hi === i ? "bg-brand/[0.08]" : "hover:bg-surface"}`;

  return (
    <div ref={boxRef} className="relative max-w-xl" data-testid="store-search">
      <div className="flex items-center border border-line focus-within:border-brand bg-paper transition">
        <Search size={15} className="text-ink-muted ml-3 shrink-0" />
        <input
          value={q}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={`Search ${makerName || "this store"}…`}
          className="flex-1 bg-transparent px-3 py-2.5 font-mono text-sm text-ink outline-none"
          role="combobox" aria-expanded={open} aria-autocomplete="list"
          data-testid="store-search-input"
        />
      </div>

      {open && rows.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 border border-line bg-paper shadow-xl max-h-[420px] overflow-y-auto"
             role="listbox" data-testid="store-search-dropdown">
          {!q.trim() && (recent.length > 0 || popular.length > 0) && (
            <div className="px-3 pt-2 pb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
              {recent.length ? "Recent & popular in this store" : "Popular in this store"}
            </div>
          )}
          {rows.map((row, i) => {
            if (row.kind === "recent" || row.kind === "popular") {
              return (
                <button key={`${row.kind}-${row.term}`} className={rowCls(i)} onMouseEnter={() => setHi(i)}
                        onClick={() => go(row)} data-testid={`store-search-${row.kind}-${row.term}`}>
                  {row.kind === "recent" ? <Clock size={13} className="text-ink-muted" /> : <TrendingUp size={13} className="text-ink-muted" />}
                  <span className="font-mono text-xs text-ink">{row.term}</span>
                </button>
              );
            }
            if (row.kind === "section") {
              return (
                <button key={`sec-${row.slug}`} className={rowCls(i)} onMouseEnter={() => setHi(i)}
                        onClick={() => go(row)} data-testid={`store-search-section-${row.slug}`}>
                  <Folder size={14} className="text-brand shrink-0" />
                  <span className="font-mono text-sm text-ink flex-1">
                    <Highlight text={row.name} q={q} />
                    <span className="ml-2 border border-brand/40 text-brand px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em]">Section</span>
                  </span>
                  <span className="font-mono text-[10px] text-ink-muted">{row.count} product{row.count === 1 ? "" : "s"}</span>
                </button>
              );
            }
            if (row.kind === "product") {
              return (
                <button key={`p-${row.slug}`} className={rowCls(i)} onMouseEnter={() => setHi(i)}
                        onClick={() => go(row)} data-testid={`store-search-product-${row.slug}`}>
                  {row.image
                    ? <img src={row.image} alt="" className="w-8 h-8 object-cover shrink-0" loading="lazy" />
                    : <div className="w-8 h-8 bg-surface shrink-0" />}
                  <span className="font-mono text-xs text-ink flex-1 truncate">
                    <Highlight text={row.title} q={q} />
                  </span>
                  {row.price != null && (
                    <span className="font-mono text-xs text-brand">${Number(row.price).toFixed(2)}</span>
                  )}
                </button>
              );
            }
            return (
              <button key={`sug-${row.slug}`} className={rowCls(i)} onMouseEnter={() => setHi(i)}
                      onClick={() => go(row)} data-testid={`store-search-suggestion-${row.slug}`}>
                <Folder size={13} className="text-ink-muted shrink-0" />
                <span className="font-mono text-xs text-ink-muted">Try browsing <span className="text-ink">{row.name}</span> ({row.count})</span>
              </button>
            );
          })}
          {q.trim() && res && res.by_section?.length > 1 && (
            <div className="border-t border-line px-3 py-2" data-testid="store-search-by-section">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted mb-1.5">Matches by section</div>
              <div className="flex flex-wrap gap-1.5">
                {res.by_section.map((s) => (
                  <button key={s.slug}
                          onClick={() => go({ kind: "section", ...s })}
                          className="border border-line hover:border-brand px-2 py-1 font-mono text-[10px] text-ink transition"
                          data-testid={`store-search-jump-${s.slug}`}>
                    {s.name} ({s.count})
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {open && q.trim() && res && rows.length === 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 border border-line bg-paper shadow-xl p-4"
             data-testid="store-search-empty">
          <p className="font-mono text-xs text-ink-muted">
            No matches for "{q}" in this store.
          </p>
        </div>
      )}
    </div>
  );
}
