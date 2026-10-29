import assert from 'node:assert/strict';
import test from 'node:test';
import type { Order } from '@workspace/api-client-react';
import { accountPaymentTotals, payableAccountOrders } from './account-payment-totals';

test('pay all sums eligible arrears and shipping without charging deferred fees or cancelled orders', () => {
  const orders = [
    { id: 1, canPayBalance: true, baseBalance: 20.1, canPayShippingFee: true, shippingBalance: 30.2 },
    { id: 2, canPayBalance: true, baseBalance: .2, canPayShippingFee: false, shippingBalance: 80 },
    { id: 3, canPayBalance: true, baseBalance: 99, status: 'Cancelled' },
    { id: 4, canPayBalance: false, canPayShippingFee: false, balance: 90 },
  ] as Order[];
  assert.deepEqual(payableAccountOrders(orders).map((o) => o.id), [1, 2]);
  assert.deepEqual(accountPaymentTotals(orders), { goods: 20.3, shipping: 30.2, total: 50.5 });
  assert.equal(accountPaymentTotals([]).total, 0);
});
