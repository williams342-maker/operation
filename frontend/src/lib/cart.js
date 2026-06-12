import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { trackCart } from "./api";

const CartCtx = createContext(null);
const STORAGE = "cm_cart_v1";

// Cart-row identity is product id + variant_id (so two variants of one product
// occupy two distinct rows).
const rowKey = (i) =>
  // Personalization fields differentiate otherwise-identical rows so
  // a buyer ordering two of the same product with different engravings
  // doesn't get them merged into one quantity-2 line. iter339 — color
  // choice does the same so two of the same item in different colors
  // stay as separate cart lines instead of stacking. iter364 — photo
  // upload ids too (two memorial pieces from different photos).
  `${i.id}::${i.variant_id || ""}::${i.color_choice || ""}::${i.personalization_text || ""}::${i.personalization_image_url || ""}::${(i.personalization_upload_ids || []).join(",")}::${(i.custom_option_ids || []).join(",")}`;

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

  const add = useCallback((p, qty = 1, variant = null, personalization = null, colorChoice = null, customOptions = []) => {
    setItems((cur) => {
      // iter380 — customization-only option picks (Engraving font etc.).
      // No SKU row exists for these, so their +$ deltas fold into the
      // line price here and the ids/labels ride along to checkout.
      const customDelta = (customOptions || []).reduce((s, o) => s + (Number(o.price_delta) || 0), 0);
      const newRow = {
        id: p.id,
        slug: p.slug,
        title: p.title,
        // Effective price: variant.price (absolute) > base + variant.price_delta > base,
        // plus customization-only option deltas on top.
        price: (variant
          ? (Number(variant.price) > 0
              ? Number(variant.price)
              : Number(p.price) + Number(variant.price_delta || 0))
          : Number(p.price)) + customDelta,
        image: p.images?.[0],
        quantity: qty,
        variant_id: variant?.id || null,
        variant_label: variant?.label || null,
        // iter150 — buyer personalization (text + image URL). Carried
        // through to checkout/_resolve_cart on the backend, persisted
        // on the order doc, surfaced in the maker order email.
        personalization_text: personalization?.text || null,
        personalization_image_url: personalization?.image_url || null,
        // iter364 — customer photo upload ids (≤10). Hydrated server-side
        // on the maker's order detail; bytes live in object storage.
        personalization_upload_ids: personalization?.upload_ids || [],
        // iter339 — buyer-selected color from the maker's offered palette.
        // Same path: flows into the resolved cart on checkout, persists on
        // the order doc, surfaces in the maker order email as a chip.
        color_choice: (colorChoice || "").trim() || null,
        // iter380 — customization-only group selections.
        custom_option_ids: (customOptions || []).map((o) => o.id),
        custom_options_label: (customOptions || []).map((o) => o.label).join(" · ") || null,
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
