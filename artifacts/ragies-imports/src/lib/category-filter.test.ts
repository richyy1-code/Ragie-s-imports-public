import test from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryFromSearch, retainAvailableCategory, shopLocationWithCategory,
} from './category-filter';

test('keeps a selected category while current category data is unavailable or still contains it', () => {
  assert.equal(retainAvailableCategory('bags', undefined), 'bags');
  assert.equal(retainAvailableCategory('bags', [{ slug: 'bags' }, { slug: 'shoes' }]), 'bags');
});

test('clears the selected filter when refreshed categories no longer contain it', () => {
  assert.equal(retainAvailableCategory('bags', [{ slug: 'shoes' }]), '');
  assert.equal(retainAvailableCategory('bags', []), '');
  assert.equal(retainAvailableCategory('', []), '');
});

test('reads category links and preserves other query parameters while changing filters', () => {
  assert.equal(categoryFromSearch('?category=hand-bags&source=home'), 'hand-bags');
  assert.equal(categoryFromSearch(''), '');
  assert.equal(
    shopLocationWithCategory('/shop', '?source=home&category=old', 'hand bags'),
    '/shop?source=home&category=hand+bags',
  );
  assert.equal(shopLocationWithCategory('/shop', '?source=home&category=old', ''), '/shop?source=home');
});
