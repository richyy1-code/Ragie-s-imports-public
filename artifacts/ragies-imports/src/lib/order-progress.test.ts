import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { orderProgress } from './order-progress';
import type { Order } from '@workspace/api-client-react';

const makeOrder = (status: string, preorder = true, fulfillmentMethod: 'pickup' | 'delivery' = 'delivery') => ({
  status, fulfillmentMethod, items: [{ availability: preorder ? 'pre-order' : 'ghana-stock' }],
}) as Pick<Order, 'status' | 'items' | 'fulfillmentMethod'>;

test('every operational status maps to its exact tracking stage', () => {
  for (const status of ['New Order', 'Processing', 'In China', 'Shipped', 'Arrived in Ghana', 'Packing', 'Ready for Pickup', 'Out for Delivery', 'Completed']) {
    const progress = orderProgress(makeOrder(status));
    assert.equal(progress.stages[progress.activeIndex], status);
  }
});
test('out for delivery is not completed', () => {
  const progress = orderProgress(makeOrder('Out for Delivery'));
  assert.ok(progress.activeIndex < progress.stages.indexOf('Completed'));
});
test('cancellation never implies completed delivery', () => {
  const progress = orderProgress(makeOrder('Cancelled'));
  assert.equal(progress.cancelled, true);
  assert.equal(progress.activeIndex, -1);
});
test('Ghana stock skips international stages and respects pickup', () => {
  const progress = orderProgress(makeOrder('Ready for Pickup', false, 'pickup'));
  assert.equal(progress.stages.includes('Shipped'), false);
  assert.equal(progress.stages[progress.activeIndex], 'Ready for Pickup');
  assert.equal(progress.stages.includes('Out for Delivery'), false);
});
test('payment-waiting and unknown statuses never imply fulfillment completion', () => {
  assert.equal(orderProgress(makeOrder('Awaiting Payment')).activeIndex, 0);
  const shipping = orderProgress(makeOrder('Awaiting Shipping Fee'));
  assert.equal(shipping.stages[shipping.activeIndex], 'Arrived in Ghana');
  assert.equal(orderProgress(makeOrder('Unknown')).activeIndex, -1);
});