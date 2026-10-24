import test from 'node:test';
import assert from 'node:assert/strict';
import { contactPhoneValue } from './contact-phone-default';

test('untouched phone fields receive late profile defaults, while edits and clears survive refresh', () => {
  const draft = { ownerId: 'A', value: '', edited: false };
  assert.equal(contactPhoneValue(draft, 'A', undefined), '');
  assert.equal(contactPhoneValue(draft, 'A', '+233241234567'), '+233241234567');
  assert.equal(contactPhoneValue({ ...draft, value: '+447911123456', edited: true }, 'A', '+233241234567'), '+447911123456');
  assert.equal(contactPhoneValue({ ...draft, edited: true }, 'A', '+233241234567'), '');
});
test('previous identity drafts never become defaults for another identity or a guest', () => {
  const draft = { ownerId: 'A', value: '+233241234567', edited: true };
  assert.equal(contactPhoneValue(draft, 'B', null), '');
  assert.equal(contactPhoneValue(draft, 'B', '+254711123456'), '+254711123456');
  assert.equal(contactPhoneValue(draft, null, '+233241234567'), '');
  assert.equal(contactPhoneValue({ ownerId: null, value: '0241234567', edited: true }, null, null), '0241234567');
});
