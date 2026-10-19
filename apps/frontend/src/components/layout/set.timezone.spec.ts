import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  newDayjs,
  fromUtc,
  setUserTimezone,
  getTimezone,
  browserTimezone,
  toPickerDate,
} from './set.timezone';

afterEach(() => setUserTimezone(null));
test('saved timezone converts UTC without changing the published instant', () => {
  setUserTimezone('America/Sao_Paulo');
  const date = fromUtc('2026-10-19T16:00:00Z');
  assert.equal(date.format('YYYY-MM-DD HH:mm'), '2026-10-19 13:00');
  assert.equal(date.utc().toISOString(), '2026-10-19T16:00:00.000Z');
  assert.equal(newDayjs('2026-10-19 13:00').toISOString(), date.toISOString());
  assert.equal(date.local().hour(), 13);
  assert.equal(toPickerDate(date).getHours(), 13);
});
test('DST skipped wall times advance and repeated times use the earlier instant', () => {
  setUserTimezone('America/New_York');
  assert.equal(newDayjs('2026-03-08 02:30').format('HH:mm'), '03:30');
  assert.equal(
    newDayjs('2026-11-01 01:30').toISOString(),
    '2026-11-01T05:30:00.000Z'
  );
  assert.equal(
    fromUtc('2026-11-01T06:30:00Z').clone().toISOString(),
    '2026-11-01T06:30:00.000Z'
  );
});
test('calendar day arithmetic respects DST and elapsed hours preserve instants', () => {
  setUserTimezone('America/New_York');
  const before = newDayjs('2026-03-07 12:00');
  assert.equal(before.add(1, 'day').diff(before, 'hour'), 23);
  assert.equal(before.add(24, 'hour').format('HH:mm'), '13:00');
  assert.equal(before.add(1, 'day').format('HH:mm'), '12:00');
});
test('invalid or automatic timezone falls back without changing plain dayjs', () => {
  setUserTimezone('invalid/timezone');
  assert.equal(getTimezone(), browserTimezone());
  setUserTimezone('America/Sao_Paulo');
  assert.equal(dayjs.utc('2026-10-19T16:00:00Z').hour(), 16);
  assert.equal(fromUtc('not-a-date').isValid(), false);
});
