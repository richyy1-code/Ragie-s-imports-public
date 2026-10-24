import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartOwner, cartStorageKey, enterCartOwner, legacyCartKey, readCart, writeCart } from './cart-session';
import type { CartItem } from './cart-session';

function storage(): Storage {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); }, clear: () => data.clear(),
    get length() { return data.size; }, key: (index) => [...data.keys()][index] ?? null };
}
const sample = [{ product: { id: 1, name: 'Test goods', price: 10, variants: [], colors: [], sizes: [] }, quantity: 2, color: null, size: null, variantType: null }] as CartItem[];
test('loading auth never masquerades as a guest; user and session changes produce different owners', () => {
  assert.equal(cartOwner({ isLoaded: false, isSignedIn: false }), null);
  assert.equal(cartOwner({ isLoaded: true }), null);
  assert.equal(cartOwner({ isLoaded: true, isSignedIn: true, userId: 'one' }), null);
  assert.equal(cartOwner({ isLoaded: true, isSignedIn: false }), 'guest');
  assert.notEqual(cartOwner({ isLoaded: true, isSignedIn: true, userId: 'one', sessionId: 'a' }),
    cartOwner({ isLoaded: true, isSignedIn: true, userId: 'two', sessionId: 'a' }));
  assert.notEqual(cartOwner({ isLoaded: true, isSignedIn: true, userId: 'one', sessionId: 'a' }),
    cartOwner({ isLoaded: true, isSignedIn: true, userId: 'one', sessionId: 'b' }));
});
test('guest shopping survives reload and transfers once on sign-in', () => {
  const store = storage();
  writeCart(store, 'guest', sample);
  assert.deepEqual(enterCartOwner(store, null, 'guest'), sample);
  assert.deepEqual(enterCartOwner(store, 'guest', 'user:A:session:S'), sample);
  assert.deepEqual(readCart(store, 'guest'), []);
  assert.deepEqual(enterCartOwner(store, null, 'user:A:session:S'), sample);
});
test('logout and account switching never copy the previous user cart', () => {
  const store = storage();
  writeCart(store, 'user:A:session:S', sample);
  assert.deepEqual(enterCartOwner(store, 'user:A:session:S', 'guest'), []);
  assert.equal(store.getItem(cartStorageKey('user:A:session:S')), null);
  writeCart(store, 'user:A:session:S', sample);
  assert.deepEqual(enterCartOwner(store, 'user:A:session:S', 'user:B:session:T'), []);
  assert.deepEqual(readCart(store, 'user:A:session:S'), []);
});
test('legacy unowned carts and malformed stored items are not displayed', () => {
  const store = storage();
  store.setItem(legacyCartKey, JSON.stringify(sample));
  assert.deepEqual(enterCartOwner(store, null, 'guest'), []);
  assert.equal(store.getItem(legacyCartKey), null);
  for (const raw of ['null', '{}', '{invalid', '[{"quantity":2}]', JSON.stringify([{ ...sample[0], quantity: -1 }])]) {
    store.setItem(cartStorageKey('guest'), raw);
    assert.deepEqual(readCart(store, 'guest'), []);
  }
  assert.deepEqual(readCart({ getItem: () => { throw new Error('Storage disabled'); } }, 'guest'), []);
  assert.doesNotThrow(() => writeCart({ setItem: () => { throw new Error('Full'); } }, 'guest', sample));
});
