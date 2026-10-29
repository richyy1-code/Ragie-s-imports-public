import { AlertTriangle, CalendarDays, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';
import { getGetAdminEtaRemindersQueryKey, useGetAdminEtaReminders } from '@workspace/api-client-react';
import type { BatchDateCell } from '@/lib/batch-date-schedule';
import { groupBatchDateSchedule } from '@/lib/batch-date-schedule';

function errorText(error: unknown) {
  const value = error as { data?: { error?: string }; message?: string };
  return value.data?.error ?? value.message ?? 'Arrival schedule could not be loaded.';
}

function relativeDate(daysUntil: number) {
  if (daysUntil === 0) return 'Today';
  if (daysUntil > 0) return `In ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
  const daysPast = Math.abs(daysUntil);
  return `Past ${daysPast} day${daysPast === 1 ? '' : 's'}`;
}

function urgent(cell: BatchDateCell | null, warningDays: number) {
  return Boolean(cell && (cell.urgent || cell.daysUntil <= warningDays));
}

function DateValue({ cell, warningDays, label, testId }: { cell: BatchDateCell; warningDays: number; label?: string; testId: string }) {
  const isUrgent = urgent(cell, warningDays);
  return <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${isUrgent ? 'font-bold text-destructive' : 'font-semibold text-foreground'}`} data-testid={testId}>
    <span>{cell.date}</span>
    <span className={`text-xs ${isUrgent ? 'text-destructive' : 'text-muted-foreground'}`}>{relativeDate(cell.daysUntil)}</span>
    {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
  </span>;
}

export function StaffEtaAlerts() {
  const query = useGetAdminEtaReminders({
    query: { queryKey: getGetAdminEtaRemindersQueryKey(), refetchInterval: 60000 },
  });
  const alerts = query.data?.alerts ?? [];
  const schedule = groupBatchDateSchedule(query.data?.schedule ?? []);
  const warningDays = query.data?.warningDays ?? 7;

  return <div className="space-y-6" data-testid="page-admin-dates">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="eyebrow text-primary">Import flow · staff only</p><h1 className="serif mt-2 text-4xl font-semibold">Dates.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Pre-order closings and arrival estimates across every batch. Dates within {warningDays} days or already passed are highlighted.</p></div>
      <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full border border-border px-4 text-sm font-semibold text-muted-foreground disabled:opacity-50 sm:self-auto" data-testid="button-refresh-dates"><RefreshCw size={15} /> Refresh dates</button>
    </header>
    {query.isLoading ? <div className="space-y-3" aria-label="Loading date schedule"><div className="skeleton h-16 rounded-xl" /><div className="skeleton h-16 rounded-xl" /><div className="skeleton h-16 rounded-xl" /></div>
      : query.isError ? <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{errorText(query.error)} <button type="button" className="ml-2 font-bold underline" onClick={() => void query.refetch()}>Retry</button></div>
        : <>
          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="active-eta-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
              <div><p className="eyebrow text-primary">Needs attention</p><h2 id="active-eta-heading" className="serif mt-1 text-2xl font-semibold">Active arrival reminders</h2></div>
              <span className="text-xs text-muted-foreground" data-testid="count-active-eta-alerts">{alerts.length} reminder{alerts.length === 1 ? '' : 's'}</span>
            </div>
            {!alerts.length ? <p className="pt-4 text-sm text-muted-foreground">No unarrived shipment or product ETA is due today or overdue.</p> :
              <div className="divide-y divide-border">{alerts.map((alert) => <article key={alert.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`eta-alert-${alert.id}`}>
                <div className="flex items-start gap-3"><AlertTriangle size={17} className={`mt-0.5 shrink-0 ${alert.severity === 'overdue' ? 'text-destructive' : 'text-primary'}`} /><div><p className="font-semibold">{alert.name}</p><p className="mt-1 text-xs text-muted-foreground">{alert.severity === 'overdue' ? `Overdue by ${alert.daysOverdue} day${alert.daysOverdue === 1 ? '' : 's'}` : 'Expected today'} · {alert.expectedArrival}{alert.type === 'product' && alert.batchName ? ` · ${alert.batchName}` : ''}</p></div></div>
                <Link href={alert.type === 'shipment' ? '/admin/shipments' : '/admin/inventory'} className="pl-8 text-sm font-bold text-primary underline underline-offset-4 sm:pl-0" data-testid={`eta-review-${alert.id}`}>Review {alert.type === 'shipment' ? 'shipment' : 'product'}</Link>
              </article>)}</div>}
          </section>

          <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="date-schedule-heading">
            <div className="border-b border-border p-5 sm:p-6"><p className="eyebrow text-primary">Complete batch schedule</p><h2 id="date-schedule-heading" className="serif mt-1 text-2xl font-semibold">Closing &amp; arrival dates</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">All batches are included, even arrived and completed batches. Customer arrival SMS is sent only after staff confirms the shipment has arrived.</p></div>
            {!schedule.length ? <div className="p-5 text-sm text-muted-foreground" data-testid="empty-date-schedule">No batch dates are available yet. Dates will appear here when shipment batches are created.</div> :
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] table-fixed text-left" data-testid="table-batch-dates">
                  <thead><tr className="border-b border-border bg-muted/50 text-[11px] font-bold uppercase tracking-[.12em] text-muted-foreground"><th scope="col" className="w-[34%] px-4 py-3 sm:px-6">Batch</th><th scope="col" className="w-[31%] px-4 py-3 sm:px-6">Closing date</th><th scope="col" className="w-[35%] px-4 py-3 sm:px-6">Arrival date</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {schedule.map((row, index) => <tr key={`${row.batchId}-${row.closing?.date ?? 'no-closing'}`} className="align-top" data-testid={`row-batch-date-${row.batchId}-${index}`}>
                      <td className="px-4 py-4 sm:px-6">
                        <Link href="/admin/shipments" className="font-bold text-foreground underline decoration-border underline-offset-4" data-testid={`link-batch-date-${row.batchId}`}>{row.batchName}</Link>
                        <p className="mt-1 text-xs capitalize text-muted-foreground">{row.batchStatus.replaceAll('-', ' ')}</p>
                      </td>
                      <td className="px-4 py-4 sm:px-6">
                        {row.closing ? <><DateValue cell={row.closing} warningDays={warningDays} testId={`date-closing-${row.batchId}-${row.closing.date}`} /><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{row.closing.productNames.length ? row.closing.productNames.join(', ') : 'Pre-order closing date'}</p></> :
                          <><span className="text-sm font-semibold text-muted-foreground">Not set</span>{!row.hasClosingDates && <p className="mt-1 text-xs leading-5 text-muted-foreground">No closing date set for this batch.</p>}</>}
                      </td>
                      <td className="px-4 py-4 sm:px-6">
                        <div className="space-y-3">
                          {row.arrival && <div><DateValue cell={row.arrival} warningDays={warningDays} label="Batch arrival" testId={`date-arrival-${row.batchId}-${row.arrival.date}`} />{row.arrival.productNames.length > 0 && <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{row.arrival.productNames.join(', ')}</p>}</div>}
                          {row.productArrivals.map((arrival) => <div key={arrival.date} className="border-t border-border/70 pt-3" data-testid={`product-arrival-override-${row.batchId}-${arrival.date}`}><DateValue cell={arrival} warningDays={warningDays} label="Product ETA override" testId={`date-product-arrival-${row.batchId}-${arrival.date}`} /><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{arrival.productNames.length ? arrival.productNames.join(', ') : 'Product-specific expected arrival'}</p></div>)}
                          {!row.arrival && !row.productArrivals.length && <span className="text-sm text-muted-foreground">Not set</span>}
                        </div>
                      </td>
                    </tr>)}
                  </tbody>
                </table>
              </div>}
            <footer className="border-t border-border px-5 py-4 text-xs leading-5 text-muted-foreground">Schedule recalculates when this view loads and refreshes every minute while open. Past dates are labeled by how many days have passed; completed batches are not treated as active overdue reminders.</footer>
          </section>
        </>}
  </div>;
}
