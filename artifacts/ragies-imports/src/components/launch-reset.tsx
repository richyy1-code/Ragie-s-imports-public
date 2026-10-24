import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useResetLaunchData } from '@workspace/api-client-react';
import { useClerk } from '@clerk/react';

export function LaunchReset() {
  const [confirmation, setConfirmation] = useState('');
  const reset = useResetLaunchData();
  const client = useQueryClient();
  const { user } = useClerk();
  const resetSummary = reset.data as (typeof reset.data & { shipmentsDeleted: number; smsNotificationsDeleted: number }) | undefined;
  if (!user) return null;
  const run = () => reset.mutate({ data: { confirmation: 'DELETE TEST DATA' } }, {
    onSuccess: () => {
      setConfirmation('');
      localStorage.removeItem('ragies-cart');
      window.dispatchEvent(new Event('ragies-cart-reset'));
      void client.invalidateQueries();
    },
  });
  return <section className="mt-8 rounded-2xl border border-destructive/40 bg-card p-5" aria-labelledby="launch-reset-title">
    <h2 id="launch-reset-title" className="text-lg font-bold text-destructive">Clear test data before launch</h2>
    <p className="mt-3 text-sm leading-6">Permanently deletes <strong>all current products, all orders (including pending payments and the recycle bin), all shipment batches (including product/order memberships, fees, and dates), all SMS notifications and queue history (including standalone messages), and all non-owner signed-up accounts</strong>. Permanent owner accounts are preserved. Promotions, settings, website content, and uploaded files are not deleted.</p>
    <p className="mt-3 text-sm font-semibold">Download a snapshot first. This cannot be undone here. Use this only before adding real products or accepting real orders. Do not use it while checkout payments are in progress.</p>
    <label className="mt-5 block text-sm font-bold">Type DELETE TEST DATA to confirm
      <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={reset.isPending} autoComplete="off" className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-3" data-testid="input-launch-reset-confirmation" />
    </label>
    <button type="button" disabled={confirmation !== 'DELETE TEST DATA' || reset.isPending} onClick={run} className="mt-4 min-h-11 rounded-full bg-destructive px-5 py-3 text-sm font-bold text-white disabled:opacity-50" data-testid="button-launch-reset">{reset.isPending ? 'Deleting test data…' : 'Permanently clear test data'}</button>
    {reset.isError && <p role="alert" className="mt-4 text-sm text-destructive">The reset could not finish. Refresh the summary before retrying. {reset.error.message}</p>}
    {resetSummary && <p role="status" className="mt-4 text-sm font-semibold">Deleted {resetSummary.productsDeleted} products, {resetSummary.ordersDeleted} orders, {resetSummary.shipmentsDeleted} shipment batches, {resetSummary.smsNotificationsDeleted} SMS notifications, and {resetSummary.accountsDeleted} non-owner accounts. {resetSummary.accountsFailed > 0 ? `${resetSummary.accountsFailed} accounts could not be deleted. Retry only before adding real data.` : 'Owner accounts were preserved.'}</p>}
  </section>;
}