import assert from 'node:assert/strict';
import test from 'node:test';
import { money } from './money';

test('a GHS 1.60 deposit never looks like its GHS 2.00 full price', () => {
  assert.match(money(1.6), /1\.60$/);
  assert.match(money(2), /2\.00$/);
  assert.match(money(.4), /0\.40$/);
  assert.notEqual(money(1.6), money(2));
});
test('money retains fractional and zero balances consistently', () => {
  assert.match(money(85.25), /85\.25$/);
  assert.match(money(.01), /0\.01$/);
  assert.match(money(0), /0\.00$/);
});
