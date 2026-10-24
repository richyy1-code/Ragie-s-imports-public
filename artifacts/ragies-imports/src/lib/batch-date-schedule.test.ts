import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { BatchDateEvent } from '@workspace/api-client-react';
import { groupBatchDateSchedule } from './batch-date-schedule';

const event = (overrides: Partial<BatchDateEvent> & Pick<BatchDateEvent, 'id' | 'batchId' | 'batchName' | 'type' | 'date'>): BatchDateEvent => ({
  id: overrides.id,
  batchId: overrides.batchId,
  batchName: overrides.batchName,
  batchStatus: 'in-transit',
  type: overrides.type,
  date: overrides.date,
  productNames: [],
  daysUntil: 4,
  urgent: true,
  hasClosingDates: false,
  ...overrides,
});

test('preserves distinct closing dates per batch, groups supporting names and sorts missing dates last', () => {
  const rows = groupBatchDateSchedule([
    event({ id: 'arrival-1', batchId: 1, batchName: 'July batch', type: 'arrival', date: '2026-08-10', hasClosingDates: true }),
    event({ id: 'close-later', batchId: 1, batchName: 'July batch', type: 'closing', date: '2026-07-03', productNames: ['Bag'] }),
    event({ id: 'close-earlier', batchId: 1, batchName: 'July batch', type: 'closing', date: '2026-06-20', productNames: ['Shoes'] }),
    event({ id: 'override', batchId: 1, batchName: 'July batch', type: 'product-arrival', date: '2026-08-14', productNames: ['Custom ETA item'] }),
    event({ id: 'arrival-2', batchId: 2, batchName: 'No close date', type: 'arrival', date: '2026-08-11', hasClosingDates: false }),
  ]);

  assert.deepEqual(rows.map((row) => row.closing?.date ?? null), ['2026-06-20', '2026-07-03', null]);
  assert.deepEqual(rows[0].closing?.productNames, ['Shoes']);
  assert.equal(rows[0].arrival?.date, '2026-08-10');
  assert.deepEqual(rows[0].productArrivals.map((item) => item.date), ['2026-08-14']);
  assert.equal(rows[2].hasClosingDates, false);
});
