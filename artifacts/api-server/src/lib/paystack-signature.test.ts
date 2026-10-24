import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { validPaystackSignature } from './paystack-signature';

test('valid webhook signatures authenticate the exact raw body', () => {
  const body = Buffer.from('{"event":"charge.success"}');
  const signature = createHmac('sha512', 'synthetic-secret').update(body).digest('hex');
  assert.equal(validPaystackSignature(body, signature, 'synthetic-secret'), true);
  assert.equal(validPaystackSignature(Buffer.from('{}'), signature, 'synthetic-secret'), false);
});
test('malformed and multibyte signatures fail safely instead of throwing', () => {
  for (const signature of ['', 'a'.repeat(127), 'z'.repeat(128), 'é'.repeat(128)]) {
    assert.equal(validPaystackSignature(Buffer.from('{}'), signature, 'synthetic-secret'), false);
  }
});
