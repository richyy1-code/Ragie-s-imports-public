import assert from 'node:assert/strict';
import test from 'node:test';
import { date, shortDate } from './dates';

test('the chosen arrival day is preserved in Ghana and ahead/behind UTC timezones', () => {
  const original = process.env.TZ;
  try {
    for (const timezone of ['Africa/Accra', 'America/New_York', 'Pacific/Honolulu', 'Pacific/Kiritimati', 'UTC']) {
      process.env.TZ = timezone;
      assert.equal(date('2026-10-20'), '20 Oct 2026', timezone);
      assert.equal(shortDate('2026-10-20'), '20 Oct', timezone);
      assert.equal(date('2026-11-01'), '1 Nov 2026', timezone);
      assert.equal(date('2027-01-01'), '1 Jan 2027', timezone);
      assert.equal(date('2028-02-29'), '29 Feb 2028', timezone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('reproduces the previous off-by-one and confirms the calendar-date fix', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(new Intl.DateTimeFormat('en-GH', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date('2026-10-20')), '19 Oct 2026');
    assert.equal(date('2026-10-20'), '20 Oct 2026');
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('real creation timestamps retain their existing local-timezone display', () => {
  const timestamp = '2026-10-20T00:30:00.000Z';
  assert.equal(date(timestamp), new Intl.DateTimeFormat('en-GH', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(timestamp)));
});

test('unset arrival dates remain empty placeholders', () => {
  assert.equal(date(null), '—');
  assert.equal(date(undefined), '—');
  assert.equal(shortDate(''), '—');
});
