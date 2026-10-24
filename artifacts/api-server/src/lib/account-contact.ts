import { normalizePhoneNumber } from "./phone-numbers";

export function isMissingAccountError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && "status" in error && error.status === 404;
}

export const missingAccountSessionMessage =
  "This account session is no longer available. Please sign in again.";

/** Return null only when Clerk confirms that this signed-in identity was deleted. */
export async function getExistingClerkUser<T>(
  userId: string | null | undefined,
  getUser: (id: string) => Promise<T>,
): Promise<T | null> {
  if (!userId) return null;
  try {
    return await getUser(userId);
  } catch (error) {
    if (isMissingAccountError(error)) return null;
    throw error;
  }
}

type ContactUser = {
  privateMetadata: Record<string, unknown>;
  primaryPhoneNumberId: string | null;
  phoneNumbers: Array<{ id: string; phoneNumber: string }>;
};

/** Contact preferences are never verification, authorization or order ownership. */
export function accountContactPhone(user: ContactUser): string | null {
  const saved = user.privateMetadata.ragiesContactPhone;
  // An empty saved value explicitly removes the default, including a native
  // Clerk phone fallback. Metadata updates can delete keys whose value is null.
  if (saved !== undefined) return typeof saved === "string" ? normalizePhoneNumber(saved) : null;
  const native = user.phoneNumbers.find((phone) => phone.id === user.primaryPhoneNumberId);
  return native ? normalizePhoneNumber(native.phoneNumber) : null;
}
