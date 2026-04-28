import React, { useState } from "react";
import { toast } from "sonner";
import { passwordSet } from "../../lib/api";
import useModalA11y from "../../hooks/useModalA11y";
import PasswordInput from "../PasswordInput";

/**
 * Blocking "rotate your admin password" modal.
 *
 * Shown whenever the backend reports `requires_password_rotation: true` on
 * `GET /api/admin/me` — which fires when the current admin password is older
 * than `ADMIN_PASSWORD_ROTATION_DAYS` (default 30). No close button, no
 * overlay-click-to-dismiss, no esc-to-close — the admin MUST rotate before
 * they can do anything else in the console.
 *
 * On success: calls `onDone()` so the parent can refresh `/api/admin/me`
 * and the modal unmounts naturally once `requires_password_rotation` flips
 * back to false.
 */
export default function RotatePasswordModal({ email, policyDays, daysSince, onDone, onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // When `onClose` is provided (voluntary rotation from the pre-expiry
  // banner), esc/overlay-click dismiss. When it's absent (hard block after
  // expiry), the modal is persistent and can only be cleared by rotating.
  const dialogRef = useModalA11y(onClose || (() => {}));
  const dismissible = !!onClose;

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (next.length < 10) return setErr("New password must be at least 10 characters.");
    if (next !== confirm) return setErr("Passwords don't match.");
    if (next === current) return setErr("Pick something different from your current password.");
    setBusy(true);
    try {
      const token = localStorage.getItem("cm_admin_jwt");
      await passwordSet("admin", next, current, token);
      toast.success("Password rotated — you're good for another 30 days.");
      await onDone?.();
      onClose?.();
    } catch (e2) {
      const d = e2?.response?.data?.detail;
      setErr(typeof d === "string" ? d : "Couldn't rotate — check your current password and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/95 backdrop-blur-md flex items-center justify-center p-4"
      data-testid="rotate-password-modal"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rotate-pw-headline"
        className="bg-[#0a0a0a] border border-[#ff4500] max-w-md w-full p-6 space-y-4 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 font-mono text-xs text-[#a3a3a3] hover:text-[#ff4500] px-2 py-1 border border-[#262626] hover:border-[#ff4500] transition"
            data-testid="rotate-pw-close"
            aria-label="Close"
          >
            ✕
          </button>
        )}
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
          ◆ Security · {dismissible ? "Rotate early" : "Rotation required"}
        </div>
        <h3 id="rotate-pw-headline" className="font-display text-3xl uppercase leading-[0.95]">
          {dismissible ? "Rotate Your Password." : "Your Password Has Expired."}
        </h3>
        <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
          Admin passwords must be rotated every <b className="text-[#e5e5e5]">{policyDays} days</b>.
          Yours was last changed <b className="text-[#e5e5e5]">{daysSince} days ago</b>.
          {dismissible ? " You can rotate now or come back later." : " Set a new password to continue."}
        </p>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] border border-[#262626] px-3 py-2">
          {email}
        </div>

        <form onSubmit={submit} className="space-y-3" data-testid="rotate-pw-form">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Current password</span>
            <PasswordInput
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
              data-testid="rotate-pw-current"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              New password <span className="text-[#525252]">(min 10 chars)</span>
            </span>
            <PasswordInput
              required
              autoComplete="new-password"
              minLength={10}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
              data-testid="rotate-pw-new"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Confirm new password</span>
            <PasswordInput
              required
              autoComplete="new-password"
              minLength={10}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
              data-testid="rotate-pw-confirm"
            />
          </label>

          {err && (
            <p className="font-mono text-xs text-red-400" data-testid="rotate-pw-error">
              {err}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full btn-industrial btn-primary disabled:opacity-50"
            data-testid="rotate-pw-submit"
          >
            {busy ? "Rotating…" : "Rotate password & continue →"}
          </button>
        </form>
      </div>
    </div>
  );
}
