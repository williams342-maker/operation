import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Key, RefreshCw, ExternalLink, AlertTriangle, CheckCircle2, Clock, ShieldOff, Shield, Zap, Copy, X } from "lucide-react";
import { timeAgo } from "../../lib/timeAgo";
import { useConfirm } from "../../hooks/useConfirm";

// Super-admin-only secrets-rotation tracker. Reads
// /api/admin/secrets/status, renders a per-secret card showing:
//   • whether the credential is currently set in env (presence only)
//   • when it was last rotated (audit log, never the value)
//   • when it should be rotated next (provider-best-practice cadence)
//   • a "Mark rotated" button that resets the timer after the operator
//     has actually rotated the key on the provider's site.
//
// Never displays the actual secret value. We don't even read it — this
// tab is pure rotation-cadence reminder.
const API = process.env.REACT_APP_BACKEND_URL;

const STATUS_STYLES = {
  ok:        { border: "border-emerald-500/40", bg: "bg-emerald-500/5",  text: "text-emerald-400", icon: <CheckCircle2 size={14} />, label: "OK" },
  due_soon:  { border: "border-yellow-500/50", bg: "bg-yellow-500/5",   text: "text-yellow-400",  icon: <Clock size={14} />,         label: "Due soon" },
  overdue:   { border: "border-red-500/50",    bg: "bg-red-500/5",      text: "text-red-400",     icon: <AlertTriangle size={14} />, label: "Overdue" },
  missing:   { border: "border-[#525252]/40",  bg: "bg-[#525252]/5",    text: "text-[#a3a3a3]",   icon: <ShieldOff size={14} />,     label: "Not configured" },
};

function authHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}`,
    "Content-Type": "application/json",
  };
}

export default function SecretsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [pending, setPending] = useState({ main: null, connect: null });
  const [revealedSecret, setRevealedSecret] = useState(null); // {kind, secret, env_var, endpoint_id}
  const [confirm, confirmModal] = useConfirm();

  const load = async () => {
    setLoading(true);
    try {
      const [statusRes, pendingRes] = await Promise.all([
        fetch(`${API}/api/admin/secrets/status`, { headers: authHeaders() }),
        fetch(`${API}/api/admin/secrets/stripe-webhook/pending`, { headers: authHeaders() }),
      ]);
      if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);
      setData(await statusRes.json());
      if (pendingRes.ok) {
        const p = await pendingRes.json();
        setPending(p.pending || { main: null, connect: null });
      }
    } catch (e) {
      toast.error(e.message || "Couldn't load secrets status.");
      setData({ secrets: [], summary: { total: 0, configured: 0, overdue: 0, missing: 0 } });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const markRotated = async (secret) => {
    const ok = await confirm({
      title: `Mark "${secret.label}" as rotated?`,
      body: "Confirm you've ALREADY rotated this credential on the provider's website AND updated the env var. This just resets the rotation timer + writes an audit log row — it does not change the secret itself.",
      confirmLabel: "I've rotated it",
      tone: "primary",
      testId: `confirm-rotate-${secret.id}`,
    });
    if (!ok) return;
    setBusy(secret.id);
    try {
      const r = await fetch(`${API}/api/admin/secrets/mark-rotated`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ secret_id: secret.id }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success(`${secret.label} → marked rotated.`);
      await load();
    } catch (e) {
      toast.error(e.message || "Failed to record rotation.");
    } finally {
      setBusy("");
    }
  };

  // ---- Stripe webhook auto-rotation ----
  const autoRotateStripeWebhook = async (kind = "main") => {
    const ok = await confirm({
      title: "Auto-rotate Stripe webhook signing secret?",
      body: "This calls the Stripe API to create a NEW webhook endpoint at the same URL with the same events. The new signing secret will be shown ONCE in the next dialog — copy it into env STRIPE_WEBHOOK_SECRET and redeploy. The OLD endpoint stays live until you click 'Finalize'.",
      confirmLabel: "Create new endpoint",
      tone: "primary",
      testId: "confirm-stripe-rotate",
    });
    if (!ok) return;
    setBusy("stripe_webhook_rotate");
    try {
      const r = await fetch(`${API}/api/admin/secrets/stripe-webhook/rotate`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ kind }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
      setRevealedSecret({
        kind,
        secret: body.new_secret,
        env_var: body.env_var_to_update,
        endpoint_id: body.new_endpoint_id,
      });
      toast.success("New webhook endpoint created. Copy the secret into env.");
      await load();
    } catch (e) {
      toast.error(e.message || "Auto-rotate failed.");
    } finally {
      setBusy("");
    }
  };

  const finalizeStripeWebhook = async (kind = "main") => {
    const ok = await confirm({
      title: "Finalize Stripe webhook rotation?",
      body: "Confirms env has been updated AND backend redeployed. We will DELETE the old webhook endpoint on Stripe and reset the rotation timer. After this, only the new secret is accepted.",
      confirmLabel: "Yes — delete old endpoint",
      tone: "primary",
      testId: "confirm-stripe-finalize",
    });
    if (!ok) return;
    setBusy("stripe_webhook_finalize");
    try {
      const r = await fetch(`${API}/api/admin/secrets/stripe-webhook/finalize`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ kind }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
      toast.success(body.old_endpoint_deleted ? "Rotation finalized. Old endpoint deleted." : "Rotation finalized. Old endpoint couldn't be deleted (see audit log).");
      await load();
    } catch (e) {
      toast.error(e.message || "Finalize failed.");
    } finally {
      setBusy("");
    }
  };

  const cancelStripeWebhook = async (kind = "main") => {
    const ok = await confirm({
      title: "Cancel pending Stripe webhook rotation?",
      body: "Deletes the NEW webhook endpoint we just created and discards the override. Use this only if you have NOT updated env yet.",
      confirmLabel: "Cancel rotation",
      tone: "danger",
      testId: "confirm-stripe-cancel",
    });
    if (!ok) return;
    setBusy("stripe_webhook_cancel");
    try {
      const r = await fetch(`${API}/api/admin/secrets/stripe-webhook/cancel`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ kind }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
      toast.success("Pending rotation cancelled.");
      await load();
    } catch (e) {
      toast.error(e.message || "Cancel failed.");
    } finally {
      setBusy("");
    }
  };

  if (loading || !data) {
    return (
      <div className="py-12 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]" data-testid="secrets-loading">
        ◆ Loading rotation status…
      </div>
    );
  }

  const groups = data.secrets.reduce((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-8" data-testid="secrets-tab">
      {confirmModal}

      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-1 inline-flex items-center gap-2">
            <Shield size={12} /> Super admin only
          </div>
          <h2 className="font-display text-3xl uppercase">Secrets Rotation.</h2>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-[60ch] leading-relaxed">
            Tracks rotation cadence for every external credential. We never read or store the secret values —
            only the audit history of WHEN you rotated each. Click <span className="text-[#ff4500]">Mark rotated</span> after
            you've actually rotated on the provider's site + updated the env var.
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 border border-[#262626] hover:border-[#ff4500]/40 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5"
          data-testid="secrets-refresh"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </header>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="secrets-summary">
        <SummaryStat label="Tracked" value={data.summary.total} tone="neutral" />
        <SummaryStat label="Configured" value={data.summary.configured} tone="emerald" />
        <SummaryStat label="Overdue" value={data.summary.overdue} tone={data.summary.overdue > 0 ? "red" : "neutral"} testId="secrets-overdue-count" />
        <SummaryStat label="Not set" value={data.summary.missing} tone="gray" />
      </div>

      {/* Groups */}
      {Object.entries(groups).map(([category, rows]) => (
        <section key={category} data-testid={`secrets-group-${category.toLowerCase()}`}>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ {category}
          </div>
          <ul className="space-y-3">
            {rows.map((s) => (
              <SecretRow
                key={s.id}
                secret={s}
                onMarkRotated={() => markRotated(s)}
                busy={busy === s.id}
                pendingRotation={s.id === "stripe_webhook" ? pending.main : null}
                onAutoRotate={s.id === "stripe_webhook" ? () => autoRotateStripeWebhook("main") : null}
                onFinalizeRotation={s.id === "stripe_webhook" ? () => finalizeStripeWebhook("main") : null}
                onCancelRotation={s.id === "stripe_webhook" ? () => cancelStripeWebhook("main") : null}
                autoRotateBusy={
                  busy === "stripe_webhook_rotate" ? "rotate" :
                  busy === "stripe_webhook_finalize" ? "finalize" :
                  busy === "stripe_webhook_cancel" ? "cancel" : ""
                }
              />
            ))}
          </ul>
        </section>
      ))}

      {revealedSecret && (
        <RevealedSecretModal
          info={revealedSecret}
          onClose={() => setRevealedSecret(null)}
        />
      )}
    </div>
  );
}

function SummaryStat({ label, value, tone, testId }) {
  const toneClass = {
    neutral: "border-[#262626] text-[#e5e5e5]",
    emerald: "border-emerald-500/40 text-emerald-400",
    red: "border-red-500/40 text-red-400",
    gray: "border-[#525252]/40 text-[#a3a3a3]",
  }[tone] || "border-[#262626]";
  return (
    <div className={`border ${toneClass} p-4`} data-testid={testId}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] opacity-70">{label}</div>
      <div className="font-display text-3xl mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function SecretRow({ secret, onMarkRotated, busy, pendingRotation, onAutoRotate, onFinalizeRotation, onCancelRotation, autoRotateBusy }) {
  const style = STATUS_STYLES[secret.status] || STATUS_STYLES.ok;
  const isStripeWebhook = !!onAutoRotate;
  const hasPending = !!pendingRotation;
  return (
    <li
      className={`border ${style.border} ${style.bg} p-4 md:p-5`}
      data-testid={`secret-row-${secret.id}`}
    >
      {hasPending && (
        <div className="mb-3 p-3 border border-yellow-500/50 bg-yellow-500/5" data-testid={`pending-rotation-${secret.id}`}>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-yellow-400 inline-flex items-center gap-1.5">
            <Zap size={12} /> Rotation in flight
          </div>
          <div className="font-mono text-xs text-[#e5e5e5] mt-2 leading-relaxed">
            New endpoint <code className="text-yellow-400">{pendingRotation.new_endpoint_id}</code> created
            {pendingRotation.started_at && <> · {timeAgo(pendingRotation.started_at)}</>}
            {pendingRotation.started_by && <> by <span className="text-[#a3a3a3]">{pendingRotation.started_by}</span></>}
            .<br />
            New secret preview: <code className="text-yellow-400">{pendingRotation.new_secret_preview}</code>.
            Once env is updated + redeployed, click <span className="text-emerald-400">Finalize</span> to delete the old endpoint.
          </div>
          <div className="mt-3 flex gap-2 flex-wrap">
            <button
              onClick={onFinalizeRotation}
              disabled={!!autoRotateBusy}
              className="px-3 py-1.5 border border-emerald-500/60 text-emerald-400 hover:bg-emerald-500/10 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-30"
              data-testid={`finalize-rotation-${secret.id}`}
            >
              {autoRotateBusy === "finalize" ? "Finalizing…" : "Finalize rotation"}
            </button>
            <button
              onClick={onCancelRotation}
              disabled={!!autoRotateBusy}
              className="px-3 py-1.5 border border-[#525252] text-[#a3a3a3] hover:border-red-500/40 hover:text-red-400 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-30"
              data-testid={`cancel-rotation-${secret.id}`}
            >
              {autoRotateBusy === "cancel" ? "Cancelling…" : "Cancel rotation"}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Key size={14} className="text-[#a3a3a3] shrink-0" />
            <div className="font-display text-lg">{secret.label}</div>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 border ${style.border} ${style.text} font-mono text-[10px] uppercase tracking-[0.18em]`}>
              {style.icon} {style.label}
            </span>
            {isStripeWebhook && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-[#ff4500]/40 text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.18em]">
                <Zap size={11} /> Auto-rotate available
              </span>
            )}
          </div>

          <div className="font-mono text-[11px] text-[#737373] mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <span>env: {secret.env_keys.map((k) => <code key={k} className="text-[#a3a3a3]">{k}</code>).reduce((acc, x, i) => i === 0 ? [x] : [...acc, " | ", x], [])}</span>
            <span>cadence: {secret.cadence_days}d</span>
            {secret.last_rotated_at ? (
              <span>
                last rotated:{" "}
                <span title={`${new Date(secret.last_rotated_at).toLocaleString()} by ${secret.last_rotated_by || "unknown"}`} className="text-[#e5e5e5]">
                  {timeAgo(secret.last_rotated_at)}
                </span>
                {secret.last_rotated_by && <span className="text-[#525252]"> · {secret.last_rotated_by}</span>}
              </span>
            ) : (
              <span className="text-[#a3a3a3]">last rotated: <span className="text-[#737373]">no record</span></span>
            )}
            {secret.days_until_due !== null && secret.days_until_due !== undefined && (
              <span className={secret.overdue ? "text-red-400" : (secret.days_until_due < 30 ? "text-yellow-400" : "text-[#a3a3a3]")}>
                {secret.overdue
                  ? `overdue by ${Math.abs(secret.days_until_due)}d`
                  : `due in ${secret.days_until_due}d`}
              </span>
            )}
          </div>

          <details className="mt-3 group">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] inline-block">
              ◆ How to rotate ↓
            </summary>
            <div className="mt-3 p-3 border border-[#262626] bg-[#0c0c0c] font-mono text-xs text-[#a3a3a3] leading-relaxed">
              {secret.rotation_notes}
              <div className="mt-3">
                <a
                  href={secret.rotation_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#ff4500] hover:underline"
                >
                  <ExternalLink size={11} /> Open provider dashboard
                </a>
              </div>
            </div>
          </details>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          {isStripeWebhook && !hasPending && (
            <button
              onClick={onAutoRotate}
              disabled={!!autoRotateBusy || !secret.is_set}
              className="px-3 py-2 border border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500] hover:bg-[#ff4500]/20 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              data-testid={`auto-rotate-${secret.id}`}
              title={!secret.is_set ? "Secret is not currently configured in env" : "Create a new Stripe webhook endpoint and get a fresh secret"}
            >
              <Zap size={11} />
              {autoRotateBusy === "rotate" ? "Rotating…" : "Auto-rotate"}
            </button>
          )}
          <button
            onClick={onMarkRotated}
            disabled={busy || !secret.is_set}
            className="px-3 py-2 border border-[#525252] text-[#a3a3a3] hover:border-[#ff4500]/40 hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid={`mark-rotated-${secret.id}`}
            title={!secret.is_set ? "Secret is not currently configured in env" : "Manually mark rotated (no Stripe API call)"}
          >
            {busy ? "Saving…" : "Mark rotated"}
          </button>
        </div>
      </div>
    </li>
  );
}

