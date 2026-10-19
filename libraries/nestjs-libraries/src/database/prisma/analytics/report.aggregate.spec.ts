// Run: npx tsx --test libraries/nestjs-libraries/src/database/prisma/analytics/report.aggregate.spec.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReport,
  listDays,
  percentageChange,
  previousPeriod,
  reportToCsv,
  toReportPoints,
  ReportDataPoint,
} from './report.aggregate.ts';

const channel = (id: string, name = id) => ({
  id,
  name,
  providerIdentifier: 'facebook',
  picture: null,
});

const point = (
  integrationId: string,
  date: string,
  metric: ReportDataPoint['metric'],
  value: number
): ReportDataPoint => ({ integrationId, date, metric, value });

test('listDays is inclusive on both ends', () => {
  assert.deepEqual(listDays('2026-03-01', '2026-03-03'), [
    '2026-03-01',
    '2026-03-02',
    '2026-03-03',
  ]);
  assert.deepEqual(listDays('2026-03-01', '2026-03-01'), ['2026-03-01']);
});

test('the previous period is the same length and ends the day before', () => {
  assert.deepEqual(previousPeriod('2026-03-08', '2026-03-14'), {
    previousFrom: '2026-03-01',
    previousTo: '2026-03-07',
  });
});

test('the previous period of a single day is the day before', () => {
  assert.deepEqual(previousPeriod('2026-03-08', '2026-03-08'), {
    previousFrom: '2026-03-07',
    previousTo: '2026-03-07',
  });
});

test('flow metrics are summed across days and across channels', () => {
  const report = buildReport({
    from: '2026-03-01',
    to: '2026-03-02',
    channels: [channel('a'), channel('b')],
    points: [
      point('a', '2026-03-01', 'reach', 10),
      point('a', '2026-03-02', 'reach', 15),
      point('b', '2026-03-01', 'reach', 5),
      point('a', '2026-03-01', 'engagement', 3),
    ],
    previousPoints: [],
  });

  assert.equal(report.totals.reach, 30);
  assert.equal(report.totals.engagement, 3);
  assert.equal(report.channels[0].totals.reach, 25);
  assert.equal(report.channels[1].totals.reach, 5);
});

test('followers is a snapshot: the last day of the period wins per channel', () => {
  const report = buildReport({
    from: '2026-03-01',
    to: '2026-03-03',
    channels: [channel('a'), channel('b')],
    points: [
      point('a', '2026-03-01', 'followers', 100),
      point('a', '2026-03-03', 'followers', 120),
      point('b', '2026-03-02', 'followers', 50),
    ],
    previousPoints: [],
  });

  // 120 (a's latest) + 50 (b's latest), never 100 + 120 + 50.
  assert.equal(report.totals.followers, 170);
});

test('a metric no channel reports stays at zero instead of disappearing', () => {
  const report = buildReport({
    from: '2026-03-01',
    to: '2026-03-01',
    channels: [channel('a')],
    points: [point('a', '2026-03-01', 'reach', 7)],
    previousPoints: [],
  });

  assert.equal(report.totals.followers, 0);
  assert.equal(report.totals.postsPublished, 0);
  assert.deepEqual(report.columns, [
    'followers',
    'followersGained',
    'reach',
    'engagement',
    'postsPublished',
  ]);
});

test('the daily series has one entry per day, zeroed on days with no data', () => {
  const report = buildReport({
    from: '2026-03-01',
    to: '2026-03-03',
    channels: [channel('a')],
    points: [point('a', '2026-03-03', 'reach', 9)],
    previousPoints: [],
  });

  assert.deepEqual(
    report.series.map((entry) => [entry.date, entry.totals.reach]),
    [
      ['2026-03-01', 0],
      ['2026-03-02', 0],
      ['2026-03-03', 9],
    ]
  );
});

test('points outside the selected channels are ignored', () => {
  const report = buildReport({
    from: '2026-03-01',
    to: '2026-03-01',
    channels: [channel('a')],
    points: [
      point('a', '2026-03-01', 'reach', 10),
      point('z', '2026-03-01', 'reach', 999),
    ],
    previousPoints: [],
  });

  assert.equal(report.totals.reach, 10);
});

test('the comparison uses the previous period totals', () => {
  const report = buildReport({
    from: '2026-03-08',
    to: '2026-03-14',
    channels: [channel('a')],
    points: [point('a', '2026-03-10', 'reach', 150)],
    previousPoints: [point('a', '2026-03-03', 'reach', 100)],
  });

  assert.equal(report.previousFrom, '2026-03-01');
  assert.equal(report.previousTo, '2026-03-07');
  assert.equal(report.previousTotals.reach, 100);
  assert.equal(report.percentageChange.reach, 50);
});

test('an empty previous period yields no change instead of dividing by zero', () => {
  const report = buildReport({
    from: '2026-03-08',
    to: '2026-03-14',
    channels: [channel('a')],
    points: [point('a', '2026-03-10', 'reach', 150)],
    previousPoints: [],
  });

  assert.equal(report.percentageChange.reach, 0);
  assert.equal(percentageChange(150, 0), 0);
});

