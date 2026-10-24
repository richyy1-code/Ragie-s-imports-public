export const PAYSTACK_RETURN_PENDING_KEY = 'ragies-paystack-return-pending';

export function markPaystackReturnPending(storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(PAYSTACK_RETURN_PENDING_KEY, '1');
}

export function consumePaystackReturnPending(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  visibility: DocumentVisibilityState = 'visible',
): boolean {
  // visibilitychange also fires when leaving for Paystack. Preserve the marker
  // until the storefront is visible again.
  if (visibility !== 'visible') return false;
  if (storage.getItem(PAYSTACK_RETURN_PENDING_KEY) !== '1') return false;
  storage.removeItem(PAYSTACK_RETURN_PENDING_KEY);
  return true;
}
