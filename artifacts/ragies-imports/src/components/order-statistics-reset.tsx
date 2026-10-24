import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useClearTestOrders } from '@workspace/api-client-react';

// Rendered only for verified owners; the server independently enforces ownership.
export function OrderStatisticsReset() {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const reset = useClearTestOrders();
  const client = useQueryClient();
  const run = () => reset.mutate({ data: { confirmation: 'DELETE TEST ORDERS' } }, {
    onSuccess: async () => {
      setConfirmation('');
      await client.invalidateQueries();
      setOpen(false);
    },
  });
  return <section className="mt-8 rounded-2xl border border-destructive/30 bg-card p-5 sm:p-6" aria-labelledby="order-statistics-reset-title">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 id="order-statistics-reset-title" className="font-bold">Start with real order statistics</h2>
        <p className="mt-2 text-sm text-muted-foreground">Remove test orders so sales, costs, profit, balances, and order counts start fresh.</p>
      </div>
      <button type="button" onClick={() => { reset.reset(); setOpen(!open); setConfirmation(''); }} disabled={reset.isPending} className="min-h-11 shrink-0 rounded-full border border-destructive/30 px-4 py-3 text-sm font-bold text-destructive disabled:opacity-50" data-testid="button-open-order-statistics-reset">
        {open ? 'Cancel' : 'Clear test order statistics'}
      </button>
    </div>
    {open && <div className="mt-5 space-y-4 border-t border-border pt-5">
      <p className="text-sm leading-6"><strong>This permanently deletes all current order history</strong>, including pending checkouts and orders in the recycle bin. It preserves products, stock quantities, accounts, shipments, and settings. It does not refund payments or alter your Paystack balance. Use it only before real selling, with no test payments in progress.</p>
      <Link href="/admin/data-protection" className="inline-flex min-h-11 items-center text-sm font-bold text-primary underline">Download a snapshot first</Link>
      <label className="block text-sm font-bold">Type DELETE TEST ORDERS to confirm
        <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={reset.isPending} autoComplete="off" className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-3" data-testid="input-order-statistics-confirmation" />
      </label>
      <button type="button" onClick={run} disabled={confirmation !== 'DELETE TEST ORDERS' || reset.isPending} className="min-h-11 rounded-full bg-destructive px-5 py-3 text-sm font-bold text-white disabled:opacity-50" data-testid="button-confirm-order-statistics-reset">
        {reset.isPending ? 'Clearing test orders…' : 'Delete test orders and clear statistics'}
      </button>
    </div>}
    {reset.isError && <p role="alert" className="mt-4 text-sm text-destructive">Refresh the order list before retrying. {reset.error.message}</p>}
    {reset.isSuccess && <p role="status" className="mt-4 text-sm font-semibold" data-testid="status-order-statistics-reset">Deleted {reset.data.ordersDeleted} test {reset.data.ordersDeleted === 1 ? 'order' : 'orders'}. Order statistics have been refreshed. Products, accounts, and settings were preserved.</p>}
  </section>;
}