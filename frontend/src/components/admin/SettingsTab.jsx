import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Stat } from "./_shared";
import {
  fetchAdminSettings,
  patchAdminSettings,
  adminClearAllChat,
  adminClearIdleChat,
  fetchAdminFeedback,
  adminResolveFeedback,
  replyToFeedback,
  adminGscStatus,
  adminGscOauthStart,
  adminGscDisconnect,
  adminGscTestInspect,
  fetchFeaturedSeedStatus,
  purgeFeaturedSeed,
  attributeWorkshopTeam,
  runWeeklyForumThread,
  installFeaturedSeedFixture,
  fetchCommunityDesignsSeedStatus,
  installCommunityDesignsSeed,
  purgeCommunityDesignsSeed,
  generateOneCommunityDesign,
  generateBatchCommunityDesigns,
  fetchClipsSeedStatus,
  generateOneClipSeed,
  purgeClipsSeed,
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
  {
    key: "auto_dormant_reengage_enabled",
    label: "Auto Dormant-Buyer Re-engagement",
    blurb: "When ON, every Tuesday at 14:00 UTC the scheduler finds buyers dormant 60+ days, mints a one-time 15% off marketplace-wide code (21-day expiry), tags them in Kit as `dormant-buyer-reengaged-auto`, and emails each one. Capped at 50 buyers per run with a 30-day per-buyer cool-off so we never re-pester the same person. The manual blast on the Retention tab still works alongside this — they share the same idempotency table.",
    tone: "warn",
  },
  {
    key: "auto_offsite_backup_enabled",
    label: "Auto Offsite Mongo Backups",
    blurb: "When ON, every night at 03:15 UTC the scheduler runs `mongodump --archive --gzip` of the entire production database, uploads the archive to a private R2 prefix, and sweeps any archive older than the retention window in the same job. Self-skips if R2 is not configured. Manual `Run now` in the Backup tab still works regardless of this toggle (super admin only). The retention window defaults to 30 days; change it via API if you need a longer history.",
    tone: "primary",
  },
  {
    key: "auto_recovery_drill_enabled",
    label: "Auto Recovery Drill (Quarterly)",
    blurb: "When ON, the first day of each quarter (Jan/Apr/Jul/Oct) at 04:30 UTC the scheduler downloads the latest R2 archive, restores it into an isolated `_dr_drill_<timestamp>` namespace on the same Mongo cluster, counts products + makers + blogs to verify the restore worked, drops the namespace, and posts the pass/fail result to your Slack/Discord webhook. Production collections are NEVER touched (the rename is enforced by mongorestore's `--nsFrom/--nsTo`). Manual trigger via the Backup tab works regardless of this toggle. Untested backups don't exist — flip this ON.",
    tone: "warn",
  },
  {
    key: "email_poster_on_admin_edit",
    label: "Email poster on admin edit",
    blurb: "When ON (default), if an admin edits a community design file via the Admin → Design Files tab, we email the original poster a field-level diff so changes don't happen silently. Each edit is also stamped on the file's `admin_edits[]` audit log. Mute this during a bulk-cleanup run if you don't want to spam, then flip back ON. The audit-log row is only written when the email actually goes out.",
    tone: "primary",
  },
  {
    key: "auto_review_prompt_enabled",
    label: "Auto post-delivery review prompts (Daily)",
    blurb: "When ON (default), at 16:00 UTC every day we sweep all orders delivered between 7 and 30 days ago that haven't been prompted yet, and email the buyer a one-tap review CTA per maker on the order. Idempotent — `review_prompt_sent_at` is the source of truth so the same order can never receive a second prompt. Reviews are the single biggest UGC lever for indie shops; expect a 15-25% review-creation rate on prompted orders. Mute during email-deliverability investigations or domain changes. Manual trigger via `POST /api/admin/marketing/review-prompts/run` works regardless of this toggle.",
    tone: "primary",
  },
  {
    key: "auto_publish_5star_reviews_enabled",
    label: "Auto-publish 5-star reviews to Buffer",
    blurb: "When ON, every fresh 5-star review (≥30 chars of text) is auto-queued to every connected Buffer channel — Pinterest, Instagram, Facebook — with the buyer's quote, the maker's name, and a deep link to the product. Idempotent: `posted_to_buffer_at` is stamped on each review so the same row is never re-posted, even on edit. Skips silently if Buffer isn't configured, no channels are connected, or the review is too short. Default OFF — flip ON once your Buffer queue/scheduler is configured to your liking. Free social-proof distribution for makers — expect 1-3 posts/week per active maker.",
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

function CommunityDesignsSeedCard() {
  // Mirror of PurgeFeaturedSeedCard but scoped to the AI-generated
  // Workshop Team design library (`design_files` rows tagged
  // `is_seed: true`). Two safe actions (status refresh + install) and
  // one destructive one (purge) guarded by a 2-step confirm.
  const [status, setStatus] = useState(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installResult, setInstallResult] = useState(null);
  // Generate-one AI button — separate state so it doesn't fight the
  // install/purge confirm flows above.
  const [genBusy, setGenBusy] = useState(false);
  const [genResult, setGenResult] = useState(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState(null);
  const [purgeStep, setPurgeStep] = useState(0);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeResult, setPurgeResult] = useState(null);

  const refresh = async () => {
    try {
      setStatus(await fetchCommunityDesignsSeedStatus());
    } catch (_e) { /* admin-gated; ignore */ }
  };
  useEffect(() => { refresh(); }, []);

  const runInstall = async () => {
    setInstallBusy(true);
    try {
      const r = await installCommunityDesignsSeed();
      setInstallResult(r);
      if (r.ok) {
        toast.success(`Installed ${r.installed} community designs.`);
        refresh();
      } else {
        toast.error(r.error || "Install failed.");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Install failed.");
    } finally {
      setInstallBusy(false);
    }
  };

  const runPurge = async () => {
    setPurgeBusy(true);
    try {
      const r = await purgeCommunityDesignsSeed();
      setPurgeResult(r);
      setPurgeStep(0);
      toast.success(`Purged ${r.deleted} seeded designs.`);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Purge failed.");
    } finally {
      setPurgeBusy(false);
    }
  };

  const runGenerate = async () => {
    setGenBusy(true);
    try {
      const r = await generateOneCommunityDesign();
      setGenResult(r);
      if (r.status === "ok") {
        toast.success(`Generated "${r.design.title}" (${r.design.template_id}).`);
        refresh();
      } else {
        toast.error(r.reason || "Generation failed.");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Generation failed.");
    } finally {
      setGenBusy(false);
    }
  };

  const runBatch = async () => {
    setBatchBusy(true);
    try {
      const r = await generateBatchCommunityDesigns(5);
      setBatchResult(r);
      toast.success(`Generated ${r.succeeded}/${r.requested} designs.${r.failed ? ` ${r.failed} failed.` : ""}`);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Batch generation failed.");
    } finally {
      setBatchBusy(false);
    }
  };

  const seeded = status?.seeded_designs ?? 0;

  return (
    <div
      className="border border-amber-900/60 bg-amber-950/15 p-4 md:p-5"
      data-testid="community-designs-seed-card"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-amber-400 mb-2">
        ◆ Community design library seed
      </div>
      <div className="font-display text-lg uppercase">Workshop Team design files</div>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1 mb-3">
        10 AI-generated, royalty-free CNC / laser / plasma design bundles (SVG + DXF + JPG preview)
        attributed to <span className="text-amber-300">"Crafters Market Workshop Team"</span>.
        Source files ship with the frontend deploy under <code className="text-emerald-300">/seed-designs/</code> —
        this card just writes the Mongo rows. Organic uploads are untouched (no <code>is_seed</code> flag).
      </p>

      {status && (
        <div
          className="font-mono text-[11px] text-[#a3a3a3] mb-4 grid grid-cols-2 gap-3 max-w-md"
          data-testid="community-designs-seed-counts"
        >
          <div className="border border-[#262626] px-2 py-1.5">
            <div className="text-[#525252] uppercase tracking-[0.2em] text-[9px]">Seeded</div>
            <div className="text-amber-300 text-base">{status.seeded_designs}</div>
          </div>
          <div className="border border-[#262626] px-2 py-1.5">
            <div className="text-[#525252] uppercase tracking-[0.2em] text-[9px]">All design files</div>
            <div className="text-amber-300 text-base">{status.total_designs}</div>
          </div>
        </div>
      )}

      <div className="mb-4 pb-4 border-b border-amber-900/40">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300 mb-1">
          ◆ Install community design seed (one-click · idempotent)
        </div>
        <p className="font-mono text-[11px] text-[#a3a3a3] mb-2 leading-relaxed max-w-2xl">
          Populates the <code className="text-emerald-300">design_files</code> collection with the
          curated 10-design Workshop Team library committed to the repo. Existing download counts
          are preserved on re-install. Use after fresh deploys.
        </p>
        <button
          onClick={runInstall}
          disabled={installBusy}
          className="px-3 py-1.5 border border-emerald-600 text-emerald-300 hover:bg-emerald-900/30 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
          data-testid="install-community-designs-seed-btn"
        >
          {installBusy ? "Installing…" : "Install community design seed"}
        </button>
        {installResult?.ok && (
          <div
            className="mt-2 font-mono text-[11px] text-emerald-300"
            data-testid="install-community-designs-seed-result"
          >
            ◆ Installed {installResult.installed} designs · total seeded now: {installResult.totals_now.seeded_designs}
          </div>
        )}
      </div>

      {/* AI generate-one button — mirrors the "Seed fresh thread now"
          pattern. Picks the least-used parametric template (welcome
          arch / family est / garage sign / heart quote / star ornament),
          has Gemini Flash fill in copy + params, then composes a real
          SVG + DXF + Nano Banana preview. Hit it whenever the library
          needs more variety. */}
      <div className="mb-4 pb-4 border-b border-amber-900/40">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300 mb-1">
          ◇ AI fresh design · Run now
        </div>
        <p className="font-mono text-[11px] text-[#a3a3a3] mb-2 leading-relaxed max-w-2xl">
          Adds <span className="text-amber-300">1 new design file</span> picked from the parametric
          template bank (Welcome arch, Family EST plaque, Garage sign, Heart quote, Star ornament).
          Gemini Flash picks copy + theme, then we generate real <code className="text-emerald-300">SVG + DXF</code> and a
          Nano-Banana lifestyle preview JPG. Takes ~15–25s.
        </p>
        <button
          onClick={runGenerate}
          disabled={genBusy || batchBusy}
          className="px-3 py-1.5 border border-amber-700 text-amber-200 hover:bg-amber-900/30 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
          data-testid="generate-one-community-design-btn"
        >
          {genBusy ? "Generating…" : "Generate fresh design file"}
        </button>
        <button
          onClick={runBatch}
          disabled={genBusy || batchBusy}
          className="ml-2 px-3 py-1.5 border border-amber-700 text-amber-200 hover:bg-amber-900/30 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
          data-testid="generate-batch-community-designs-btn"
          title="Generate 5 designs back-to-back (round-robin across templates). Takes 60-120s."
        >
          {batchBusy ? "Generating 5…" : "Generate 5 at once"}
        </button>
        <p className="font-mono text-[10px] text-[#525252] mt-2 leading-relaxed max-w-2xl">
          ◇ Cron <code className="text-emerald-300">daily_design_file</code> adds 1 fresh design every day at
          08:00 UTC (toggle via <code>SCHEDULER_DAILY_DESIGNS</code> env). The buttons above are for on-demand top-ups.
        </p>
        {genResult?.status === "ok" && (
          <div
            className="mt-2 font-mono text-[11px] text-emerald-300"
            data-testid="generate-one-community-design-result"
          >
            ◆ &quot;{genResult.design.title}&quot; · template: {genResult.design.template_id} · slug: {genResult.design.slug}
            <div className="text-[#737373] mt-1 break-all">
              svg: {genResult.design.svg_url} · dxf: {genResult.design.dxf_url}
            </div>
          </div>
        )}
        {batchResult && (
          <div
            className="mt-2 font-mono text-[11px] text-emerald-300"
            data-testid="generate-batch-community-designs-result"
          >
            ◆ Batch: {batchResult.succeeded}/{batchResult.requested} succeeded
            {batchResult.failed > 0 && <span className="text-red-400"> · {batchResult.failed} failed</span>}
            <ul className="mt-1 text-[#737373] space-y-0.5">
              {(batchResult.designs || []).slice(0, 5).map((d) => (
                <li key={d.slug}>· {d.template_id} → {d.title}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {purgeResult && (
        <p
          className="font-mono text-xs text-emerald-300 mb-3"
          data-testid="purge-community-designs-result"
        >
          ◆ Deleted {purgeResult.deleted} seeded designs.
        </p>
      )}

      {purgeStep === 0 && (
        <button
          onClick={() => setPurgeStep(1)}
          disabled={seeded === 0}
          className="px-4 py-2 border border-amber-700 text-amber-300 hover:bg-amber-900/30 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="purge-community-designs-btn"
        >
          {seeded === 0 ? "Nothing to purge" : `Purge ${seeded} seeded design${seeded === 1 ? "" : "s"}`}
        </button>
      )}
      {purgeStep === 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setPurgeStep(2)}
            className="px-4 py-2 border border-amber-700 bg-amber-900/30 text-amber-200 font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="purge-community-designs-confirm-1"
          >
            I understand · continue
          </button>
          <button
            onClick={() => setPurgeStep(0)}
            className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em]"
          >
            Cancel
          </button>
        </div>
      )}
      {purgeStep === 2 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={runPurge}
            disabled={purgeBusy}
            className="px-4 py-2 border border-red-600 bg-red-900/30 text-red-200 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="purge-community-designs-confirm-2"
          >
            {purgeBusy ? "Purging…" : `Yes — hard-delete ${seeded}`}
          </button>
          <button
            onClick={() => setPurgeStep(0)}
            className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em]"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function ClipsSeedCard() {
  // Sora-2 seeded clip feed. Each click renders one fresh vertical 9:16
  // video (~2-5 min). Mirrors the design-seed card but with a stronger
  // "this is slow" warning since Sora is meaningfully slower than Nano
  // Banana.
  const [status, setStatus] = useState(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genResult, setGenResult] = useState(null);
  const [purgeStep, setPurgeStep] = useState(0);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [model, setModel] = useState("sora-2-pro");

  const refresh = async () => {
    try { setStatus(await fetchClipsSeedStatus()); } catch (_e) { /* admin-gated */ }
  };
  useEffect(() => { refresh(); }, []);

  const runGenerate = async () => {
    setGenBusy(true);
    try {
      const r = await generateOneClipSeed(model);
      setGenResult(r);
      if (r.status === "ok") {
        toast.success(`Generated "${r.clip.title}" (${r.clip.category}).`);
        refresh();
      } else {
        toast.error(r.reason || "Sora generation failed.");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Generation failed.");
    } finally { setGenBusy(false); }
  };

  const runPurge = async () => {
    setPurgeBusy(true);
    try {
      const r = await purgeClipsSeed();
      toast.success(`Purged ${r.deleted} seeded clips.`);
      setPurgeStep(0);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Purge failed.");
    } finally { setPurgeBusy(false); }
  };

  return (
    <div
      className="border border-purple-900/60 bg-purple-950/15 p-4 md:p-5"
      data-testid="clips-seed-card"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-purple-400 mb-2">
        ◆ Workshop Clip Feed seed (Sora 2)
      </div>
      <div className="font-display text-lg uppercase">Short-form video seed</div>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1 mb-3">
        Generates one Sora-2 rendered vertical clip (9:16, 8s) per click, picked from the least-used
        (category × prompt) combo across 6 categories (workshop · cuts · welding · powder-coat ·
        engraving · before-after). Files land in <code className="text-emerald-300">/seed-clips/&lt;slug&gt;/</code>
        and are attributed to the <span className="text-purple-300">Workshop Team</span>.
        ⚠ Each render takes <strong>2–5 minutes</strong> — keep the tab open.
      </p>

      {status && (
        <div className="font-mono text-[11px] text-[#a3a3a3] mb-4 grid grid-cols-3 gap-2 max-w-md" data-testid="clips-seed-counts">
          <div className="border border-[#262626] px-2 py-1.5">
            <div className="text-[#525252] uppercase tracking-[0.2em] text-[9px]">Seeded</div>
            <div className="text-purple-300 text-base">{status.seeded_clips}</div>
          </div>
          <div className="border border-[#262626] px-2 py-1.5">
            <div className="text-[#525252] uppercase tracking-[0.2em] text-[9px]">AI</div>
            <div className="text-purple-300 text-base">{status.ai_clips}</div>
          </div>
          <div className="border border-[#262626] px-2 py-1.5">
            <div className="text-[#525252] uppercase tracking-[0.2em] text-[9px]">All clips</div>
            <div className="text-purple-300 text-base">{status.total_clips}</div>
          </div>
        </div>
      )}

      <div className="mb-4 pb-4 border-b border-purple-900/40 space-y-2">
        <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          Model
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="ml-2 bg-[#0a0a0a] border border-[#262626] px-2 py-1 font-mono text-xs"
            data-testid="clips-seed-model"
          >
            <option value="sora-2-pro">sora-2-pro · 1024×1792 (recommended)</option>
            <option value="sora-2">sora-2 · 1280×720 horizontal (cheaper)</option>
          </select>
        </label>
        <div>
          <button
            onClick={runGenerate}
            disabled={genBusy}
            className="px-3 py-1.5 border border-purple-600 text-purple-200 hover:bg-purple-900/30 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="generate-one-clip-btn"
          >
            {genBusy ? "Rendering clip… (2–5 min)" : "Generate fresh clip"}
          </button>
        </div>
        {genResult?.status === "ok" && (
          <div className="font-mono text-[11px] text-emerald-300" data-testid="generate-one-clip-result">
            ◆ &quot;{genResult.clip.title}&quot; · {genResult.clip.category} · slug: {genResult.clip.slug}
          </div>
        )}
        {genResult?.status === "error" && (
          <div className="font-mono text-[11px] text-red-400" data-testid="generate-one-clip-error">
            ✕ {genResult.reason}
          </div>
        )}
      </div>

      {purgeStep === 0 && (
        <button
          onClick={() => setPurgeStep(1)}
          disabled={!(status?.seeded_clips > 0)}
          className="px-4 py-2 border border-purple-700 text-purple-300 hover:bg-purple-900/30 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="purge-clips-seed-btn"
        >
          {status?.seeded_clips > 0
            ? `Purge ${status.seeded_clips} seeded clip${status.seeded_clips === 1 ? "" : "s"}`
            : "Nothing to purge"}
        </button>
      )}
      {purgeStep === 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={runPurge}
            disabled={purgeBusy}
            className="px-4 py-2 border border-red-600 bg-red-900/30 text-red-200 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="purge-clips-confirm"
          >
            {purgeBusy ? "Purging…" : "Yes — purge"}
          </button>
          <button
            onClick={() => setPurgeStep(0)}
            className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em]"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function OperatorOpsChecklistCard() {
  // Consolidated post-deploy / weekly-ops checklist. Each row is one
  // operator concern with a live status probe + a "Run check" button and
  // a deep-link to the existing tab that handles deeper actions. The
  // backing diagnostic endpoints are all unchanged — this is purely a
  // single-pane-of-glass surface so nothing gets forgotten on deploy day.
  const API = process.env.REACT_APP_BACKEND_URL;
  const [seoDiag, setSeoDiag] = useState(null);
  const [seoBusy, setSeoBusy] = useState(false);
  const [seoErr, setSeoErr] = useState("");
  const [prerenderResult, setPrerenderResult] = useState(null);
  const [prerenderBusy, setPrerenderBusy] = useState(false);
  const [indexnowBusy, setIndexnowBusy] = useState(false);
  const [indexnowResult, setIndexnowResult] = useState(null);

  // ── SEO diag (sitemap host + total indexable count) ─────────────────────
  const runSeoDiag = async () => {
    setSeoBusy(true); setSeoErr("");
    try {
      const r = await fetch(`${API}/api/seo/diag`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSeoDiag(await r.json());
    } catch (e) {
      setSeoErr(e.message || "Failed");
    } finally { setSeoBusy(false); }
  };
  useEffect(() => { runSeoDiag(); /* eslint-disable-next-line */ }, []);

  // ── Cloudflare-Worker prerender probe: hit any OG endpoint directly to
  //    confirm FastAPI returns a complete <meta og:title>. Doesn't talk to
  //    Cloudflare itself (no zone API token here) — we just sanity-check
  //    the origin endpoint that the Worker forwards to. If this is broken,
  //    Cloudflare can't possibly serve a good unfurl. ────────────────────
  const runPrerenderProbe = async () => {
    setPrerenderBusy(true); setPrerenderResult(null);
    try {
      const r = await fetch(`${API}/api/og/diag`);
      const ok = r.ok && (await r.headers.get("content-type"))?.includes("application/json");
      const body = ok ? await r.json() : null;
      setPrerenderResult({ ok: !!body, status: r.status, body });
    } catch (e) {
      setPrerenderResult({ ok: false, error: e.message });
    } finally { setPrerenderBusy(false); }
  };

  // ── IndexNow ping — handled by an existing admin endpoint. Just calls it
  //    so the operator gets a one-click "tell Bing/Yandex about every URL"
  //    affordance from this checklist. ─────────────────────────────────
  const runIndexNow = async () => {
    setIndexnowBusy(true); setIndexnowResult(null);
    try {
      const r = await fetch(`${API}/api/admin/seo/ping`, {
        method: "POST", headers: adminAuthHeaders(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setIndexnowResult(await r.json());
      toast.success("IndexNow ping submitted.");
    } catch (e) {
      toast.error(e?.message || "Ping failed.");
      setIndexnowResult({ ok: false, error: e.message });
    } finally { setIndexnowBusy(false); }
  };

  const seoLeaked = seoDiag?.preview_domain_leakage;
  const seoHealthy = seoDiag && !seoLeaked && seoDiag.resolved_site_root?.endsWith(".org");
  const prerenderHealthy = !!prerenderResult?.ok;

  return (
    <section
      className="border border-cyan-900/60 bg-cyan-950/15 p-4 md:p-5"
      data-testid="operator-ops-checklist"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-400 mb-2">
        ◆ Operator ops checklist
      </div>
      <div className="font-display text-lg uppercase">Post-deploy 5-minute sweep</div>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1 mb-4 max-w-2xl">
        One-stop verification panel. Hit each row's button after every prod
        deploy and weekly thereafter. Backing docs live in{" "}
        <code className="text-emerald-300">/app/docs/</code> (Cloudflare
        Worker · SEO submission · Mongo backup).
      </p>

      <div className="space-y-3">
        {/* 1 — Cloudflare prerender Worker ----------------------------- */}
        <OpsRow
          step="1"
          title="Cloudflare prerender Worker"
          subtitle="Origin OG endpoint should return JSON · the Worker routes social-bot UAs here. Doc: /app/docs/cloudflare-worker-prerender.md"
          status={prerenderResult == null ? "idle" : prerenderHealthy ? "ok" : "fail"}
          statusLabel={
            prerenderResult == null
              ? "Not checked yet"
              : prerenderHealthy
                ? "Origin OG diag · 200 OK"
                : `Failed (HTTP ${prerenderResult.status || "?"})`
          }
          onRun={runPrerenderProbe}
          busy={prerenderBusy}
          testIdPrefix="ops-prerender"
        />

        {/* 2 — GSC / Bing sitemap submission ---------------------------- */}
        <OpsRow
          step="2"
          title="Sitemap & search-engine submission"
          subtitle={
            seoDiag
              ? `Resolved: ${seoDiag.resolved_site_root} · ${seoDiag.total_indexable_urls} URLs in sitemap`
              : "Confirms PUBLIC_SITE_URL is wired correctly · no preview-domain leakage"
          }
          status={!seoDiag ? "idle" : seoHealthy ? "ok" : "fail"}
          statusLabel={
            !seoDiag
              ? "Loading…"
              : seoLeaked
                ? "⚠ Preview-domain leakage — fix PUBLIC_SITE_URL"
                : seoHealthy
                  ? "Clean"
                  : "Check resolved host"
          }
          onRun={runSeoDiag}
          busy={seoBusy}
          err={seoErr}
          testIdPrefix="ops-sitemap"
          actions={
            <button
              onClick={runIndexNow}
              disabled={indexnowBusy}
              data-testid="ops-indexnow-ping"
              className="px-2.5 py-1 border border-cyan-700 text-cyan-200 hover:bg-cyan-900/30 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
            >
              {indexnowBusy ? "Pinging…" : "Ping IndexNow"}
            </button>
          }
        />
        {indexnowResult?.count > 0 && (
          <div
            className="font-mono text-[10px] text-emerald-300 ml-12 -mt-1"
            data-testid="ops-indexnow-result"
          >
            ◆ Submitted {indexnowResult.count} URLs to api.indexnow.org · Bing/Yandex/Naver will see new content within hours.
          </div>
        )}

        {/* 3 — Backup toggle verification ------------------------------- */}
        <OpsRow
          step="3"
          title="Backup & recovery toggle"
          subtitle={
            <>
              Verify <code className="text-emerald-300">auto_offsite_backup_enabled</code> + <code className="text-emerald-300">auto_recovery_drill_enabled</code> are ON
              (Settings → top of this tab). Doc: /app/docs/mongodb-backup.md
            </>
          }
          status="idle"
          statusLabel="Open the Backup tab to run a manual drill"
          onRun={() => {
            window.dispatchEvent(new CustomEvent("cm:open-admin-tab", { detail: { tab: "backup" } }));
            toast.message("Switch to the Backup tab to run a drill or download an archive.");
          }}
          busy={false}
          runLabel="Open Backup tab"
          testIdPrefix="ops-backup"
        />
      </div>
    </section>
  );
}

function OpsRow({
  step, title, subtitle, status, statusLabel, onRun, busy, err,
  runLabel = "Run check", actions, testIdPrefix,
}) {
  // status ∈ idle | ok | fail · drives the left dot color so an operator
  // can scan the column in a glance.
  const dot =
    status === "ok"   ? "bg-emerald-400 text-emerald-400"
    : status === "fail" ? "bg-red-400 text-red-400"
                        : "bg-[#525252] text-[#525252]";
  return (
    <div
      className="border border-[#262626] bg-[#0a0a0a]/40 p-3 flex items-start gap-3"
      data-testid={`${testIdPrefix}-row`}
    >
      <div className="flex flex-col items-center gap-1 pt-1 shrink-0 w-8">
        <span className={`w-2.5 h-2.5 rounded-full ${dot.split(" ")[0]}`} aria-hidden="true" />
        <span className="font-mono text-[10px] text-[#525252]">{step}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-sm text-[#e5e5e5]">{title}</div>
        <div className="font-mono text-[10px] text-[#a3a3a3] mt-0.5 leading-relaxed">
          {subtitle}
        </div>
        <div className={`font-mono text-[10px] mt-1 ${dot.split(" ")[1]}`} data-testid={`${testIdPrefix}-status`}>
          {statusLabel}{err && ` · ${err}`}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 shrink-0">
        <button
          onClick={onRun}
          disabled={busy}
          data-testid={`${testIdPrefix}-run`}
          className="px-2.5 py-1 border border-[#262626] hover:border-cyan-500 hover:text-cyan-300 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
        >
          {busy ? "…" : runLabel}
        </button>
        {actions}
      </div>
    </div>
  );
}

function PurgeFeaturedSeedCard() {
  const [status, setStatus] = useState(null);   // {featured_makers, featured_products, ...}
  const [step, setStep] = useState(0);          // 0 idle · 1 first confirm · 2 second confirm
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  // Separate state for the (much safer) Workshop Team attribution action
  // so the user can run it without interfering with the destructive purge
  // confirm-flow above.
  const [attrBusy, setAttrBusy] = useState(false);
  const [attrResult, setAttrResult] = useState(null);
  // Weekly forum thread manual trigger — same handler shape as
  // attribution so the two "safe action" blocks share styling.
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const [weeklyResult, setWeeklyResult] = useState(null);
  // One-shot "install everything" — used to populate an empty production
  // DB from the curated seed fixture committed to the repo.
  const [installBusy, setInstallBusy] = useState(false);
  const [installResult, setInstallResult] = useState(null);

  const refresh = async () => {
    try {
      const s = await fetchFeaturedSeedStatus();
      setStatus(s);
    } catch (_e) { /* gated to admins; ignore failures silently */ }
  };
  useEffect(() => { refresh(); }, []);

  const fire = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await purgeFeaturedSeed();
      setResult(r);
      setStep(0);
      toast.success(`Purged ${r.deleted_products} products + ${r.deleted_makers} makers.`);
      refresh();
    } catch (e) {
      const msg = e?.response?.data?.detail || "Purge failed.";
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const runAttribution = async () => {
    setAttrBusy(true);
    try {
      const r = await attributeWorkshopTeam();
      setAttrResult(r);
      const total = r.threads_updated + r.replies_updated + r.showcase_updated;
      toast.success(total === 0
        ? "Already attributed — nothing to update."
        : `Attributed ${total} seeded posts to Workshop Team.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Attribution failed.");
    } finally {
      setAttrBusy(false);
    }
  };

  const runWeekly = async () => {
    setWeeklyBusy(true);
    try {
      const r = await runWeeklyForumThread();
      setWeeklyResult(r);
      if (r.status === "ok") {
        toast.success(`Seeded new thread: "${r.title}" (${r.replies} starter ${r.replies === 1 ? "reply" : "replies"}).`);
      } else if (r.status === "skip") {
        toast.message(r.reason === "topics_exhausted"
          ? "Topic bank exhausted — refill required."
          : "Skipped — see card for details.");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Weekly thread seed failed.");
    } finally {
      setWeeklyBusy(false);
    }
  };

  const runInstall = async () => {
    setInstallBusy(true);
    try {
      const r = await installFeaturedSeedFixture();
      setInstallResult(r);
      if (r.ok) {
        const t = r.installed;
        toast.success(`Installed ${t.makers} makers · ${t.products} products · ${t.threads} threads · ${t.replies} replies.`);
        refresh();
      } else {
        toast.error(r.error || "Install failed.");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Install failed.");
    } finally {
      setInstallBusy(false);
    }
  };

  const total = (status?.featured_makers || 0) + (status?.featured_products || 0);

  return (
    <div className="border border-amber-900/60 bg-amber-950/15 p-4 md:p-5" data-testid="purge-featured-seed-card">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-amber-400 mb-2">
        ◆ Platform seed content
      </div>
      <div className="font-display text-lg uppercase">Purge featured-example content</div>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1 mb-3">
        Hard-removes every product tagged "✦ Featured Example" and every maker tagged
        "✦ Founding Maker · Platform Showcase". Use once organic listings fill the
        catalogue. Organic listings (no flag) are <span className="text-emerald-300">not touched</span>.
      </p>
      {status && (
        <div className="font-mono text-[11px] text-[#a3a3a3] mb-4 grid grid-cols-3 gap-3 max-w-md" data-testid="purge-featured-seed-counts">
          <div className="border border-[#262626] px-2 py-1.5">
            <div className="text-[#525252] uppercase tracking-[0.2em] text-[9px]">Makers</div>
            <div className="text-amber-300 text-base">{status.featured_makers}</div>
          </div>
          <div className="border border-[#262626] px-2 py-1.5">
            <div className="text-[#525252] uppercase tracking-[0.2em] text-[9px]">Products</div>
            <div className="text-amber-300 text-base">{status.featured_products}</div>
          </div>
          <div className="border border-[#262626] px-2 py-1.5">
            <div className="text-[#525252] uppercase tracking-[0.2em] text-[9px]">Published</div>
            <div className="text-amber-300 text-base">{status.published_featured_products}</div>
          </div>
        </div>
      )}
      {result && (
        <p className="font-mono text-xs text-emerald-300 mb-3" data-testid="purge-featured-seed-result">
          ◆ Deleted {result.deleted_products} products + {result.deleted_makers} makers.
        </p>
      )}
      {err && <p className="font-mono text-xs text-red-400 mb-3">{err}</p>}

      {/* Install-everything button — the single most important action
          on a freshly-deployed production database. Replays the curated
          seed fixture so all 8 makers + 34 products + 22 threads + 160
          replies + 8 showcase posts land in one shot. Idempotent so the
          admin can click it any time without fear. */}
      <div className="mb-4 pb-4 border-b border-amber-900/40">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300 mb-1">
          ◆ Install seed content (one-click · for fresh deploys)
        </div>
        <p className="font-mono text-[11px] text-[#a3a3a3] mb-2 leading-relaxed max-w-2xl">
          Populates the database from the curated seed fixture committed to the repo —
          <span className="text-emerald-300"> 8 founding makers, 34 featured-example products,
          22 forum threads, 160 replies, 8 showcase posts</span>. Idempotent. Use this on
          production immediately after a fresh deploy. Images (`/seed-images/featured/*.jpg`)
          ship with the frontend build, so no R2 / image-gen calls are made.
        </p>
        <button
          onClick={runInstall}
          disabled={installBusy}
          className="px-3 py-1.5 border border-emerald-600 text-emerald-300 hover:bg-emerald-900/30 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
          data-testid="install-featured-seed-btn"
        >
          {installBusy ? "Installing…" : "Install seed content"}
        </button>
        {installResult?.ok && (
          <div
            className="mt-2 font-mono text-[11px] text-emerald-300"
            data-testid="install-featured-seed-result"
          >
            ◆ Installed {installResult.installed.makers} makers · {installResult.installed.products} products · {installResult.installed.threads} threads · {installResult.installed.replies} replies · {installResult.installed.showcase} showcase
            <div className="text-[#737373] mt-1">
              now: {installResult.totals_now.featured_makers}/{installResult.totals_now.featured_products}/{installResult.totals_now.seeded_threads}/{installResult.totals_now.seeded_replies}/{installResult.totals_now.seeded_showcase}
            </div>
          </div>
        )}
      </div>

      {/* Safe, idempotent backfill — keeps its own action row above the
          destructive purge so the user can't fat-finger them together.
          Use this on production right after a redeploy. */}
      <div className="mb-4 pb-4 border-b border-amber-900/40">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300 mb-1">
          ◇ Workshop Team attribution (safe · idempotent)
        </div>
        <p className="font-mono text-[11px] text-[#a3a3a3] mb-2 leading-relaxed max-w-2xl">
          Backfills <span className="text-amber-300">"Crafters Market Workshop Team"</span> as the
          author on every seeded forum thread / reply / showcase post (scoped to <code className="text-emerald-300">is_seed: true</code>).
          Run this once on production after each fresh deploy of the seed data — re-running is a no-op.
        </p>
        <button
          onClick={runAttribution}
          disabled={attrBusy}
          className="px-3 py-1.5 border border-amber-700 text-amber-200 hover:bg-amber-900/30 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
          data-testid="attribute-workshop-team-btn"
        >
          {attrBusy ? "Running…" : "Attribute Workshop Team posts"}
        </button>
        {attrResult && (
          <div
            className="mt-2 font-mono text-[11px] text-emerald-300"
            data-testid="attribute-workshop-team-result"
          >
            ◆ Threads: {attrResult.threads_updated} · Replies: {attrResult.replies_updated} · Showcase: {attrResult.showcase_updated}
            <span className="text-[#737373] ml-2">
              (total seeded: {attrResult.totals?.forum_threads_tagged}/{attrResult.totals?.forum_replies_tagged}/{attrResult.totals?.showcase_posts_tagged})
            </span>
          </div>
        )}
      </div>

      {/* Weekly forum thread seeder — auto-runs Tuesdays 14:00 UTC via
          scheduler; this button is the manual override. Adds 1 fresh
          thread + 1-2 starter replies, picked from a curated topic bank
          and expanded by Gemini Flash. */}
      <div className="mb-4 pb-4 border-b border-amber-900/40">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300 mb-1">
          ◇ Weekly thread seed · Run now
        </div>
        <p className="font-mono text-[11px] text-[#a3a3a3] mb-2 leading-relaxed max-w-2xl">
          Adds <span className="text-amber-300">1 fresh forum thread</span> picked from the curated CNC/maker topic bank,
          plus 1-2 starter replies from generic maker usernames. Auto-runs every Tuesday at 14:00 UTC —
          use this button to trigger one on-demand (e.g., during a slow week or pre-launch).
        </p>
        <button
          onClick={runWeekly}
          disabled={weeklyBusy}
          className="px-3 py-1.5 border border-amber-700 text-amber-200 hover:bg-amber-900/30 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
          data-testid="run-weekly-thread-btn"
        >
          {weeklyBusy ? "Generating…" : "Seed one fresh thread now"}
        </button>
        {weeklyResult && (
          <div
            className="mt-2 font-mono text-[11px]"
            data-testid="run-weekly-thread-result"
          >
            {weeklyResult.status === "ok" ? (
              <span className="text-emerald-300">
                ◆ &quot;{weeklyResult.title}&quot; · {weeklyResult.channel} · {weeklyResult.replies} starter {weeklyResult.replies === 1 ? "reply" : "replies"}
              </span>
            ) : (
              <span className="text-[#a3a3a3]">◇ Skipped: {weeklyResult.reason}</span>
            )}
          </div>
        )}
      </div>

      {step === 0 && (
        <button
          onClick={() => setStep(1)}
          disabled={total === 0}
          className="px-4 py-2 border border-amber-700 text-amber-300 hover:bg-amber-900/30 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="purge-featured-seed-btn"
        >
          {total === 0 ? "Nothing to purge" : `Purge ${total} seeded item${total === 1 ? "" : "s"}`}
        </button>
      )}
      {step === 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStep(2)}
            className="px-4 py-2 border border-amber-700 bg-amber-900/30 text-amber-200 font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="purge-featured-seed-confirm-1"
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
            className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white border border-amber-700 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="purge-featured-seed-confirm-2"
          >
            {busy ? "Purging…" : "Yes — remove all seeded content"}
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
  const [replyTarget, setReplyTarget] = useState(null);

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
              {it.replied_at && (
                <div className="mt-2 font-mono text-[10px] text-emerald-400">
                  ◆ Replied by {it.replied_by} · {(it.replied_at || "").slice(0, 16).replace("T", " ")} · "{it.replied_subject}"
                </div>
              )}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {!it.resolved && (
                  <button
                    onClick={() => resolve(it.id)}
                    className="px-3 py-1 border border-emerald-800 hover:border-emerald-500 hover:text-emerald-300 font-mono text-[10px] uppercase tracking-[0.22em]"
                    data-testid={`feedback-resolve-${it.id}`}
                  >
                    Mark resolved
                  </button>
                )}
                <button
                  onClick={() => setReplyTarget(it)}
                  className="px-3 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5"
                  data-testid={`feedback-reply-${it.id}`}
                >
                  ✉ Reply
                </button>
                {it.resolved && (
                  <span className="inline-block px-2 py-0.5 border border-emerald-800 bg-emerald-900/30 text-emerald-300 font-mono text-[9px] uppercase tracking-[0.22em]">
                    Resolved
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {replyTarget && (
        <FeedbackReplyModal
          feedback={replyTarget}
          onClose={() => setReplyTarget(null)}
          onSent={async () => { setReplyTarget(null); await refresh(); }}
        />
      )}
    </div>
  );
}

// One-shot reply composer for a beta-feedback item. Reuses the same dark
// shell as the Admin Email modal — single recipient transactional send +
// optional auto-resolve.
function FeedbackReplyModal({ feedback, onClose, onSent }) {
  const [subject, setSubject] = useState(`Re: your feedback to Crafters Market`);
  const [message, setMessage] = useState(
    `Hi ${feedback.name || "there"},\n\nThanks for the feedback — `,
  );
  const [autoResolve, setAutoResolve] = useState(true);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error("Subject and message are required.");
      return;
    }
    setBusy(true);
    try {
      await replyToFeedback(feedback.id, {
        subject, message, auto_resolve: autoResolve,
      });
      toast.success(`Reply sent to ${feedback.email}.`);
      onSent();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reply failed.");
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="feedback-reply-modal"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="w-full max-w-xl bg-[#0a0a0a] border border-[#ff4500] p-6 md:p-8">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#262626]">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">◆ Feedback reply</div>
            <h3 className="font-display text-2xl mt-1">Reply to {feedback.name}</h3>
            <p className="font-mono text-xs text-[#a3a3a3] mt-1 break-all">{feedback.email}</p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            data-testid="feedback-reply-close"
            className="font-mono text-xl text-[#a3a3a3] hover:text-[#ff4500] disabled:opacity-50"
          >✕</button>
        </div>
        <div className="mt-4 border-l-2 border-[#262626] pl-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mb-1">Original</div>
          <p className="font-mono text-xs text-[#a3a3a3] whitespace-pre-wrap leading-relaxed line-clamp-5">{feedback.message}</p>
        </div>
        <div className="space-y-3 mt-5">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={180}
              data-testid="feedback-reply-subject"
              className="w-full mt-1.5 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={7}
              data-testid="feedback-reply-message"
              className="w-full mt-1.5 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5] resize-none leading-relaxed"
            />
          </div>
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] cursor-pointer">
            <input
              type="checkbox"
              checked={autoResolve}
              onChange={(e) => setAutoResolve(e.target.checked)}
              data-testid="feedback-reply-resolve"
            />
            Mark as resolved after sending
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-5 pt-4 border-t border-[#262626]">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border border-[#262626] hover:border-[#525252] font-mono text-xs uppercase tracking-[0.22em] disabled:opacity-50"
          >Cancel</button>
          <button
            onClick={send}
            disabled={busy || !subject.trim() || !message.trim()}
            data-testid="feedback-reply-send"
            className="btn-industrial btn-primary disabled:opacity-50"
          >{busy ? "Sending…" : "Send reply →"}</button>
        </div>
      </div>
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


// ─────────────────────────────────────────────────────────────────────────────
// iter111 — Search-engine ping card. Fires an IndexNow ping (Bing / Yandex /
// Naver / Seznam / Yep) on demand from the admin dashboard. Google doesn't
// support IndexNow, so we surface a deep-link to Search Console for the
// manual step. Saves the operator from waiting 1-7 days for natural recrawl
// after a deploy or copy refresh.
// ─────────────────────────────────────────────────────────────────────────────
function SearchEnginePingCard() {
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = async () => {
    setErr("");
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const token = localStorage.getItem("cm_admin_jwt") || "";
      const r = await fetch(`${API}/api/admin/seo/ping/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStatus(await r.json());
    } catch (e) {
      setErr(e.message || "Failed to load");
    }
  };

  const fire = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const token = localStorage.getItem("cm_admin_jwt") || "";
      const r = await fetch(`${API}/api/admin/seo/ping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ budget: 50 }),
      });
      const body = await r.json();
      // Fire-and-forget Google nudge alongside the IndexNow push. We
      // surface the result inside the same card so the operator sees
      // both engines' status in one place.
      try {
        const gr = await fetch(`${API}/api/admin/seo/gsc-submit-sitemap`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        body._gsc = await gr.json();
      } catch (gerr) {
        body._gsc = { ok: false, error: gerr.message || "GSC submit failed" };
      }
      setResult(body);
      await refresh();
    } catch (e) {
      setErr(e.message || "Ping failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const lastOk = status?.last_ping_ok;
  const lastWhen = status?.last_ping_at;

  return (
    <section className="border border-[#262626] p-4 md:p-5" data-testid="seo-ping-card">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">SEO · search-engine ping</div>
          <h3 className="font-display text-xl mt-1 text-[#e5e5e5]">Notify search engines</h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl">
            Pushes the homepage + ~50 most-recent product / maker / journal
            URLs to <b className="text-[#e5e5e5]">Bing, Yandex, Naver, Seznam, and Yep</b> via IndexNow
            <b className="text-[#e5e5e5]"> and re-submits the sitemap to Google</b> Search Console (when GSC is connected).
            All search engines re-crawl within hours instead of days. Also fires
            automatically on every product publish, renew, and journal post.
          </p>
        </div>
        <button
          onClick={fire}
          disabled={busy}
          data-testid="seo-ping-fire"
          className="shrink-0 px-4 py-2 border border-[#ff4500] bg-[#ff4500]/5 text-[#ff4500] hover:bg-[#ff4500] hover:text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50"
        >
          {busy ? "Pinging…" : "▶ Ping now"}
        </button>
      </div>

      {err && <div className="mt-4 font-mono text-xs text-red-400" data-testid="seo-ping-error">{err}</div>}

      {/* Last-ping audit row */}
      {status && (
        <div className="mt-4 flex flex-wrap items-center gap-3 font-mono text-[11px] text-[#a3a3a3]">
          <span className="text-[#525252]">Last ping:</span>
          {lastWhen ? (
            <>
              <code className="text-[#e5e5e5]">{lastWhen}</code>
              <span
                className={`px-2 py-0.5 border font-bold uppercase tracking-[0.22em] text-[10px] ${
                  lastOk
                    ? "border-emerald-500/60 text-emerald-400"
                    : "border-red-500/60 text-red-400"
                }`}
                data-testid="seo-ping-last-status"
              >
                {lastOk ? `✓ ${status.last_ping_status}` : `✕ ${status.last_ping_status || "err"}`}
              </span>
              <span className="text-[#525252]">·</span>
              <span>{status.last_ping_count} URLs</span>
              {status.last_ping_error && (
                <span className="text-red-400">· {status.last_ping_error}</span>
              )}
            </>
          ) : (
            <span className="text-[#525252]">never</span>
          )}
        </div>
      )}

      {/* Most-recent ping result */}
      {result && (
        <div className="mt-4 border-t border-[#262626] pt-4 space-y-3" data-testid="seo-ping-result">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block px-2 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] font-bold ${
                result.ok
                  ? "border-emerald-500/60 text-emerald-400 bg-emerald-500/5"
                  : "border-red-500/60 text-red-400 bg-red-500/5"
              }`}
            >
              {result.ok ? `◆ Submitted · ${result.status}` : `✕ Failed · ${result.status || "err"}`}
            </span>
            <span className="font-mono text-xs text-[#e5e5e5]">
              {result.count} URLs sent to <code className="text-[#ff4500]">api.indexnow.org</code>
            </span>
          </div>

          {!result.ok && result.response_excerpt && (
            <div className="border-l-2 border-red-500 pl-3 font-mono text-[11px] text-red-400 leading-relaxed">
              <b>IndexNow response:</b> {result.response_excerpt}
            </div>
          )}

          {result.urls_sample && result.urls_sample.length > 0 && (
            <details className="font-mono text-[11px] text-[#a3a3a3]">
              <summary className="cursor-pointer hover:text-[#ff4500]" data-testid="seo-ping-urls-toggle">
                ↓ {result.count} URL{result.count === 1 ? "" : "s"} submitted (sample)
              </summary>
              <ul className="mt-2 space-y-1 pl-4 max-h-48 overflow-y-auto">
                {result.urls_sample.map((u) => (
                  <li key={u} className="text-[#e5e5e5] truncate">
                    <a href={u} target="_blank" rel="noreferrer" className="hover:text-[#ff4500]">{u}</a>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Google sitemap-submit result (auto-fired alongside IndexNow). */}
          <div className="border-t border-[#262626] pt-3">
            <p className="font-mono text-[11px] text-[#a3a3a3] mb-2">
              Google sitemap re-submit:
            </p>
            {result._gsc?.ok ? (
              <div
                className="inline-block px-3 py-1.5 border border-emerald-500/60 text-emerald-400 bg-emerald-500/5 font-mono text-[10px] uppercase tracking-[0.22em] font-bold"
                data-testid="seo-ping-gsc-result"
              >
                {result._gsc.throttled
                  ? `⏱ Throttled · last submitted ${result._gsc.last_submit_at?.slice(0, 16) || "recently"}`
                  : `✓ Submitted · status ${result._gsc.status}`}
              </div>
            ) : (
              <div className="space-y-2">
                <div
                  className="inline-block px-3 py-1.5 border border-amber-500/60 text-amber-400 bg-amber-500/5 font-mono text-[10px] uppercase tracking-[0.22em] font-bold"
                  data-testid="seo-ping-gsc-result"
                >
                  ✕ {result._gsc?.error?.slice(0, 80) || "GSC not configured"}
                </div>
                <a
                  href={result.google_search_console_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition"
                  data-testid="seo-ping-gsc-link"
                >
                  → Open Search Console manually
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}



/**
 * GscConnectionCard — admin-side "Connect GSC via OAuth" panel.
 *
 * Shows current connection status (OAuth + service-account) and lets
 * the admin either connect a Google account that already has GSC
 * property access, or disconnect / test an existing connection.
 *
 * Two-step flow:
 *   1. Click "Connect" → backend returns Google's authorization URL.
 *   2. Frontend opens that URL in a popup. Google redirects to
 *      /api/admin/gsc/oauth-callback which stores the refresh-token
 *      then posts a message back to the opener.
 *   3. Status auto-refreshes on the postMessage signal.
 *
 * Idempotent disconnect — never destructive (only removes the stored
 * refresh-token; doesn't touch GSC-side permissions).
 */
function GscConnectionCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const s = await adminGscStatus();
      setStatus(s);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't load GSC status.");
    }
  };

  useEffect(() => {
    load();
    // Listen for the popup's postMessage so we auto-refresh after consent
    const onMsg = (e) => {
      if (e?.data?.type === "gsc-oauth") {
        if (e.data.success) {
          toast.success("GSC connected.");
        } else {
          toast.error("GSC connection failed — see popup details.");
        }
        load();
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const connect = async () => {
    setBusy("connect");
    try {
      const { authorization_url } = await adminGscOauthStart();
      // Open in a popup; the callback page posts back via window.opener
      const w = window.open(authorization_url, "gsc-connect", "width=520,height=720");
      if (!w) {
        toast.error("Popup blocked — allow popups for this site and retry.");
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Couldn't start OAuth flow.";
      toast.error(msg);
      setErr(msg);
    } finally {
      setBusy("");
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect the stored Google account? GSC inspections will pause until you reconnect (or until the service-account fallback is used).")) return;
    setBusy("disconnect");
    try {
      await adminGscDisconnect();
      toast.success("GSC disconnected.");
      setTestResult(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't disconnect.");
    } finally {
      setBusy("");
    }
  };

  const runTest = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      const r = await adminGscTestInspect("");
      setTestResult(r);
      if (r.ok) toast.success(`Inspection OK → ${r.tier}`);
      else toast.error(`Inspection failed: ${r.reason}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Inspection failed.");
    } finally {
      setBusy("");
    }
  };

  if (!status) return null;

  const oauthAvailable = status.oauth_configured;
  const isConnected = status.connected;

  return (
    <div className="border border-[#262626] p-4 md:p-5" data-testid="gsc-connection-card">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-1">
            ◆ Search Console
          </div>
          <h3 className="font-display text-2xl uppercase">GSC connection</h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl leading-relaxed">
            Powers the "Verified by Google" pill + the real index-status tier on listing cards. Connect a Google account that already has GSC access for{" "}
            <code className="text-[#e5e5e5]">{status.site_url || "your GSC property"}</code> and the daily 05:30 UTC sweep starts pulling real verdicts.
          </p>
        </div>
        <ConnectionPill connected={isConnected} email={status.connection?.connected_email} />
      </div>

      {err && <p className="font-mono text-xs text-red-400 mb-3">{err}</p>}

      {!oauthAvailable && !status.service_account_configured && (
        <div className="border border-amber-500/40 bg-amber-500/5 p-3 mb-4 font-mono text-xs text-amber-200">
          ⚠️ OAuth is not configured. Set <code>GSC_OAUTH_CLIENT_ID</code>, <code>GSC_OAUTH_CLIENT_SECRET</code>, and{" "}
          <code>GSC_OAUTH_REDIRECT_URI</code> env vars in production, then reload this page.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {oauthAvailable && !isConnected && (
          <button
            onClick={connect}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 bg-[#ff4500] hover:bg-[#ff5f1f] text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] px-4 py-2 disabled:opacity-50"
            data-testid="gsc-connect-btn"
          >
            {busy === "connect" ? "Opening…" : "Connect Google account"}
          </button>
        )}
        {isConnected && (
          <>
            <button
              onClick={runTest}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[10px] uppercase tracking-[0.22em] px-4 py-2 disabled:opacity-50"
              data-testid="gsc-test-btn"
            >
              {busy === "test" ? "Inspecting…" : "Run test inspection"}
            </button>
            <button
              onClick={disconnect}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 border border-red-500/40 text-red-400 hover:bg-red-500/10 font-mono text-[10px] uppercase tracking-[0.22em] px-4 py-2 disabled:opacity-50"
              data-testid="gsc-disconnect-btn"
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        )}
      </div>

      {testResult && (
        <div
          className={`mt-4 border p-3 font-mono text-xs ${
            testResult.ok ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-300" : "border-red-500/40 bg-red-500/5 text-red-300"
          }`}
          data-testid="gsc-test-result"
        >
          <div className="text-[10px] uppercase tracking-[0.22em] opacity-70 mb-1">
            ◆ Test result · {testResult.url}
          </div>
          {testResult.ok ? (
            <div className="space-y-1">
              <div>Verdict: <span className="text-[#e5e5e5]">{testResult.verdict || "—"}</span></div>
              <div>Coverage: <span className="text-[#e5e5e5]">{testResult.coverage || "—"}</span></div>
              <div>Last crawl: <span className="text-[#e5e5e5]">{testResult.last_crawl || "—"}</span></div>
              <div>Tier: <span className="text-[#ff4500] font-bold">{testResult.tier}</span></div>
            </div>
          ) : (
            <div>Reason: {testResult.reason}</div>
          )}
        </div>
      )}

      {isConnected && status.connection?.connected_at && (
        <p className="font-mono text-[10px] text-[#525252] mt-3">
          Connected {new Date(status.connection.connected_at).toLocaleString()}
          {status.connection.connected_email && ` · ${status.connection.connected_email}`}
        </p>
      )}
    </div>
  );
}

function ConnectionPill({ connected, email }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] shrink-0 ${
        connected
          ? "border-emerald-500/50 bg-emerald-500/5 text-emerald-400"
          : "border-[#262626] bg-[#0a0a0a] text-[#a3a3a3]"
      }`}
      data-testid="gsc-connection-pill"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-[#525252]"}`} />
      {connected ? (email ? `Connected · ${email}` : "Connected") : "Not connected"}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// iter182 — Email provider audit card. Lists every email provider with an
// API key still set in the environment and flags the ones NOT in the active
// fallback chain (= safe to remove). For each removable provider it surfaces
// the precise Cloudflare DNS records (SPF + DKIM) that can be deleted, so
// the operator can clean up without guessing.
// ─────────────────────────────────────────────────────────────────────────────
function EmailProviderAuditCard() {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  const load = async () => {
    setErr("");
    setLoading(true);
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const token = localStorage.getItem("cm_admin_jwt") || "";
      const r = await fetch(`${API}/api/admin/email-providers/audit`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); }, []);

  const roleClass = (role) => ({
    primary:    "border-emerald-500/60 text-emerald-400 bg-emerald-500/5",
    fallback:   "border-blue-500/60 text-blue-400 bg-blue-500/5",
    fallback_2: "border-blue-500/40 text-blue-400 bg-blue-500/5",
    unused:     "border-[#262626] text-[#737373] bg-[#0d0d0d]",
  }[role] || "border-[#262626] text-[#737373]");

  return (
    <section
      className="border border-[#262626] p-4 md:p-5"
      data-testid="email-provider-audit-card"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Email · provider audit
          </div>
          <h3 className="font-display text-xl mt-1 text-[#e5e5e5]">
            Clean up unused email providers
          </h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl leading-relaxed">
            Lists every provider with an API key still in the environment.
            Providers not in the active{" "}
            <code className="text-[#e5e5e5]">EMAIL_PROVIDER → EMAIL_FALLBACK_PROVIDER → EMAIL_FALLBACK_PROVIDER_2</code>{" "}
            chain are dead weight — safe to remove from both env vars and Cloudflare DNS.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="shrink-0 px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          data-testid="email-audit-refresh"
        >
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {err && (
        <div className="mt-4 font-mono text-xs text-red-400" data-testid="email-audit-error">
          {err}
        </div>
      )}

      {!loading && !err && data && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-xs">
            <Stat label="Keys configured" value={data.summary.configured_keys} testId="email-audit-configured-count" />
            <Stat label="Active in chain" value={data.summary.in_active_chain} testId="email-audit-active-count" />
            <Stat label="Safe to remove" value={data.summary.safe_to_remove} testId="email-audit-removable-count" />
          </div>

          <div className="mt-5 border border-[#262626] divide-y divide-[#262626]" data-testid="email-audit-rows">
            {data.providers.map((p) => (
              <div key={p.provider} className="p-3 md:p-4" data-testid={`email-audit-row-${p.provider}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-display text-base text-[#e5e5e5] uppercase tracking-[0.04em]">
                      {p.provider}
                    </span>
                    <span
                      className={`px-2 py-0.5 border font-mono text-[10px] uppercase tracking-[0.22em] font-bold ${roleClass(p.role)}`}
                    >
                      {p.role}
                    </span>
                    {p.key_configured ? (
                      <span className="font-mono text-[10px] text-[#737373]">
                        <code className="text-[#a3a3a3]">{p.key_env}</code> · set
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-[#525252]">
                        <code>{p.key_env}</code> · unset
                      </span>
                    )}
                  </div>
                  {p.safe_to_remove && (
                    <span
                      className="px-2 py-0.5 border border-amber-500/60 text-amber-400 bg-amber-500/5 font-mono text-[10px] uppercase tracking-[0.22em] font-bold"
                      data-testid={`email-audit-removable-${p.provider}`}
                    >
                      ⚠ Safe to remove
                    </span>
                  )}
                </div>

                {p.safe_to_remove && p.dns_records.length > 0 && (
                  <details className="mt-3 font-mono text-[11px] text-[#a3a3a3]">
                    <summary
                      className="cursor-pointer hover:text-[#ff4500]"
                      data-testid={`email-audit-dns-toggle-${p.provider}`}
                    >
                      ↓ Cloudflare records to delete ({p.dns_records.length})
                    </summary>
                    <pre className="mt-2 p-3 bg-[#0a0a0a] border border-[#1a1a1a] overflow-x-auto text-[10.5px] text-[#a3a3a3] leading-relaxed whitespace-pre">
{p.dns_records.join("\n")}
                    </pre>
                    <p className="mt-2 text-[10px] text-[#525252]">
                      Verify in Cloudflare dashboard first — some operators share SPF includes across multiple providers.
                    </p>
                  </details>
                )}
              </div>
            ))}
          </div>

          {data.summary.safe_to_remove === 0 && (
            <p className="mt-4 font-mono text-[11px] text-emerald-400" data-testid="email-audit-clean">
              ✓ Nothing to clean up — every configured key is earning its keep.
            </p>
          )}
        </>
      )}
    </section>
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

      <SearchEnginePingCard />

      <EmailProviderAuditCard />

      <GscConnectionCard />

      <PurgeFeaturedSeedCard />

      <CommunityDesignsSeedCard />

      <ClipsSeedCard />

      <OperatorOpsChecklistCard />

      <div className="grid md:grid-cols-2 gap-3">
        <IdleClearNowCard />
        <HardClearCard onCleared={refresh} />
      </div>

      <FeedbackInbox />
    </div>
  );
}
