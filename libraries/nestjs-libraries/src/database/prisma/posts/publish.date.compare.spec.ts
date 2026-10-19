// Run: npx tsx --test libraries/nestjs-libraries/src/database/prisma/posts/publish.date.compare.spec.ts
//
// PostsService.createPost skips startWorkflow when the publish time did not
// move, comparing the stored `publishDate` against the incoming date with
// `dayjs(a).isSame(dayjs(b), 'minute')`. The repository stores that same
// incoming date as `dayjs(date).toDate()`. If the two ever parse differently,
// an edit that really moved the post would be read as "unchanged", the
// workflow would not be restarted and the post would fire at the old time.
// These tests pin that both sides agree on every date shape the callers send.
import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';

// what posts.repository.ts does when writing the row
const store = (date: string) => dayjs(date).toDate();

// what posts.service.ts does when deciding publishTimeUnchanged
const unchanged = (stored: Date, incoming: string) =>
  dayjs(stored).isSame(dayjs(incoming), 'minute');

test('a date round-trips through the repository as unchanged', () => {
  for (const date of [
    '2026-07-20T10:30:00', // dashboard / `type: now` format
    '2026-07-20T10:30:00.000Z', // public API ISO with zone
    '2026-07-20T10:30:00+02:00', // public API ISO with offset
  ]) {
    assert.equal(unchanged(store(date), date), true, date);
  }
});

test('seconds inside the same minute still count as unchanged', () => {
  assert.equal(
    unchanged(store('2026-07-20T10:30:00'), '2026-07-20T10:30:59'),
    true
  );
});

test('a real time change is detected', () => {
  const stored = store('2026-07-20T10:30:00');
  assert.equal(unchanged(stored, '2026-07-20T10:31:00'), false);
  assert.equal(unchanged(stored, '2026-07-21T10:30:00'), false);
});

test('the same instant written with a different offset is unchanged', () => {
  // the public API may send the same moment as UTC or as a local offset
  assert.equal(
    unchanged(store('2026-07-20T10:30:00Z'), '2026-07-20T12:30:00+02:00'),
    true
  );
});
