/**
 * Admin Command Palette (⌘+K / Ctrl+K)
 * ==========================================================================
 * Global keyboard-first navigator for the admin dashboard. Lists every tab
 * + a handful of common cross-tab actions ("Open Workshop Analytics",
 * "Sign out") with fuzzy substring matching. Pure UI — no new backend.
 *
 * Keyboard:
 *   ⌘K / Ctrl+K  — open
 *   Esc          — close
 *   ↑ ↓          — navigate filtered results
 *   ↵            — execute highlighted entry
 *
 * Suppressed inside <input>/<textarea>/contentEditable so the palette
 * doesn't fight with browser autocomplete and keyboard typing.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowRight, Command } from "lucide-react";

const CROSS_ACTIONS = [
  {
    id: "act-workshop",
    label: "Open Workshop Analytics",
    keywords: "analytics charts kpi cohort",
    perform: ({ navigate }) => navigate("/admin/workshop-analytics"),
  },
  {
    id: "act-home",
    label: "Visit live homepage",
    keywords: "site root public",
    perform: () => window.open("/", "_blank"),
  },
  {
    id: "act-logout",
    label: "Sign out of admin",
    keywords: "logout signout exit leave",
    perform: ({ logout }) => logout(),
  },
];

export default function AdminCommandPalette({ tabs, onPickTab, currentTab, logout }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  // Global keydown — open + close + soft skip while user is typing in
  // an input/textarea so we don't fight autocomplete or form input.
  useEffect(() => {
    const onKey = (e) => {
      const target = e.target;
      const tag = (target?.tagName || "").toUpperCase();
      const inField = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey) && !inField) {
        e.preventDefault();
        setOpen((v) => !v);
        setQ("");
        setCursor(0);
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Auto-focus the search input when palette opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const entries = useMemo(() => {
    const tabEntries = (tabs || []).map((t) => ({
      id: `tab-${t.id}`,
      label: `Go to ${t.label}`,
      keywords: t.label.toLowerCase(),
      kind: "tab",
      tabId: t.id,
    }));
    return [...tabEntries, ...CROSS_ACTIONS];
  }, [tabs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return entries.slice(0, 12);
    return entries.filter((e) =>
      e.label.toLowerCase().includes(needle) ||
      (e.keywords || "").toLowerCase().includes(needle),
    ).slice(0, 25);
  }, [q, entries]);

  // Keep cursor inside bounds when filter changes
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(0);
  }, [filtered, cursor]);

  const execute = (entry) => {
    if (!entry) return;
    setOpen(false);
    setQ("");
    if (entry.kind === "tab") {
      onPickTab(entry.tabId);
    } else if (entry.perform) {
      entry.perform({ navigate, logout });
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/70 flex items-start justify-center pt-[15vh] px-4"
      onClick={() => setOpen(false)}
      data-testid="admin-cmdk"
    >
      <div
        className="bg-[#0a0a0a] border border-[#262626] w-full max-w-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#262626]">
          <Search size={16} className="text-[#a3a3a3]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(filtered.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                execute(filtered[cursor]);
              }
            }}
            placeholder="Jump to a tab or run a command…"
            className="flex-1 bg-transparent outline-none font-mono text-sm text-[#e5e5e5] placeholder:text-[#525252]"
            data-testid="admin-cmdk-input"
          />
          <kbd className="hidden sm:inline px-1.5 py-0.5 border border-[#262626] font-mono text-[9px] text-[#a3a3a3]">
            ESC
          </kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto" data-testid="admin-cmdk-list">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center font-mono text-xs text-[#525252]">
              No matches for "{q}"
            </div>
          ) : (
            filtered.map((e, i) => {
              const active = i === cursor;
              const isCurrent = e.kind === "tab" && e.tabId === currentTab;
              return (
                <button
                  key={e.id}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => execute(e)}
                  data-testid={`admin-cmdk-item-${e.id}`}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition ${
                    active ? "bg-[#ff4500]/10 border-l-2 border-[#ff4500]" : "border-l-2 border-transparent hover:bg-[#1a1a1a]/40"
                  }`}
                >
                  <span className="font-mono text-xs text-[#e5e5e5] truncate">
                    {e.label}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {isCurrent && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">
                        current
                      </span>
                    )}
                    {active && <ArrowRight size={12} className="text-[#ff4500]" />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-[#262626] flex items-center justify-between text-[#525252] font-mono text-[10px]">
          <span className="flex items-center gap-1">
            <Command size={10} /> ↵ to run · ↑↓ to navigate
          </span>
          <span>{filtered.length} match{filtered.length === 1 ? "" : "es"}</span>
        </div>
      </div>
    </div>
  );
}
