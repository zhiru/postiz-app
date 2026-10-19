// Run: npx tsx --test libraries/nestjs-libraries/src/database/prisma/analytics/report.aggregate.spec.ts
import dayjs from 'dayjs';
import {
  AnalyticsData,
  ReportMetric,
  ReportMetricsMap,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

// postsPublished is not reported by any provider, it is counted from our own
// Post table, so it lives next to the provider metrics but is never collected.
export type ReportColumn = ReportMetric | 'postsPublished';

// Period over period change, rounded to the single decimal the UI renders. A
// previous period of zero is not a 100% rise, it is simply not computable.
export const percentageChange = (current: number, previous: number): number =>
  !previous ? 0 : Math.round(((current - previous) / previous) * 1000) / 10;

export const REPORT_COLUMNS: ReportColumn[] = [
  'followers',
  'followersGained',
  'reach',
  'engagement',
  'postsPublished',
];

// `followers` is a running total: the value of the last day in the period is
// the period's value. Every other column is a per day amount, so it is summed.
const STOCK_COLUMNS: ReportColumn[] = ['followers'];

export interface ReportDataPoint {
  integrationId: string;
  date: string; // YYYY-MM-DD
  metric: ReportColumn;
  value: number;
}

export interface ReportChannel {
  id: string;
  name: string;
  providerIdentifier: string;
  picture?: string | null;
}

export type ReportTotals = Record<ReportColumn, number>;

export interface ReportSeriesPoint {
  date: string;
  totals: ReportTotals;
}

export interface ReportChannelResult extends ReportChannel {
  totals: ReportTotals;
  series: ReportSeriesPoint[];
}

export interface Report {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  columns: ReportColumn[];
  totals: ReportTotals;
  previousTotals: ReportTotals;
  percentageChange: ReportTotals;
  series: ReportSeriesPoint[];
  channels: ReportChannelResult[];
}

const emptyTotals = (): ReportTotals =>
  REPORT_COLUMNS.reduce(
    (all, column) => ({ ...all, [column]: 0 }),
    {} as ReportTotals
  );

export const listDays = (from: string, to: string): string[] => {
  const days: string[] = [];
  const last = dayjs(to);
  for (
    let current = dayjs(from);
    !current.isAfter(last, 'day');
    current = current.add(1, 'day')
  ) {
    days.push(current.format('YYYY-MM-DD'));
  }

  return days;
};

// The period immediately before [from, to], of exactly the same length.
export const previousPeriod = (from: string, to: string) => {
  const length = listDays(from, to).length;

  return {
    previousFrom: dayjs(from).subtract(length, 'day').format('YYYY-MM-DD'),
    previousTo: dayjs(to).subtract(length, 'day').format('YYYY-MM-DD'),
  };
};

const aggregate = (points: ReportDataPoint[], column: ReportColumn): number => {
  const matching = points.filter((point) => point.metric === column);
  if (!matching.length) {
    return 0;
  }

  if (STOCK_COLUMNS.includes(column)) {
    return matching.reduce((latest, point) =>
      point.date > latest.date ? point : latest
    ).value;
  }

  return matching.reduce((total, point) => total + point.value, 0);
};

const totalsOf = (points: ReportDataPoint[]): ReportTotals =>
  REPORT_COLUMNS.reduce(
    (all, column) => ({ ...all, [column]: aggregate(points, column) }),
    {} as ReportTotals
  );

const sumTotals = (list: ReportTotals[]): ReportTotals =>
  REPORT_COLUMNS.reduce(
    (all, column) => ({
      ...all,
      [column]: list.reduce((total, totals) => total + (totals[column] || 0), 0),
    }),
    {} as ReportTotals
  );

export const buildReport = ({
  from,
  to,
  channels,
  points,
  previousPoints,
}: {
  from: string;
  to: string;
  channels: ReportChannel[];
  points: ReportDataPoint[];
  previousPoints: ReportDataPoint[];
}): Report => {
  const days = listDays(from, to);
  const { previousFrom, previousTo } = previousPeriod(from, to);

  const channelResults: ReportChannelResult[] = channels.map((channel) => {
    const own = points.filter((point) => point.integrationId === channel.id);

    return {
      ...channel,
      totals: totalsOf(own),
      series: days.map((date) => ({
        date,
        totals: totalsOf(own.filter((point) => point.date === date)),
      })),
    };
  });

  // Totals are summed across channels even for `followers`, where each channel
  // already collapsed its own period down to its latest snapshot first.
  const totals = sumTotals(channelResults.map((channel) => channel.totals));
  const previousTotals = sumTotals(
    channels.map((channel) =>
      totalsOf(
        previousPoints.filter((point) => point.integrationId === channel.id)
      )
    )
  );

  return {
    from,
    to,
    previousFrom,
    previousTo,
    columns: REPORT_COLUMNS,
    totals,
    previousTotals,
    percentageChange: REPORT_COLUMNS.reduce(
      (all, column) => ({
        ...all,
        [column]: percentageChange(totals[column], previousTotals[column]),
      }),
      {} as ReportTotals
    ),
    series: days.map((date) => ({
      date,
      totals: sumTotals(
        channelResults.map(
          (channel) =>
            channel.series.find((point) => point.date === date)?.totals ||
            emptyTotals()
        )
      ),
    })),
    channels: channelResults,
  };
};

// Channel names come from the provider, so they are attacker reachable text in
// a file that spreadsheets happily execute. Anything that starts a formula is
// quoted and prefixed with a single quote, the usual neutralisation.
const csvCell = (value: string | number): string => {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const reportToCsv = (report: Report): string =>
  [
    ['date', 'channel', 'provider', ...report.columns],
    ...report.channels.flatMap((channel) =>
      channel.series.map((point) => [
        point.date,
        channel.name,
        channel.providerIdentifier,
        ...report.columns.map((column) => point.totals[column]),
      ])
    ),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');

// Translates one provider's analytics() output into canonical report points,
// using the label map that provider declared for itself. Nothing here knows
// which provider it is looking at.
//
// `allowSinglePoint` is the backfill guard: some providers answer a multi day
// window with a single aggregated value dated today (Instagram's total_value
// metrics, Threads' total_value branch, X). Storing that as one day's value
// would invent history, so a backfill drops it and only the daily collection,
// which asks for a single day at a time, keeps it.
export const toReportPoints = (
  integrationId: string,
  analytics: AnalyticsData[],
  reportMetrics: ReportMetricsMap = {},
  { allowSinglePoint }: { allowSinglePoint: boolean }
): ReportDataPoint[] => {
  const totals = new Map<string, number>();

  for (const [metric, labels] of Object.entries(reportMetrics)) {
    for (const series of analytics) {
      if (!labels?.includes(series.label)) {
        continue;
      }

      if (!allowSinglePoint && (series.data || []).length < 2) {
        continue;
      }

      for (const entry of series.data || []) {
        const value = Number(entry?.total);
        // A zero carries no information, and writing it would overwrite a real
        // value already collected for that day.
        if (!value || !Number.isFinite(value) || !entry?.date) {
          continue;
        }

        const key = `${metric}|${entry.date}`;
        totals.set(key, (totals.get(key) || 0) + value);
      }
    }
  }

  return [...totals.entries()].map(([key, value]) => {
    const [metric, date] = key.split('|');

    return {
      integrationId,
      date,
      metric: metric as ReportColumn,
      value,
    };
  });
};