function RevealedSecretModal({ info, onClose }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(info.secret);
      setCopied(true);
      toast.success("Secret copied to clipboard.");
    } catch {
      toast.error("Couldn't access clipboard — copy manually.");
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
      data-testid="revealed-secret-modal"
    >
      <div className="max-w-2xl w-full border border-[#ff4500]/40 bg-[#0a0a0a] p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-[#a3a3a3] hover:text-[#ff4500]"
          data-testid="revealed-secret-close"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-2 inline-flex items-center gap-2">
          <Zap size={12} /> Copy this NOW — shown only once
        </div>
        <h3 className="font-display text-2xl mb-3">New Stripe webhook signing secret</h3>
        <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mb-4">
          Paste this into <code className="text-[#ff4500]">{info.env_var}</code> in your production env,
          then redeploy. The OLD endpoint stays active until you click <span className="text-emerald-400">Finalize</span> on
          the secrets tab — that protects in-flight events during the redeploy.
        </p>

        <div className="border border-[#262626] bg-[#0c0c0c] p-3 mb-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#737373] mb-1">env var name</div>
          <code className="font-mono text-sm text-[#e5e5e5]">{info.env_var}</code>
        </div>

        <div className="border border-[#ff4500]/40 bg-[#ff4500]/5 p-3 mb-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">new signing secret</div>
          <code
            className="block font-mono text-sm text-[#e5e5e5] break-all select-all"
            data-testid="revealed-secret-value"
          >
            {info.secret}
          </code>
        </div>

        <div className="font-mono text-[10px] text-[#737373] mb-4">
          New endpoint ID: <code className="text-[#a3a3a3]">{info.endpoint_id}</code>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onCopy}
            className="px-3 py-2 border border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500] hover:bg-[#ff4500]/20 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5"
            data-testid="revealed-secret-copy"
          >
            <Copy size={11} /> {copied ? "Copied" : "Copy secret"}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 border border-[#525252] text-[#a3a3a3] hover:border-[#ff4500]/40 font-mono text-[10px] uppercase tracking-[0.22em]"
            data-testid="revealed-secret-dismiss"
          >
            I've saved it
          </button>
        </div>
      </div>
    </div>
  );
}
