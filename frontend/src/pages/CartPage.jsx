import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "../lib/cart";
import { createCheckout } from "../lib/api";
import { Trash2 } from "lucide-react";

export default function CartPage() {
  const { items, remove, setQty, subtotal, clear } = useCart();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const checkout = async () => {
    setErr(""); setLoading(true);
    try {
      const res = await createCheckout({
        items: items.map((i) => ({ product_id: i.id, quantity: i.quantity })),
        origin_url: window.location.origin,
      });
      window.location.href = res.url;
    } catch (e) {
      setErr("Checkout failed. Try again."); setLoading(false);
    }
  };

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
                <li key={i.id} className="grid grid-cols-12 gap-4 py-6 items-center" data-testid={`cart-item-${i.slug}`}>
                  <Link to={`/shop/${i.slug}`} className="col-span-3 sm:col-span-2 aspect-square overflow-hidden border border-[#262626]">
                    <img src={i.image} alt={i.title} className="w-full h-full object-cover" />
                  </Link>
                  <div className="col-span-9 sm:col-span-5">
                    <Link to={`/shop/${i.slug}`} className="font-display text-2xl hover:text-[#ff4500] transition">{i.title}</Link>
                    <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3] mt-1">${i.price.toFixed(2)} ea</div>
                  </div>
                  <div className="col-span-6 sm:col-span-3 flex items-center gap-3">
                    <div className="flex items-center border border-[#262626]">
                      <button onClick={() => setQty(i.id, i.quantity - 1)} className="px-3 py-2 hover:bg-[#1a1a1a]">−</button>
                      <span className="px-3 font-mono text-sm">{i.quantity}</span>
                      <button onClick={() => setQty(i.id, i.quantity + 1)} className="px-3 py-2 hover:bg-[#1a1a1a]">+</button>
                    </div>
                  </div>
                  <div className="col-span-4 sm:col-span-1 font-display text-xl text-right">${(i.price * i.quantity).toFixed(2)}</div>
                  <button onClick={() => remove(i.id)} className="col-span-2 sm:col-span-1 justify-self-end p-2 text-[#a3a3a3] hover:text-[#ff4500]" data-testid={`cart-remove-${i.slug}`}>
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <aside className="lg:col-span-4 bg-[#121212] border border-[#262626] p-8 h-fit">
              <h2 className="font-display text-3xl mb-6">Summary</h2>
              <div className="space-y-3 font-mono text-sm border-y border-[#262626] py-4 mb-6">
                <Row k="Subtotal" v={`$${subtotal.toFixed(2)}`} />
                <Row k="Shipping" v="Calculated by maker" />
                <Row k="Tax" v="At checkout" />
              </div>
              <div className="flex justify-between items-baseline mb-6">
                <span className="font-mono text-xs uppercase tracking-[0.22em] text-[#a3a3a3]">Total</span>
                <span className="font-display text-4xl text-[#ff4500]">${subtotal.toFixed(2)}</span>
              </div>
              <button onClick={checkout} disabled={loading} data-testid="cart-checkout-btn" className="btn-industrial btn-primary w-full justify-center">
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

const Row = ({ k, v }) => (
  <div className="flex justify-between text-[#a3a3a3]">
    <span className="font-mono text-xs uppercase tracking-[0.22em]">{k}</span>
    <span className="text-[#e5e5e5]">{v}</span>
  </div>
);