test('a decline is reported as a negative change', () => {
  const report = buildReport({
    from: '2026-03-08',
    to: '2026-03-14',
    channels: [channel('a')],
    points: [point('a', '2026-03-10', 'engagement', 40)],
    previousPoints: [point('a', '2026-03-03', 'engagement', 100)],
  });

  assert.equal(report.percentageChange.engagement, -60);
});

test('the csv has a header and one row per channel per day', () => {
  const report = buildReport({
    from: '2026-03-01',
    to: '2026-03-02',
    channels: [channel('a', 'Main page'), channel('b', 'Second page')],
    points: [point('a', '2026-03-02', 'reach', 12)],
    previousPoints: [],
  });

  const lines = reportToCsv(report).split('\n');
  assert.equal(
    lines[0],
    'date,channel,provider,followers,followersGained,reach,engagement,postsPublished'
  );
  assert.equal(lines.length, 5);
  assert.equal(lines[2], '2026-03-02,Main page,facebook,0,0,12,0,0');
});

test('a channel name that would run as a formula is neutralised', () => {
  const report = buildReport({
    from: '2026-03-01',
    to: '2026-03-01',
    channels: [channel('a', '=HYPERLINK("http://evil","click")')],
    points: [],
    previousPoints: [],
  });

  const row = reportToCsv(report).split('\n')[1];
  assert.ok(row.includes(`"'=HYPERLINK(""http://evil"",""click"")"`));
});

test('a channel name with a comma or a quote stays in one column', () => {
  const report = buildReport({
    from: '2026-03-01',
    to: '2026-03-01',
    channels: [channel('a', 'Acme, Inc. "HQ"')],
    points: [],
    previousPoints: [],
  });

  const row = reportToCsv(report).split('\n')[1];
  assert.equal(row, '2026-03-01,"Acme, Inc. ""HQ""",facebook,0,0,0,0,0');
});

const series = (label: string, points: Array<[string, number | string]>) => ({
  label,
  percentageChange: 0,
  data: points.map(([date, total]) => ({ total: total as any, date })),
});

test('provider labels are translated into canonical metrics', () => {
  const points = toReportPoints(
    'a',
    [
      series('Page Impressions', [
        ['2026-03-01', 10],
        ['2026-03-02', 20],
      ]),
      series('Posts Engagement', [
        ['2026-03-01', 3],
        ['2026-03-02', 4],
      ]),
      series('Something else', [
        ['2026-03-01', 99],
        ['2026-03-02', 99],
      ]),
    ],
    {
      reach: ['Page Impressions'],
      engagement: ['Posts Engagement'],
    },
    { allowSinglePoint: false }
  );

  assert.deepEqual(
    points.sort((a, b) => `${a.metric}${a.date}`.localeCompare(`${b.metric}${b.date}`)),
    [
      { integrationId: 'a', date: '2026-03-01', metric: 'engagement', value: 3 },
      { integrationId: 'a', date: '2026-03-02', metric: 'engagement', value: 4 },
      { integrationId: 'a', date: '2026-03-01', metric: 'reach', value: 10 },
      { integrationId: 'a', date: '2026-03-02', metric: 'reach', value: 20 },
    ]
  );
});

test('several labels feeding one metric are summed per day', () => {
  const points = toReportPoints(
    'a',
    [
      series('Likes', [
        ['2026-03-01', 5],
        ['2026-03-02', 1],
      ]),
      series('Comments', [
        ['2026-03-01', 2],
        ['2026-03-02', 1],
      ]),
    ],
    { engagement: ['Likes', 'Comments'] },
    { allowSinglePoint: false }
  );

  assert.deepEqual(
    points.map((entry) => [entry.date, entry.value]),
    [
      ['2026-03-01', 7],
      ['2026-03-02', 2],
    ]
  );
});

test('a provider with no mapping contributes nothing', () => {
  assert.deepEqual(
    toReportPoints('a', [series('Views', [['2026-03-01', 4]])], undefined, {
      allowSinglePoint: true,
    }),
    []
  );
});

test('backfill drops a window wide aggregate dated as a single day', () => {
  const analytics = [series('Views', [['2026-03-07', 900]])];

  assert.deepEqual(
    toReportPoints('a', analytics, { reach: ['Views'] }, {
      allowSinglePoint: false,
    }),
    []
  );
  assert.deepEqual(
    toReportPoints('a', analytics, { reach: ['Views'] }, {
      allowSinglePoint: true,
    }),
    [{ integrationId: 'a', date: '2026-03-07', metric: 'reach', value: 900 }]
  );
});

test('zero and non numeric points are never written', () => {
  const points = toReportPoints(
    'a',
    [
      series('IMPRESSION', [
        ['2026-03-01', 0],
        ['2026-03-02', 'not a number'],
        ['2026-03-03', '42'],
      ]),
    ],
    { reach: ['IMPRESSION'] },
    { allowSinglePoint: true }
  );

  assert.deepEqual(points, [
    { integrationId: 'a', date: '2026-03-03', metric: 'reach', value: 42 },
  ]);
});
