import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentProgress } from './payment-progress';

test('80% receipt uses actual money paid, not the full order value', () => {
  assert.deepEqual(paymentProgress({ totalAmount: 2, amountPaid: 1.6 }), {
    balance: .4, fullyPaid: false, partiallyPaid: true, percent: 80,
    label: 'Part payment received (80%)',
  });
});
test('full merchandise payment is explicitly separate from deferred shipping', () => {
  const progress = paymentProgress({ totalAmount: 2, amountPaid: 2 });
  assert.equal(progress.balance, 0);
  assert.equal(progress.fullyPaid, true);
  assert.equal(progress.partiallyPaid, false);
  assert.equal(progress.label, 'Goods paid in full (100%)');
});
test('intermediate deposits, rounding and the final unpaid cent remain partial', () => {
  assert.equal(paymentProgress({ totalAmount: 100, amountPaid: 85.25 }).percent, 85.25);
  assert.equal(paymentProgress({ totalAmount: .3, amountPaid: .1 + .2 }).fullyPaid, true);
  const almost = paymentProgress({ totalAmount: 10000, amountPaid: 9999.99 });
  assert.equal(almost.fullyPaid, false);
  assert.equal(almost.balance, .01);
  assert.equal(almost.percent, 99.99);
});
test('unpaid and zero-total orders are never called paid in full', () => {
  for (const totalAmount of [0, 2]) {
    assert.equal(paymentProgress({ totalAmount, amountPaid: 0 }).label, 'Awaiting payment');
  }
});
