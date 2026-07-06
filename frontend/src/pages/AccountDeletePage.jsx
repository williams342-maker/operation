/**
 * Public account-deletion information page — required by Google Play's
 * Account Deletion policy. Anyone (buyer, maker, or unauthenticated
 * visitor) can reach /account/delete and learn:
 *   • how to delete their account
 *   • what data is deleted
 *   • what data is retained (and why)
 *   • the typical processing timeline
 *   • the support email fallback
 *
 * When a buyer is signed in we surface the in-app delete controls;
 * otherwise we deep-link them to `/community/login?next=/account/delete`
 * or `/maker/login?next=/maker/dashboard?tab=settings`.
 *
 * This page must be linkable from the Privacy Policy (see PolicyPage.jsx).
 */
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useStructuredData } from "../lib/seo";

const API = process.env.REACT_APP_BACKEND_URL;
const SUPPORT_EMAIL = "support@craftersmarket.org";
const _tok = () => localStorage.getItem("cm_buyer_jwt");
const _clearTok = () => localStorage.removeItem("cm_buyer_jwt");

export default function AccountDeletePage() {
  const nav = useNavigate();
  const [status, setStatus] = useState({ pending: false, loading: true });
  const [busy, setBusy] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const token = _tok();
  const isBuyerSignedIn = !!token;

  async function loadStatus() {
    if (!token) {
      setStatus({ pending: false, loading: false });
      return;
    }
    try {
      const r = await fetch(`${API}/api/community/account/deletion-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      setStatus({ ...d, loading: false });
    } catch {
      setStatus({ pending: false, loading: false });
    }
  }
  useEffect(() => { loadStatus();   }, []);

  async function requestDeletion() {
    setBusy("request");
    try {
      const r = await fetch(`${API}/api/community/account/request-deletion`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      toast.success("Deletion scheduled. You have 30 days to change your mind.");
      await loadStatus();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); setShowConfirm(false); }
  }

  async function cancelDeletion() {
    setBusy("cancel");
    try {
      const r = await fetch(`${API}/api/community/account/cancel-deletion`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      toast.success("Deletion cancelled. Your account will stay active.");
      await loadStatus();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  }

  async function deleteNow() {
    setBusy("delete-now");
    try {
      const r = await fetch(`${API}/api/community/account/delete-now`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      toast.success("Your account has been deleted.");
      _clearTok();
      setTimeout(() => nav("/"), 800);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); setShowConfirm(false); }
  }

  return (
    <>
      {(() => {
        document.title = "Delete your Crafters Market account";
        return null;
      })()}
      <div className="min-h-screen bg-paper text-ink" data-testid="account-delete-page">
        <div className="max-w-3xl mx-auto px-6 py-16">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-4">
            ◆ Account · Deletion
          </div>
          <h1 className="font-display text-4xl md:text-5xl leading-tight mb-6">
            Delete your account
          </h1>
          <p className="text-ink-muted mb-10 max-w-2xl">
            You control your Crafters Market data. This page explains
            exactly what deletion does, what we keep (and why), and how to
            request removal from any device.
          </p>

          {/* ────────────────── Buyer in-app controls ────────────────── */}
          {isBuyerSignedIn && (
            <section className="border border-line p-6 mb-10" data-testid="buyer-delete-controls">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">
                You are signed in as a buyer
              </div>
              {status.loading ? (
                <p className="text-ink-muted">Checking status…</p>
              ) : status.pending ? (
                <div>
                  <p className="text-ink mb-2">
                    A deletion request is <strong>pending</strong>.
                  </p>
                  <p className="text-ink-muted text-sm mb-4">
                    Your account will be permanently deleted on{" "}
                    <span className="text-ink font-mono">
                      {new Date(status.purge_at).toLocaleDateString()}
                    </span>
                    . Sign in any time before then and click Cancel to
                    keep your account.
                  </p>
                  <button
                    onClick={cancelDeletion}
                    disabled={busy === "cancel"}
                    className="border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.22em] hover:bg-surface-2"
                    data-testid="buyer-cancel-deletion-btn"
                  >
                    {busy === "cancel" ? "…" : "← Cancel deletion — keep my account"}
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-ink mb-4">
                    Ready to delete your buyer account? Choose one:
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={requestDeletion}
                      disabled={busy === "request"}
                      className="border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.22em] hover:bg-surface-2"
                      data-testid="buyer-request-deletion-btn"
                    >
                      {busy === "request" ? "…" : "Schedule deletion (30-day grace)"}
                    </button>
                    <button
                      onClick={() => setShowConfirm(true)}
                      disabled={busy === "delete-now"}
                      className="border border-red-600 text-red-500 px-4 py-2 font-mono text-xs uppercase tracking-[0.22em] hover:bg-red-500/10"
                      data-testid="buyer-delete-now-btn"
                    >
                      Delete immediately
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ────────────────── Non-signed-in fallback ────────────────── */}
          {!isBuyerSignedIn && (
            <section className="border border-line p-6 mb-10" data-testid="signed-out-cta">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">
                Sign in to delete your account
              </div>
              <p className="text-ink mb-4">
                For your security we can only accept deletion requests
                from a signed-in session. Pick the account type you use:
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  to="/community/login?next=/account/delete"
                  className="border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.22em] hover:bg-surface-2"
                  data-testid="signin-as-buyer-link"
                >
                  Sign in as a buyer
                </Link>
                <Link
                  to="/maker/login?next=/maker/dashboard?tab=settings"
                  className="border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.22em] hover:bg-surface-2"
                  data-testid="signin-as-maker-link"
                >
                  Sign in as a maker
                </Link>
              </div>
              <p className="text-ink-muted text-sm mt-4">
                Can&apos;t sign in? Email {" "}
                <a href={`mailto:${SUPPORT_EMAIL}?subject=Account%20deletion%20request`}
                   className="text-brand underline" data-testid="deletion-support-email">
                  {SUPPORT_EMAIL}
                </a>
                {" "}from the address on your account and we&apos;ll delete it manually within 30 days.
              </p>
            </section>
          )}

          {/* ────────────────── Policy details ────────────────── */}
          <section className="space-y-10">
            <div>
              <h2 className="font-display text-2xl md:text-3xl mb-3">What we delete</h2>
              <ul className="list-disc pl-6 space-y-1 text-ink-muted">
                <li>Your profile (name, avatar, email, phone, password hash)</li>
                <li>Your reviews, showcase posts, forum threads &amp; replies</li>
                <li>Your follows and notifications</li>
                <li>Your direct-message content (thread is closed and hidden)</li>
                <li>Your session tokens (you are signed out on every device)</li>
                <li>For makers: shop listings, drafts, journal posts, design files,
                    payout accounts, workshop videos, and pending orders that
                    haven&apos;t shipped</li>
              </ul>
            </div>

            <div>
              <h2 className="font-display text-2xl md:text-3xl mb-3">What we retain — and why</h2>
              <ul className="list-disc pl-6 space-y-1 text-ink-muted">
                <li>
                  <strong>Completed order records</strong> — tax authorities and
                  US fraud-prevention rules require us to keep transaction
                  history for up to <strong>7 years</strong>. Your name, email, and shipping
                  address on those rows are replaced with tombstones so
                  the data is no longer personally identifiable to you, but
                  the payment/tax figures remain.
                </li>
                <li>
                  <strong>Anonymized review bodies</strong> — the text of your
                  reviews stays visible to future shoppers (attribution
                  changes to &ldquo;Deleted user&rdquo;) because other buyers rely on
                  it when deciding what to purchase.
                </li>
                <li>
                  <strong>Aggregate analytics</strong> — session counts, funnel
                  stats, and de-identified marketing attribution are
                  retained. None of it contains your personal data.
                </li>
              </ul>
            </div>

            <div>
              <h2 className="font-display text-2xl md:text-3xl mb-3">Timeline</h2>
              <ul className="list-disc pl-6 space-y-1 text-ink-muted">
                <li>
                  <strong>Scheduled deletion (default):</strong> your account is
                  disabled immediately and hard-deleted 30 days later.
                  Cancel any time in that window to keep your account.
                </li>
                <li>
                  <strong>Immediate deletion:</strong> use &ldquo;Delete immediately&rdquo;
                  above. Your account is purged within seconds; the
                  regulator-required order-record retention (see above)
                  still applies.
                </li>
                <li>
                  <strong>Support-assisted deletion:</strong> completed within
                  10 business days of receiving your request from the
                  email address on file.
                </li>
              </ul>
            </div>

            <div>
              <h2 className="font-display text-2xl md:text-3xl mb-3">Need help?</h2>
              <p className="text-ink-muted">
                Email{" "}
                <a href={`mailto:${SUPPORT_EMAIL}?subject=Account%20deletion%20help`}
                   className="text-brand underline">
                  {SUPPORT_EMAIL}
                </a>{" "}from the address on your account.
              </p>
              <p className="text-ink-muted text-sm mt-4">
                Include the phrase &ldquo;Account deletion&rdquo; in the subject line so we route it
                quickly.
              </p>
              <p className="text-ink-muted text-sm mt-4">
                See the{" "}
                <Link to="/policies?tab=privacy" className="text-brand underline">
                  Privacy Policy
                </Link>{" "}
                for full details on data handling, retention periods, and
                your rights under CCPA / GDPR.
              </p>
            </div>
          </section>
        </div>

        {/* Confirmation modal for immediate deletion */}
        {showConfirm && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-4"
               data-testid="delete-now-confirm-modal">
            <div className="max-w-md w-full bg-paper border border-red-600 p-6">
              <h3 className="font-display text-2xl mb-3 text-red-500">
                Permanently delete your account?
              </h3>
              <p className="text-ink mb-4">
                This <strong>cannot be undone</strong>. Your profile, reviews,
                and messages will be removed immediately. Order records
                are anonymized and retained for accounting compliance.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.22em] hover:bg-surface-2"
                  data-testid="delete-now-cancel-btn"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteNow}
                  disabled={busy === "delete-now"}
                  className="flex-1 bg-red-600 text-white px-4 py-2 font-mono text-xs uppercase tracking-[0.22em] hover:bg-red-700"
                  data-testid="delete-now-confirm-btn"
                >
                  {busy === "delete-now" ? "…" : "Yes, delete my account"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
