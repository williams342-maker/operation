import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import axios from "axios";
import { ShieldAlert, Save } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * iter365 — Admin "Merchant category rules" card (SettingsTab).
 *
 * Category-level overrides for the Google Merchant feed:
 *   sync    — always export as-is (skip auto-rewrite)
 *   rewrite — sanitize restricted terms (default behavior anyway, but
 *             explicit for categories prone to false positives)
 *   default — per-listing auto-optimize decides (no rule stored)
 *   exclude — drop the whole category from the Google feed
 */
const MODES = [
  { value: "", label: "Default (per-listing)" },
  { value: "sync", label: "Sync as-is" },
  { value: "rewrite", label: "Rewrite feed metadata" },
  { value: "exclude", label: "Exclude from Merchant" },
];

export default function MerchantRulesCard() {
  const [categories, setCategories] = useState([]);
  const [modes, setModes] = useState({});   // { category: mode }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const headers = () => ({
    Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}`,
  });

  useEffect(() => {
    axios.get(`${API}/admin/merchant/category-rules`, { headers: headers() })
      .then(({ data }) => {
        setCategories(data.categories || []);
        const m = {};
        for (const r of data.rules || []) m[r.category] = r.mode;
        setModes(m);
      })
      .catch(() => toast.error("Couldn't load merchant rules."))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const rules = Object.entries(modes)
        .filter(([, mode]) => mode)
        .map(([category, mode]) => ({ category, mode }));
      await axios.put(`${API}/admin/merchant/category-rules`, { rules }, { headers: headers() });
      setDirty(false);
      toast.success("Merchant category rules saved.");
    } catch {
      toast.error("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-line bg-surface p-6 mt-6" data-testid="merchant-rules-card">
      <div className="flex items-center justify-between mb-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand inline-flex items-center gap-1.5">
          <ShieldAlert size={12} /> Google Merchant · Category rules
        </div>
        {dirty && (
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand hover:bg-brand-hover text-white font-mono text-[10px] uppercase tracking-[0.2em] disabled:opacity-50"
            data-testid="merchant-rules-save"
          >
            <Save size={11} /> {saving ? "Saving…" : "Save rules"}
          </button>
        )}
      </div>
      <p className="font-mono text-[10px] text-ink-muted mb-4 leading-relaxed">
        Per-category handling for the Google Shopping feed. Restricted-term
        rewriting (knife → keepsake, hunting → outdoor…) runs by default;
        use these rules to force a category to sync untouched or drop it
        from the feed entirely.
      </p>
      {loading ? (
        <div className="font-mono text-xs text-ink-muted">Loading…</div>
      ) : categories.length === 0 ? (
        <div className="font-mono text-xs text-ink-muted">No published categories found.</div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          {categories.map((cat) => (
            <div key={cat} className="flex items-center justify-between gap-3 py-1 border-b border-line/60">
              <span className="font-mono text-xs text-ink truncate" title={cat}>{cat}</span>
              <select
                value={modes[cat] || ""}
                onChange={(e) => {
                  setModes((m) => ({ ...m, [cat]: e.target.value }));
                  setDirty(true);
                }}
                className="bg-paper border border-line focus:border-brand outline-none font-mono text-[11px] px-2 py-1"
                data-testid={`merchant-rule-${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
