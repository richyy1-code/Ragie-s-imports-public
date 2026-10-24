export type ContactPhoneDraft = { ownerId: string | null; value: string; edited: boolean };

export function contactPhoneValue(draft: ContactPhoneDraft, ownerId: string | null, savedPhone: string | null | undefined) {
  if (draft.ownerId === ownerId && draft.edited) return draft.value;
  return ownerId ? savedPhone ?? '' : '';
}
