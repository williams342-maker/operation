import React, { useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getCheckoutStatus } from "../lib/api";
import { useCart } from "../lib/cart";

export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const sid = params.get("session_id");
  const [state, setState] = useState({ status: "polling", payment_status: "", amount_total: 0, currency: "usd" });
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
          if (!cleared.current) { cleared.current = true; clear(); }
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
      <Link to="/shop" className="btn-industrial btn-primary inline-flex">Continue browsing →</Link>
    </div>
  );
}
