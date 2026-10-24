import type { BatchDateEvent } from '@workspace/api-client-react';

export type BatchDateCell = Pick<BatchDateEvent, 'date' | 'daysUntil' | 'urgent' | 'productNames'>;
export type BatchDateRow = {
  batchId: number;
  batchName: string;
  batchStatus: string;
  closing: BatchDateCell | null;
  arrival: BatchDateCell | null;
  productArrivals: BatchDateCell[];
  hasClosingDates: boolean;
};

function mergeDate(target: Map<string, BatchDateCell>, event: BatchDateEvent) {
  const existing = target.get(event.date);
  target.set(event.date, {
    date: event.date,
    daysUntil: event.daysUntil,
    urgent: Boolean(existing?.urgent || event.urgent),
    productNames: Array.from(new Set([...(existing?.productNames ?? []), ...event.productNames])),
  });
}

/** Group API schedule events by batch while retaining every distinct closing date and ETA override. */
export function groupBatchDateSchedule(events: BatchDateEvent[]): BatchDateRow[] {
  const batches = new Map<number, {
    batchId: number;
    batchName: string;
    batchStatus: string;
    closings: Map<string, BatchDateCell>;
    arrivals: Map<string, BatchDateCell>;
    productArrivals: Map<string, BatchDateCell>;
    hasClosingDates: boolean;
  }>();

  for (const event of events) {
    let batch = batches.get(event.batchId);
    if (!batch) {
      batch = {
        batchId: event.batchId,
        batchName: event.batchName,
        batchStatus: event.batchStatus,
        closings: new Map(),
        arrivals: new Map(),
        productArrivals: new Map(),
        hasClosingDates: event.hasClosingDates,
      };
      batches.set(event.batchId, batch);
    }
    batch.batchStatus = event.batchStatus;
    batch.hasClosingDates ||= event.hasClosingDates;
    if (event.type === 'closing') mergeDate(batch.closings, event);
    else if (event.type === 'product-arrival') mergeDate(batch.productArrivals, event);
    else mergeDate(batch.arrivals, event);
  }

  const rows: BatchDateRow[] = [];
  for (const batch of batches.values()) {
    const closings = Array.from(batch.closings.values()).sort((a, b) => a.date.localeCompare(b.date));
    const arrival = Array.from(batch.arrivals.values()).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    const productArrivals = Array.from(batch.productArrivals.values()).sort((a, b) => a.date.localeCompare(b.date));
    const common = {
      batchId: batch.batchId,
      batchName: batch.batchName,
      batchStatus: batch.batchStatus,
      arrival,
      productArrivals,
      hasClosingDates: batch.hasClosingDates || closings.length > 0,
    };
    if (closings.length) closings.forEach((closing) => rows.push({ ...common, closing }));
    else rows.push({ ...common, closing: null });
  }

  return rows.sort((a, b) => {
    if (a.closing && b.closing) return a.closing.date.localeCompare(b.closing.date) || a.batchName.localeCompare(b.batchName) || a.batchId - b.batchId;
    if (a.closing) return -1;
    if (b.closing) return 1;
    return a.batchName.localeCompare(b.batchName) || a.batchId - b.batchId;
  });
}
