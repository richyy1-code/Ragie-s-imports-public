type ApiErrorLike = {
  status?: number;
  data?: unknown;
};

export const MISSING_ACCOUNT_SESSION_MESSAGE =
  "This account session is no longer available. Please sign in again.";

export function isMissingAccountSessionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as ApiErrorLike;
  if (candidate.status !== 401 || !candidate.data || typeof candidate.data !== "object") return false;
  return (candidate.data as { error?: unknown }).error === MISSING_ACCOUNT_SESSION_MESSAGE;
}
