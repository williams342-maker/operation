import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "../lib/cart";
import { createCheckout, fetchCartQuote, trackCart } from "../lib/api";
import { getAttributionSource, getMsclkid, getGclid, getFbclid } from "../lib/analytics";
import { uetTrack } from "../lib/consent";
import { Trash2 } from "lucide-react";
import PolicyConsent, { usePolicyConsent } from "../components/PolicyConsent";

export default function CartPage() {
  const { items, remove, setQty, subtotal, clear } = useCart();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [email, setEmail] = useState("");
  // iter265 — optional SMS contact + granular per-channel consents.
  // Each checkbox stamps the current ISO timestamp at click-time so the
  // backend has an audit trail of when consent was given.
  const [phone, setPhone] = useState("");
  const [smsReceipts, setSmsReceipts] = useState(false);
  const [smsShipping, setSmsShipping] = useState(false);
  const consent = usePolicyConsent();
  const [giftNote, setGiftNote] = useState(() => {
    try { return localStorage.getItem("cm_gift_note") || ""; } catch { return ""; }
  });
  const [quote, setQuote] = useState(null);
  // Per-shop discount code state. Lives in localStorage so it persists
  // across the cart-page reload that comes back from a Stripe cancel.
  const [discountInput, setDiscountInput] = useState(() => {
    try { return localStorage.getItem("cm_cart_discount") || ""; } catch { return ""; }
  });
  const [appliedCode, setAppliedCode] = useState(() => {
    try { return localStorage.getItem("cm_cart_discount") || ""; } catch { return ""; }
  });

  useEffect(() => {
    try { localStorage.setItem("cm_gift_note", giftNote); } catch {}
  }, [giftNote]);

  // iter268 — Capture cart-recovery attribution from the URL once on
  // mount. Email/SMS abandoned-cart CTAs land here with `?recovery=email`
  // or `?recovery=sms` (+ optional `?code=BACKxxxx` for auto-apply).
  // We persist `cm_recovery_medium` in localStorage so the value
  // survives the Stripe cancel-and-return round-trip, and we
  // auto-apply the code so the buyer doesn't have to retype it.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const medium = (sp.get("recovery") || "").toLowerCase();
      if (medium === "email" || medium === "sms") {
        const ts = new Date().toISOString();
        localStorage.setItem("cm_recovery_medium", medium);
        localStorage.setItem("cm_recovery_landed_at", ts);
      }
      const codeFromUrl = (sp.get("code") || "").trim().toUpperCase();
      if (codeFromUrl && /^[A-Z0-9_-]{3,32}$/.test(codeFromUrl)) {
        setDiscountInput(codeFromUrl);
        setAppliedCode(codeFromUrl);
        try { localStorage.setItem("cm_cart_discount", codeFromUrl); } catch {}
      }
    } catch { /* no-op */ }
    // run-once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live shipping/total quote (refreshes whenever cart OR applied code changes)
  useEffect(() => {
    if (!items.length) { setQuote(null); return; }
    let alive = true;
    fetchCartQuote(
      items.map((i) => ({
        product_id: i.id, quantity: i.quantity,
        variant_id: i.variant_id || undefined,
        personalization_text: i.personalization_text || undefined,
        personalization_image_url: i.personalization_image_url || undefined,
      })),
      appliedCode || null,
    )
      .then((q) => { if (alive) setQuote(q); })
      .catch(() => { if (alive) setQuote(null); });
    return () => { alive = false; };
  }, [items, appliedCode]);

  // iter267 — Debounced push of phone + receipts/shipping consents to
  // /cart/track so the abandoned-cart SMS fallback has the buyer's
  // number even if they bounce before hitting checkout. Backend still
  // only writes the row when it can resolve an email (JWT or push sub).
  useEffect(() => {
    if (!items.length) return;
    const anySmsConsent = smsReceipts || smsShipping;
    if (!anySmsConsent) return;
    if (!/^\+?[\d\s().-]{7,20}$/.test(phone.trim())) return;
    const t = setTimeout(() => {
      const nowIso = new Date().toISOString();
      const trimmed = items.map(({ image: _img, ...rest }) => rest);
      trackCart(trimmed, {
        phone: phone.trim(),
        sms_consent_receipts_at: smsReceipts ? nowIso : undefined,
        sms_consent_shipping_at: smsShipping ? nowIso : undefined,
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [phone, smsReceipts, smsShipping, items]);

  const applyCode = () => {
    const c = (discountInput || "").trim().toUpperCase();
    if (!c) return;
    setAppliedCode(c);
    try { localStorage.setItem("cm_cart_discount", c); } catch {}
  };
  const removeCode = () => {
    setAppliedCode(""); setDiscountInput("");
    try { localStorage.removeItem("cm_cart_discount"); } catch {}
  };

  const checkout = async () => {
    if (!email || !/.+@.+\..+/.test(email)) {
      setErr("Enter a valid email so we can send your receipt."); return;
    }
    if (!consent.accepted) {
      setErr("Please review and accept the Site Policies to continue."); return;
    }
    // iter267 — if any SMS consent is ticked, phone is required. The
    // cart-nudge consent was removed; cart-recovery SMS now only fires
    // as a fallback against the phone given for receipts/shipping,
    // 24h after the first abandoned-cart email goes out.
    const anySmsConsent = smsReceipts || smsShipping;
    if (anySmsConsent && !/^\+?[\d\s().-]{7,20}$/.test(phone.trim())) {
      setErr("Enter a phone number to receive the SMS updates you opted into."); return;
    }
    setErr(""); setLoading(true);
    try {
      const nowIso = new Date().toISOString();
      const res = await createCheckout({
        items: items.map((i) => ({
          product_id: i.id, quantity: i.quantity,
          variant_id: i.variant_id || undefined,
          personalization_text: i.personalization_text || undefined,
          personalization_image_url: i.personalization_image_url || undefined,
        })),
        origin_url: window.location.origin,
        customer_email: email,
        gift_note: giftNote || undefined,
        attribution_source: getAttributionSource() || undefined,
        msclkid: getMsclkid() || undefined,
        gclid: getGclid() || undefined,
        fbclid: getFbclid() || undefined,
        discount_code: appliedCode || undefined,
        policy_accepted: true,
        policy_version: consent.version,
        policy_accepted_at: nowIso,
        // iter267 — SMS phone + per-channel consents. Absence = no
        // consent. Cart-nudges consent removed — cart-recovery SMS is
        // an automatic 24h-after-email fallback (not buyer-toggled).
        customer_phone: anySmsConsent ? phone.trim() : undefined,
        sms_consent_receipts_at: smsReceipts ? nowIso : undefined,
        sms_consent_shipping_at: smsShipping ? nowIso : undefined,
        // iter268 — Cart-recovery attribution. If the buyer landed here
        // from an email/SMS abandoned-cart CTA, forward the medium so
        // the discount-redemption hook can log it into the attribution
        // ledger.
        recovery_medium: (() => {
          try { return localStorage.getItem("cm_recovery_medium") || undefined; }
          catch { return undefined; }
        })(),
      });
      // iter334h — Fire Microsoft Ads `begin_checkout` BEFORE the
      // redirect to Stripe so the event registers in this session, not
      // the next one (the buyer is about to leave our origin). Honors
      // Consent Mode — denied → UET drops it server-side. Powers the
      // "abandoned-cart" remarketing audience in Bing Ads (anyone who
      // hit begin_checkout but didn't fire purchase within N days).
      try {
        const revenue = (quote?.total_before_tax ?? subtotal) || 0;
        if (revenue > 0) {
          uetTrack("begin_checkout", {
            revenue_value: Number(revenue.toFixed(2)),
            currency: "USD",
            event_label: "cart_to_stripe",
            event_value: Number(revenue.toFixed(2)),
          });
        }
      } catch { /* analytics should never block checkout */ }
      window.location.href = res.url;
    } catch (e) {
      setErr(e?.response?.data?.detail || "Checkout failed. Try again."); setLoading(false);
    }
  };

  const shipping = quote?.shipping ?? null;
  const total = quote?.total_before_tax ?? subtotal;
  const remaining = quote ? Math.max(0, quote.free_shipping_threshold - quote.subtotal) : 0;

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="cart-page">
      <div className="w-full max-w-[1400px] mx-auto px-4 md:px-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ Cart</div>
        <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] mb-12">Your <span className="text-outline">Pile</span></h1>

        {!items.length ? (
          <div className="border-y border-[#262626] py-20 text-center">
            <p className="font-mono text-sm text-[#a3a3a3] mb-6">Cart is empty. Go find something sharp.</p>
            <Link to="/shop" className="btn-industrial btn-primary inline-flex">Browse the shop →</Link>
          </div>
        ) : (
          <div className="grid lg:grid-cols-12 gap-10">
            <ul className="lg:col-span-8 border-y border-[#262626] divide-y divide-[#262626]">
              {items.map((i) => (
                <li key={`${i.id}::${i.variant_id || ""}`} className="grid grid-cols-12 gap-4 py-6 items-center" data-testid={`cart-item-${i.slug}`}>
                  <Link to={`/shop/${i.slug}`} className="col-span-3 sm:col-span-2 aspect-square overflow-hidden border border-[#262626]">
                    <img src={i.image} alt={i.title} className="w-full h-full object-cover" />
                  </Link>
                  <div className="col-span-9 sm:col-span-5">
                    <Link to={`/shop/${i.slug}`} className="font-display text-2xl hover:text-[#ff4500] transition">{i.title}</Link>
                    {i.variant_label && (
                      <div
                        className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mt-1"
                        data-testid={`cart-variant-${i.slug}`}
                      >
                        ◆ {i.variant_label}
                      </div>
                    )}
                    <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3] mt-1">${i.price.toFixed(2)} ea</div>
                    {/* iter150 — Personalization summary on the cart line
                        so the buyer can see exactly what they're sending
                        before paying. */}
                    {(i.personalization_text || i.personalization_image_url) && (
                      <div
                        className="mt-3 border-l-2 border-[#ff4500] pl-3"
                        data-testid={`cart-personalization-${i.slug}`}
                      >
                        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">
                          ◆ Personalization
                        </div>
                        {i.personalization_text && (
                          <div className="text-xs text-[#e5e5e5] leading-relaxed whitespace-pre-wrap">
                            {i.personalization_text}
                          </div>
                        )}
                        {i.personalization_image_url && (
                          <a
                            href={i.personalization_image_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block mt-2"
                          >
                            <img
                              src={i.personalization_image_url}
                              alt="Reference"
                              className="w-16 h-16 object-cover border border-[#262626]"
                            />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="col-span-6 sm:col-span-3 flex items-center gap-3">
                    <div className="flex items-center border border-[#262626]">
                      <button onClick={() => setQty(i.id, i.quantity - 1, i.variant_id)} className="px-3 py-2 hover:bg-[#1a1a1a]">−</button>
                      <span className="px-3 font-mono text-sm">{i.quantity}</span>
                      <button onClick={() => setQty(i.id, i.quantity + 1, i.variant_id)} className="px-3 py-2 hover:bg-[#1a1a1a]">+</button>
                    </div>
                  </div>
                  <div className="col-span-4 sm:col-span-1 font-display text-xl text-right">${(i.price * i.quantity).toFixed(2)}</div>
                  <button onClick={() => remove(i.id, i.variant_id)} className="col-span-2 sm:col-span-1 justify-self-end p-2 text-[#a3a3a3] hover:text-[#ff4500]" data-testid={`cart-remove-${i.slug}`}>
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <aside className="lg:col-span-4 bg-[#121212] border border-[#262626] p-8 h-fit">
              <h2 className="font-display text-3xl mb-6">Summary</h2>
              <div className="space-y-3 font-mono text-sm border-y border-[#262626] py-4 mb-6" data-testid="cart-summary">
                <Row k="Subtotal" v={`$${subtotal.toFixed(2)}`} testId="row-subtotal" />
                <Row
                  k="Shipping"
                  v={
                    quote?.digital_only
                      ? <span className="text-cyan-400">Digital · no shipping</span>
                      : shipping == null
                      ? "—"
                      : shipping === 0
                      ? "Free"
                      : `$${shipping.toFixed(2)}`
                  }
                  testId="row-shipping"
                />
                <Row k="Tax" v="At checkout" testId="row-tax" />
                {quote?.discount_code && (quote?.discount || 0) > 0 && (
                  <Row
                    k={`Discount · ${quote.discount_code}`}
                    v={<span className="text-emerald-400">−${quote.discount.toFixed(2)}</span>}
                    testId="row-discount"
                  />
                )}
              </div>
              {/* iter328 — All-sales-final disclaimer for pure-digital
                  carts. Surfaces ABOVE the checkout button so the buyer
                  can't miss it before paying. */}
              {quote?.digital_only && (
                <div
                  className="mb-4 p-3 border border-cyan-500/40 bg-cyan-950/[0.15] font-mono text-[10.5px] text-cyan-200 leading-relaxed"
                  data-testid="cart-digital-disclaimer"
                >
                  ◆ This is a digital download — files are delivered the moment
                  payment clears, via email and on the order confirmation page.
                  <strong className="text-cyan-100"> All digital sales are final.</strong>
                </div>
              )}
              {quote && !quote.digital_only && remaining > 0 && (
                <p
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-4"
                  data-testid="free-shipping-banner"
                >
                  ◆ Add ${remaining.toFixed(2)} for free shipping
                </p>
              )}
              {quote && !quote.digital_only && quote.free_shipping_eligible && (
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-4">
                  ◆ Free shipping unlocked
                </p>
              )}
              <div className="flex justify-between items-baseline mb-6">
                <span className="font-mono text-xs uppercase tracking-[0.22em] text-[#a3a3a3]">Total</span>
                <span className="font-display text-4xl text-[#ff4500]" data-testid="cart-total">
                  ${total.toFixed(2)}
                </span>
              </div>

              {/* Discount code — per-shop maker promo. Only applies to that
                  shop's items in the cart; if the cart has multiple shops it
                  discounts only the matching shop's subtotal. */}
              <div className="mb-4 pb-4 border-b border-[#262626]" data-testid="cart-discount-block">
                {appliedCode && quote?.discount_code ? (
                  <div className="flex items-center justify-between gap-3" data-testid="cart-discount-applied">
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400">
                        ✓ Code applied · {quote.discount_code}
                      </div>
                      <div className="font-mono text-[11px] text-[#a3a3a3] mt-0.5">
                        −${(quote.discount || 0).toFixed(2)} off
                      </div>
                    </div>
                    <button onClick={removeCode}
                      className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
                      data-testid="cart-discount-remove">
                      Remove
                    </button>
                  </div>
                ) : (
                  <div>
                    <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-2">
                      Discount Code
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={discountInput}
                        onChange={(e) => setDiscountInput(e.target.value.toUpperCase())}
                        placeholder="SUMMER15"
                        className="flex-1 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm uppercase"
                        data-testid="cart-discount-input"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCode(); } }}
                      />
                      <button onClick={applyCode} disabled={!discountInput.trim()}
                        className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
                        data-testid="cart-discount-apply">
                        Apply
                      </button>
                    </div>
                    {appliedCode && quote?.discount_error && (
                      <p className="font-mono text-[11px] text-red-400 mt-2" data-testid="cart-discount-error">
                        {quote.discount_error}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <label className="block mb-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">Email for receipt</span>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" data-testid="cart-email"
                  className="w-full mt-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm"
                />
              </label>

              {/* iter267 — Optional SMS notifications. Buyer-toggled
                  consents are receipts + shipping only. Cart-recovery
                  SMS no longer has a checkbox — it fires automatically
                  as a fallback 24h after the abandoned-cart email,
                  reusing the phone the buyer provided for transactional
                  receipts/shipping updates. */}
              <div className="mb-4 border border-[#262626] p-3" data-testid="cart-sms-block">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3] mb-2">
                  ◆ Text me updates (optional)
                </div>
                <label className="flex items-start gap-2 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={smsReceipts}
                    onChange={(e) => setSmsReceipts(e.target.checked)}
                    data-testid="cart-sms-consent-receipts"
                    className="mt-1"
                  />
                  <span className="font-mono text-[11px] text-[#d4d4d4]">
                    Text my order receipt confirmations
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={smsShipping}
                    onChange={(e) => setSmsShipping(e.target.checked)}
                    data-testid="cart-sms-consent-shipping"
                    className="mt-1"
                  />
                  <span className="font-mono text-[11px] text-[#d4d4d4]">
                    Text me when my order ships (with tracking link)
                  </span>
                </label>
                {(smsReceipts || smsShipping) && (
                  <label className="block mt-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">
                      Mobile number
                    </span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1 555 123 4567"
                      data-testid="cart-phone"
                      className="w-full mt-1 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
                    />
                    <span className="font-mono text-[9px] text-[#737373] mt-1 block">
                      Msg & data rates may apply. Reply STOP to opt out anytime.
                    </span>
                  </label>
                )}
              </div>
              <label className="block mb-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">
                  🎁 Gift note (optional)
                </span>
                <textarea
                  value={giftNote}
                  onChange={(e) => setGiftNote(e.target.value)}
                  rows={2}
                  maxLength={400}
                  placeholder="Sent to the maker · printed on the packing slip"
                  data-testid="cart-gift-note"
                  className="w-full mt-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-3 font-mono text-sm resize-y"
                />
              </label>
              <PolicyConsent consent={consent} testId="cart-policy" />
              <button onClick={checkout} disabled={loading || !consent.accepted} data-testid="cart-checkout-btn" className="btn-industrial btn-primary w-full justify-center mt-4 disabled:opacity-50">
                {loading ? "Redirecting…" : "Checkout →"}
              </button>
              {err && <p className="text-[#ff4500] font-mono text-xs mt-3">{err}</p>}
              <button onClick={clear} className="block mt-4 mx-auto industrial-link font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Clear cart</button>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

const Row = ({ k, v, testId }) => (
  <div className="flex justify-between text-[#a3a3a3]" data-testid={testId}>
    <span className="font-mono text-xs uppercase tracking-[0.22em]">{k}</span>
    <span className="text-[#e5e5e5]">{v}</span>
  </div>
);
