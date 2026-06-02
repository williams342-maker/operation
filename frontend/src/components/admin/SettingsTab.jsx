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
  purgeOrphanCommunityDesignsSeed,
  migrateCommunityDesignsToR2,
  fetchStripeDiag,
  generateOneCommunityDesign,
  generateBatchCommunityDesigns,
  fetchClipsSeedStatus,
  generateOneClipSeed,
  fetchClipSeedJob,
  fetchRecentClipSeedJobs,
  purgeClipsSeed,
  purgeOrphanClipsSeed,
  fetchOgDiag,
  fetchSeoDiag,
  adminPingIndexNow,
  // iter220 — Rotating hero headlines pool
  adminListHeroHeadlines,
  adminRefreshHeroHeadlines,
  adminPinHeroHeadline,
  adminUnpinHeroHeadlines,
  adminArchiveHeroHeadline,
  adminRestoreHeroHeadline,
  adminCreateHeroHeadline,
  adminDeleteHeroHeadline,
} from "../../lib/api";
import { refreshSiteSettings } from "../../hooks/useSiteSettings";
import { RowsSkeleton } from "../Skeleton";
import { ShippoDiagCard, MailgunDiagCard, R2DiagCard } from "./IntegrationDiagCards";
import FeedHealthCard from "./FeedHealthCard";
import ZombieCleanupCard from "./ZombieCleanupCard";
import ExternalDistributionStatusCard from "./ExternalDistributionStatusCard";

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

  // iter221 — Targeted orphan cleanup: nukes only is_seed=true rows whose
  // local `/seed-designs/<slug>/preview.jpg` was never saved to disk
  // (broken-image cards on /community Design Files in production).
  const [orphanBusy, setOrphanBusy] = useState(false);
  const runOrphanPurge = async () => {
    setOrphanBusy(true);
    try {
      const r = await purgeOrphanCommunityDesignsSeed();
      if (r.deleted > 0) {
        toast.success(`Cleared ${r.deleted} orphan design${r.deleted === 1 ? "" : "s"}: ${r.slugs.join(", ")}`);
      } else {
        toast.success("No orphan designs found — feed is clean.");
      }
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Orphan purge failed.");
    } finally { setOrphanBusy(false); }
  };

  // iter262 — Re-upload local /seed-designs/<slug>/... files to R2 so the
  // generated rows survive pod restarts. Rows whose local files are gone
  // get `file_verified: false` so the orphan-guard hides them.
  const [migrateBusy, setMigrateBusy] = useState(false);
  const runR2Migrate = async () => {
    setMigrateBusy(true);
    try {
      const r = await migrateCommunityDesignsToR2();
      const parts = [];
      if (r.migrated) parts.push(`${r.migrated} uploaded to R2`);
      if (r.orphaned_marked) parts.push(`${r.orphaned_marked} marked orphaned`);
      if (r.failed?.length) parts.push(`${r.failed.length} failed`);
      toast.success(parts.length ? parts.join(" · ") : "No rows needed migration.");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "R2 migration failed.");
    } finally { setMigrateBusy(false); }
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
          className="font-mono text-[11px] text-[#a3a3a3] mb-4 grid grid-cols-3 gap-3 max-w-md"
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
          <div className={`border px-2 py-1.5 ${status.orphan_seeds > 0 ? "border-red-700/60 bg-red-950/15" : "border-[#262626]"}`}>
            <div className={`uppercase tracking-[0.2em] text-[9px] ${status.orphan_seeds > 0 ? "text-red-400" : "text-[#525252]"}`}>Orphans</div>
            <div className={`text-base ${status.orphan_seeds > 0 ? "text-red-300" : "text-amber-300"}`}>{status.orphan_seeds ?? 0}</div>
          </div>
        </div>
      )}

      {status?.orphan_seeds > 0 && (
        <div
          className="border border-red-900/60 bg-red-950/20 p-3 mb-4"
          data-testid="community-designs-orphan-warning"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-red-300 mb-1">
            ◆ {status.orphan_seeds} orphan design{status.orphan_seeds === 1 ? "" : "s"} detected
          </div>
          <p className="font-mono text-[11px] text-red-200/80 leading-relaxed mb-3">
            These seed rows point to <code>/seed-designs/…</code> preview files that never made it into the
            deploy artifact — they render as broken-image cards on the public Design Files tab. Safe to clear;
            preserves any working seeds.
          </p>
          <button
            onClick={runOrphanPurge}
            disabled={orphanBusy}
            className="px-3 py-1.5 border border-red-600 bg-red-900/30 text-red-100 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="purge-orphan-designs-btn"
          >
            {orphanBusy ? "Clearing…" : `Clear ${status.orphan_seeds} orphan${status.orphan_seeds === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {/* iter262 — Migrate any local-path seed design files to R2 so they
          survive pod restarts. Always available; safe to run multiple
          times. Rows whose local files are gone get hidden via
          file_verified=false (handled by the backend). */}
      <div className="mb-4 pb-4 border-b border-cyan-900/40">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-300 mb-1">
          ◆ Migrate seed designs to R2 (one-click · idempotent)
        </div>
        <p className="font-mono text-[11px] text-[#a3a3a3] mb-2 leading-relaxed max-w-2xl">
          Re-uploads <code>/seed-designs/&lt;slug&gt;/</code> local files to R2 and rewrites the DB rows
          with the absolute CDN URLs. Without this, AI-generated design cards break on every redeploy
          because the local pod disk is ephemeral. Run after the daily cron generates a new design.
        </p>
        <button
          onClick={runR2Migrate}
          disabled={migrateBusy}
          className="px-3 py-1.5 border border-cyan-600 text-cyan-300 hover:bg-cyan-900/30 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
          data-testid="migrate-designs-r2-btn"
        >
          {migrateBusy ? "Uploading…" : "↑ Migrate seed designs to R2"}
        </button>
      </div>

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
  const [recentJobs, setRecentJobs] = useState([]);
  const [recentExpanded, setRecentExpanded] = useState(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genResult, setGenResult] = useState(null);
  const [purgeStep, setPurgeStep] = useState(0);
  const [purgeBusy, setPurgeBusy] = useState(false);
  // iter314c — Default flipped to base sora-2 (horizontal). Sora pro
  // queue has been saturating its 900s wait ceiling, while sora-2 base
  // is finishing in 60-90s reliably. Pro still selectable from the
  // dropdown; auto-fallback in clip_seeder.py covers either choice.
  // Revisit ~mid-June 2026 once pro capacity stabilises.
  const [model, setModel] = useState("sora-2");

  const refresh = async () => {
    try { setStatus(await fetchClipsSeedStatus()); } catch (_e) { /* admin-gated */ }
    try {
      const r = await fetchRecentClipSeedJobs(5);
      setRecentJobs(r?.jobs || []);
    } catch (_e) { /* admin-gated */ }
  };
  useEffect(() => { refresh(); }, []);

  const runGenerate = async () => {
    setGenBusy(true);
    setGenResult(null);
    // iter310 — background-job pattern. The POST returns instantly with
    // a job_id; we then poll for completion. This survives Cloudflare's
    // ~100s edge timeout on craftersmarket.org which was dropping the
    // long synchronous request and surfacing as a "Network error".
    toast.info(`Drafting clip via ${model}… typically 2–3 min. You can leave this tab; the toast will follow.`);
    let jobId;
    try {
      const enq = await generateOneClipSeed(model);
      jobId = enq?.job_id;
      if (!jobId) {
        toast.error("Failed to enqueue render job — backend returned no job_id.");
        setGenBusy(false);
        return;
      }
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const status = e?.response?.status;
      let pretty = detail || e?.message || "Failed to start generation.";
      if (status === 401 || status === 403) pretty = "Admin auth expired — refresh and retry.";
      else if (!status) pretty = "Network error reaching backend. Check VPN / connection.";
      toast.error(pretty, { duration: 10000 });
      setGenBusy(false);
      return;
    }

    // Poll every 5s up to ~17 min (covers the new sora-2-pro 900s wait
    // + R2 upload + DB write + a small buffer).
    const POLL_MS = 5000;
    const MAX_TRIES = 200; // ~16.7 minutes
    let consecutiveErrors = 0;
    for (let i = 0; i < MAX_TRIES; i++) {
      await new Promise((res) => setTimeout(res, POLL_MS));
      let job;
      try {
        job = await fetchClipSeedJob(jobId);
        consecutiveErrors = 0;
      } catch (e) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 4) {
          toast.error("Lost connection to backend while polling render status. Refresh the page to recover — the render may still complete.", { duration: 12000 });
          setGenBusy(false);
          return;
        }
        continue;
      }
      if (job.status === "done") {
        setGenResult({ status: "ok", clip: job.clip });
        toast.success(`✓ Generated "${job.clip?.title}" (${job.clip?.category}).`);
        refresh();
        setGenBusy(false);
        return;
      }
      if (job.status === "error") {
        setGenResult({ status: "error", reason: job.reason, detail: job.detail });
        const reason = (job.reason || "").toLowerCase();
        const detail = (job.detail || "").toLowerCase();
        let pretty = job.reason || "Sora generation failed.";
        if (reason.includes("budget") || reason.includes("quota") || reason.includes("balance") || reason.includes("exhaust") || detail.includes("budget exhausted")) {
          pretty = "Universal LLM Key budget exhausted. Sora-2-pro renders cost ~$3.40 each. Top up at Profile → Universal Key → Add Balance, then retry.";
        } else if (reason.includes("video file missing") || reason.includes("download")) {
          pretty = "Sora returned but the MP4 download didn't complete (likely a transient upstream timeout). Safe to retry — no DB row was created.";
        } else if (reason.includes("rate") || reason.includes("429")) {
          pretty = "Sora is rate-limiting us — wait 60s and retry.";
        } else if (detail.includes("no video after") || detail.includes("wait timeout") || (reason.includes("video generation failed") && detail.includes("max_wait"))) {
          pretty = "Sora-2-pro render exceeded the 15-min wait timeout. Retry — or switch to `sora-2` (horizontal, faster). If this keeps happening, Sora's queue may be congested or the Universal LLM Key balance is low.";
        } else if (job.detail) {
          pretty = `${pretty} — ${job.detail.slice(0, 250)}`;
        }
        toast.error(pretty, { duration: 15000 });
        setGenBusy(false);
        return;
      }
      // status: queued | running → keep polling
    }
    toast.error("Render polling timed out after 10 minutes. The job may still finish in the background — refresh to see the latest counts.", { duration: 12000 });
    setGenBusy(false);
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

  // iter218 — Targeted orphan cleanup: nukes ONLY broken seed rows
  // (is_seed=true + file_verified missing + local /seed-clips/ url).
  // Working seed clips with file_verified=true are preserved.
  const [orphanBusy, setOrphanBusy] = useState(false);
  const runOrphanPurge = async () => {
    setOrphanBusy(true);
    try {
      const r = await purgeOrphanClipsSeed();
      if (r.deleted > 0) {
        toast.success(`Cleared ${r.deleted} orphan clip${r.deleted === 1 ? "" : "s"}: ${r.slugs.join(", ")}`);
      } else {
        toast.success("No orphan clips found — feed is clean.");
      }
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Orphan purge failed.");
    } finally { setOrphanBusy(false); }
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
        <div className="font-mono text-[11px] text-[#a3a3a3] mb-4 grid grid-cols-4 gap-2 max-w-md" data-testid="clips-seed-counts">
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
          <div className={`border px-2 py-1.5 ${status.orphan_seeds > 0 ? "border-red-700/60 bg-red-950/15" : "border-[#262626]"}`}>
            <div className={`uppercase tracking-[0.2em] text-[9px] ${status.orphan_seeds > 0 ? "text-red-400" : "text-[#525252]"}`}>Orphans</div>
            <div className={`text-base ${status.orphan_seeds > 0 ? "text-red-300" : "text-purple-300"}`}>{status.orphan_seeds ?? 0}</div>
          </div>
        </div>
      )}

      {/* iter218 — Orphan-only cleanup. Surfaces in red when there are
          broken seed rows on production whose MP4 never reached the
          deploy artifact (renders as black-screen panels on /clips).
          Safer than the full "Purge all seeds" button below since it
          preserves any working seed clips with file_verified=true. */}
      {status?.orphan_seeds > 0 && (
        <div
          className="border border-red-900/60 bg-red-950/20 p-3 mb-4"
          data-testid="clips-orphan-warning"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-red-300 mb-1">
            ◆ {status.orphan_seeds} orphan clip{status.orphan_seeds === 1 ? "" : "s"} detected
          </div>
          <p className="font-mono text-[11px] text-red-200/80 leading-relaxed mb-3">
            These seed rows point to <code>/seed-clips/…</code> files that never made it into the deploy artifact —
            they render as black-screen panels on <code>/clips</code>. Safe to clear; preserves any working seeds.
          </p>
          <button
            onClick={runOrphanPurge}
            disabled={orphanBusy}
            className="px-3 py-1.5 border border-red-600 bg-red-900/30 text-red-100 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="purge-orphan-clips-btn"
          >
            {orphanBusy ? "Clearing…" : `Clear ${status.orphan_seeds} orphan${status.orphan_seeds === 1 ? "" : "s"}`}
          </button>
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
            <option value="sora-2">sora-2 · 1280×720 horizontal (recommended · faster + cheaper)</option>
            <option value="sora-2-pro">sora-2-pro · 1024×1792 vertical (premium · slower queue)</option>
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
          <div className="font-mono text-[11px] text-red-400 space-y-1" data-testid="generate-one-clip-error">
            <div>✕ {genResult.reason}</div>
            {genResult.detail && (
              <div className="text-red-300/80 text-[10px] leading-relaxed break-all whitespace-pre-wrap max-w-2xl" data-testid="generate-one-clip-error-detail">
                ↳ {genResult.detail}
              </div>
            )}
          </div>
        )}
      </div>

      {/* iter310c — Last 5 renders strip. One row per recent
          clip_seed_job: status pill + model + slug-or-reason + duration.
          Helps the operator spot a degrading Sora queue or recurring
          failures without re-clicking Generate. */}
      {recentJobs.length > 0 && (
        <div className="mb-4 pb-4 border-b border-purple-900/40" data-testid="clips-seed-recent">
          <div className="flex items-center justify-between mb-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              Last {recentJobs.length} render{recentJobs.length === 1 ? "" : "s"}
            </div>
            <button
              onClick={refresh}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-purple-300 hover:text-purple-100"
              data-testid="clips-seed-recent-refresh"
              title="Refresh recent renders"
            >
              ↻ Refresh
            </button>
          </div>
          <div className="space-y-1">
            {recentJobs.map((j) => {
              const startedMs = j.started_at ? Date.parse(j.started_at) : null;
              const finishedMs = j.finished_at ? Date.parse(j.finished_at) : null;
              const durSec = startedMs && finishedMs ? Math.round((finishedMs - startedMs) / 1000) : null;
              // iter313b — Classify the failure shape so the operator
              // can spot patterns at a glance. The 8s-instant-fail is
              // almost always budget/auth/rate-limit (real upstream
              // rejection); 600-900s is a wait-timeout (Sora capacity
              // hiccup or queue saturation).
              // iter314 — Classification order matters. The TIMEOUT
              // signal ("no video after Ns" / duration ≥ 590s) is far
              // more precise than the generic substring "budget" or
              // "balance" which legitimately appears inside the
              // explanatory copy of a timeout-class error too. Check
              // for precise markers first; only call it BUDGET if the
              // error explicitly starts with the budget-exhausted
              // phrase or carries a 402.
              let kind = "";
              if (j.status === "error") {
                const detail = (j.detail || "").toLowerCase();
                const reason = (j.reason || "").toLowerCase();
                const isTimeout = detail.startsWith("sora returned no video after")
                  || detail.includes("no video after ")
                  || (durSec != null && durSec >= 590);
                const isBudget = detail.startsWith("universal llm key budget exhausted")
                  || detail.includes("status 402") || detail.includes("http 402")
                  || /\b402\b/.test(detail)
                  || detail.includes("insufficient_quota") || detail.includes("balance exhausted");
                const isModeration = detail.includes("moderation")
                  || detail.includes("content_policy")
                  || detail.includes("rejected the prompt") || detail.includes("flagged");
                const isRate = detail.includes("rate limit") || detail.includes("rate-limit")
                  || detail.includes("status 429") || /\b429\b/.test(detail);
                if (isTimeout) kind = "timeout";
                else if (isBudget) kind = "budget";
                else if (isModeration) kind = "moderation";
                else if (isRate) kind = "rate";
                else if (durSec != null && durSec < 30) kind = "rejected";
                else if (reason || detail) kind = "other";
              }
              const pillColor = {
                done: "border-emerald-700 text-emerald-300 bg-emerald-950/30",
                error: "border-red-700 text-red-300 bg-red-950/30",
                running: "border-yellow-700 text-yellow-300 bg-yellow-950/30 animate-pulse",
                queued: "border-[#525252] text-[#a3a3a3] bg-neutral-900/30",
              }[j.status] || "border-[#525252] text-[#a3a3a3]";
              const kindBadge = {
                budget: { label: "BUDGET", cls: "border-amber-700 text-amber-300 bg-amber-950/40" },
                moderation: { label: "BLOCKED", cls: "border-pink-700 text-pink-300 bg-pink-950/40" },
                rate: { label: "RATE", cls: "border-orange-700 text-orange-300 bg-orange-950/40" },
                timeout: { label: "TIMEOUT", cls: "border-red-800/70 text-red-300/80 bg-red-950/20" },
                rejected: { label: "INSTANT-FAIL", cls: "border-rose-700 text-rose-200 bg-rose-950/40" },
                other: { label: "OTHER", cls: "border-[#525252] text-[#a3a3a3]" },
              }[kind];
              const startedLabel = startedMs
                ? new Date(startedMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "—";
              const isOpen = recentExpanded === j.job_id;
              return (
                <div
                  key={j.job_id}
                  className="border-l-2 border-purple-900/40 pl-2"
                  data-testid="clips-seed-recent-row"
                >
                  <button
                    type="button"
                    onClick={() => setRecentExpanded(isOpen ? null : j.job_id)}
                    disabled={j.status !== "error" || !j.detail}
                    className="w-full grid grid-cols-[70px_55px_55px_70px_1fr_55px] gap-2 items-center font-mono text-[10px] py-1 text-left disabled:cursor-default"
                  >
                    <span className={`uppercase tracking-[0.15em] text-center px-1.5 py-0.5 border ${pillColor}`}>
                      {j.status || "?"}
                    </span>
                    <span className="text-[#737373]">{startedLabel}</span>
                    <span className="text-purple-300/80 truncate" title={j.model}>{(j.model || "").replace("sora-2-", "")}</span>
                    <span
                      className={`uppercase tracking-[0.15em] text-center px-1 py-0.5 border ${kindBadge ? kindBadge.cls : "border-transparent"}`}
                    >
                      {kindBadge ? kindBadge.label : ""}
                    </span>
                    <span
                      className={`truncate ${j.status === "error" ? "text-red-300" : "text-emerald-300/90"}`}
                      title={j.status === "error" ? (j.detail || j.reason || "") : (j.clip?.slug || "")}
                    >
                      {j.status === "done" && (j.clip?.slug || j.clip?.title || "—")}
                      {j.status === "error" && (j.reason || "failed")}
                      {(j.status === "running" || j.status === "queued") && "rendering…"}
                    </span>
                    <span className="text-[#737373] text-right">{durSec != null ? `${durSec}s` : "—"}</span>
                  </button>
                  {isOpen && j.detail && (
                    <div
                      className="ml-[70px] mb-1.5 px-2 py-1.5 bg-red-950/20 border-l-2 border-red-800/60 font-mono text-[10px] text-red-200/85 leading-relaxed whitespace-pre-wrap break-all"
                      data-testid="clips-seed-recent-detail"
                    >
                      {j.detail}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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

function StripeDiagCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try { setData(await fetchStripeDiag()); }
    catch (e) { toast.error(e?.response?.data?.detail || "Stripe diag failed."); }
    finally { setBusy(false); }
  };
  useEffect(() => { refresh(); }, []);

  const ok = data?.ok;
  const mode = data?.mode;
  return (
    <div
      className={`border ${ok ? "border-emerald-700/40 bg-emerald-950/15" : "border-red-700/40 bg-red-950/15"} p-5`}
      data-testid="stripe-diag-card"
    >
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className={`font-mono text-[10px] uppercase tracking-[0.28em] mb-1 ${ok ? "text-emerald-300" : "text-red-300"}`}>
            ◆ Stripe Connect · Health
          </div>
          <h3 className={`font-display text-xl ${ok ? "text-emerald-200" : "text-red-200"}`}>
            {ok ? "Reachable" : "Unreachable"}
          </h3>
          <p className="font-mono text-[11px] text-[#a3a3a3] mt-1 max-w-[60ch] leading-relaxed">
            Probes <code>/api/admin/stripe/diag</code>. If this says Unreachable, makers can't onboard for payouts — usually a STRIPE_API_KEY mismatch or Connect not enabled on the Stripe dashboard.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className="px-3 py-1.5 border border-amber-700/60 hover:border-amber-400 hover:text-amber-300 font-mono text-[11px] uppercase tracking-[0.22em] text-amber-300 disabled:opacity-50"
          data-testid="stripe-diag-refresh"
        >
          {busy ? "Checking…" : "↻ Re-check"}
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]" data-testid="stripe-diag-tiles">
          <DiagTile label="Mode" value={mode || "—"} highlight={mode === "live"} />
          <DiagTile label="Key prefix" value={data.key_prefix || "—"} />
          <DiagTile
            label="Platform acct"
            value={data.platform_account_id ? data.platform_account_id.slice(-8) : "—"}
          />
          <DiagTile
            label="Charges"
            value={data.charges_enabled ? "ON" : "off"}
            highlight={data.charges_enabled}
          />
        </div>
      )}

      {!ok && data?.reason && (
        <div className="mt-3 font-mono text-[11px] text-red-200 bg-black/30 border border-red-900/60 p-3 leading-relaxed" data-testid="stripe-diag-reason">
          <strong className="text-red-300">Reason:</strong> {data.reason}
        </div>
      )}
    </div>
  );
}

function DiagTile({ label, value, highlight }) {
  return (
    <div className={`border px-2 py-1.5 ${highlight ? "border-emerald-500/50 bg-emerald-950/30" : "border-[#262626] bg-[#0a0a0a]"}`}>
      <div className={`uppercase tracking-[0.22em] text-[9px] ${highlight ? "text-emerald-300" : "text-[#525252]"}`}>{label}</div>
      <div className={`text-base ${highlight ? "text-emerald-200" : "text-zinc-200"}`}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// iter259 — Link a manually-created Stripe Connect account to a maker.
// Use when an operator created the Stripe Connect account directly in
// the Stripe dashboard (so our `/maker/stripe/connect/onboard` flow
// never ran and the maker row has no `stripe_account_id`).
// ─────────────────────────────────────────────────────────────────────
function StripeLinkAccountCard() {
  const [slug, setSlug] = useState("");
  const [acctId, setAcctId] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setResult(null);
    setBusy(true);
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const token = localStorage.getItem("cm_admin_jwt") || "";
      const r = await fetch(`${API}/api/admin/stripe/link-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          maker_slug: slug.trim(),
          stripe_account_id: acctId.trim(),
          overwrite,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = typeof body?.detail === "string"
          ? body.detail
          : (body?.detail?.code === "stripe_account_already_linked"
              ? `Already linked to ${body.detail.current}. Check 'overwrite' to replace it.`
              : r.status === 401
                ? "Your admin session expired. Sign in again at /admin/login and retry."
                : `HTTP ${r.status}`);
        throw new Error(msg);
      }
      setResult(body);
    } catch (e2) {
      setErr(e2.message || "Link failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="border border-[#262626] p-4 md:p-5"
      data-testid="stripe-link-account-card"
    >
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          Stripe Connect · manual link
        </div>
        <h3 className="font-display text-xl mt-1 text-[#e5e5e5]">
          Link an existing Stripe account to a maker
        </h3>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl leading-relaxed">
          Use when the Connect account was created directly in the Stripe
          dashboard (instead of via the maker dashboard's onboarding flow).
          We verify the account ID with Stripe, then stamp it + its current
          status flags onto the maker row.
        </p>
      </div>

      <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-[1fr,1fr,auto] md:items-end">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Maker slug
          </span>
          <input
            type="text"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="williams-cnc"
            className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            data-testid="stripe-link-slug"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Stripe account ID
          </span>
          <input
            type="text"
            required
            pattern="^acct_[A-Za-z0-9]+$"
            value={acctId}
            onChange={(e) => setAcctId(e.target.value)}
            placeholder="acct_1ABCxyz…"
            className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            data-testid="stripe-link-acct-id"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !slug.trim() || !acctId.trim()}
          className="h-[42px] px-4 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500] hover:text-black font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          data-testid="stripe-link-submit"
        >
          {busy ? "Linking…" : "Link account →"}
        </button>
      </form>

      <label className="mt-3 inline-flex items-center gap-2 font-mono text-[11px] text-[#a3a3a3] cursor-pointer">
        <input
          type="checkbox"
          checked={overwrite}
          onChange={(e) => setOverwrite(e.target.checked)}
          data-testid="stripe-link-overwrite"
        />
        Overwrite if maker already has a different account ID
      </label>

      {err && (
        <div className="mt-4 font-mono text-xs text-red-300 border border-red-900/60 bg-red-950/20 p-3" data-testid="stripe-link-error">
          {err}
        </div>
      )}

      {result && (
        <div className="mt-4 border border-emerald-700/40 bg-emerald-950/15 p-3 font-mono text-xs text-emerald-200" data-testid="stripe-link-result">
          <div className="font-bold mb-1.5">✓ Linked</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[#a3a3a3]">
            <div>maker: <span className="text-[#e5e5e5]">{result.maker_slug}</span></div>
            <div>acct: <span className="text-[#e5e5e5]">…{result.stripe_account_id?.slice(-8)}</span></div>
            <div>charges: <span className={result.charges_enabled ? "text-emerald-300" : "text-red-300"}>{String(result.charges_enabled)}</span></div>
            <div>payouts: <span className={result.payouts_enabled ? "text-emerald-300" : "text-red-300"}>{String(result.payouts_enabled)}</span></div>
            <div>details_submitted: <span className={result.details_submitted ? "text-emerald-300" : "text-red-300"}>{String(result.details_submitted)}</span></div>
          </div>
          {!result.details_submitted && (
            <div className="mt-2 text-amber-300">
              ⚠ Stripe says onboarding is NOT yet complete. Finish the Stripe-hosted flow, then re-run this link (or wait for the webhook) to flip the flags.
            </div>
          )}
        </div>
      )}
    </section>
  );
}


// ─────────────────────────────────────────────────────────────────────
// iter260 — Bulk reset every maker's Stripe Connect state. Used during
// a Stripe platform migration when STRIPE_API_KEY is being swapped to a
// new platform account (old `acct_*` IDs become dead pointers).
// ─────────────────────────────────────────────────────────────────────
function StripeBulkResetCard() {
  const [preview, setPreview] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const API = process.env.REACT_APP_BACKEND_URL;
  const authedFetch = (body) =>
    fetch(`${API}/api/admin/stripe/reset-all-connect-accounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}`,
      },
      body: JSON.stringify(body),
    });

  const loadPreview = async () => {
    setErr("");
    setResult(null);
    setBusy(true);
    try {
      const r = await authedFetch({ confirm: "" });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.detail || `HTTP ${r.status}`);
      setPreview(body);
    } catch (e) {
      setErr(e.message || "Preview failed");
    } finally {
      setBusy(false);
    }
  };

  const runReset = async () => {
    if (confirmText.trim() !== "RESET ALL") {
      setErr("Type the exact phrase RESET ALL to confirm.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const r = await authedFetch({ confirm: "RESET ALL" });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.detail || `HTTP ${r.status}`);
      setResult(body);
      setPreview(null);
      setConfirmText("");
    } catch (e) {
      setErr(e.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="border border-amber-900/40 bg-amber-950/10 p-4 md:p-5"
      data-testid="stripe-bulk-reset-card"
    >
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
          ◆ Danger zone · Stripe platform migration
        </div>
        <h3 className="font-display text-xl mt-1 text-amber-100">
          Reset all Stripe Connect accounts
        </h3>
        <p className="font-mono text-xs text-amber-200/70 mt-2 max-w-2xl leading-relaxed">
          Wipes <code>stripe_account_id</code> + status flags on every maker.
          Use this only when you've swapped <code>STRIPE_API_KEY</code> to a
          new Stripe platform — the old <code>acct_*</code> IDs become dead
          pointers (the new platform can't retrieve them). Makers will
          re-onboard cleanly under the new platform on their next visit to
          <code> /maker/dashboard/financials</code>.
        </p>
      </div>

      {!preview && !result && (
        <button
          onClick={loadPreview}
          disabled={busy}
          className="mt-4 px-4 py-2 border border-amber-600/60 text-amber-200 hover:border-amber-400 hover:text-amber-100 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          data-testid="stripe-reset-preview"
        >
          {busy ? "Loading preview…" : "↻ Preview impact"}
        </button>
      )}

      {preview && (
        <div className="mt-4 border border-amber-700/40 bg-black/30 p-3" data-testid="stripe-reset-preview-panel">
          <div className="font-mono text-xs text-amber-200">
            <span className="font-bold">{preview.would_reset}</span> maker row(s) currently hold a Stripe Connect account ID.
          </div>
          {preview.sample && preview.sample.length > 0 && (
            <div className="mt-2 font-mono text-[10.5px] text-amber-200/70">
              <div className="text-amber-300/80 mb-1">Sample (up to 10):</div>
              {preview.sample.map((s, i) => (
                <div key={i} className="flex gap-2 py-0.5">
                  <span className="w-32 truncate text-amber-100">{s.slug}</span>
                  <span className="w-44 truncate">…{(s.stripe_account_id || "").slice(-12)}</span>
                  <span className="text-amber-200/50">payouts: {String(s.stripe_payouts_enabled || false)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 border-t border-amber-700/30 pt-3">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
                Type <code className="text-amber-100">RESET ALL</code> to confirm
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="RESET ALL"
                className="mt-1 w-full bg-black border border-amber-700/40 focus:border-amber-400 outline-none px-3 py-2 font-mono text-sm text-amber-100"
                data-testid="stripe-reset-confirm-input"
              />
            </label>
            <div className="mt-3 flex gap-2">
              <button
                onClick={runReset}
                disabled={busy || confirmText.trim() !== "RESET ALL"}
                className="px-4 py-2 border border-red-600 bg-red-900/30 text-red-200 hover:bg-red-900/60 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="stripe-reset-execute"
              >
                {busy ? "Wiping…" : "⚠ Wipe Connect state →"}
              </button>
              <button
                onClick={() => { setPreview(null); setConfirmText(""); setErr(""); }}
                disabled={busy}
                className="px-4 py-2 border border-[#262626] text-[#a3a3a3] hover:border-[#737373] font-mono text-[11px] uppercase tracking-[0.22em] transition"
                data-testid="stripe-reset-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {err && (
        <div className="mt-3 font-mono text-xs text-red-300 border border-red-900/60 bg-red-950/20 p-3" data-testid="stripe-reset-error">
          {err}
        </div>
      )}

      {result && (
        <div className="mt-4 border border-emerald-700/40 bg-emerald-950/15 p-3 font-mono text-xs text-emerald-200" data-testid="stripe-reset-result">
          <div className="font-bold mb-1.5">✓ Stripe Connect state wiped</div>
          <div className="text-emerald-300/80">
            matched <span className="text-emerald-100">{result.matched}</span> · modified <span className="text-emerald-100">{result.modified}</span>
          </div>
          <div className="mt-2 text-emerald-200/70">
            All makers will see a fresh "Connect Stripe" prompt on their next visit to <code>/maker/dashboard/financials</code>.
          </div>
        </div>
      )}
    </section>
  );
}




function HeroHeadlinesCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState({ statement: "", accent: "", closer: "" });

  const refresh = async () => {
    try { setData(await adminListHeroHeadlines()); }
    catch (e) { toast.error(e?.response?.data?.detail || "Load failed."); }
  };
  useEffect(() => { refresh(); }, []);

  const onRefreshFromAI = async () => {
    setRefreshing(true);
    try {
      const r = await adminRefreshHeroHeadlines();
      toast.success(`AI drafted ${r.drafted_by_ai} · inserted ${r.inserted} · skipped ${r.skipped_dup} dup · archived ${r.archived_old}`);
      await refresh();
    } catch (e) { toast.error(e?.response?.data?.detail || "Refresh failed."); }
    finally { setRefreshing(false); }
  };

  const onPin = async (id) => {
    setBusy(true);
    try { await adminPinHeroHeadline(id); toast.success("Pinned — this headline now overrides rotation."); await refresh(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Pin failed."); }
    finally { setBusy(false); }
  };
  const onUnpin = async () => {
    setBusy(true);
    try { await adminUnpinHeroHeadlines(); toast.success("Rotation re-enabled."); await refresh(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Unpin failed."); }
    finally { setBusy(false); }
  };
  const onArchive = async (id) => {
    setBusy(true);
    try { await adminArchiveHeroHeadline(id); await refresh(); } catch (e) { toast.error(e?.response?.data?.detail || "Archive failed."); }
    finally { setBusy(false); }
  };
  const onRestore = async (id) => {
    setBusy(true);
    try { await adminRestoreHeroHeadline(id); await refresh(); } catch (e) { toast.error(e?.response?.data?.detail || "Restore failed."); }
    finally { setBusy(false); }
  };
  const onDelete = async (id) => {
    if (!window.confirm("Delete this headline permanently?")) return;
    setBusy(true);
    try { await adminDeleteHeroHeadline(id); await refresh(); } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed."); }
    finally { setBusy(false); }
  };
  const onCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminCreateHeroHeadline(form);
      setForm({ statement: "", accent: "", closer: "" });
      toast.success("Headline added.");
      await refresh();
    } catch (err) { toast.error(err?.response?.data?.detail || "Create failed."); }
    finally { setBusy(false); }
  };

  if (!data) return (
    <div className="border border-amber-700/30 bg-[#0a0805] p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber-400 mb-3">◆ Hero Headlines · Rotating Pool</div>
      <RowsSkeleton count={4} />
    </div>
  );

  const live = data.items.filter((i) => i.status === "live");
  const archived = data.items.filter((i) => i.status === "archived");

  return (
    <div className="border border-amber-700/30 bg-[#0a0805] p-5 space-y-4" data-testid="hero-headlines-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber-400 mb-1">◆ Hero Headlines · Rotating Pool</div>
          <h3 className="font-display text-xl text-amber-200">Rotating Headlines</h3>
          <p className="font-mono text-[11px] text-[#a3a3a3] mt-1 max-w-[60ch] leading-relaxed">
            Live pool rotates on the homepage hero every 7s. Daily Gemini cron drafts 5 fresh variants at 09:15 UTC. Pin one to override rotation for a campaign window.
          </p>
        </div>
        <button
          onClick={onRefreshFromAI}
          disabled={refreshing}
          className="btn-industrial inline-flex items-center justify-center gap-2 text-xs disabled:opacity-50"
          data-testid="hero-headlines-refresh-ai-btn"
        >
          {refreshing ? "Drafting…" : "✦ Generate 5 with AI"}
        </button>
      </div>

      {/* Counts strip */}
      <div className="font-mono text-[11px] grid grid-cols-3 md:grid-cols-6 gap-2" data-testid="hero-headlines-counts">
        <CountTile label="Live" value={data.counts.live} />
        <CountTile label="AI" value={data.counts.ai} />
        <CountTile label="Seed" value={data.counts.seed} />
        <CountTile label="Manual" value={data.counts.manual} />
        <CountTile label="Archived" value={data.counts.archived} />
        <CountTile label="Pinned" value={data.counts.pinned} highlight={data.counts.pinned > 0} />
      </div>

      {data.counts.pinned > 0 && (
        <div className="border border-amber-500/60 bg-amber-950/30 px-4 py-2.5 font-mono text-[11px] text-amber-200 flex items-center justify-between" data-testid="hero-headlines-pinned-banner">
          <span>◆ A headline is pinned — rotation is paused.</span>
          <button onClick={onUnpin} disabled={busy} className="underline hover:no-underline text-amber-100 text-[11px]" data-testid="hero-headlines-unpin-btn">Resume rotation →</button>
        </div>
      )}

      {/* Live list */}
      <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1" data-testid="hero-headlines-live-list">
        {live.map((h) => (
          <HeadlineRow key={h.id} h={h} busy={busy} onPin={onPin} onArchive={onArchive} onDelete={onDelete} />
        ))}
      </div>

      {/* Manual add */}
      <form onSubmit={onCreate} className="border-t border-amber-900/40 pt-4 space-y-2" data-testid="hero-headlines-create-form">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber-300">◆ Add manual variant</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input value={form.statement} onChange={(e) => setForm({ ...form, statement: e.target.value })} placeholder="Statement (≤28)" maxLength={32} required className="bg-[#0a0a0a] border border-[#262626] focus:border-amber-400 px-3 py-2 font-mono text-xs text-zinc-100 outline-none" data-testid="hh-create-statement" />
          <input value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} placeholder="Accent word (≤12, 1 word)" maxLength={16} required className="bg-[#0a0a0a] border border-[#262626] focus:border-amber-400 px-3 py-2 font-mono text-xs text-amber-300 outline-none" data-testid="hh-create-accent" />
          <input value={form.closer} onChange={(e) => setForm({ ...form, closer: e.target.value })} placeholder="Closer (≤16)" maxLength={20} required className="bg-[#0a0a0a] border border-[#262626] focus:border-amber-400 px-3 py-2 font-mono text-xs text-zinc-100 outline-none" data-testid="hh-create-closer" />
        </div>
        <div className="flex items-center justify-between">
          <div className="font-mono text-[11px] text-[#525252]">
            Preview: <span className="text-zinc-200">{form.statement || "—"}.</span>{" "}
            <span className="text-[#ff4500]">{form.accent || "—"}</span>{" "}
            <span className="text-zinc-200">{form.closer || "—"}.</span>
          </div>
          <button type="submit" disabled={busy} className="btn-industrial btn-primary text-xs disabled:opacity-50" data-testid="hh-create-submit">Add</button>
        </div>
      </form>

      {archived.length > 0 && (
        <details className="border-t border-amber-900/40 pt-4">
          <summary className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#737373] cursor-pointer">◇ Archived ({archived.length})</summary>
          <div className="space-y-1.5 mt-3 max-h-[260px] overflow-y-auto pr-1">
            {archived.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 border border-[#1a1a1a] bg-[#0a0a0a] px-3 py-2" data-testid={`hh-archived-${h.id}`}>
                <div className="font-mono text-[11px] text-[#525252] truncate">
                  {h.statement}. <span className="text-amber-700">{h.accent}</span> {h.closer}.
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => onRestore(h.id)} disabled={busy} className="font-mono text-[10px] text-amber-300 hover:text-amber-100">Restore</button>
                  <button onClick={() => onDelete(h.id)} disabled={busy} className="font-mono text-[10px] text-red-300 hover:text-red-100">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function HeadlineRow({ h, busy, onPin, onArchive, onDelete }) {
  return (
    <div className={`flex items-center justify-between gap-3 border ${h.pinned ? "border-amber-500/60 bg-amber-950/20" : "border-[#1a1a1a] bg-[#0a0a0a]"} px-3 py-2`} data-testid={`hh-row-${h.id}`}>
      <div className="font-mono text-[12px] text-zinc-200 truncate flex-1">
        {h.pinned && <span className="text-amber-400 mr-1.5">◆</span>}
        <span className="text-zinc-100">{h.statement}.</span>{" "}
        <span className="text-[#ff4500]">{h.accent}</span>{" "}
        <span className="text-zinc-300">{h.closer}.</span>
        <span className="ml-2 text-[10px] uppercase tracking-[0.22em] text-[#525252]">{h.source}</span>
      </div>
      <div className="flex gap-1.5 shrink-0">
        {!h.pinned && (
          <button onClick={() => onPin(h.id)} disabled={busy} className="font-mono text-[10px] text-amber-300 hover:text-amber-100 px-2 py-1 border border-amber-700/50 hover:border-amber-400" data-testid={`hh-pin-${h.id}`}>Pin</button>
        )}
        <button onClick={() => onArchive(h.id)} disabled={busy} className="font-mono text-[10px] text-[#a3a3a3] hover:text-zinc-100 px-2 py-1 border border-[#262626] hover:border-zinc-500" data-testid={`hh-archive-${h.id}`}>Archive</button>
        {h.source !== "seed" && (
          <button onClick={() => onDelete(h.id)} disabled={busy} className="font-mono text-[10px] text-red-300 hover:text-red-100 px-2 py-1 border border-red-900/50 hover:border-red-500" data-testid={`hh-delete-${h.id}`}>×</button>
        )}
      </div>
    </div>
  );
}

function CountTile({ label, value, highlight }) {
  return (
    <div className={`border px-2 py-1.5 ${highlight ? "border-amber-500 bg-amber-950/30" : "border-[#262626] bg-[#0a0a0a]"}`}>
      <div className={`uppercase tracking-[0.22em] text-[9px] ${highlight ? "text-amber-300" : "text-[#525252]"}`}>{label}</div>
      <div className={`text-base ${highlight ? "text-amber-200" : "text-zinc-200"}`}>{value}</div>
    </div>
  );
}

function OperatorOpsChecklistCard() {
  // Consolidated post-deploy / weekly-ops checklist. Each row is one
  // operator concern with a live status probe + a "Run check" button and
  // a deep-link to the existing tab that handles deeper actions. The
  // backing diagnostic endpoints are all unchanged — this is purely a
  // single-pane-of-glass surface so nothing gets forgotten on deploy day.
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
      setSeoDiag(await fetchSeoDiag());
    } catch (e) {
      setSeoErr(e?.message || "Failed");
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
      const body = await fetchOgDiag();
      setPrerenderResult({ ok: !!body, body });
    } catch (e) {
      setPrerenderResult({ ok: false, error: e?.message, status: e?.response?.status });
    } finally { setPrerenderBusy(false); }
  };

  // ── IndexNow ping — handled by an existing admin endpoint. Just calls it
  //    so the operator gets a one-click "tell Bing/Yandex about every URL"
  //    affordance from this checklist. ─────────────────────────────────
  const runIndexNow = async () => {
    setIndexnowBusy(true); setIndexnowResult(null);
    try {
      const r = await adminPingIndexNow();
      setIndexnowResult(r);
      toast.success("IndexNow ping submitted.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Ping failed.");
      setIndexnowResult({ ok: false, error: e?.message });
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
// ─────────────────────────────────────────────────────────────────────
// iter289 — Stripe webhook health card. Surfaces signature failures,
// route 404s, and stuck event types BEFORE they cost real money.
// Reads from `GET /api/admin/stripe/webhook-health` which aggregates
// the last 7d of `stripe_webhook_log` rows (populated by both the
// main checkout webhook and the Connect webhook).
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// iter292 — Sales channel feeds card.
// Surfaces the 3 catalog feed URLs (Pinterest / Google / Meta) with a
// one-click "Copy URL" and a "last crawled X ago" indicator pulled from
// `feed_access_log`. Discoverable home for these URLs so they're not
// buried in chat history.
// ─────────────────────────────────────────────────────────────────────
function SalesChannelFeedsCard() {
  const API = process.env.REACT_APP_BACKEND_URL;
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");  // which channel was just copied
  // iter293 — Per-channel auth credentials. Currently only Pinterest
  // requires login on the data-source URL. `null` means "not loaded yet";
  // empty object means "no auth required for this channel".
  const [creds, setCreds] = useState({});  // { pinterest: {username, password, rotated_at} }
  const [showPw, setShowPw] = useState({});
  const [rotating, setRotating] = useState("");

  const adminHeader = () => ({
    Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}`,
  });

  const load = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/admin/feeds/status`, { headers: adminHeader() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      // Fetch Pinterest credentials in parallel — fire-and-forget; if
      // the endpoint 404s (e.g. backwards-compat with older API), we
      // simply hide the password row.
      try {
        const rc = await fetch(`${API}/api/admin/feeds/pinterest/credentials`, { headers: adminHeader() });
        if (rc.ok) {
          const body = await rc.json();
          setCreds((c) => ({ ...c, pinterest: body }));
        }
      } catch {/* ignore */}
    } catch (e) {
      setErr(e.message || "Load failed");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const copy = async (key, value, label = "URL") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied((c) => (c === key ? "" : c)), 2500);
    } catch {
      toast.error("Couldn't copy — select + copy manually.");
    }
  };

  const rotate = async (channel) => {
    if (!window.confirm(
      `Rotate the ${channel} feed password?\n\n` +
      "The current password stops working IMMEDIATELY. You'll need to " +
      "paste the new password into the platform's data-source form before " +
      "the next crawl, or the feed will fail."
    )) return;
    setRotating(channel);
    try {
      const r = await fetch(`${API}/api/admin/feeds/${channel}/rotate-password`, {
        method: "POST", headers: adminHeader(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const fresh = await r.json();
      setCreds((c) => ({ ...c, [channel]: fresh }));
      setShowPw((s) => ({ ...s, [channel]: true }));  // auto-reveal so admin sees the new value
      toast.success("Password rotated — copy + paste it into the platform now.");
    } catch (e) {
      toast.error(e.message || "Rotation failed");
    } finally {
      setRotating("");
    }
  };

  const fmtAgo = (iso) => {
    if (!iso) return "never";
    try {
      const ms = Date.now() - new Date(iso).getTime();
      if (ms < 60_000) return "just now";
      if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
      if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
      const d = Math.floor(ms / 86_400_000);
      return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
    } catch { return iso; }
  };

  // Verdict colors based on time-since-last-crawl. Platforms typically
  // hit daily, so a > 36h gap is a real red flag.
  const hitVerdict = (last) => {
    if (!last?.ts) return { color: "#737373", label: "no hits yet" };
    const hoursAgo = (Date.now() - new Date(last.ts).getTime()) / 3.6e6;
    if (hoursAgo < 36) return { color: "#22c55e", label: "active" };
    if (hoursAgo < 7 * 24) return { color: "#f59e0b", label: "stale" };
    return { color: "#ef4444", label: "silent" };
  };

  if (err && !data) {
    return (
      <section className="border border-[#262626] p-4 md:p-5" data-testid="sales-feeds-card">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Sales channel feeds</div>
        <div className="font-mono text-xs text-red-400 mt-2">{err}</div>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="border border-[#262626] p-4 md:p-5" data-testid="sales-feeds-card">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Sales channel feeds</div>
        <div className="font-mono text-xs text-[#737373] mt-2">Loading…</div>
      </section>
    );
  }

  return (
    <section
      className="border border-[#262626] p-4 md:p-5"
      data-testid="sales-feeds-card"
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Sales channel feeds
          </div>
          <h3 className="font-display text-xl mt-1 text-[#e5e5e5]">
            Auto-pull catalog URLs
          </h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl">
            Paste each URL into the matching platform's "catalog feed" form.
            All three are public, refresh hourly, and honor each maker's
            <code className="text-[#ff4500]"> external_ads_opt_out</code> toggle.
            The "last crawled" timestamp confirms the platform's crawler is
            actually hitting us.
          </p>
        </div>
        <button
          onClick={load}
          disabled={busy}
          data-testid="sales-feeds-refresh"
          className="shrink-0 px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="space-y-3">
        {data.channels.map((c) => {
          const verd = hitVerdict(c.last_hit);
          return (
            <div
              key={c.key}
              className="border border-[#262626] bg-[#0d0d0d] p-4"
              data-testid={`sales-feed-${c.key}`}
            >
              <div className="flex flex-wrap items-baseline gap-3 mb-2">
                <div className="font-display text-base text-[#e5e5e5]">{c.name}</div>
                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">{c.format}</span>
                <span
                  className="ml-auto px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] border"
                  style={{ borderColor: verd.color, color: verd.color }}
                  data-testid={`sales-feed-${c.key}-verdict`}
                >
                  ◆ {verd.label}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-2">
                <code
                  className="font-mono text-[11px] text-cyan-300 bg-[#080808] border border-[#262626] px-2 py-1 break-all flex-1 min-w-0"
                  data-testid={`sales-feed-${c.key}-url`}
                >
                  {c.url}
                </code>
                <button
                  onClick={() => copy(c.key, c.url)}
                  className="px-2.5 py-1 border border-[#ff4500]/60 text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[9px] uppercase tracking-[0.22em]"
                  data-testid={`sales-feed-${c.key}-copy`}
                >
                  {copied === c.key ? "✓ Copied" : "Copy URL"}
                </button>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 border border-[#262626] text-[#a3a3a3] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[9px] uppercase tracking-[0.22em]"
                  data-testid={`sales-feed-${c.key}-open`}
                >
                  Open ↗
                </a>
              </div>

              <div className="font-mono text-[10px] text-[#737373]">
                Last crawl:{" "}
                <span className="text-[#e5e5e5]">{fmtAgo(c.last_hit?.ts)}</span>
                {c.last_hit?.rows != null && (
                  <span className="text-[#525252]">{" "}· returned <span className="text-[#a3a3a3]">{c.last_hit.rows}</span> rows</span>
                )}
                <span className="text-[#525252]">{" "}· {c.hits_7d} hits in 7d</span>
                {c.last_hit?.ua && (
                  <div className="text-[#525252] truncate" title={c.last_hit.ua}>
                    UA: {c.last_hit.ua.slice(0, 80)}
                  </div>
                )}
              </div>

              {/* iter293 — Pinterest-only credentials block */}
              {c.key === "pinterest" && creds.pinterest && (
                <div className="mt-3 pt-3 border-t border-[#1f1f1f]">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                    ◆ Basic auth credentials (Pinterest enterprise flow)
                  </div>
                  <div className="grid sm:grid-cols-[120px_1fr_auto] gap-2 items-center mb-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">username</div>
                    <code className="font-mono text-[11px] text-cyan-300 bg-[#080808] border border-[#262626] px-2 py-1">
                      {creds.pinterest.username}
                    </code>
                    <button
                      onClick={() => copy(`${c.key}-user`, creds.pinterest.username, "Username")}
                      className="px-2.5 py-1 border border-[#262626] text-[#a3a3a3] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[9px] uppercase tracking-[0.22em]"
                      data-testid={`sales-feed-${c.key}-copy-user`}
                    >
                      {copied === `${c.key}-user` ? "✓" : "Copy"}
                    </button>
                  </div>
                  <div className="grid sm:grid-cols-[120px_1fr_auto] gap-2 items-center mb-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">password</div>
                    <code className="font-mono text-[11px] text-amber-300 bg-[#080808] border border-[#262626] px-2 py-1 break-all">
                      {showPw[c.key]
                        ? creds.pinterest.password
                        : "•".repeat(Math.min(creds.pinterest.password?.length || 0, 32))}
                    </code>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setShowPw((s) => ({ ...s, [c.key]: !s[c.key] }))}
                        className="px-2.5 py-1 border border-[#262626] text-[#a3a3a3] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[9px] uppercase tracking-[0.22em]"
                        data-testid={`sales-feed-${c.key}-toggle-pw`}
                      >
                        {showPw[c.key] ? "Hide" : "Show"}
                      </button>
                      <button
                        onClick={() => copy(`${c.key}-pw`, creds.pinterest.password, "Password")}
                        className="px-2.5 py-1 border border-[#262626] text-[#a3a3a3] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[9px] uppercase tracking-[0.22em]"
                        data-testid={`sales-feed-${c.key}-copy-pw`}
                      >
                        {copied === `${c.key}-pw` ? "✓" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2 mt-2">
                    <div className="font-mono text-[10px] text-[#525252]">
                      Last rotated: {fmtAgo(creds.pinterest.rotated_at)}
                      {creds.pinterest.rotated_by && (
                        <span> · by <span className="text-[#737373]">{creds.pinterest.rotated_by}</span></span>
                      )}
                    </div>
                    <button
                      onClick={() => rotate(c.key)}
                      disabled={rotating === c.key}
                      className="px-2.5 py-1 border border-amber-500/60 text-amber-300 hover:bg-amber-500/10 font-mono text-[9px] uppercase tracking-[0.22em] disabled:opacity-50"
                      data-testid={`sales-feed-${c.key}-rotate`}
                    >
                      {rotating === c.key ? "Rotating…" : "↺ Rotate password"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StripeWebhookHealthCard() {
  const API = process.env.REACT_APP_BACKEND_URL;
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/admin/stripe/webhook-health`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e.message || "Load failed");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const fmtAgo = (iso) => {
    if (!iso) return "never";
    try {
      const ms = Date.now() - new Date(iso).getTime();
      if (ms < 60_000) return "just now";
      if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
      if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
      const d = Math.floor(ms / 86_400_000);
      return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
    } catch { return iso; }
  };

  if (err && !data) {
    return (
      <section className="border border-[#262626] p-4 md:p-5" data-testid="stripe-webhook-health-card">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Stripe · webhook health</div>
        <div className="font-mono text-xs text-red-400 mt-2">{err}</div>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="border border-[#262626] p-4 md:p-5" data-testid="stripe-webhook-health-card">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Stripe · webhook health</div>
        <div className="font-mono text-xs text-[#737373] mt-2">Loading…</div>
      </section>
    );
  }

  // Health verdict per channel — drives the colored status pill at top.
  // Definitions:
  //   green  → at least 1 ok in last 24h AND zero errors in last 7d
  //   amber  → ok in last 24h BUT some errors in last 7d
  //   red    → zero ok in last 24h (or never received) — actively broken
  //   gray   → no secret configured (channel disabled by ops)
  const verdict = (k) => {
    const v = data[k] || {};
    if (!data.secrets_configured?.[k]) return { color: "#737373", label: "not configured" };
    if (v.ok_24h > 0 && v.err_7d === 0) return { color: "#22c55e", label: "healthy" };
    if (v.ok_24h > 0)                   return { color: "#f59e0b", label: "degraded" };
    if (v.last)                         return { color: "#ef4444", label: "failing" };
    return { color: "#737373", label: "no events yet" };
  };

  const Channel = ({ k, title, configUrl }) => {
    const v = data[k] || {};
    const verd = verdict(k);
    return (
      <div
        className="border border-[#262626] bg-[#0d0d0d] p-4"
        data-testid={`stripe-webhook-${k}`}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{title}</div>
            <div className="font-mono text-[10px] text-[#525252] mt-0.5">
              {configUrl}
            </div>
          </div>
          <span
            className="px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] border"
            style={{ borderColor: verd.color, color: verd.color }}
            data-testid={`stripe-webhook-${k}-verdict`}
          >
            ◆ {verd.label}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div>
            <div className="font-display text-xl" style={{ color: v.ok_24h ? "#22c55e" : "#525252" }}>
              {v.ok_24h || 0}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#737373]">ok · 24h</div>
          </div>
          <div>
            <div className="font-display text-xl text-[#a3a3a3]">{v.ok_7d || 0}</div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#737373]">ok · 7d</div>
          </div>
          <div>
            <div className="font-display text-xl" style={{ color: v.err_7d ? "#ef4444" : "#525252" }}>
              {v.err_7d || 0}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#737373]">err · 7d</div>
          </div>
        </div>

        <div className="font-mono text-[10px] text-[#a3a3a3]">
          Last event: <span className="text-[#e5e5e5]">{fmtAgo(v.last?.ts)}</span>
          {v.last?.event_type && (
            <span className="text-[#525252]"> · <code className="text-cyan-400">{v.last.event_type}</code></span>
          )}
        </div>

        {/* Recent errors — inline preview so admin can copy/paste */}
        {v.recent_errors?.length > 0 && (
          <details className="mt-3">
            <summary className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300 cursor-pointer">
              ▾ {v.recent_errors.length} recent error{v.recent_errors.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 space-y-1.5 max-h-48 overflow-auto" data-testid={`stripe-webhook-${k}-errors`}>
              {v.recent_errors.map((e, i) => (
                <li key={i} className="border-l-2 border-red-500/40 pl-2 py-0.5">
                  <div className="font-mono text-[10px] text-[#737373]">
                    {fmtAgo(e.ts)} · <span className="text-amber-300">{e.status}</span>
                    {e.event_type && <span className="text-[#525252]"> · {e.event_type}</span>}
                  </div>
                  <div className="font-mono text-[10px] text-red-300 break-words mt-0.5">
                    {e.error || "(no detail)"}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  };

  return (
    <section
      className="border border-[#262626] p-4 md:p-5"
      data-testid="stripe-webhook-health-card"
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Stripe · webhook health
          </div>
          <h3 className="font-display text-xl mt-1 text-[#e5e5e5]">
            Are Stripe events actually reaching us?
          </h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl">
            Both webhook routes log every hit (signature failures, route 404s,
            handler errors). A red verdict means something is silently broken —
            check the recent errors below or send a test event from the Stripe
            Dashboard webhook page.
          </p>
        </div>
        <button
          onClick={load}
          disabled={busy}
          data-testid="stripe-webhook-health-refresh"
          className="shrink-0 px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Channel
          k="main"
          title="Main · checkout.session.*"
          configUrl="POST /api/webhook/stripe"
        />
        <Channel
          k="connect"
          title="Connect · account.updated, subscriptions"
          configUrl="POST /api/stripe/connect/webhook"
        />
      </div>

      {(!data.secrets_configured?.main || !data.secrets_configured?.connect) && (
        <div
          className="mt-3 border border-amber-500/30 bg-amber-500/5 p-2.5 font-mono text-[11px] text-amber-300"
          data-testid="stripe-webhook-health-config-warn"
        >
          ⚠ Set <code className="text-amber-200">STRIPE_WEBHOOK_SECRET</code> and{" "}
          <code className="text-amber-200">STRIPE_CONNECT_WEBHOOK_SECRET</code> in backend/.env
          (find them in Stripe Dashboard → Developers → Webhooks → your endpoint → "Signing secret").
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// iter275 — GSC indexation summary widget. One-glance "is Google
// noticing my listings?" answer that surfaces stuck URLs (crawled-
// not-indexed, soft 404s) before they tank organic traffic. Reads
// from `GET /api/admin/gsc/indexation-summary` which aggregates:
//   • products.gsc_tier buckets (established / submitted /
//     not_in_sitemap / unchecked) — populated by the daily refresh cron
//   • gsc_sitemap_log (last 7d / 30d submit counts)
//   • system_state/startup_seo (most recent on-deploy auto-submit)
// ─────────────────────────────────────────────────────────────────────
function GscIndexationCard() {
  const API = process.env.REACT_APP_BACKEND_URL;
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true); setErr("");
    try {
      const token = localStorage.getItem("cm_admin_jwt") || "";
      const r = await fetch(`${API}/api/admin/gsc/indexation-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e.message || "Failed to load");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (err && !data) {
    return (
      <section className="border border-[#262626] p-4 md:p-5" data-testid="gsc-indexation-card">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">SEO · indexation health</div>
        <div className="font-mono text-xs text-red-400 mt-2">{err}</div>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="border border-[#262626] p-4 md:p-5" data-testid="gsc-indexation-card">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">SEO · indexation health</div>
        <div className="font-mono text-xs text-[#737373] mt-2">Loading…</div>
      </section>
    );
  }

  const t = data.tier_counts || {};
  const total = data.total_published || 0;
  const pct = (n) => total ? Math.round((n / total) * 100) : 0;

  const fmtDate = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      const ms = Date.now() - d.getTime();
      const h = Math.floor(ms / 3.6e6);
      if (h < 1) return "just now";
      if (h < 24) return `${h}h ago`;
      const days = Math.floor(h / 24);
      if (days < 30) return `${days}d ago`;
      return d.toLocaleDateString();
    } catch { return iso; }
  };

  const lastSubmit = data.last_sitemap_submit;
  const lastStartup = data.last_startup_submit;

  return (
    <section
      className="border border-[#262626] p-4 md:p-5"
      data-testid="gsc-indexation-card"
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            SEO · indexation health
          </div>
          <h3 className="font-display text-xl mt-1 text-[#e5e5e5]">
            {data.indexed_pct}% of published listings indexed by Google
          </h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl">
            One-glance "is Google noticing my listings?". Refreshed by the
            daily 05:30 UTC <code className="text-[#ff4500]">refresh_gsc_indexing</code>{" "}
            cron + the on-deploy submission hook.
          </p>
        </div>
        <button
          onClick={load}
          disabled={busy}
          data-testid="gsc-indexation-refresh"
          className="shrink-0 px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Tier buckets — the load-bearing visualization */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {[
          ["Indexed",       t.established,    "#22c55e", "established"],
          ["Submitted",     t.submitted,      "#f59e0b", "submitted"],
          ["Excluded",      t.not_in_sitemap, "#ef4444", "not_in_sitemap"],
          ["Not checked",   t.unchecked,      "#737373", "unchecked"],
        ].map(([lbl, n, col, key]) => (
          <div
            key={key}
            className="border border-[#262626] bg-[#0d0d0d] p-3"
            data-testid={`gsc-indexation-tier-${key}`}
          >
            <div className="flex items-baseline gap-2">
              <div className="font-display text-2xl" style={{ color: n ? col : "#525252" }}>
                {n || 0}
              </div>
              <div className="font-mono text-[10px] text-[#737373]">· {pct(n)}%</div>
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-1">
              {lbl}
            </div>
          </div>
        ))}
      </div>

      {/* Stale + submit history strip */}
      <div className="grid md:grid-cols-3 gap-3 text-[11px] font-mono">
        <div className="border border-[#262626] bg-[#0d0d0d] p-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#737373] mb-1">
            ◆ Refresh backlog
          </div>
          <div className="text-[#e5e5e5]">
            <span className="font-display text-lg"
                  style={{ color: data.stale_count ? "#f59e0b" : "#22c55e" }}>
              {data.stale_count}
            </span>{" "}
            listings unchecked or {">"}7 days stale
          </div>
        </div>
        <div className="border border-[#262626] bg-[#0d0d0d] p-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#737373] mb-1">
            ◆ Sitemap submits (7d)
          </div>
          <div className="text-[#e5e5e5]">
            <span className="font-display text-lg text-[#22d3ee]">{data.sitemap_submits_7d}</span>{" "}
            total · 30d: {data.sitemap_submits_30d_ok} ok / {data.sitemap_submits_30d_err} err
          </div>
          {lastSubmit?.ts && (
            <div className="text-[10px] text-[#737373] mt-1">
              Last: {fmtDate(lastSubmit.ts)}{" "}
              <span style={{ color: lastSubmit.ok ? "#22c55e" : "#ef4444" }}>
                · {lastSubmit.ok ? "ok" : `err ${lastSubmit.status || ""}`}
              </span>
            </div>
          )}
        </div>
        <div className="border border-[#262626] bg-[#0d0d0d] p-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#737373] mb-1">
            ◆ On-deploy auto-submit
          </div>
          <div className="text-[#e5e5e5]">
            {lastStartup?.last_submitted_at
              ? `Fired ${fmtDate(lastStartup.last_submitted_at)}`
              : "Never fired"}
          </div>
          {lastStartup?.last_payload?.indexnow && (
            <div className="text-[10px] text-[#737373] mt-1">
              IndexNow: {lastStartup.last_payload.indexnow.submitted ?? "?"} URLs ·
              GSC: {lastStartup.last_payload.gsc?.ok ? "ok"
                  : (lastStartup.last_payload.gsc?.reason || "err")}
            </div>
          )}
        </div>
      </div>

      {!data.gsc_connected && (
        <div className="mt-3 border border-amber-500/30 bg-amber-500/5 p-2.5 font-mono text-[11px] text-amber-300"
             data-testid="gsc-indexation-not-connected">
          ⚠ GSC not connected — tier buckets stay at 0 until you connect
          OAuth in the "GSC connection" card above. The on-deploy
          IndexNow ping still fires either way.
        </div>
      )}
    </section>
  );
}

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


// ─────────────────────────────────────────────────────────────────────
// iter261 — LLM budget exhaustion alerts panel. Shows recent budget
// alerts + a one-click test button. The actual alerts are fired by the
// Sora-2 daily clip cron when the Emergent Universal Key is exhausted.
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// iter263 — Daily ops digest preview + send. Mirrors the cron that
// fires every 06:00 UTC. Lets the operator preview yesterday's data
// without leaving the admin dashboard and fire a manual send to any
// email (defaults to OPS_EMAIL).
// ─────────────────────────────────────────────────────────────────────
function OpsDigestCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [recipient, setRecipient] = useState("");

  const API = process.env.REACT_APP_BACKEND_URL;
  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` });

  const loadPreview = async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`${API}/api/admin/ops-digest/preview`, { headers: auth() });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.detail || `HTTP ${r.status}`);
      setData(body);
    } catch (e) {
      setErr(e.message || "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  const sendNow = async () => {
    setSending(true);
    setErr("");
    setSentTo("");
    try {
      const r = await fetch(`${API}/api/admin/ops-digest/send-now`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: recipient.trim() || null }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.detail || `HTTP ${r.status}`);
      if (body.sent) setSentTo(body.to);
      else setErr(body.reason || "Send returned false");
    } catch (e) {
      setErr(e.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => { loadPreview(); /* eslint-disable-next-line */ }, []);

  return (
    <section className="border border-[#262626] p-4 md:p-5" data-testid="ops-digest-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Daily ops digest · 06:00 UTC cron
          </div>
          <h3 className="font-display text-xl mt-1 text-[#e5e5e5]">
            Yesterday in one email
          </h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl leading-relaxed">
            GMV, makers, catalog, traffic, reliability, community — one
            inbox-worthy summary every morning. Disable via{" "}
            <code>OPS_DIGEST_ENABLED=false</code>.
          </p>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300 border border-emerald-700/60 px-2 py-1">
          ✓ scheduled
        </div>
      </div>

      {err && (
        <div className="mt-3 font-mono text-xs text-red-300 border border-red-900/60 bg-red-950/20 p-3" data-testid="ops-digest-err">
          {err}
        </div>
      )}

      {sentTo && (
        <div className="mt-3 font-mono text-xs text-emerald-300 border border-emerald-700/40 bg-emerald-950/20 p-3" data-testid="ops-digest-sent">
          ✓ Sent to {sentTo}
        </div>
      )}

      {data && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="ops-digest-tiles">
          <div className="border border-[#262626] p-3 bg-[#0a0a0a]">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">GMV (yest.)</div>
            <div className="font-mono text-lg text-emerald-300 mt-1">${data.revenue?.gmv?.toLocaleString?.(undefined, { minimumFractionDigits: 2 }) ?? "0.00"}</div>
            <div className="font-mono text-[10px] text-[#737373] mt-0.5">{data.revenue?.orders ?? 0} orders</div>
          </div>
          <div className="border border-[#262626] p-3 bg-[#0a0a0a]">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">New makers</div>
            <div className="font-mono text-lg text-cyan-300 mt-1">{data.makers?.new_makers ?? 0}</div>
            <div className="font-mono text-[10px] text-[#737373] mt-0.5">{data.makers?.new_applications ?? 0} applied · {data.makers?.new_plus ?? 0} new Plus</div>
          </div>
          <div className="border border-[#262626] p-3 bg-[#0a0a0a]">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">Pageviews</div>
            <div className="font-mono text-lg text-violet-300 mt-1">{(data.traffic?.pageviews ?? 0).toLocaleString()}</div>
            <div className="font-mono text-[10px] text-[#737373] mt-0.5">{(data.traffic?.sessions ?? 0).toLocaleString()} sessions · {(data.traffic?.visitors ?? 0).toLocaleString()} visitors</div>
          </div>
          <div className="border border-[#262626] p-3 bg-[#0a0a0a]">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">Reliability</div>
            <div className={`font-mono text-lg mt-1 ${
              (data.reliability?.outages?.length || 0) + (data.reliability?.budget_alerts?.length || 0) === 0
                ? "text-emerald-300" : "text-amber-300"
            }`}>
              {(data.reliability?.outages?.length || 0) + (data.reliability?.budget_alerts?.length || 0) === 0 ? "✓ All clear" : "⚠ Issues"}
            </div>
            <div className="font-mono text-[10px] text-[#737373] mt-0.5">{data.reliability?.outages?.length ?? 0} outages · {data.reliability?.budget_alerts?.length ?? 0} budget</div>
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2 flex-wrap items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              Send to (defaults to OPS_EMAIL)
            </span>
            <input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
              data-testid="ops-digest-recipient"
            />
          </label>
        </div>
        <button
          onClick={loadPreview}
          disabled={loading}
          className="h-[42px] px-3 border border-[#262626] hover:border-[#737373] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] disabled:opacity-50"
          data-testid="ops-digest-refresh"
        >
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
        <button
          onClick={sendNow}
          disabled={sending}
          className="h-[42px] px-4 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500] hover:text-black font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
          data-testid="ops-digest-send"
        >
          {sending ? "Sending…" : "▷ Send now"}
        </button>
      </div>
    </section>
  );
}


function LlmBudgetAlertsCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [testing, setTesting] = useState(false);

  const API = process.env.REACT_APP_BACKEND_URL;
  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` });

  const refresh = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`${API}/api/admin/llm-budget-alerts`, { headers: auth() });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.detail || `HTTP ${r.status}`);
      setData(body);
    } catch (e) {
      setErr(e.message || "Failed to load");
    } finally {
      setBusy(false);
    }
  };

  const fireTest = async () => {
    setTesting(true);
    setErr("");
    try {
      const r = await fetch(`${API}/api/admin/llm-budget-alerts/test`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.detail || `HTTP ${r.status}`);
      await refresh();
    } catch (e) {
      setErr(e.message || "Test failed");
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const relTime = (iso) => {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const lastAt = data?.last_alert_at;
  const healthy = !lastAt || (Date.now() - new Date(lastAt).getTime()) > 7 * 24 * 3600 * 1000;

  return (
    <section
      className="border border-[#262626] p-4 md:p-5"
      data-testid="llm-budget-alerts-card"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            LLM Universal Key · Budget watchdog
          </div>
          <h3 className="font-display text-xl mt-1 text-[#e5e5e5]">
            Sora-2 budget exhaustion alerts
          </h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl leading-relaxed">
            When the daily Sora-2 clip cron hits an "out of budget" error from
            the Emergent Universal Key, we fire a one-shot admin email + Slack/Discord
            ping (dedup'd 24h) and log it here. Top up at
            {" "}<span className="text-[#ff4500]">Emergent → Profile → Universal Key</span>.
          </p>
        </div>
        <div className={`px-2 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] ${
          healthy ? "border-emerald-700 text-emerald-300" : "border-amber-600 text-amber-300"
        }`} data-testid="llm-budget-status-pill">
          {healthy ? "✓ healthy" : "⚠ recent alert"}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="border border-[#262626] p-3 bg-[#0a0a0a]">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">Last alert</div>
          <div className="font-mono text-sm text-[#e5e5e5] mt-1" data-testid="llm-last-alert">
            {relTime(lastAt)}
          </div>
        </div>
        <div className="border border-[#262626] p-3 bg-[#0a0a0a]">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">Last service</div>
          <div className="font-mono text-sm text-[#e5e5e5] mt-1 truncate" title={data?.last_service || ""}>
            {data?.last_service || "—"}
          </div>
        </div>
        <div className="border border-[#262626] p-3 bg-[#0a0a0a]">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">History (90d)</div>
          <div className="font-mono text-sm text-[#e5e5e5] mt-1">{data?.count ?? "—"}</div>
        </div>
      </div>

      <div className="mt-4 flex gap-2 flex-wrap">
        <button
          onClick={refresh}
          disabled={busy}
          className="px-3 py-1.5 border border-[#262626] hover:border-[#737373] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] disabled:opacity-50"
          data-testid="llm-budget-refresh"
        >
          {busy ? "Loading…" : "↻ Refresh"}
        </button>
        <button
          onClick={fireTest}
          disabled={testing}
          className="px-3 py-1.5 border border-amber-700/60 hover:border-amber-500 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300 disabled:opacity-50"
          data-testid="llm-budget-test"
        >
          {testing ? "Firing…" : "▷ Fire test alert"}
        </button>
      </div>

      {err && (
        <div className="mt-3 font-mono text-xs text-red-300 border border-red-900/60 bg-red-950/20 p-3">
          {err}
        </div>
      )}

      {data?.rows && data.rows.length > 0 && (
        <div className="mt-4 border border-[#262626]" data-testid="llm-budget-history">
          <div className="px-3 py-2 border-b border-[#262626] font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">
            Recent alerts (newest first)
          </div>
          <div className="divide-y divide-[#1a1a1a]">
            {data.rows.slice(0, 10).map((row, i) => (
              <div key={i} className="px-3 py-2 grid grid-cols-[140px,1fr,auto] gap-3 items-center">
                <div className="font-mono text-[10px] text-[#737373]">
                  {relTime(row.created_at)}
                </div>
                <div className="font-mono text-xs text-[#e5e5e5] truncate" title={row.error_message}>
                  {row.service} — {row.error_message}
                </div>
                <div className="font-mono text-[10px] text-[#737373] truncate" title={row.kind}>
                  {row.kind}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}


// ─────────────────────────────────────────────────────────────────────
// iter268 — Cart-recovery conversion attribution. Reads the
// `discount_attributions` ledger and shows per-channel redemption
// counts + revenue so the operator can see whether SMS adds enough
// lift over email-only to justify the per-message cost. Channel buckets
// are email · sms · direct (latter = buyer redeemed without clicking
// through any recovery CTA).
// ─────────────────────────────────────────────────────────────────────
function CartRecoveryAttributionCard() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const API = process.env.REACT_APP_BACKEND_URL;
  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` });

  const load = async (windowDays) => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(
        `${API}/api/admin/abandoned-cart/attribution?days=${windowDays}`,
        { headers: auth() }
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body?.detail || `HTTP ${r.status}`);
      setData(body);
    } catch (e) {
      setErr(e.message || "Load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); /* eslint-disable-next-line */ }, []);

  const onDaysChange = (d) => {
    setDays(d);
    load(d);
  };

  const fmt$ = (n) => `$${Number(n || 0).toFixed(2)}`;
  const channelStyles = {
    email:  { dot: "#22d3ee", label: "Email" },
    sms:    { dot: "#ff4500", label: "SMS" },
    direct: { dot: "#737373", label: "Direct (no CTA)" },
  };

  return (
    <section
      className="border border-[#262626] bg-[#0a0a0a] p-5"
      data-testid="cart-recovery-attribution-card"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#ff4500]">
            ◆ Cart-recovery attribution
          </div>
          <div className="text-[#e5e5e5] mt-1">
            Where the buyers came from when they redeemed a recovery discount code.
          </div>
          <div className="font-mono text-[11px] text-[#737373] mt-1">
            Counts marketplace-wide codes only (per-shop maker codes excluded).
          </div>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDaysChange(d)}
              className={`font-mono text-[11px] px-2 py-1 border ${days === d ? "border-[#ff4500] text-[#ff4500]" : "border-[#262626] text-[#a3a3a3] hover:text-[#e5e5e5]"}`}
              data-testid={`attr-window-${d}d`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="mt-3 font-mono text-xs text-red-400 break-all" data-testid="attr-error">
          {err}
        </div>
      )}

      {loading && !data && (
        <div className="font-mono text-xs text-[#737373]">Loading…</div>
      )}

      {data && (
        <>
          <div className="grid md:grid-cols-3 gap-3 mt-4">
            {["email", "sms", "direct"].map((k) => {
              const v = data.by_medium[k] || {};
              const s = channelStyles[k];
              return (
                <div
                  key={k}
                  className="border border-[#262626] bg-[#0a0a0a] p-3"
                  data-testid={`attr-row-${k}`}
                >
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                    <span style={{ width: 8, height: 8, background: s.dot, display: "inline-block" }} />
                    {s.label}
                  </div>
                  <div className="font-display text-[28px] text-[#e5e5e5] mt-2 leading-none" data-testid={`attr-${k}-redemptions`}>
                    {v.redemptions || 0}
                  </div>
                  <div className="font-mono text-[10px] text-[#737373] mt-1">
                    {v.redemptions === 1 ? "redemption" : "redemptions"}
                  </div>
                  <div className="font-mono text-[11px] text-[#a3a3a3] mt-3">
                    Revenue: <span className="text-[#e5e5e5]" data-testid={`attr-${k}-revenue`}>{fmt$(v.total_revenue)}</span>
                  </div>
                  <div className="font-mono text-[11px] text-[#a3a3a3]">
                    AOV: <span className="text-[#e5e5e5]">{fmt$(v.avg_order_value)}</span>
                  </div>
                  <div className="font-mono text-[11px] text-[#a3a3a3]">
                    Total discounted: {fmt$(v.total_discount)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-[#262626] grid md:grid-cols-3 gap-3 font-mono text-[11px]">
            <div className="text-[#a3a3a3]">
              <span className="text-[#737373]">Last {data.days}d total · </span>
              <span className="text-[#e5e5e5]" data-testid="attr-total-redemptions">
                {data.totals.redemptions}
              </span>{" "}
              redemptions
            </div>
            <div className="text-[#a3a3a3]">
              <span className="text-[#737373]">Revenue: </span>
              <span className="text-[#e5e5e5]">{fmt$(data.totals.total_revenue)}</span>
            </div>
            <div className="text-[#a3a3a3]">
              <span className="text-[#737373]">Discounted: </span>
              <span className="text-[#e5e5e5]">{fmt$(data.totals.total_discount)}</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}


// ─────────────────────────────────────────────────────────────────────
// iter270 — EnrichLabs product-feed download card. Lets the operator
// grab the {product_name, image_url, listing_url} export as CSV or JSON
// to share with EnrichLabs (or any external marketing agent). The data
// is the same as `/api/enrich/v1/feed.{csv,json}` — surfaced here so the
// admin doesn't need to run curl with the API key.
// ─────────────────────────────────────────────────────────────────────
function EnrichLabsFeedCard() {
  const API = process.env.REACT_APP_BACKEND_URL;
  const [busy, setBusy] = useState("");
  const [includeOos, setIncludeOos] = useState(false);
  const [count, setCount] = useState(null);

  const fetchWithAdminKey = async (path) => {
    // The EnrichLabs endpoints are gated by `X-EnrichLabs-Key`, but the
    // admin doesn't memorize that — so we proxy through an admin-only
    // helper that reads the env-var server-side.
    const r = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };

  const download = async (fmt) => {
    setBusy(fmt);
    try {
      const r = await fetchWithAdminKey(
        `/api/admin/integrations/enrichlabs/feed.${fmt}?include_out_of_stock=${includeOos}`
      );
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.href = url;
      a.download = `crafters_market_feed_${today}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${fmt.toUpperCase()} feed.`);
    } catch (e) {
      toast.error(e.message || "Download failed");
    } finally {
      setBusy("");
    }
  };

  const preview = async () => {
    setBusy("preview");
    try {
      const r = await fetchWithAdminKey(
        `/api/admin/integrations/enrichlabs/feed.json?include_out_of_stock=${includeOos}`
      );
      const arr = await r.json();
      setCount(arr.length);
      toast.success(`Feed contains ${arr.length} products.`);
    } catch (e) {
      toast.error(e.message || "Preview failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <section
      className="border border-[#262626] bg-[#0a0a0a] p-5"
      data-testid="enrichlabs-feed-card"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#ff4500]">
        ◆ EnrichLabs product feed
      </div>
      <div className="text-[#e5e5e5] mt-1">
        Export {`{product_name, image_url, listing_url}`} for EnrichLabs or any external marketing agent.
      </div>
      <div className="font-mono text-[11px] text-[#737373] mt-1">
        Published listings only · absolute URLs · max 5000 rows
      </div>

      <label className="flex items-center gap-2 mt-3 cursor-pointer">
        <input
          type="checkbox"
          checked={includeOos}
          onChange={(e) => setIncludeOos(e.target.checked)}
          className="accent-[#ff4500]"
          data-testid="enrich-feed-include-oos"
        />
        <span className="font-mono text-[11px] text-[#d4d4d4]">
          Include out-of-stock listings
        </span>
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => download("csv")}
          disabled={busy === "csv"}
          className="px-4 py-2 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500] hover:text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          data-testid="enrich-feed-download-csv"
        >
          {busy === "csv" ? "Downloading…" : "Download CSV"}
        </button>
        <button
          type="button"
          onClick={() => download("json")}
          disabled={busy === "json"}
          className="px-4 py-2 border border-[#262626] text-[#e5e5e5] hover:border-[#525252] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          data-testid="enrich-feed-download-json"
        >
          {busy === "json" ? "Downloading…" : "Download JSON"}
        </button>
        <button
          type="button"
          onClick={preview}
          disabled={busy === "preview"}
          className="px-4 py-2 border border-[#262626] text-[#a3a3a3] hover:border-[#525252] hover:text-[#e5e5e5] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          data-testid="enrich-feed-preview"
        >
          {busy === "preview" ? "Counting…" : "Count rows"}
        </button>
        {count !== null && (
          <span className="font-mono text-[11px] text-[#a3a3a3] self-center" data-testid="enrich-feed-count">
            {count} products in current feed
          </span>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-[#262626] font-mono text-[11px] text-[#737373]">
        EnrichLabs can also pull directly via the API:{" "}
        <code className="text-[#a3a3a3]">GET /api/enrich/v1/feed.csv</code>{" "}
        (header <code className="text-[#a3a3a3]">X-EnrichLabs-Key</code>).
      </div>
    </section>
  );
}


// ─────────────────────────────────────────────────────────────────────
// iter313 — Community feeds (Showcase + Design Files). Same shape as
// the product feed above so any partner that ingests {product_name,
// image_url, listing_url} can reuse their parser unchanged — we just
// rename to {item_name, image_url, permalink} since the source rows
// aren't products. Both feeds honor each maker's external_ads_opt_out
// toggle, identical to the product feed.
// ─────────────────────────────────────────────────────────────────────
function CommunityFeedCard({ kind, title, description, accent }) {
  // kind: "showcase" | "design-files"
  const API = process.env.REACT_APP_BACKEND_URL;
  const [busy, setBusy] = useState("");
  const [count, setCount] = useState(null);

  const fetchAdmin = async (path) => {
    const r = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };

  const download = async (fmt) => {
    setBusy(fmt);
    try {
      const r = await fetchAdmin(`/api/admin/integrations/enrichlabs/${kind}/feed.${fmt}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.href = url;
      a.download = `crafters_${kind.replace("-", "_")}_feed_${today}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${fmt.toUpperCase()} feed.`);
    } catch (e) {
      toast.error(e.message || "Download failed");
    } finally {
      setBusy("");
    }
  };

  const preview = async () => {
    setBusy("preview");
    try {
      const r = await fetchAdmin(`/api/admin/integrations/enrichlabs/${kind}/feed.json`);
      const arr = await r.json();
      setCount(arr.length);
      toast.success(`Feed contains ${arr.length} items.`);
    } catch (e) {
      toast.error(e.message || "Preview failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <section
      className="border border-[#262626] bg-[#0a0a0a] p-5"
      data-testid={`enrichlabs-${kind}-feed-card`}
    >
      <div
        className="font-mono text-[10px] uppercase tracking-[0.25em]"
        style={{ color: accent }}
      >
        ◆ {title}
      </div>
      <div className="text-[#e5e5e5] mt-1">{description}</div>
      <div className="font-mono text-[11px] text-[#737373] mt-1">
        Shape: {`{item_name, image_url, permalink}`} · honors maker opt-out · max 5000 rows
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => download("csv")}
          disabled={busy === "csv"}
          className="px-4 py-2 border font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          style={{ borderColor: accent, color: accent }}
          data-testid={`enrichlabs-${kind}-download-csv`}
        >
          {busy === "csv" ? "Downloading…" : "Download CSV"}
        </button>
        <button
          type="button"
          onClick={() => download("json")}
          disabled={busy === "json"}
          className="px-4 py-2 border border-[#262626] text-[#e5e5e5] hover:border-[#525252] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          data-testid={`enrichlabs-${kind}-download-json`}
        >
          {busy === "json" ? "Downloading…" : "Download JSON"}
        </button>
        <button
          type="button"
          onClick={preview}
          disabled={busy === "preview"}
          className="px-4 py-2 border border-[#262626] text-[#a3a3a3] hover:border-[#525252] hover:text-[#e5e5e5] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          data-testid={`enrichlabs-${kind}-preview`}
        >
          {busy === "preview" ? "Counting…" : "Count rows"}
        </button>
        {count !== null && (
          <span
            className="font-mono text-[11px] text-[#a3a3a3] self-center"
            data-testid={`enrichlabs-${kind}-count`}
          >
            {count} items in current feed
          </span>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-[#262626] font-mono text-[11px] text-[#737373]">
        Partner pull (no admin JWT needed):{" "}
        <code className="text-[#a3a3a3]">GET /api/enrich/v1/{kind}/feed.csv</code>{" "}
        (header <code className="text-[#a3a3a3]">X-EnrichLabs-Key</code>).
      </div>
    </section>
  );
}


// ─────────────────────────────────────────────────────────────────────
// iter271 — Social auto-post queue. Lists every listing that's been
// auto-queued for Crafters Market's branded IG/Pinterest/FB posting
// (only Founder + Plus makers get auto-queued — eligibility lives in
// `backend/social_auto_post_service.py::eligibility_for`). Ops works
// the queue manually today: copy the image + caption to IG, mark the
// row "Published". Skip if it's off-brand / poor photo / already posted.
// ─────────────────────────────────────────────────────────────────────
function SocialAutoPostQueueCard() {
  const API = process.env.REACT_APP_BACKEND_URL;
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState(null);
  const [eligCounts, setEligCounts] = useState(null);
  const [credStatus, setCredStatus] = useState(null);  // {instagram, facebook, pinterest}
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const auth = () => ({
    Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}`,
  });

  const load = async (statusFilter) => {
    setErr("");
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch(`${API}/api/admin/social-auto-post/queue?status=${statusFilter}&limit=50`, { headers: auth() }),
        fetch(`${API}/api/admin/social-auto-post/eligibility-counts`, { headers: auth() }),
        fetch(`${API}/api/admin/social-auto-post/credentials-status`, { headers: auth() }),
      ]);
      if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
      const body = await r1.json();
      setData(body);
      if (r2.ok) setEligCounts(await r2.json());
      if (r3.ok) setCredStatus((await r3.json()).channels);
    } catch (e) {
      setErr(e.message || "Load failed");
    }
  };

  useEffect(() => { load(status); /* eslint-disable-next-line */ }, [status]);

  const markPublished = async (rowId) => {
    setBusy(rowId);
    try {
      const r = await fetch(`${API}/api/admin/social-auto-post/${rowId}/mark-published`, {
        method: "POST", headers: auth(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success("Marked as published.");
      load(status);
    } catch (e) {
      toast.error(e.message || "Failed");
    } finally {
      setBusy("");
    }
  };

  // iter273 — actually fire the publish to IG/FB/Pinterest via env-bound
  // credentials. Per-channel result lives in `platform_post_ids` +
  // `platform_errors` on the row. UI surfaces the per-channel outcome
  // via toasts so the admin sees exactly which channel landed.
  const publishNow = async (rowId) => {
    setBusy(rowId);
    try {
      const r = await fetch(`${API}/api/admin/social-auto-post/${rowId}/publish-now`, {
        method: "POST", headers: auth(),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.detail || `HTTP ${r.status}`);
      const ok = Object.keys(body.platform_ids || {});
      const errs = Object.keys(body.errors || {});
      const skipped = Object.keys(body.skipped || {});
      if (ok.length) toast.success(`Published to ${ok.join(", ")}`);
      if (errs.length) toast.error(`Errors on: ${errs.join(", ")}`);
      if (skipped.length) toast(`Skipped (no creds): ${skipped.join(", ")}`,
                                 { icon: "⚠️" });
      load(status);
    } catch (e) {
      toast.error(e.message || "Failed");
    } finally {
      setBusy("");
    }
  };

  const skip = async (rowId) => {
    const reason = window.prompt("Why skip this listing? (optional, ≤200 chars)") || "";
    setBusy(rowId);
    try {
      const url = `${API}/api/admin/social-auto-post/${rowId}/skip?reason=${encodeURIComponent(reason)}`;
      const r = await fetch(url, { method: "POST", headers: auth() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success("Skipped.");
      load(status);
    } catch (e) {
      toast.error(e.message || "Failed");
    } finally {
      setBusy("");
    }
  };

  const [captionsOpen, setCaptionsOpen] = useState({});  // {rowId: bool}

  const toggleCaptions = (rowId) =>
    setCaptionsOpen((prev) => ({ ...prev, [rowId]: !prev[rowId] }));

  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso || ""; }
  };

  const tierColor = {
    inaugural_founder: "#22d3ee",
    founder: "#ff4500",
    plus: "#ff4500",
  };

  return (
    <section
      className="border border-[#262626] bg-[#0a0a0a] p-5"
      data-testid="social-auto-post-queue-card"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#ff4500]">
            ◆ Social auto-post queue
          </div>
          <div className="text-[#e5e5e5] mt-1">
            Listings queued for our IG / Pinterest / Facebook accounts.
          </div>
          <div className="font-mono text-[11px] text-[#737373] mt-1">
            Only Founder + Plus makers' listings auto-queue. Free-tier makers must upgrade.
          </div>
        </div>
        <div className="flex gap-1">
          {["pending", "published", "skipped", "all"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`font-mono text-[10px] uppercase tracking-[0.18em] px-2 py-1 border ${status === s ? "border-[#ff4500] text-[#ff4500]" : "border-[#262626] text-[#a3a3a3] hover:text-[#e5e5e5]"}`}
              data-testid={`social-queue-filter-${s}`}
            >
              {s}
              {data?.summary?.[s] !== undefined && s !== "all" && (
                <span className="ml-1 text-[#525252]">· {data.summary[s]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Top stats row: queue summary + eligibility breakdown */}
      <div className="grid md:grid-cols-2 gap-3 mb-4">
        {data?.summary && (
          <div className="border border-[#262626] bg-[#0d0d0d] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373] mb-2">
              ◆ Queue totals
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                ["Pending",   data.summary.pending,   "#ff4500"],
                ["Published", data.summary.published, "#22c55e"],
                ["Skipped",   data.summary.skipped,   "#737373"],
              ].map(([lbl, v, col]) => (
                <div key={lbl} data-testid={`social-queue-stat-${lbl.toLowerCase()}`}>
                  <div className="font-display text-2xl leading-none" style={{ color: v ? col : "#525252" }}>
                    {v}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#737373] mt-1">{lbl}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {eligCounts && (
          <div className="border border-[#262626] bg-[#0d0d0d] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373] mb-2">
              ◆ Makers by tier ({eligCounts.total} total)
            </div>
            <div className="space-y-1.5 font-mono text-[11px]">
              <TierRow label="Inaugural Founder" count={eligCounts.counts.inaugural_founder} color="#22d3ee" total={eligCounts.total} />
              <TierRow label="Founder member"    count={eligCounts.counts.founder}           color="#ff4500" total={eligCounts.total} />
              <TierRow label="Plus subscriber"   count={eligCounts.counts.plus}              color="#ff4500" total={eligCounts.total} />
              <TierRow label="Free tier (no auto-post)" count={eligCounts.counts.none}       color="#737373" total={eligCounts.total} />
            </div>
          </div>
        )}
      </div>

      {err && (
        <div className="font-mono text-xs text-red-400 mb-3" data-testid="social-queue-error">{err}</div>
      )}

      {/* iter273 — Auto-publish credential status banner */}
      {credStatus && (
        <div
          className="border border-[#262626] bg-[#0d0d0d] p-2.5 mb-3 flex items-center gap-4 flex-wrap"
          data-testid="social-queue-creds-banner"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">
            ◆ Auto-publish
          </div>
          {["instagram", "facebook", "pinterest"].map((ch) => (
            <span
              key={ch}
              className="font-mono text-[10px] uppercase tracking-[0.18em]"
              style={{ color: credStatus[ch] ? "#22c55e" : "#737373" }}
              data-testid={`social-queue-cred-${ch}`}
            >
              {credStatus[ch] ? "✓" : "○"} {ch}
            </span>
          ))}
          {!Object.values(credStatus).some(Boolean) && (
            <span className="font-mono text-[10px] text-[#737373] ml-auto">
              Add Meta/Pinterest tokens to /app/backend/.env to enable
              "Publish now" buttons.
            </span>
          )}
        </div>
      )}

      {/* Queue rows */}
      {data?.rows?.length === 0 && (
        <div className="border border-[#262626] bg-[#0d0d0d] p-6 text-center font-mono text-xs text-[#525252]">
          No rows in the "{status}" bucket.
        </div>
      )}

      {data?.rows?.length > 0 && (
        <div className="border border-[#262626] divide-y divide-[#262626]" data-testid="social-queue-list">
          {data.rows.map((row) => (
            <div key={row.id} className="p-3" data-testid={`social-queue-row-${row.id}`}>
              <div className="flex items-start gap-3">
                {row.image_url && (
                  <img
                    src={row.image_url}
                    alt=""
                    loading="lazy"
                    className="w-16 h-16 object-cover shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-mono text-xs text-[#e5e5e5] truncate">
                      {row.product_title}
                    </div>
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.22em] px-1.5 py-0.5 border"
                      style={{ color: tierColor[row.eligibility_tier] || "#737373", borderColor: tierColor[row.eligibility_tier] || "#262626" }}
                    >
                      {row.eligibility_tier?.replace("_", " ")}
                    </span>
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.22em] px-1.5 py-0.5 border"
                      style={{
                        color: row.status === "pending" ? "#ff4500"
                             : row.status === "published" ? "#22c55e"
                             : "#737373",
                        borderColor: "#262626",
                      }}
                    >
                      {row.status}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-[#737373] mt-1">
                    by {row.maker_name} · ${(row.price || 0).toFixed(0)} ·{" "}
                    {row.status === "pending" ? "Queued" : "Closed"} {fmtDate(row.published_at || row.queued_at)}
                  </div>
                  <div className="font-mono text-[10px] text-[#525252] mt-1">
                    {(row.channels || []).join(" · ")}
                  </div>
                  {row.skipped_reason && (
                    <div className="font-mono text-[10px] text-[#a3a3a3] mt-1 italic">
                      Skip reason: {row.skipped_reason}
                    </div>
                  )}
                </div>
                {/* Actions */}
                <div className="flex flex-col gap-1.5 shrink-0">
                  <a
                    href={row.product_url}
                    target="_blank" rel="noopener noreferrer"
                    className="px-2.5 py-1 border border-[#262626] text-[#a3a3a3] hover:text-[#e5e5e5] hover:border-[#525252] font-mono text-[9px] uppercase tracking-[0.22em] text-center"
                    data-testid={`social-queue-open-${row.id}`}
                  >
                    View →
                  </a>
                  {row.status === "pending" && (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleCaptions(row.id)}
                        className="px-2.5 py-1 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 font-mono text-[9px] uppercase tracking-[0.22em]"
                        data-testid={`social-queue-copy-${row.id}`}
                      >
                        {captionsOpen[row.id] ? "Hide captions" : "Captions ▾"}
                      </button>
                      {credStatus && Object.values(credStatus).some(Boolean) && (
                        <button
                          type="button"
                          onClick={() => publishNow(row.id)}
                          disabled={busy === row.id}
                          className="px-2.5 py-1 border border-[#ff4500]/70 text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[9px] uppercase tracking-[0.22em] disabled:opacity-50"
                          data-testid={`social-queue-publish-now-${row.id}`}
                          title="Fire the actual external API calls (IG / FB / Pinterest)"
                        >
                          {busy === row.id ? "…" : "Publish now ⚡"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => markPublished(row.id)}
                        disabled={busy === row.id}
                        className="px-2.5 py-1 border border-[#22c55e]/40 text-[#22c55e] hover:bg-[#22c55e]/10 font-mono text-[9px] uppercase tracking-[0.22em] disabled:opacity-50"
                        data-testid={`social-queue-publish-${row.id}`}
                      >
                        {busy === row.id ? "…" : "Mark published"}
                      </button>
                      <button
                        type="button"
                        onClick={() => skip(row.id)}
                        disabled={busy === row.id}
                        className="px-2.5 py-1 border border-[#262626] text-[#737373] hover:text-[#e5e5e5] hover:border-[#525252] font-mono text-[9px] uppercase tracking-[0.22em] disabled:opacity-50"
                        data-testid={`social-queue-skip-${row.id}`}
                      >
                        Skip
                      </button>
                    </>
                  )}
                </div>
              </div>
              {row.status === "pending" && captionsOpen[row.id] && (
                <CaptionEditorPanel row={row} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TierRow({ label, count, color, total }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 6, height: 6, background: color, display: "inline-block" }} />
      <span className="flex-1 text-[#d4d4d4] truncate">{label}</span>
      <span className="text-[#e5e5e5]" style={{ color: count ? color : undefined }}>{count}</span>
      <span className="text-[#525252] w-10 text-right">{pct}%</span>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// iter272 — Per-channel caption editor for the social auto-post queue.
// Each platform gets its own optimized default template + inline
// editable textarea + one-click Copy button. Three taps → three
// platform-tuned captions in the clipboard.
//
// Why three templates?
//   • Instagram → longer caption + relevant emoji + ~10 hashtags. IG
//     ranks posts partly on engagement-per-impression; better hashtags
//     surface the post to a wider niche audience.
//   • Pinterest → keyword-rich descriptive copy. Pinterest is a search
//     engine; what matters is putting the buyer's likely search terms
//     in the description ("walnut cutting board live edge gift").
//   • Facebook → short + link-forward. FB de-ranks anything that
//     "looks like" Pinterest spam, so brevity + a clear CTA wins.
// ─────────────────────────────────────────────────────────────────────
function CaptionEditorPanel({ row }) {
  const price = (row.price || 0).toFixed(0);
  const title = row.product_title || "";
  const maker = row.maker_name || "the maker";
  const url = row.product_url || "https://craftersmarket.org";

  // Build platform-tuned defaults. The admin can edit each before copying.
  const defaults = React.useMemo(() => ({
    instagram: [
      `✨ NEW DROP — ${maker}`,
      "",
      `${title} · $${price}`,
      "",
      "Hand-crafted in a small workshop, made to order. Click the link in our bio (or the URL below) to grab one before it's gone — these tend to go fast.",
      "",
      `🔗 ${url}`,
      "",
      "#handmade #cncwoodworking #cncart #makersgonnamake #shopsmall #homedecor #craftersmarket #woodworking #smallbusiness #supportlocal",
    ].join("\n"),
    pinterest: [
      `${title} — Handmade by ${maker}`,
      "",
      `${title} · CNC-crafted on Crafters Market · $${price} · made to order · ships from a small US workshop. Perfect for housewarming, anniversary, wedding, and gift ideas. Discover unique handmade decor, signs, and furniture made by independent fabricators.`,
      "",
      `Shop: ${url}`,
    ].join("\n"),
    facebook: [
      `New from ${maker}: ${title} ($${price}) →`,
      "",
      `${url}`,
      "",
      "Hand-crafted, made-to-order, ships from a small US workshop.",
    ].join("\n"),
  }), [title, maker, price, url]);

  // Pre-populate with previously saved captions (if any) so re-opening
  // the editor doesn't blow away the admin's edits.
  const [drafts, setDrafts] = useState({ ...defaults, ...(row.captions || {}) });
  const [saving, setSaving] = useState(false);

  // If the row data changes (rare in practice), refresh the defaults.
  useEffect(() => {
    setDrafts({ ...defaults, ...(row.captions || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults, row.id]);

  const reset = (channel) => {
    setDrafts((d) => ({ ...d, [channel]: defaults[channel] }));
    toast.success("Reset to default template.");
  };

  const copy = async (channel) => {
    try {
      await navigator.clipboard.writeText(drafts[channel]);
      toast.success(`${channel} caption copied — paste into your post.`);
    } catch {
      toast.error("Couldn't copy. Select + copy manually.");
    }
  };

  // iter273 — Persist the edits so "Publish now" (and the auto-publish
  // cron) use them instead of the default templates.
  const save = async () => {
    setSaving(true);
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const r = await fetch(`${API}/api/admin/social-auto-post/${row.id}/captions`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}`,
        },
        body: JSON.stringify(drafts),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success("Captions saved — Publish now will use these.");
    } catch (e) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const channels = [
    { key: "instagram", label: "Instagram",
      hint: "Longer copy · 10 hashtags · emoji · link in URL line",
      accent: "#ec4899" },
    { key: "pinterest", label: "Pinterest",
      hint: "Keyword-rich · search-optimized description · no hashtags",
      accent: "#dc2626" },
    { key: "facebook",  label: "Facebook",
      hint: "Short + link-forward · no hashtag spam (FB de-ranks it)",
      accent: "#3b82f6" },
  ];

  return (
    <div
      className="mt-3 border border-[#1f1f1f] bg-[#070707] p-3 space-y-3"
      data-testid={`caption-editor-${row.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">
          ◆ Per-channel captions · edit, save, then publish
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-2.5 py-0.5 border border-[#ff4500]/60 text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[9px] uppercase tracking-[0.18em] disabled:opacity-50"
          data-testid={`caption-editor-save-${row.id}`}
        >
          {saving ? "Saving…" : "Save captions"}
        </button>
      </div>
      {channels.map((c) => (
        <div key={c.key} data-testid={`caption-editor-${row.id}-${c.key}`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: c.accent }}>
              {c.label}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => reset(c.key)}
                className="px-2 py-0.5 border border-[#262626] text-[#737373] hover:text-[#e5e5e5] hover:border-[#525252] font-mono text-[9px] uppercase tracking-[0.18em]"
                data-testid={`caption-editor-reset-${row.id}-${c.key}`}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => copy(c.key)}
                className="px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.18em]"
                style={{ color: c.accent, borderColor: c.accent, opacity: 0.85 }}
                data-testid={`caption-editor-copy-${row.id}-${c.key}`}
              >
                Copy {c.label}
              </button>
            </div>
          </div>
          <div className="font-mono text-[9px] text-[#525252] mb-1">{c.hint}</div>
          <textarea
            rows={c.key === "instagram" ? 7 : c.key === "pinterest" ? 5 : 4}
            value={drafts[c.key]}
            onChange={(e) => setDrafts((d) => ({ ...d, [c.key]: e.target.value }))}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#525252] outline-none px-2.5 py-2 font-mono text-[11px] text-[#e5e5e5] leading-relaxed resize-y"
            data-testid={`caption-editor-textarea-${row.id}-${c.key}`}
          />
          <div className="font-mono text-[9px] text-[#525252] mt-0.5 text-right">
            {drafts[c.key].length} chars
          </div>
        </div>
      ))}
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
      <FeedHealthCard />
      <ExternalDistributionStatusCard />
      <ZombieCleanupCard />
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

      <GscIndexationCard />

      <StripeWebhookHealthCard />

      <SalesChannelFeedsCard />

      <PurgeFeaturedSeedCard />

      <CommunityDesignsSeedCard />

      <ClipsSeedCard />

      <StripeDiagCard />

      <LlmBudgetAlertsCard />

      <OpsDigestCard />

      <CartRecoveryAttributionCard />

      <EnrichLabsFeedCard />
      <CommunityFeedCard
        kind="showcase"
        title="EnrichLabs · Showcase feed"
        description="Buyer + maker photos of finished pieces. Permalinks deep-link to /community/showcase/&lt;id&gt; — high-converting UGC for partners."
        accent="#22d3ee"
      />
      <CommunityFeedCard
        kind="design-files"
        title="EnrichLabs · Design files feed"
        description="Free SVG/DXF designs. Permalinks point at /free-svg-pack with utm_source=enrichlabs — drives email captures + lead-magnet conversions."
        accent="#a78bfa"
      />

      <SocialAutoPostQueueCard />

      <StripeLinkAccountCard />

      <StripeBulkResetCard />

      {/* iter226 — Same friendly-error pattern, three more integrations. */}
      <ShippoDiagCard />
      <MailgunDiagCard />
      <R2DiagCard />

      <HeroHeadlinesCard />

      <OperatorOpsChecklistCard />

      <div className="grid md:grid-cols-2 gap-3">
        <IdleClearNowCard />
        <HardClearCard onCleared={refresh} />
      </div>

      <FeedbackInbox />
    </div>
  );
}
