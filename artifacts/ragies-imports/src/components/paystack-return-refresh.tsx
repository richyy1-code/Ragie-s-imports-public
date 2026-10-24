import { useEffect } from 'react';
import { consumePaystackReturnPending } from '@/lib/paystack-return';

export function PaystackReturnRefresh() {
  useEffect(() => {
    const refreshCatalog = () => {
      let shouldRefresh = false;
      try {
        shouldRefresh = consumePaystackReturnPending(window.sessionStorage, document.visibilityState);
      } catch {
        return;
      }
      if (!shouldRefresh) return;

      // Reset restored mutation/form state as well as cached stock. Consume the
      // marker before reloading so this cannot create a reload loop.
      window.location.reload();
    };

    window.addEventListener('pageshow', refreshCatalog);
    window.addEventListener('focus', refreshCatalog);
    document.addEventListener('visibilitychange', refreshCatalog);
    refreshCatalog();
    return () => {
      window.removeEventListener('pageshow', refreshCatalog);
      window.removeEventListener('focus', refreshCatalog);
      document.removeEventListener('visibilitychange', refreshCatalog);
    };
  }, []);

  return null;
}
