import { useListProductBatches, getListProductBatchesQueryKey } from '@workspace/api-client-react';
import { date } from '@/lib/dates';

type Props = { shipmentId: number | null; rawDate: string; onChange: (value: string) => void; testId?: string };
export function InheritedClosingField({ shipmentId, rawDate, onChange, testId = 'product-close-date' }: Props) {
  const batches = useListProductBatches({ query: { queryKey: getListProductBatchesQueryKey() } });
  const batch = batches.data?.find((item) => item.id === shipmentId);
  const inherited = !rawDate;
  const displayed = rawDate || batch?.preOrderCloseDate || '';
  return <div className="sm:col-span-2 rounded-xl border border-border bg-background p-4">
    <label className="block"><span className="text-sm font-bold">Preorder closing date</span>
      <input type="date" required value={displayed} onChange={(event) => onChange(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-3 text-sm" data-testid={testId} />
    </label>
    <p className="mt-2 text-xs leading-5 text-muted-foreground" aria-live="polite">{inherited
      ? batch?.preOrderCloseDate ? `Using ${batch.name} closing date.` : 'Set a closing date on the shipment batch or enter a custom product date.'
      : `Custom product date. ${batch?.preOrderCloseDate ? `Batch closes ${date(batch.preOrderCloseDate)}. ` : ''}`}</p>
    {!inherited && <button type="button" onClick={() => onChange('')} className="mt-2 text-xs font-bold text-primary underline" data-testid={`${testId}-reset`}>Use batch date</button>}
    {batches.isError && <p role="alert" className="mt-2 text-xs text-destructive">Batch date could not be loaded. Retry loading the batch or enter a custom date.</p>}
  </div>;
}
