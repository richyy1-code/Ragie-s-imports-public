import assert from 'node:assert/strict';
import test from 'node:test';
import { orderEditorPatch } from './order-editor';

const order = {
  customerName: 'Synthetic customer', phone: '0000000000', whatsapp: null,
  address: 'Address', city: 'Accra', paymentMethod: 'paystack', amountPaid: 80,
  status: 'In China', shipmentName: 'Batch', notes: null,
};
const draft = { ...order, whatsapp: '', notes: '', amountPaid: '80' };

test('saving unchanged fields sends no financial or server-owned payment status', () => {
  assert.deepEqual(orderEditorPatch(order, draft), {});
});
test('address and status edits omit payment details and preserve other sessions payments', () => {
  assert.deepEqual(orderEditorPatch(order, { ...draft, address: 'New address' }), { address: 'New address' });
  assert.deepEqual(orderEditorPatch(order, { ...draft, status: 'Shipped' }), { status: 'Shipped' });
});
test('explicit payment corrections and clearing nullable fields are retained', () => {
  assert.deepEqual(orderEditorPatch(order, { ...draft, amountPaid: '100' }), { amountPaid: 100 });
  assert.deepEqual(orderEditorPatch(order, { ...draft, shipmentName: '' }), { shipmentName: null });
});
