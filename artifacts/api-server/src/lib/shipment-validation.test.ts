import assert from 'node:assert/strict';
import test from 'node:test';
import { shipmentValidationError } from './shipment-validation';

const batch = { name: 'Synthetic batch', status: 'preparing', expectedArrival: '2026-12-01', actualArrival: null };
test('arrival and completion both require an actual date; partial edits can retain the saved date', () => {
  assert.equal(shipmentValidationError(batch), null);
  for (const status of ['arrived', 'completed']) {
    assert.match(shipmentValidationError({ ...batch, status })!, /actual arrival/);
    assert.equal(shipmentValidationError({ ...batch, status, actualArrival: '2026-12-02' }), null);
  }
});
test('invalid calendar dates, duplicate fees and negative fees are rejected', () => {
  for (const expectedArrival of ['2026-02-30', '2026-13-01', '12/1/2026', '']) {
    assert.match(shipmentValidationError({ ...batch, expectedArrival })!, /expected arrival/);
  }
  assert.match(shipmentValidationError({ ...batch, productFees: [{ productId: 1, feePerItem: -1 }] })!, /zero or more/);
  assert.match(shipmentValidationError({ ...batch, productFees: [{ productId: 1, feePerItem: 5 }, { productId: 1, feePerItem: 8 }] })!, /only one/);
});
