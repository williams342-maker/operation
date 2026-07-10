/**
 * iter438 — PayPal Smart Buttons at checkout (Orders v2, server-side
 * create + capture — the browser never sends totals). Renders only when
 * the backend reports PayPal is configured. Stripe stays the primary CTA.
 */
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const API = process.env.REACT_APP_BACKEND_URL;

export default function PayPalCheckoutButton({ buildPayload, disabled, onPaid }) {
  const [cfg, setCfg] = useState(null);
  const [sdkReady, setSdkReady] = useState(false);
  const boxRef = useRef(null);
  const navigate = useNavigate();
  const payloadRef = useRef(buildPayload);
  payloadRef.current = buildPayload;

  useEffect(() => {
    fetch(`${API}/api/paypal/checkout/config`)
      .then((r) => r.json())
      .then((c) => { if (c.enabled && c.client_id) setCfg(c); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!cfg || window.paypal) { if (window.paypal) setSdkReady(true); return; }
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.client_id)}&currency=USD&intent=capture&disable-funding=credit,card`;
    s.onload = () => setSdkReady(true);
    s.onerror = () => console.warn("PayPal SDK failed to load");
    document.body.appendChild(s);
  }, [cfg]);

  useEffect(() => {
    if (!sdkReady || !window.paypal || !boxRef.current) return undefined;
    const buttons = window.paypal.Buttons({
      style: { layout: "horizontal", color: "gold", shape: "rect", label: "paypal", height: 44, tagline: false },
      createOrder: async () => {
        const payload = payloadRef.current(); // throws with a user message when invalid
        const r = await fetch(`${API}/api/paypal/checkout/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail || "Could not start PayPal checkout.");
        return d.paypal_order_id;
      },
      onApprove: async (data) => {
        const r = await fetch(`${API}/api/paypal/checkout/orders/${data.orderID}/capture`, { method: "POST" });
        const d = await r.json();
        if (!r.ok) { toast.error(d.detail || "Payment could not be completed."); return; }
        onPaid?.();
        navigate(`/checkout/success?paypal_order=${d.internal_id}&total=${encodeURIComponent(d.total)}`);
      },
      onError: (err) => {
        toast.error(err?.message || "PayPal checkout failed — please try again.");
      },
      onCancel: () => toast.info("PayPal checkout cancelled."),
    });
    buttons.render(boxRef.current).catch(() => {});
    return () => { try { buttons.close(); } catch { /* noop */ } };
  }, [sdkReady]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg) return null;
  return (
    <div className="mt-3" data-testid="paypal-checkout-block">
      <div className="flex items-center gap-3 my-3">
        <span className="flex-1 h-px bg-line" />
        <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-ink-muted">or pay with</span>
        <span className="flex-1 h-px bg-line" />
      </div>
      {cfg.environment === "sandbox" && (
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-amber-500 mb-2 text-center"
             data-testid="paypal-sandbox-badge">
          ◆ PayPal sandbox mode — test payments only
        </div>
      )}
      <div ref={boxRef} className={disabled ? "opacity-50 pointer-events-none" : ""}
           data-testid="paypal-buttons-container" />
    </div>
  );
}
