import { useEffect, useState } from 'react';
import { useAccountContactProfile } from './use-account-contact-profile';
import { contactPhoneValue, type ContactPhoneDraft } from '@/lib/contact-phone-default';

/** An editable default, not an enforced value or proof of phone ownership. */
export function useContactPhoneDefault() {
  const contact = useAccountContactProfile();
  const [draft, setDraft] = useState<ContactPhoneDraft>({
    ownerId: contact.ownerId, value: '', edited: false,
  });
  useEffect(() => {
    setDraft((current) => current.ownerId === contact.ownerId
      ? current : { ownerId: contact.ownerId, value: '', edited: false });
  }, [contact.ownerId]);
  return {
    ownerId: contact.ownerId,
    value: contactPhoneValue(draft, contact.ownerId, contact.profile.data?.phone),
    onChange: (value: string) => setDraft({ ownerId: contact.ownerId, value, edited: true }),
  };
}
