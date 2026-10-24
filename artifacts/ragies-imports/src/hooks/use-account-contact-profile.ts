import { useAuth, useUser } from '@clerk/react';
import { getGetAccountProfileQueryKey, useGetAccountProfile } from '@workspace/api-client-react';

export function useAccountContactProfile() {
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const { isLoaded: userLoaded, user } = useUser();
  const identityReady = Boolean(authLoaded && userLoaded && isSignedIn && userId && user && user.id === userId);
  const ownerId = identityReady ? userId! : null;
  const profile = useGetAccountProfile({
    query: {
      queryKey: [...getGetAccountProfileQueryKey(), ownerId],
      enabled: Boolean(ownerId),
    },
  });
  return { ownerId, identityReady, profile };
}
