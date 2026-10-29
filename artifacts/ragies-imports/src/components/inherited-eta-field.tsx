import { useListProductBatches, getListProductBatchesQueryKey } from '@workspace/api-client-react';

type Props = { shipmentId: number | null; rawEta: string; onChange: (value: string) => void; testId?: string };

export function InheritedEtaField({ shipmentId, rawEta, onChange, testId = 'product-eta' }: Props) {
  const batches = useListProductBatches({ query: { queryKey: getListProductBatchesQueryKey() } });
  const batch = batches.data?.find((item) => item.id === shipmentId);
  const inherited = !rawEta;
  const displayed = rawEta || batch?.expectedArrival || '';
  return <div className="sm:col-span-2 rounded-xl border border-border bg-background p-4">
    <label className="block">
      <span className="text-sm font-bold">Expected arrival</span>
      <input type="date" value={displayed} onChange={(event) => onChange(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-3 text-sm" data-testid={testId} />
    </label>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs leading-5 text-muted-foreground" aria-live="polite">
        {inherited ? batch ? `Using ${batch.name} batch date.` : 'Choose a shipment batch to inherit its expected arrival date.' : 'Custom product date.'}
      </p>
      {!inherited && <button type="button" onClick={() => onChange('')} className="text-xs font-bold text-primary underline" data-testid={`${testId}-reset`}>Use batch date</button>}
    </div>
    {batches.isError && <p role="alert" className="mt-2 text-xs text-destructive">Batch date unavailable. The custom date can still be set.</p>}
  </div>;
}
