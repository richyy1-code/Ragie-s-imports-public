import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useClerk, useUser } from '@clerk/react';
import { CalendarDays, Check, CircleUserRound, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { useStorefrontSignOut } from '@/hooks/use-storefront-sign-out';
import { useAccountContactProfile } from '@/hooks/use-account-contact-profile';
import { getGetAccountProfileQueryKey, useUpdateAccountProfile } from '@workspace/api-client-react';
import { normalizeContactPhone } from '@/lib/phone-numbers';
import { PhoneInput } from '@/components/phone-input';

function formatJoinedDate(date: Date | null | undefined) {
  if (!date) return null;
  return new Intl.DateTimeFormat('en-GH', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function AccountProfile() {
  const { isLoaded: authLoaded, userId } = useAuth();
  const { isLoaded: userLoaded, user } = useUser();
  const { openUserProfile } = useClerk();
  const { signOut, isSigningOut, error } = useStorefrontSignOut();
  const contact = useAccountContactProfile();
  const updateContact = useUpdateAccountProfile();
  const client = useQueryClient();
  const [contactPhone, setContactPhone] = useState('');
  const [contactDirty, setContactDirty] = useState(false);
  const [contactError, setContactError] = useState('');
  const [contactSaved, setContactSaved] = useState(false);
  const ownerRef = useRef<string | null>(null);
  const latestOwnerRef = useRef(contact.ownerId);
  latestOwnerRef.current = contact.ownerId;
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (ownerRef.current === contact.ownerId) return;
    const previousOwner = ownerRef.current;
    ownerRef.current = contact.ownerId;
    if (previousOwner === null && contact.ownerId !== null) return;
    dirtyRef.current = false;
    setContactDirty(false);
    setContactPhone('');
    setContactError('');
    setContactSaved(false);
    updateContact.reset();
  }, [contact.ownerId]);
  useEffect(() => {
    if (!contact.ownerId || ownerRef.current !== contact.ownerId || !contact.profile.data || dirtyRef.current) return;
    setContactPhone(contact.profile.data.phone ?? '');
  }, [contact.ownerId, contact.profile.data]);

  // Clerk can briefly retain the previous user object while the active session changes.
  // Do not render identity data until both hooks agree on the same user.
  const isReady = authLoaded && userLoaded && Boolean(userId && user && user.id === userId);

  if (!isReady || !user) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-8" data-testid="account-profile">
        <div className="skeleton h-8 w-44 rounded-lg" />
        <div className="mt-6 space-y-4">
          <div className="skeleton h-16 rounded-xl" />
          <div className="skeleton h-16 rounded-xl" />
          <div className="skeleton h-16 rounded-xl" />
        </div>
      </section>
    );
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Your account';
  const email = user.primaryEmailAddress;
  const joinedDate = formatJoinedDate(user.createdAt);
  const saveContactPhone = (event: FormEvent) => {
    event.preventDefault();
    const owner = contact.ownerId;
    if (!owner || ownerRef.current !== owner) return;
    const entered = contactPhone.trim();
    const phone = entered ? normalizeContactPhone(entered) : null;
    if (entered && !phone) {
      setContactError('Enter a valid phone number, or clear the field to remove it.');
      return;
    }
    setContactError('');
    setContactSaved(false);
    updateContact.mutate({ data: { phone } }, {
      onSuccess: (profile) => {
        if (latestOwnerRef.current !== owner) return;
        client.setQueryData([...getGetAccountProfileQueryKey(), owner], profile);
        dirtyRef.current = false;
        setContactDirty(false);
        setContactPhone(profile.phone ?? '');
        setContactSaved(true);
      },
    });
  };

  return (
    <section
      className="overflow-hidden rounded-2xl border border-border bg-card"
      data-testid="account-profile"
      aria-labelledby="profile-heading"
    >
      <header className="relative border-b border-border bg-secondary px-5 py-6 text-secondary-foreground sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-5 -top-12 h-40 w-40 rounded-full border border-secondary-foreground/10" />
        <div className="pointer-events-none absolute -right-1 -top-6 h-28 w-28 rounded-full border border-secondary-foreground/10" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-secondary-foreground/20 bg-secondary-foreground/10">
            <CircleUserRound size={28} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="eyebrow text-secondary-foreground/70">Personal details</p>
            <h2 id="profile-heading" className="serif mt-1 truncate text-2xl font-semibold sm:text-3xl" data-testid="text-profile-name">
              {fullName}
            </h2>
          </div>
        </div>
        <p className="relative mt-5 max-w-lg text-sm leading-6 text-secondary-foreground/75">
          Keep the details connected to your Ragies Imports account up to date.
        </p>
      </header>

      <div className="p-4 sm:p-8">
        <div className="divide-y divide-border rounded-xl border border-border">
          <div className="flex min-h-[76px] items-center gap-4 px-4 py-4 sm:px-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/55 text-foreground" aria-hidden="true">
              <UserRound size={18} strokeWidth={1.7} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">Full name</p>
              <p className="mt-1 truncate text-sm font-semibold text-foreground" data-testid="text-profile-full-name">{fullName}</p>
            </div>
          </div>

          <div className="flex min-h-[76px] items-center gap-4 px-4 py-4 sm:px-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/55 text-foreground" aria-hidden="true">
              <Mail size={18} strokeWidth={1.7} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">Email address</p>
              <p className="mt-1 break-all text-sm font-semibold text-foreground" data-testid="text-profile-email">{email?.emailAddress ?? 'Not added'}</p>
            </div>
            {email ? (
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] ${
                  email.verification.status === 'verified'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-accent/70 text-foreground'
                }`}
                data-testid="status-profile-email-verification"
                aria-label={email.verification.status === 'verified' ? 'Email verified' : 'Email not verified'}
              >
                {email.verification.status === 'verified' ? <Check size={12} /> : <ShieldCheck size={12} />}
                {email.verification.status === 'verified' ? 'Verified' : 'Not verified'}
              </span>
            ) : null}
          </div>

          <form onSubmit={saveContactPhone} className="flex flex-col gap-4 px-4 py-5 sm:px-5">
            <div className="flex items-center gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/55 text-foreground" aria-hidden="true"><Phone size={18} strokeWidth={1.7} /></span>
              <div><p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">Saved contact phone</p><p className="mt-1 text-xs text-muted-foreground">For order contact only. It is not a verified sign-in phone and does not grant order access.</p></div>
            </div>
            {contact.profile.isLoading && <div className="skeleton h-4 w-52 rounded" role="status" aria-label="Loading saved contact phone" />}
            {contact.profile.isError && <div role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive" data-testid="alert-profile-contact-load">{(contact.profile.error as { message?: string })?.message ?? 'Could not load your saved contact phone.'} <button type="button" className="ml-1 font-bold underline" onClick={() => void contact.profile.refetch()}>Retry</button></div>}
            <PhoneInput label="Contact phone number" value={contactPhone} onChange={(value) => { dirtyRef.current = true; setContactDirty(true); setContactSaved(false); setContactError(''); updateContact.reset(); setContactPhone(value); }} testId="input-profile-contact-phone" />
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={!contact.ownerId || updateContact.isPending || !contactDirty} className="min-h-11 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-save-profile-contact">{updateContact.isPending ? 'Saving…' : 'Save contact phone'}</button>
              {contactSaved && <span role="status" className="text-sm font-semibold text-primary" data-testid="status-profile-contact-saved">Contact phone saved.</span>}
            </div>
            {contactError && <p role="alert" className="text-sm text-destructive" data-testid="alert-profile-contact-validation">{contactError}</p>}
            {updateContact.isError && <p role="alert" className="text-sm text-destructive" data-testid="alert-profile-contact-save">{(updateContact.error as { data?: { error?: string }; message?: string })?.data?.error ?? updateContact.error.message ?? 'Could not save your contact phone.'}</p>}
          </form>

          {joinedDate ? (
            <div className="flex min-h-[76px] items-center gap-4 px-4 py-4 sm:px-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/55 text-foreground" aria-hidden="true">
                <CalendarDays size={18} strokeWidth={1.7} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">Member since</p>
                <p className="mt-1 text-sm font-semibold text-foreground" data-testid="text-profile-joined">{joinedDate}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => openUserProfile()}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="button-manage-account"
          >
            <UserRound size={16} aria-hidden="true" />
            Manage account
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={isSigningOut}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-border bg-background px-5 py-3 text-sm font-bold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="button-profile-sign-out"
          >
            {isSigningOut ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                Signing out…
              </>
            ) : (
              'Sign out'
            )}
          </button>
        </div>
        {error ? (
          <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive" role="alert" data-testid="alert-profile-sign-out-error">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
