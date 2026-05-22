import React, { useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getCheckoutStatus, communityRequestMagic, subscribeNewsletter } from "../lib/api";
import { useCart } from "../lib/cart";
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
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
        ◆ {paid ? "Payment Confirmed" : state.status === "error" ? "Issue" : "Confirming…"}
      </div>
      <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] mb-6">
        {paid ? "Thank You." : state.status === "error" ? "Something Went Sideways." : "Hold Tight…"}
      </h1>
      <p className="font-mono text-sm text-[#a3a3a3] max-w-lg mx-auto mb-10">
        {paid
          ? `Your makers have been notified. You'll receive a confirmation email shortly. Order total: $${(state.amount_total / 100).toFixed(2)}.`
          : state.status === "error"
            ? "We couldn't verify the payment. Check your email — if you were charged, support will reach out."
            : "Verifying payment status with Stripe…"}
      </p>

      {canCreateAccount && (
        <div
          className="max-w-lg mx-auto border border-[#ff4500]/40 bg-[#ff4500]/5 p-6 mb-10 text-left"
          data-testid="success-create-account"
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] mb-2">
            ◆ Create a free account
          </div>
          <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mb-4">
            Track this order, post a photo of your piece in the Showcase, and join the workshop community —
            free, no password required.
          </p>
          {accountState.kind === "sent" ? (
            <p className="font-mono text-xs text-[#ff4500]" data-testid="success-account-sent">
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
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] self-center"
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
        <p className="font-mono text-xs text-[#a3a3a3]">
          You're on the list. Expect a roundup of new drops and maker stories — never daily, never spammy.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="max-w-lg mx-auto border border-[#262626] p-6 mb-10 text-left"
      data-testid="success-newsletter-card"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] mb-2">
        ◆ Get the next drop first
      </div>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mb-4">
        New listings, maker stories, and curated collections — once a week. No spam, unsubscribe with a click.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="flex-1 bg-[#0a0a0a] border border-[#262626] px-3 py-2 font-mono text-sm text-[#e5e5e5] focus:border-[#ff4500] focus:outline-none"
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
