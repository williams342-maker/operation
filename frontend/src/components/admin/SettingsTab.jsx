import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchAdminSettings,
  patchAdminSettings,
  adminClearAllChat,
  adminClearIdleChat,
  fetchAdminFeedback,
  adminResolveFeedback,
} from "../../lib/api";
import { refreshSiteSettings } from "../../hooks/useSiteSettings";
import { RowsSkeleton } from "../Skeleton";

const SWITCHES = [
  {
    key: "maintenance_mode",
    label: "Maintenance Mode",
    blurb: "When ON, every public route shows a branded maintenance page. Admin + maker portals stay accessible so you can flip it back off.",
    tone: "danger",
    messageKey: "maintenance_message",
    messageLabel: "Message shown on the maintenance page",
  },
  {
    key: "beta_mode",
    label: "Beta Mode",
    blurb: "Show a sticky 'Beta' banner sitewide with a feedback button. Submissions email ops + persist to /admin/dashboard for triage.",
    tone: "warn",
    messageKey: "beta_message",
    messageLabel: "Banner message",
  },
  {
    key: "allow_maker_applications",
    label: "Allow New Maker Applications",
    blurb: "When OFF, /apply rejects new submissions with the configured copy. Use to throttle inbound during reviews.",
    tone: "primary",
    messageKey: "applications_closed_message",
    messageLabel: "'Applications closed' copy",
  },
  {
    key: "beta_signup_enabled",
    label: "Founding Seller Beta Signup",
    blurb: "Master switch for the bold ◆ BETA SIGNUP button in the header AND the /beta landing page. When OFF, the Nav hides the pill and /beta shows a 'spots are closed' state — existing Founding Sellers keep their perks.",
    tone: "warn",
  },
  {
    key: "live_chat_enabled",
    label: "Live Chat",
    blurb: "Master kill-switch for WebSocket chat. When OFF, new connections are rejected and the Chat tab is hidden in /community.",
    tone: "warn",
  },
  {
    key: "auto_clear_idle_rooms",
    label: "Auto-clear idle rooms",
    blurb: "When ON, the scheduler purges chat rooms with no activity in the past N minutes. Runs every 10 min.",
    tone: "primary",
    numericKey: "idle_clear_minutes",
    numericLabel: "Idle window (minutes)",
    numericMin: 5,
    numericMax: 1440,
  },
  {
    key: "ai_moderator_enabled",
    label: "AI Moderator (chat & forum)",
    blurb: "When ON, every chat message AND every forum thread/reply is classified by Claude before being saved. Slurs/threats are blocked and the offender gets a private notice; spammy messages get a warn nudge but still post. Decisions are logged to the audit log with a `chat:`/`forum:` channel prefix.",
    tone: "primary",
  },
];

const toneClass = (tone, on) => {
  if (!on) return "bg-[#262626] border-[#262626]";
  if (tone === "danger") return "bg-red-600 border-red-700";
  if (tone === "warn") return "bg-yellow-500 border-yellow-600";
  return "bg-emerald-600 border-emerald-700";
};

function ToggleRow({ row, settings, onPatch, busy }) {
  const on = !!settings[row.key];
  return (
    <div
      className={`border p-4 md:p-5 transition ${on ? "border-[#ff4500]/40 bg-[#ff4500]/5" : "border-[#262626]"}`}
      data-testid={`setting-row-${row.key}`}
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg uppercase">{row.label}</div>
          <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1">{row.blurb}</p>
        </div>
        <button
          role="switch"
          aria-checked={on}
          disabled={busy}
          onClick={() => onPatch({ [row.key]: !on })}
          className={`relative inline-flex h-7 w-14 shrink-0 items-center border transition disabled:opacity-50 ${toneClass(row.tone, on)}`}
          data-testid={`setting-toggle-${row.key}`}
        >
          <span
            className={`inline-block h-5 w-5 bg-white shadow transition-transform ${on ? "translate-x-8" : "translate-x-1"}`}
          />
        </button>
      </div>

      {on && row.messageKey && (
        <label className="block mt-4">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
            {row.messageLabel}
          </span>
          <textarea
            rows={2}
            value={settings[row.messageKey] || ""}
            onChange={(e) => onPatch({ [row.messageKey]: e.target.value }, /*debounce*/ true)}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid={`setting-text-${row.messageKey}`}
          />
        </label>
      )}

      {on && row.numericKey && (
        <label className="block mt-4 max-w-xs">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
            {row.numericLabel}
          </span>
          <input
            type="number"
            min={row.numericMin}
            max={row.numericMax}
            value={settings[row.numericKey] || 60}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) onPatch({ [row.numericKey]: n }, /*debounce*/ true);
            }}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            data-testid={`setting-num-${row.numericKey}`}
          />
        </label>
      )}
    </div>
  );
}

