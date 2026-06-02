import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { GPC_PRESETS } from "./constants";

// Consumer-language aliases for taxonomy paths whose Google text uses
// industry terms (e.g. "Vehicles & Parts > Motor Vehicle Parts"). If a
// maker types "automotive" or "car", we still surface those entries
// without forcing them to know the verbatim Google wording.
const PRESET_ALIASES = [
  {
    keywords: ["automotive", "auto", "car", "truck", "vehicle"],
    match: (p) => p.startsWith("Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle"),
  },
  {
    keywords: ["boat", "marine", "watercraft", "yacht"],
    match: (p) => p.includes("Watercraft"),
  },
  {
    keywords: ["bike", "bicycle", "cycling"],
    match: (p) => p.includes("Bicycle"),
  },
];

/**
 * Searchable Google Product Category (GPC) combobox.
 *
 * Hybrid of dropdown + freeform input: makers can either tap a preset
 * from the dropdown OR paste / type any verbatim GPC path from the
 * official taxonomy
 * ( https://www.google.com/basepages/producttype/taxonomy.en-US.txt ).
 *
 * Empty value ⇒ the catalog feeds auto-derive a path from the listing's
 * category. The `autoPlaceholder` prop surfaces that fallback as a
 * placeholder so the maker knows what they're overriding without having
 * to inspect the feed CSV.
 *
 * Validation is light — the parent enforces it server-side. We just hint
 * at "≥ 2 levels deep" so makers don't trip Pinterest's alert 126.
 */
export default function GpcCombobox({
  value,
  onChange,
  autoPlaceholder = "",
  testid = "gpc-combobox",
}) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Keep local query in sync when the parent loads a value from the
  // backend after the editor mounts.
  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return GPC_PRESETS.slice(0, 30);
    // Direct substring match against the verbatim path.
    const direct = GPC_PRESETS.filter((p) => p.toLowerCase().includes(q));
    // Plus any preset that matches a consumer-language alias for `q`.
    const aliasHits = PRESET_ALIASES
      .filter((a) => a.keywords.some((kw) => kw.includes(q) || q.includes(kw)))
      .flatMap((a) => GPC_PRESETS.filter(a.match));
    // De-dupe while preserving order (direct first).
    const seen = new Set();
    const merged = [...direct, ...aliasHits].filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    return merged.slice(0, 30);
  }, [query]);

  const commit = (next) => {
    const cleaned = (next || "").trim();
    setQuery(cleaned);
    onChange(cleaned);
    setOpen(false);
  };

  const looksValid = useMemo(() => {
    const q = (query || "").trim();
    if (!q) return null;            // empty = inherit, neutral state
    return q.includes(" > ") && q.length >= 8;
  }, [query]);

  return (
    <div className="relative" ref={wrapRef} data-testid={testid}>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Commit raw freeform on blur after a tick so a preset click
            // inside the dropdown still fires before the input commits.
            setTimeout(() => onChange((query || "").trim()), 120);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(query);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={
            autoPlaceholder
              ? `Inherit auto-derived path · ${autoPlaceholder}`
              : "e.g. Home & Garden > Decor > Signs"
          }
          className="flex-1 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
          data-testid={`${testid}-input`}
          autoComplete="off"
          spellCheck="false"
        />
        {query && (
          <button
            type="button"
            onClick={() => commit("")}
            className="px-3 py-2 border border-[#262626] text-[#525252] hover:text-[#ff4500] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition"
            data-testid={`${testid}-clear`}
            title="Clear override — feeds will auto-derive the path."
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div
          className="absolute left-0 right-0 mt-1 z-30 max-h-[280px] overflow-y-auto bg-[#0d0d0d] border border-[#262626] shadow-2xl"
          role="listbox"
          data-testid={`${testid}-list`}
        >
          {filtered.map((p) => {
            const selected = p === query;
            return (
              <button
                key={p}
                type="button"
                onMouseDown={(e) => {
                  // Use onMouseDown so the click registers before the
                  // input's onBlur fires and commits the raw query string.
                  e.preventDefault();
                  commit(p);
                }}
                className={`w-full text-left px-3 py-2 font-mono text-[11px] hover:bg-[#ff4500]/10 transition flex items-center gap-2 ${
                  selected ? "bg-[#ff4500]/10 text-[#ff4500]" : "text-[#e5e5e5]"
                }`}
                role="option"
                aria-selected={selected}
                data-testid={`${testid}-option-${p}`}
              >
                {selected && <Check size={12} className="text-[#ff4500] shrink-0" />}
                <span className="truncate">{p}</span>
              </button>
            );
          })}
          <div className="px-3 py-2 border-t border-[#1f1f1f] font-mono text-[9px] uppercase tracking-[0.2em] text-[#525252]">
            ◆ Or type / paste any path from Google&apos;s taxonomy
          </div>
        </div>
      )}

      {looksValid === false && (
        <p
          className="font-mono text-[10px] text-amber-400 mt-1"
          data-testid={`${testid}-warn`}
        >
          ⚠ Path should be ≥ 2 levels deep (use {" > "} between levels).
        </p>
      )}
    </div>
  );
}
