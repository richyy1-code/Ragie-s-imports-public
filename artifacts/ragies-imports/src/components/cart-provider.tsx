import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import type { Product } from '@workspace/api-client-react';
import { isQuantified, variantStock } from '@/lib/product-options';
import { cartOwner, cartStorageKey, enterCartOwner, readCart, writeCart, type CartItem } from '@/lib/cart-session';

type CartContextValue = {
  items: CartItem[];
  addItem: (product: Product, options?: { color?: string | null; size?: string | null; variantType?: string | null }) => void;
  removeItem: (productId: number, color: string | null, size: string | null, variantType?: string | null) => void;
  setQuantity: (productId: number, quantity: number, color: string | null, size: string | null, variantType?: string | null) => void;
  clear: () => void;
};
const CartContext = createContext<CartContextValue | null>(null);
export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error('Cart context is unavailable');
  return value;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const owner = cartOwner(useAuth());
  const previous = useRef<string | null>(null);
  const [cart, setCart] = useState<{ owner: string | null; items: CartItem[] }>({ owner: null, items: [] });
  // Never render the previous identity's items, even in the frame before effects run.
  const items = owner && cart.owner === owner ? cart.items : [];
  useEffect(() => {
    if (!owner) return;
    if (previous.current === owner) return;
    let next: CartItem[] = [];
    try { next = enterCartOwner(window.localStorage, previous.current, owner); } catch { /* Private browsing may disable storage. */ }
    previous.current = owner;
    setCart({ owner, items: next });
  }, [owner]);
  useEffect(() => {
    if (owner && cart.owner === owner) {
      try { writeCart(window.localStorage, owner, cart.items); } catch { /* Keep in-memory shopping usable. */ }
    }
  }, [owner, cart]);
  useEffect(() => {
    const clear = () => {
      if (!owner) return;
      try { writeCart(window.localStorage, owner, []); } catch { /* Keep the state cleared even without storage. */ }
      setCart((current) => current.owner === owner ? { owner, items: [] } : current);
    };
    const removeProduct = (event: Event) => {
      const id = (event as CustomEvent<number>).detail;
      if (Number.isSafeInteger(id)) setCart((current) => ({ ...current, items: current.items.filter((item) => item.product.id !== id) }));
    };
    const synchronize = (event: StorageEvent) => {
      if (!owner || (event.key !== null && event.key !== cartStorageKey(owner))) return;
      let next: CartItem[] = [];
      try { next = readCart(window.localStorage, owner); } catch { /* Treat inaccessible storage as empty. */ }
      setCart((current) => current.owner === owner ? { owner, items: next } : current);
    };
    window.addEventListener('ragies-cart-reset', clear);
    window.addEventListener('ragies-product-deleted', removeProduct);
    window.addEventListener('storage', synchronize);
    return () => {
      window.removeEventListener('ragies-cart-reset', clear);
      window.removeEventListener('ragies-product-deleted', removeProduct);
      window.removeEventListener('storage', synchronize);
    };
  }, [owner]);
  const update = (change: (items: CartItem[]) => CartItem[]) =>
    setCart((current) => owner && current.owner === owner ? { owner, items: change(current.items) } : current);
  const addItem: CartContextValue['addItem'] = (product, options = {}) => update((current) => {
    const quant = isQuantified(product.variants);
    const variantType = options.variantType ?? (quant ? options.size : null) ?? product.variants[0]?.name ?? null;
    const variant = product.variants.find((entry) => entry.name === variantType);
    const colors = variant?.colors ?? (product.variants.length ? [] : product.colors);
    const color = options.color ?? colors[0] ?? null;
    const size = quant ? variantType : (options.size ?? product.sizes[0] ?? null);
    const limit = variantStock(product, size, color);
    const existing = current.find((item) => item.product.id === product.id && item.color === color && item.size === size && item.variantType === variantType);
    if (existing) return limit !== null && existing.quantity + 1 > limit ? current : current.map((item) => item === existing ? { ...item, quantity: item.quantity + 1 } : item);
    if (limit !== null && limit < 1) return current;
    return [...current, { product, quantity: 1, color, size, variantType }];
  });
  const removeItem: CartContextValue['removeItem'] = (productId, color, size, variantType = null) => update((current) =>
    current.filter((item) => !(item.product.id === productId && item.color === color && item.size === size && item.variantType === variantType)));
  const setQuantity: CartContextValue['setQuantity'] = (productId, quantity, color, size, variantType = null) => update((current) =>
    Number.isSafeInteger(quantity) ? current.map((item) => item.product.id === productId && item.color === color && item.size === size && item.variantType === variantType
      ? { ...item, quantity: Math.min(Math.max(1, quantity), variantStock(item.product, item.size, item.color) ?? Infinity) } : item) : current);
  const clear = () => {
    if (!owner) return;
    try { writeCart(window.localStorage, owner, []); } catch { /* State remains usable without browser storage. */ }
    update(() => []);
  };
  return <CartContext.Provider value={{ items, addItem, removeItem, setQuantity, clear }}>{children}</CartContext.Provider>;
}
