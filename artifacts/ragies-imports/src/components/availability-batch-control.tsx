import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateShipment, useListProductBatches, getListProductBatchesQueryKey, useGetAdminAccess, getGetAdminAccessQueryKey, getListProductsQueryKey, getListShipmentsQueryKey, getGetAdminEtaRemindersQueryKey } from '@workspace/api-client-react';
import { useAuth } from '@clerk/react';
import type { Shipment } from '@workspace/api-client-react';
import { date } from '@/lib/dates';

type Props = {
  availability: 'ghana-stock' | 'pre-order';
  shipmentId: number | null;
  onChange: (availability: 'ghana-stock' | 'pre-order', shipmentId: number | null) => void;
  testId?: string;
};

const errorText = (error: unknown) => {
  const value = error as { message?: string; status?: number; data?: { error?: string } };
  return value.data?.error ?? value.message?.replace(/^HTTP\s+\d{3}[^:]*:\s*/i, '') ?? 'Please try again.';
};

export function AvailabilityBatchControl({ availability, shipmentId, onChange, testId = 'availability-batch' }: Props) {
  const client = useQueryClient();
  const shipments = useListProductBatches({ query: { queryKey: getListProductBatchesQueryKey() } });
  const { userId, isLoaded, isSignedIn } = useAuth();
  const access = useGetAdminAccess({ query: { queryKey: [...getGetAdminAccessQueryKey(), userId], enabled: Boolean(isLoaded && isSignedIn), refetchOnMount: 'always' } });
  const canCreateBatch = access.data?.permissions.includes('shipments') === true;
  const create = useCreateShipment();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [expectedArrival, setExpectedArrival] = useState('');
  const [preOrderCloseDate, setPreOrderCloseDate] = useState('');
  const [createError, setCreateError] = useState('');
  const selected = shipments.data?.find((shipment) => shipment.id === shipmentId);
  const submitBatch = () => {
    if (!name.trim() || !expectedArrival || !preOrderCloseDate) {
      setCreateError('Enter a batch name, closing date, and expected arrival date.');
      return;
    }
    setCreateError('');
    create.mutate({ data: { name: name.trim(), status: 'preparing', expectedArrival, preOrderCloseDate, actualArrival: null, notes: null } }, {
      onSuccess: async (shipment: Shipment) => {
        await client.invalidateQueries({ queryKey: getListShipmentsQueryKey() });
        await client.invalidateQueries({ queryKey: getListProductBatchesQueryKey() });
        await client.invalidateQueries({ queryKey: getListProductsQueryKey() });
        await client.invalidateQueries({ queryKey: getGetAdminEtaRemindersQueryKey() });
        onChange('pre-order', shipment.id);
        setName('');
        setExpectedArrival('');
        setPreOrderCloseDate('');
        setCreating(false);
      },
      onError: (error) => setCreateError(errorText(error)),
    });
  };
  return <section className="rounded-xl border border-border bg-background p-4" data-testid={testId}>
    <label className="block"><span className="text-sm font-bold">Availability</span>
      <select value={availability} onChange={(event) => onChange(event.target.value as Props['availability'], event.target.value === 'ghana-stock' ? null : shipmentId)} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm" data-testid={`${testId}-select`}>
        <option value="ghana-stock">Ready in Ghana</option><option value="pre-order">Pre-order</option>
      </select>
    </label>
    {availability === 'pre-order' && <div className="mt-4 space-y-3">
      {shipments.isLoading ? <div className="skeleton h-12 rounded-xl" aria-label="Loading shipment batches" /> :
        shipments.isError ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">Batch choices could not be loaded. {errorText(shipments.error)} <button type="button" onClick={() => shipments.refetch()} className="ml-1 underline">Retry</button></p> :
          <>
            <label className="block"><span className="text-sm font-bold">Shipment batch <span className="text-destructive">*</span></span>
              <select required value={shipmentId ?? ''} onChange={(event) => onChange('pre-order', event.target.value ? Number(event.target.value) : null)} className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-sm" data-testid={`${testId}-shipment`}>
                <option value="" disabled>Select a batch</option>
                {(shipments.data ?? []).map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.name} · expected {date(shipment.expectedArrival)}</option>)}
              </select>
            </label>
            {selected && <p className="text-xs text-muted-foreground" data-testid={`${testId}-selected`}>Assigned to <strong>{selected.name}</strong> · closes {selected.preOrderCloseDate ? date(selected.preOrderCloseDate) : 'not set'} · expected arrival {date(selected.expectedArrival)}.</p>}
            {!selected && shipmentId != null && <p className="text-xs text-destructive">The saved batch is not available in the current shipment list.</p>}
            {canCreateBatch ? <button type="button" onClick={() => { setCreating(!creating); setCreateError(''); }} className="text-sm font-bold text-primary underline" data-testid={`${testId}-new-batch`}>{creating ? 'Cancel new batch' : 'Create a new batch'}</button> : <p className="text-xs text-muted-foreground">Ask shipment staff to create a new batch if needed.</p>}
            {creating && canCreateBatch && <div className="grid gap-3 rounded-xl bg-card p-4 sm:grid-cols-2" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitBatch(); } }}>
              <label className="sm:col-span-2"><span className="text-sm font-bold">Batch name</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. July accessories" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid={`${testId}-batch-name`} /></label>
              <label><span className="text-sm font-bold">Preorder closing date</span><input required type="date" value={preOrderCloseDate} onChange={(event) => setPreOrderCloseDate(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid={`${testId}-batch-closing`} /></label>
              <label><span className="text-sm font-bold">Expected arrival</span><input required type="date" value={expectedArrival} onChange={(event) => setExpectedArrival(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid={`${testId}-batch-arrival`} /></label>
              <div className="flex items-end"><button type="button" onClick={submitBatch} disabled={create.isPending} className="h-11 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60" data-testid={`${testId}-create-batch-submit`}>{create.isPending ? 'Creating…' : 'Create and select'}</button></div>
              {createError && <p role="alert" className="text-sm text-destructive sm:col-span-2">{createError}</p>}
            </div>}
          </>}
    </div>}
  </section>;
}