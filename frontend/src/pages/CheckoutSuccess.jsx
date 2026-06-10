import React, { useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getCheckoutStatus, communityRequestMagic, subscribeNewsletter } from "../lib/api";
import { useCart } from "../lib/cart";
import { uetTrack } from "../lib/consent";
import PushOptInCard from "../components/PushOptInCard";

export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const sid = params.get("session_id");
  const [state, setState] = useState({ status: "polling", payment_status: "", amount_total: 0, currency: "usd", customer_email: "" });
  const [accountState, setAccountState] = useState({ kind: "idle", message: "" });
  const { clear } = useCart();
  const tries = useRef(0);
  const cleared = useRef(false);

  useEffect(() => {
    if (!sid) { setState({ status: "error", payment_status: "missing" }); return; }
    let alive = true;
    const tick = async () => {
      tries.current += 1;
      try {
        const s = await getCheckoutStatus(sid);
        if (!alive) return;
        setState({ ...s, status: s.payment_status === "paid" ? "paid" : s.status });
        if (s.payment_status === "paid") {
          if (!cleared.current) {
            cleared.current = true;
            clear();
            try { localStorage.removeItem("cm_gift_note"); } catch {}
            // iter334f — Fire Microsoft Ads `purchase` conversion event
            // exactly once per successful checkout. Honors Consent Mode
            // — if the user rejected ad_storage, UET drops it
            // server-side. Stripe returns amount in cents, UET expects
            // a decimal — divide by 100 here. GA4 `purchase` event is
            // already fired by Stripe's redirect/return-url tracking
            // pixel; this complements that on the Bing Ads side.
            try {
              const revenue = (s.amount_total || 0) / 100;
              const currency = (s.currency || "usd").toUpperCase();
              if (revenue > 0) {
                // iter334j — Include the buyer's SHA-256 hashed email
                // (computed server-side) as the `pid.em` field on the
                // UET purchase event. This is Microsoft's "Enhanced
                // Conversions" payload — the hash is one-way so the
                // raw email never leaves our server, and Bing matches
                // it against their hashed Customer Match database for
                // ~30-50% better attribution + lookalike audiences.
                const payload = {
                  revenue_value: revenue,
                  currency,
                  event_label: "checkout_success",
                  event_value: revenue,
                };
                if (s.email_sha256) {
                  payload.pid = { em: s.email_sha256 };
                }
                uetTrack("purchase", payload);
              }
            } catch { /* analytics should never break the success page */ }
          }
          return;
        }
        if (s.status === "expired" || tries.current >= 8) return;
        setTimeout(tick, 2000);
      } catch {
        if (tries.current < 8) setTimeout(tick, 2000);
        else setState({ status: "error", payment_status: "" });
      }
    };
    tick();
    return () => { alive = false; };
  }, [sid, clear]);

  const paid = state.payment_status === "paid";
  const alreadyHasAccount = !!localStorage.getItem("cm_buyer_jwt");
  const canCreateAccount = paid && !alreadyHasAccount;

  const createAccount = async () => {
    // We don't get the buyer's email back from /checkout/status (it isn't returned).
    // Use a small inline form instead — buyer pastes their email + we send a magic link.
    const email = window.prompt(
      "Enter your email — we'll send a one-click sign-in link so you can track this order in the community.",
      ""
    );
    if (!email || !/.+@.+\..+/.test(email)) return;
    setAccountState({ kind: "loading", message: "" });
    try {
      const r = await communityRequestMagic(email.trim(), window.location.origin);
      setAccountState({ kind: "sent", message: r.message });
    } catch {
      setAccountState({ kind: "error", message: "Couldn't send the link." });
    }
  };

  return (
    <div className="pt-40 pb-24 min-h-screen grain text-center px-4" data-testid="checkout-success">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
        ◆ {paid ? "Payment Confirmed" : state.status === "error" ? "Issue" : "Confirming…"}
      </div>
      <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] mb-6">
        {paid ? "Thank You." : state.status === "error" ? "Something Went Sideways." : "Hold Tight…"}
      </h1>
      <p className="font-mono text-sm text-ink-muted max-w-lg mx-auto mb-10">
        {paid
          ? `Your makers have been notified. You'll receive a confirmation email shortly. Order total: $${(state.amount_total / 100).toFixed(2)}.`
          : state.status === "error"
            ? "We couldn't verify the payment. Check your email — if you were charged, support will reach out."
            : "Verifying payment status with Stripe…"}
      </p>

      {/* iter328 — Digital download manifest. Renders only when the
          order's transaction has uploaded files. Each row links to the
          token-gated `/api/checkout/downloads/{token}` endpoint which
          302s to the public R2 URL after verifying the HMAC token and
          bumping the per-file counter. */}
      {paid && Array.isArray(state.digital_downloads) && state.digital_downloads.length > 0 && (
        <div
          className="max-w-2xl mx-auto border border-cyan-500/40 bg-cyan-950/[0.15] p-6 mb-10 text-left"
          data-testid="success-digital-downloads"
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-cyan-300 mb-3">
            ◆ Your downloads ({state.digital_downloads.length})
          </div>
          <p className="font-mono text-xs text-ink-muted leading-relaxed mb-4">
            Files are ready right now. Links also went to your email — they stay
            valid for 30 days. Save them locally; all digital sales are final.
          </p>
          <ul className="space-y-2">
            {state.digital_downloads.map((d) => {
              const apiBase = process.env.REACT_APP_BACKEND_URL || "";
              const href = `${apiBase}/api/checkout/downloads/${d.token}`;
              const sizeH = d.size_bytes >= 1024 * 1024
                ? `${(d.size_bytes / 1024 / 1024).toFixed(1)} MB`
                : `${Math.max(1, Math.round(d.size_bytes / 1024))} KB`;
              return (
                <li
                  key={d.file_id}
                  className="flex items-center gap-3 p-3 border border-line bg-paper"
                  data-testid={`success-download-row-${d.file_id}`}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <div className="font-mono text-[11.5px] text-ink truncate">
                      {d.filename}
                    </div>
                    <div className="font-mono text-[9.5px] text-ink-muted mt-1 uppercase tracking-[0.18em]">
                      {(d.ext || "").toUpperCase()} · {sizeH}
                    </div>
                  </div>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 px-4 py-2 bg-brand hover:bg-[#ff5a1f] text-black font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition"
                    data-testid={`success-download-btn-${d.file_id}`}
                  >
                    Download →
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canCreateAccount && (
        <div
          className="max-w-lg mx-auto border border-brand/40 bg-brand/5 p-6 mb-10 text-left"
          data-testid="success-create-account"
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand mb-2">
            ◆ Create a free account
          </div>
          <p className="font-mono text-xs text-ink-muted leading-relaxed mb-4">
            Track this order, post a photo of your piece in the Showcase, and join the workshop community —
            free, no password required.
          </p>
          {accountState.kind === "sent" ? (
            <p className="font-mono text-xs text-brand" data-testid="success-account-sent">
              ✓ {accountState.message}
            </p>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={createAccount}
                disabled={accountState.kind === "loading"}
                className="btn-industrial btn-primary inline-flex disabled:opacity-50"
                data-testid="success-create-account-btn"
              >
                {accountState.kind === "loading" ? "Sending…" : "Send me a sign-in link →"}
              </button>
              <Link
                to="/shop"
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand self-center"
                data-testid="success-skip-account"
              >
                Continue as guest
              </Link>
            </div>
          )}
          {accountState.kind === "error" && (
            <p className="mt-3 font-mono text-[10px] text-red-400">{accountState.message}</p>
          )}
        </div>
      )}

      {paid && (
        <PushOptInCard role="buyer" email={state.customer_email || null} />
      )}

      {paid && (
        <PostCheckoutNewsletterCard initialEmail={state.customer_email || ""} />
      )}

      <Link to="/shop" className="btn-industrial btn-primary inline-flex">Continue browsing →</Link>
    </div>
  );
}


/**
 * Post-checkout newsletter opt-in card (iter181).
 *
 * Buyers who just paid are the highest-intent newsletter signups we ever
 * see — they've already proven they like the marketplace. We pre-fill
 * their email from the Stripe checkout session when available, default
 * the consent toggle to OFF (explicit opt-in, GDPR-compliant), and tag
 * the source as `checkout_success` so admins can see the funnel.
 */
function PostCheckoutNewsletterCard({ initialEmail }) {
  const [email, setEmail] = useState(initialEmail || "");
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const [err, setErr] = useState("");

  // Sync once Stripe returns the email — but never overwrite an in-progress edit.
  useEffect(() => {
    if (initialEmail && !email) setEmail(initialEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEmail]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!/.+@.+\..+/.test(email)) {
      setErr("Please enter a valid email.");
      return;
    }
    setState("loading");
    setErr("");
    try {
      await subscribeNewsletter(email.trim(), "checkout_success");
      setState("done");
    } catch (ex) {
      setState("error");
      setErr(ex?.response?.data?.detail || "Couldn't subscribe. You can try again later.");
    }
  };

  if (state === "done") {
    return (
      <div
        className="max-w-lg mx-auto border border-emerald-500/40 bg-emerald-500/5 p-6 mb-10 text-left"
        data-testid="success-newsletter-done"
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-400 mb-2">
          ◆ Subscribed
        </div>
        <p className="font-mono text-xs text-ink-muted">
          You're on the list. Expect a roundup of new drops and maker stories — never daily, never spammy.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="max-w-lg mx-auto border border-line p-6 mb-10 text-left"
      data-testid="success-newsletter-card"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand mb-2">
        ◆ Get the next drop first
      </div>
      <p className="font-mono text-xs text-ink-muted leading-relaxed mb-4">
        New listings, maker stories, and curated collections — once a week. No spam, unsubscribe with a click.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="flex-1 bg-paper border border-line px-3 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none"
          data-testid="success-newsletter-email"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="btn-industrial btn-primary inline-flex disabled:opacity-50"
          data-testid="success-newsletter-submit"
        >
          {state === "loading" ? "Subscribing…" : "Subscribe →"}
        </button>
      </div>
      {err && (
        <p className="mt-3 font-mono text-[10px] text-red-400" data-testid="success-newsletter-error">
          {err}
        </p>
      )}
    </form>
  );
}
