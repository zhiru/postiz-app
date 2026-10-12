// Run: npx tsx --test libraries/nestjs-libraries/src/integrations/social/analytics.trend.spec.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { percentageChange, withTrend } from './analytics.trend.ts';

const series = (label: string, ...totals: Array<number | string>) => ({
  label,
  percentageChange: 0,
  data: totals.map((total, index) => ({
    total: total as any,
    date: `2026-01-0${index + 1}`,
  })),
});

test('percentageChange returns the period over period change', () => {
  assert.equal(percentageChange(150, 100), 50);
  assert.equal(percentageChange(50, 100), -50);
  assert.equal(percentageChange(100, 100), 0);
});

test('percentageChange rounds to the single decimal the UI renders', () => {
  assert.equal(percentageChange(1234, 1000), 23.4);
  assert.equal(percentageChange(1000, 3000), -66.7);
});

test('percentageChange does not divide by zero', () => {
  assert.equal(percentageChange(500, 0), 0);
  assert.equal(percentageChange(0, 0), 0);
});

test('withTrend compares the summed totals of both periods', async () => {
  const result = await withTrend(
    [series('Page Impressions', 10, 20, 30)],
    async () => [series('Page Impressions', 10, 10, 10)]
  );

  assert.equal(result[0].percentageChange, 100);
  assert.equal(result[0].data.length, 3);
});

test('withTrend sums totals that arrive as strings', async () => {
  const result = await withTrend(
    [series('Clicks', '30', '30')],
    async () => [series('Clicks', '20', '20')]
  );

  assert.equal(result[0].percentageChange, 50);
});

test('withTrend pairs periods by label and ignores the rest', async () => {
  const result = await withTrend(
    [series('Reach', 200), series('Follower Count', 10)],
    async () => [series('Follower Count', 5), series('Reach', 100)]
  );

  assert.deepEqual(
    result.map((item) => [item.label, item.percentageChange]),
    [
      ['Reach', 100],
      ['Follower Count', 100],
    ]
  );
});

test('a label missing from the previous period is uncomputable, not -100%', async () => {
  const result = await withTrend([series('Saves', 7)], async () => [
    series('Reach', 7),
  ]);

  assert.equal(result[0].percentageChange, 0);
});

test('an empty previous period leaves every label without a trend', async () => {
  const result = await withTrend(
    [series('Views', 10), series('Likes', 2)],
    async () => []
  );

  assert.deepEqual(
    result.map((item) => item.percentageChange),
    [0, 0]
  );
});

test('a previous period that is all zeroes does not divide by zero', async () => {
  const result = await withTrend([series('Replies', 4)], async () => [
    series('Replies', 0, 0),
  ]);

  assert.equal(result[0].percentageChange, 0);
});

test('a failing previous period never costs the current period', async () => {
  const result = await withTrend([series('Page Views', 42)], async () => {
    throw new Error('(#100) The period is outside the retention window');
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].data[0].total, 42);
  assert.equal(result[0].percentageChange, 0);
});

test('the current period is loaded before the previous one is even requested', async () => {
  // The caller awaits the current period as an argument, so a provider error on
  // it still propagates to checkAnalytics instead of being swallowed here.
  let requested = false;
  await assert.rejects(
    (async () =>
      withTrend(
        await (async () => {
          throw new Error('current period failed');
        })(),
        async () => {
          requested = true;
          return [];
        }
      ))(),
    /current period failed/
  );
  assert.equal(requested, false);
});
