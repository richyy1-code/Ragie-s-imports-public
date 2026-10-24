import assert from 'node:assert/strict';
import test from 'node:test';
import { CreateProductBody, UpdateProductBody, CreateShipmentBody } from '@workspace/api-zod';

test('product management rejects negative stock and invalid sale prices', () => {
  const product = { name: 'Synthetic product', category: 'Test', description: 'Test', price: 10, availability: 'ghana-stock', stockQuantity: 2 };
  assert.equal(CreateProductBody.safeParse(product).success, true);
  for (const price of [-1, 0]) {
    assert.equal(CreateProductBody.safeParse({ ...product, price }).success, false);
    assert.equal(UpdateProductBody.safeParse({ price }).success, false);
  }
  assert.equal(UpdateProductBody.safeParse({ stockQuantity: -1 }).success, false);
  assert.equal(UpdateProductBody.safeParse({ stockQuantity: 0 }).success, true);
});
test('negative shipping fees are rejected at the API boundary', () => {
  assert.equal(CreateShipmentBody.safeParse({
    name: 'Synthetic batch', expectedArrival: '2026-12-01',
    productFees: [{ productId: 1, productName: 'Synthetic product', feePerItem: -1 }],
  }).success, false);
});
