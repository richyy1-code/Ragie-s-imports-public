import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumePaystackReturnPending,
  markPaystackReturnPending,
  PAYSTACK_RETURN_PENDING_KEY,
} from './paystack-return';

test('a Paystack redirect return marker is consumed only once', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };

  assert.equal(consumePaystackReturnPending(storage), false);
  markPaystackReturnPending(storage);
  assert.equal(values.get(PAYSTACK_RETURN_PENDING_KEY), '1');
  assert.equal(consumePaystackReturnPending(storage), true);
  assert.equal(consumePaystackReturnPending(storage), false);
});

test('leaving for Paystack must not consume the flag before the customer returns', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  markPaystackReturnPending(storage);
  assert.equal(consumePaystackReturnPending(storage, 'hidden'), false);
  assert.equal(values.get(PAYSTACK_RETURN_PENDING_KEY), '1');
  assert.equal(consumePaystackReturnPending(storage, 'visible'), true);
  assert.equal(consumePaystackReturnPending(storage, 'visible'), false);
});
