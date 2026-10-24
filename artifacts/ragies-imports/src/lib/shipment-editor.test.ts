import assert from 'node:assert/strict';
import test from 'node:test';
import type { Shipment, ShipmentInput } from '@workspace/api-client-react';
import { shipmentEditorPatch } from './shipment-editor';
const original = { name: 'Batch', status: 'arrived', expectedArrival: '2030-01-01', actualArrival: '2030-01-01', notes: null,
  orders: [{ id: 1 }], productFees: [{ productId: 1, productName: 'Goods', feePerItem: 10 }] } as Shipment;
const draft: ShipmentInput = { name: original.name, status: original.status, expectedArrival: original.expectedArrival,
  actualArrival: original.actualArrival, notes: null, orderIds: [1], productFees: original.productFees };
test('date-only corrections never resubmit shipping fees, membership or shipment status', () => {
  assert.deepEqual(shipmentEditorPatch(original, { ...draft, expectedArrival: '2030-02-02' }), { expectedArrival: '2030-02-02' });
  assert.deepEqual(shipmentEditorPatch(original, { ...draft, actualArrival: '2030-01-02' }), { actualArrival: '2030-01-02' });
  assert.deepEqual(shipmentEditorPatch(original, draft), {});
});
test('intentional financial and membership changes stay explicit', () => {
  assert.deepEqual(shipmentEditorPatch(original, { ...draft, orderIds: [] }), { orderIds: [] });
  assert.deepEqual(shipmentEditorPatch(original, { ...draft, productFees: [] }), { productFees: [] });
  assert.deepEqual(shipmentEditorPatch(original, { ...draft, notes: 'Updated' }), { notes: 'Updated' });
});

test('closing date-only edits send no status, financial, or membership changes', () => {
  assert.deepEqual(shipmentEditorPatch({ ...original, preOrderCloseDate: '2030-01-01' }, { ...draft, preOrderCloseDate: '2030-01-05' }), { preOrderCloseDate: '2030-01-05' });
  assert.deepEqual(shipmentEditorPatch({ ...original, preOrderCloseDate: '2030-01-01' }, { ...draft, preOrderCloseDate: '2030-01-01' }), {});
});
