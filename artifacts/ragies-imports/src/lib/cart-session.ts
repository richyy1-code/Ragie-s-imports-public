import type { Product } from '@workspace/api-client-react';

export type CartItem = { product: Product; quantity: number; color: string | null; size: string | null; variantType: string | null };
export const guestCartOwner = 'guest';
export const legacyCartKey = 'ragies-cart';
export const cartStorageKey = (owner: string) => `ragies-cart:v2:${owner}`;

export function cartOwner(auth: { isLoaded: boolean; isSignedIn?: boolean; userId?: string | null; sessionId?: string | null }): string | null {
  if (!auth.isLoaded) return null;
  if (auth.isSignedIn === false) return guestCartOwner;
  return auth.isSignedIn && auth.userId && auth.sessionId
    ? `user:${encodeURIComponent(auth.userId)}:session:${encodeURIComponent(auth.sessionId)}` : null;
}

export function readCart(storage: Pick<Storage, 'getItem'>, owner: string): CartItem[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(cartStorageKey(owner)) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is CartItem => {
      const product = item?.product;
      return product && Number.isSafeInteger(product.id) && typeof product.name === 'string'
        && Number.isFinite(product.price) && product.price >= 0
        && Array.isArray(product.variants) && Array.isArray(product.colors) && Array.isArray(product.sizes)
        && Number.isSafeInteger(item.quantity) && item.quantity > 0
        && [item.color, item.size, item.variantType].every((option) => option == null || typeof option === 'string');
    });
  } catch { return []; }
}

export function writeCart(storage: Pick<Storage, 'setItem'>, owner: string, items: CartItem[]) {
  try { storage.setItem(cartStorageKey(owner), JSON.stringify(items)); } catch { /* Browsers can disable storage; the in-memory cart still works. */ }
}

export function enterCartOwner(storage: Storage, previous: string | null, next: string): CartItem[] {
  // The legacy shared cart has no trustworthy owner and cannot be migrated safely.
  try { storage.removeItem(legacyCartKey); } catch { /* Storage may be unavailable. */ }
  const saved = readCart(storage, next);
  let items = saved;
  if (next !== guestCartOwner && (previous === null || previous === guestCartOwner)) {
    // A fresh sign-in may claim a guest cart once, without duplicating an existing session cart.
    if (!saved.length) items = readCart(storage, guestCartOwner);
    try { storage.removeItem(cartStorageKey(guestCartOwner)); } catch { /* Storage may be unavailable. */ }
  }
  if (previous && previous !== next) {
    try { storage.removeItem(cartStorageKey(previous)); } catch { /* Storage may be unavailable. */ }
  }
  writeCart(storage, next, items);
  return items;
}
