import assert from 'node:assert/strict';
import test from 'node:test';
import type { Product } from '@workspace/api-client-react';
import { buildOptionsPayload, buildRowsPayload, emptyOptionRow, optionsFromProduct, variantStock } from './product-options';

const product = (changes: Partial<Product>) => ({ variants: [], colors: [], sizes: [], stockQuantity: 0, ...changes }) as Product;

test('new optional rows default to zero and plain quantity needs no option labels', () => {
  assert.deepEqual(emptyOptionRow(), { sizeType: '', color: '', quantity: '0' });
  assert.deepEqual(buildRowsPayload([emptyOptionRow()]), { ok: true, data: { variants: [{ name: '', colors: [], quantities: [{ color: '', quantity: 0 }] }], sizes: [], colors: [], stockQuantity: 0 } });
  const result = buildRowsPayload([{ sizeType: '', color: '', quantity: '7' }, emptyOptionRow()]);
  assert.equal(result.ok && result.data.stockQuantity, 7);
  assert.equal(buildRowsPayload([{ ...emptyOptionRow(), quantity: '' }]).ok, true);
});

test('row totals support size only, colour only, both, and literal punctuation', () => {
  const result = buildRowsPayload([
    { sizeType: 'M: relaxed', color: '', quantity: '3' },
    { sizeType: '', color: 'Blue=navy, sky', quantity: '4' },
    { sizeType: 'L', color: 'Red', quantity: '2' }, emptyOptionRow(),
  ]);
  assert.ok(result.ok);
  assert.equal(result.data.stockQuantity, 9);
  assert.deepEqual(result.data.sizes, ['M: relaxed', 'L']);
  assert.deepEqual(result.data.colors, ['Blue=navy, sky', 'Red']);
  assert.equal(result.data.variants[0]!.quantities![0]!.color, '');
  assert.equal(result.data.variants[1]!.name, '');
  const saved = product(result.data);
  assert.equal(variantStock(saved, 'M: relaxed', null), 3);
  assert.equal(variantStock(saved, null, 'Blue=navy, sky'), 4);
  const rebuilt = buildOptionsPayload(optionsFromProduct(saved));
  assert.deepEqual(rebuilt, result);
});

test('rows reject negative, fractional, huge and repeated options without hiding errors', () => {
  for (const quantity of ['-1', '1.5', 'x', '2147483648']) assert.equal(buildRowsPayload([{ sizeType: 'M', color: '', quantity }]).ok, false);
  assert.equal(buildRowsPayload([{ sizeType: 'M', color: 'Red', quantity: '1' }, { sizeType: ' m ', color: ' red ', quantity: '2' }]).ok, false);
});

test('legacy shared stock is preserved until quantities are explicitly set', () => {
  const legacy = product({ variants: [], sizes: ['M', 'L'], colors: ['Red'], stockQuantity: 17 });
  const state = optionsFromProduct(legacy);
  const untouched = buildOptionsPayload(state);
  assert.equal(untouched.ok && untouched.data.stockQuantity, 17);
  assert.equal(state.legacySharedStock, 17);
  assert.equal(buildOptionsPayload({ ...state, rows: state.legacyRows }).ok, false);
  const changed = buildOptionsPayload({ ...state, rows: [{ sizeType: 'M', color: 'Red', quantity: '12' }, { sizeType: 'L', color: 'Red', quantity: '5' }], quantitiesConfirmed: true });
  assert.equal(changed.ok && changed.data.stockQuantity, 17);
});
