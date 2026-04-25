import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const CartCtx = createContext(null);
const STORAGE = "cm_cart_v1";

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE)) || []; }
    catch { return []; }
  });
  useEffect(() => { localStorage.setItem(STORAGE, JSON.stringify(items)); }, [items]);

  const add = useCallback((p, qty = 1) => {
    setItems((cur) => {
      const ex = cur.find((i) => i.id === p.id);
      if (ex) return cur.map((i) => i.id === p.id ? { ...i, quantity: i.quantity + qty } : i);
      return [...cur, { id: p.id, slug: p.slug, title: p.title, price: p.price, image: p.images?.[0], quantity: qty }];
    });
  }, []);
  const remove = useCallback((id) => setItems((c) => c.filter((i) => i.id !== id)), []);
  const setQty = useCallback((id, q) =>
    setItems((c) => c.map((i) => i.id === id ? { ...i, quantity: Math.max(1, q) } : i)), []);
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
