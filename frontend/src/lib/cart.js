import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { trackCart } from "./api";

const CartCtx = createContext(null);
const STORAGE = "cm_cart_v1";

// Cart-row identity is product id + variant_id (so two variants of one product
// occupy two distinct rows).
const rowKey = (i) =>
  // Personalization fields differentiate otherwise-identical rows so
  // a buyer ordering two of the same product with different engravings
  // doesn't get them merged into one quantity-2 line.
  `${i.id}::${i.variant_id || ""}::${i.personalization_text || ""}::${i.personalization_image_url || ""}`;

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE)) || []; }
    catch { return []; }
  });
  useEffect(() => { localStorage.setItem(STORAGE, JSON.stringify(items)); }, [items]);

  // Debounced sync to the abandoned-cart tracker. Fires ~3s after the last
  // mutation so rapid +/- clicks don't hammer the server. Backend self-noops
  // if the buyer has no email reachable (no JWT + no push subscription).
  const syncTimer = useRef(null);
  useEffect(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      // Strip image (we don't need it server-side; keeps payload small)
      const trimmed = items.map(({ image: _img, ...rest }) => rest);
      trackCart(trimmed).catch(() => {});
    }, 3000);
    return () => clearTimeout(syncTimer.current);
  }, [items]);

  const add = useCallback((p, qty = 1, variant = null, personalization = null) => {
    setItems((cur) => {
      const newRow = {
        id: p.id,
        slug: p.slug,
        title: p.title,
        // Effective price: variant.price (absolute) > base + variant.price_delta > base.
        price: variant
          ? (Number(variant.price) > 0
              ? Number(variant.price)
              : Number(p.price) + Number(variant.price_delta || 0))
          : p.price,
        image: p.images?.[0],
        quantity: qty,
        variant_id: variant?.id || null,
        variant_label: variant?.label || null,
        // iter150 — buyer personalization (text + image URL). Carried
        // through to checkout/_resolve_cart on the backend, persisted
        // on the order doc, surfaced in the maker order email.
        personalization_text: personalization?.text || null,
        personalization_image_url: personalization?.image_url || null,
      };
      const ex = cur.find((i) => rowKey(i) === rowKey(newRow));
      if (ex) {
        return cur.map((i) =>
          rowKey(i) === rowKey(newRow) ? { ...i, quantity: i.quantity + qty } : i
        );
      }
      return [...cur, newRow];
    });
  }, []);

  const remove = useCallback((id, variantId = null) =>
    setItems((c) => c.filter((i) => !(i.id === id && (i.variant_id || null) === (variantId || null)))), []);

  const setQty = useCallback((id, q, variantId = null) =>
    setItems((c) => c.map((i) =>
      i.id === id && (i.variant_id || null) === (variantId || null)
        ? { ...i, quantity: Math.max(1, q) }
        : i
    )), []);

  const clear = useCallback(() => setItems([]), []);

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const count = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <CartCtx.Provider value={{ items, add, remove, setQty, clear, subtotal, count }}>
      {children}
    </CartCtx.Provider>
  );
}

export const useCart = () => useContext(CartCtx);