function HardClearCard({ onCleared }) {
  const [step, setStep] = useState(0); // 0=idle, 1=first confirm, 2=double confirm
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const fire = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await adminClearAllChat();
      setResult(r);
      setStep(0);
      toast.success(`Cleared ${r.deleted} chat message${r.deleted === 1 ? "" : "s"}.`);
      onCleared?.();
    } catch (e) {
      const msg = e?.response?.data?.detail || "Failed to clear chat.";
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-red-900/60 bg-red-950/20 p-4 md:p-5" data-testid="hard-clear-card">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-red-400 mb-2">
        ◆ Danger zone
      </div>
      <div className="font-display text-lg uppercase">Hard clear all chat rooms</div>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1 mb-4">
        Permanently deletes every chat message across every room. Cannot be undone.
        Forum threads and replies are not touched.
      </p>
      {result && (
        <p className="font-mono text-xs text-emerald-300 mb-3" data-testid="hard-clear-result">
          ◆ Cleared {result.deleted} message{result.deleted === 1 ? "" : "s"}.
        </p>
      )}
      {err && <p className="font-mono text-xs text-red-400 mb-3">{err}</p>}
      {step === 0 && (
        <button
          onClick={() => setStep(1)}
          className="px-4 py-2 border border-red-700 text-red-300 hover:bg-red-900/30 font-mono text-[11px] uppercase tracking-[0.22em]"
          data-testid="hard-clear-btn"
        >
          Hard clear all rooms
        </button>
      )}
      {step === 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStep(2)}
            className="px-4 py-2 border border-red-700 bg-red-900/30 text-red-200 font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="hard-clear-confirm-1"
          >
            I understand · continue
          </button>
          <button
            onClick={() => setStep(0)}
            className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em]"
          >
            Cancel
          </button>
        </div>
      )}
      {step === 2 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={fire}
            disabled={busy}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white border border-red-700 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="hard-clear-confirm-2"
          >
            {busy ? "Clearing…" : "Yes — wipe everything"}
          </button>
          <button
            onClick={() => setStep(0)}
            className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em]"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function IdleClearNowCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const fire = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await adminClearIdleChat();
      setResult(r);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border border-[#262626] p-4 md:p-5" data-testid="idle-clear-now-card">
      <div className="font-display text-lg uppercase">Run idle-clear now</div>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1 mb-4">
        Manually trigger the idle-room cleanup using the configured idle window.
        Useful for spot-checking before relying on the cron.
      </p>
      {result && (
        <pre className="font-mono text-[10px] text-[#a3a3a3] mb-3 overflow-x-auto bg-[#0d0d0d] border border-[#262626] p-2" data-testid="idle-clear-now-result">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      {err && <p className="font-mono text-xs text-red-400 mb-3">{err}</p>}
      <button
        onClick={fire}
        disabled={busy}
        className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
        data-testid="idle-clear-now-btn"
      >
        {busy ? "Running…" : "Run idle-clear now"}
      </button>
    </div>
  );
}

function FeedbackInbox() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("open"); // open | all | resolved

  const refresh = async () => {
    setLoading(true);
    try {
      const resolved = filter === "all" ? undefined : filter === "resolved";
      const data = await fetchAdminFeedback(resolved);
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const resolve = async (id) => {
    await adminResolveFeedback(id);
    await refresh();
  };

  return (
    <div className="border border-[#262626] p-4 md:p-5" data-testid="feedback-inbox">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="font-display text-lg uppercase">Beta feedback inbox</div>
        <div className="flex border border-[#262626]">
          {["open", "resolved", "all"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] border-r border-[#262626] last:border-r-0 ${
                filter === f ? "bg-[#ff4500] text-[#0a0a0a]" : "text-[#a3a3a3] hover:text-[#e5e5e5]"
              }`}
              data-testid={`feedback-filter-${f}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <p className="font-mono text-xs text-[#a3a3a3]">Loading…</p>
      ) : !items.length ? (
        <p className="font-mono text-xs text-[#a3a3a3]" data-testid="feedback-empty">No {filter === "all" ? "" : filter + " "}feedback yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="border border-[#262626] p-3" data-testid={`feedback-${it.id}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-display text-base">{it.name}</div>
                <div className="font-mono text-[10px] text-[#525252]">
                  {(it.created_at || "").slice(0, 16).replace("T", " ")} · {it.page || "—"}
                </div>
              </div>
              <a href={`mailto:${it.email}`} className="font-mono text-[10px] text-[#a3a3a3] hover:text-[#ff4500]">
                {it.email}
              </a>
              <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-2 whitespace-pre-wrap">{it.message}</p>
              {!it.resolved && (
                <button
                  onClick={() => resolve(it.id)}
                  className="mt-3 px-3 py-1 border border-emerald-800 hover:border-emerald-500 hover:text-emerald-300 font-mono text-[10px] uppercase tracking-[0.22em]"
                  data-testid={`feedback-resolve-${it.id}`}
                >
                  Mark resolved
                </button>
              )}
              {it.resolved && (
                <span className="inline-block mt-3 px-2 py-0.5 border border-emerald-800 bg-emerald-900/30 text-emerald-300 font-mono text-[9px] uppercase tracking-[0.22em]">
                  Resolved
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MaintenanceScheduleCard({ settings, onPatch, busy }) {
  // Convert ISO → datetime-local format ("YYYY-MM-DDTHH:MM")
  const toLocal = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ""; }
  };
  // Convert datetime-local → ISO UTC
  const toIso = (local) => {
    if (!local) return "";
    try { return new Date(local).toISOString(); } catch { return ""; }
  };

  return (
    <div className="border border-[#262626] p-4 md:p-5" data-testid="maintenance-schedule-card">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
        ◆ Scheduled Maintenance
      </div>
      <div className="font-display text-lg uppercase">Plan a window</div>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1 mb-4">
        Set a future time to flip Maintenance Mode on, off, or both. The cron
        runs every minute and clears each schedule once it fires. Leave a field
        blank to skip it.
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
            Turn ON at (local time)
          </span>
          <input
            type="datetime-local"
            value={toLocal(settings.maintenance_scheduled_on)}
            onChange={(e) =>
              onPatch({ maintenance_scheduled_on: toIso(e.target.value) }, true)
            }
            disabled={busy}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            data-testid="maintenance-scheduled-on"
          />
        </label>
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
            Turn OFF at (local time)
          </span>
          <input
            type="datetime-local"
            value={toLocal(settings.maintenance_scheduled_off)}
            onChange={(e) =>
              onPatch({ maintenance_scheduled_off: toIso(e.target.value) }, true)
            }
            disabled={busy}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            data-testid="maintenance-scheduled-off"
          />
        </label>
      </div>
      {(settings.maintenance_scheduled_on || settings.maintenance_scheduled_off) && (
        <button
          onClick={() =>
            onPatch({ maintenance_scheduled_on: "", maintenance_scheduled_off: "" })
          }
          disabled={busy}
          className="mt-4 px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
          data-testid="maintenance-clear-schedule"
        >
          ✕ Clear schedule
        </button>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// SEO diagnostics — hits the public /api/seo/diag endpoint and surfaces
// exactly what `site_root()` resolved to. Flags preview-domain leakage
// (happens when PUBLIC_SITE_URL env var isn't set on a deploy) with a red
// "FIX ME" badge so the operator can't miss it.
// ─────────────────────────────────────────────────────────────────────────────
function SeoDiagCard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setErr("");
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const r = await fetch(`${API}/api/seo/diag`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e.message || "Failed to load");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const leaked = data?.preview_domain_leakage;
  const healthy = data && !leaked;

  return (
    <section className="border border-[#262626] p-4 md:p-5" data-testid="seo-diag-card">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">SEO · sitemap & robots</div>
          <h3 className="font-display text-xl mt-1 text-[#e5e5e5]">Indexing health</h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl">
            Confirms `PUBLIC_SITE_URL` is wired correctly and search engines
            will see <code className="text-[#ff4500]">craftersmarket.org</code>{" "}
            URLs (not preview hostnames). Refresh after any deploy.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          data-testid="seo-diag-refresh"
          className="shrink-0 px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
        >
          {busy ? "…" : "↻ Refresh"}
        </button>
      </div>

      {err && <div className="mt-4 font-mono text-xs text-red-400">{err}</div>}

      {data && (
        <div className="mt-4 space-y-3">
          {/* Health pill */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-block px-2 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] font-bold ${
                healthy
                  ? "border-emerald-500/60 text-emerald-400 bg-emerald-500/5"
                  : "border-red-500/60 text-red-400 bg-red-500/5"
              }`}
              data-testid="seo-diag-status"
            >
              {healthy ? "◆ OK" : "✕ Preview leak"}
            </span>
            <span className="font-mono text-xs text-[#e5e5e5]">
              resolved to <code className="text-[#ff4500]">{data.resolved_site_root}</code>
            </span>
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-xs">
            <DiagStat label="static" value={data.breakdown.static_pages} />
            <DiagStat label="products" value={data.breakdown.products} />
            <DiagStat label="makers" value={data.breakdown.makers} />
            <DiagStat label="blog" value={data.breakdown.blog_posts} />
          </div>

          {/* Env var status */}
          <div className="font-mono text-[11px] text-[#a3a3a3] space-y-1 border-t border-[#262626] pt-3">
            <div>
              <span className="text-[#525252]">PUBLIC_SITE_URL:</span>{" "}
              {data.public_site_url_env ? (
                <code className="text-emerald-400">{data.public_site_url_env}</code>
              ) : (
                <span className="text-red-400 font-bold">✕ not set · add to backend env</span>
              )}
            </div>
            <div>
              <span className="text-[#525252]">X-Forwarded-Host:</span>{" "}
              <code className="text-[#e5e5e5]">{data.x_forwarded_host || "—"}</code>
            </div>
            <div>
              <span className="text-[#525252]">Total indexable URLs:</span>{" "}
              <code className="text-[#ff4500]">{data.total_indexable_urls}</code>
            </div>
          </div>

          {/* Quick links */}
          <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.22em] pt-2">
            <a
              href={data.checks.sitemap_endpoint}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] transition"
              data-testid="seo-diag-link-sitemap"
            >
              → sitemap.xml
            </a>
            <a
              href={data.checks.robots_endpoint}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] transition"
              data-testid="seo-diag-link-robots"
            >
              → robots.txt
            </a>
            <a
              href={data.checks.static_index}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] transition"
              data-testid="seo-diag-link-index"
            >
              → static index
            </a>
          </div>

          {leaked && (
            <div className="mt-3 border-l-2 border-red-500 pl-3 font-mono text-[11px] text-red-400 leading-relaxed" data-testid="seo-diag-leak-warning">
              <b>Preview-domain leak detected.</b> Your backend is emitting sitemap
              URLs rooted at a preview hostname. Set{" "}
              <code className="text-[#e5e5e5]">PUBLIC_SITE_URL=https://craftersmarket.org</code>{" "}
              in the deployed backend env, redeploy, then refresh.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DiagStat({ label, value }) {
  return (
    <div className="border border-[#262626] p-2 text-center">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</div>
      <div className="font-display text-2xl text-[#e5e5e5]">{value}</div>
    </div>
  );
}


export default function SettingsTab() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pendingText, setPendingText] = useState({});

  const refresh = async () => {
    setLoading(true);
    try {
      const s = await fetchAdminSettings();
      setSettings(s);
      setPendingText({});
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  // Debounced PATCH for text/numeric edits.
  useEffect(() => {
    const keys = Object.keys(pendingText);
    if (!keys.length) return;
    const t = setTimeout(async () => {
      try {
        const next = await patchAdminSettings(pendingText);
        setSettings(next);
        setPendingText({});
        refreshSiteSettings();
      } catch (e) {
        setErr(e?.response?.data?.detail || "Failed to save.");
      }
    }, 700);
    return () => clearTimeout(t);
  }, [pendingText]);

  const onPatch = async (delta, debounce = false) => {
    setSettings((s) => ({ ...s, ...delta }));
    if (debounce) {
      setPendingText((p) => ({ ...p, ...delta }));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const next = await patchAdminSettings(delta);
      setSettings(next);
      refreshSiteSettings();
      const k = Object.keys(delta)[0];
      const v = delta[k];
      const label = k.replace(/_/g, " ");
      if (typeof v === "boolean") {
        toast.success(`${label} ${v ? "enabled" : "disabled"}`);
      } else {
        toast.success(`${label} updated`);
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Failed to save.";
      setErr(msg);
      toast.error(msg);
      // Revert on failure.
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="space-y-3" data-testid="settings-loading">
        <RowsSkeleton count={6} />
      </div>
    );
  }

  return (
    <div data-testid="settings-tab" className="space-y-6">
      <div className="border border-[#262626] p-4 md:p-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
          ◆ Site Switches
        </div>
        <h3 className="font-display text-2xl uppercase mb-1">Operator controls</h3>
        <p className="font-mono text-xs text-[#a3a3a3]">
          All toggles take effect within ~60 seconds for users (frontend polls /api/settings).
          Admin + maker portals always stay accessible — even in maintenance mode — so you can flip switches back.
        </p>
      </div>

      {err && <p className="font-mono text-xs text-red-400" data-testid="settings-error">{err}</p>}

      <div className="grid gap-3">
        {SWITCHES.map((row) => (
          <ToggleRow
            key={row.key}
            row={row}
            settings={settings}
            onPatch={onPatch}
            busy={busy}
          />
        ))}
      </div>

      <MaintenanceScheduleCard settings={settings} onPatch={onPatch} busy={busy} />

      <SeoDiagCard />

      <div className="grid md:grid-cols-2 gap-3">
        <IdleClearNowCard />
        <HardClearCard onCleared={refresh} />
      </div>

      <FeedbackInbox />
    </div>
  );
}
