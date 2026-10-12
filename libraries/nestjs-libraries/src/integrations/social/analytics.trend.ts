// Run: node --test libraries/nestjs-libraries/src/integrations/social/analytics.trend.spec.ts
import { AnalyticsData } from './social.integrations.interface';

const sumTotals = (data: AnalyticsData['data']) =>
  (data || []).reduce((total, point) => total + (Number(point?.total) || 0), 0);

// Period-over-period change, in percent, rounded to the single decimal the
// frontend TrendIndicator renders. A previous period of zero (or missing) is
// not a 100% rise, it is simply not computable, and 0 makes TrendIndicator
// render nothing at all.
export const percentageChange = (current: number, previous: number): number => {
  if (!previous) {
    return 0;
  }

  return Math.round(((current - previous) / previous) * 1000) / 10;
};

// Attaches a real percentageChange to an already loaded period by comparing it
// against the same provider call over the preceding period of the same length.
// The previous period is best effort: older data can be outside the retention
// window of the API, and losing it must never cost the user the current period
// they actually asked for.
export const withTrend = async (
  current: AnalyticsData[],
  loadPrevious: () => Promise<AnalyticsData[]>
): Promise<AnalyticsData[]> => {
  const previous = await loadPrevious().catch(() => [] as AnalyticsData[]);
  const previousTotals = new Map(
    (previous || []).map((item) => [item.label, sumTotals(item.data)])
  );

  return current.map((item) => ({
    ...item,
    // A label the previous period never reported is uncomputable, not -100%.
    percentageChange: previousTotals.has(item.label)
      ? percentageChange(sumTotals(item.data), previousTotals.get(item.label)!)
      : 0,
  }));
};
