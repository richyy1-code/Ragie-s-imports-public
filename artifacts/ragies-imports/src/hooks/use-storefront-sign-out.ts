import { useState } from 'react';
import { useClerk } from '@clerk/react';
import { useCart } from '@/components/cart-provider';

export function useStorefrontSignOut() {
  const { signOut } = useClerk();
  const { clear } = useCart();
  const [isSigningOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leave = async (redirectUrl = import.meta.env.BASE_URL) => {
    if (isSigningOut) return;
    setSigningOut(true);
    setError(null);
    clear();
    try {
      await signOut({ redirectUrl });
    } catch {
      setError('Sign-out did not finish. Please try again.');
      setSigningOut(false);
    }
  };
  return { signOut: leave, isSigningOut, error };
}
