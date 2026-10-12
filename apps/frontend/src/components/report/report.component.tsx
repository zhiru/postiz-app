'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { ChartSocial } from '@gitroom/frontend/components/analytics/chart-social';
import { TrendIndicator } from '@gitroom/frontend/components/platform-analytics/render.analytics';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';

interface ReportTotals {
  [column: string]: number;
}

interface ReportChannel {
  id: string;
  name: string;
  providerIdentifier: string;
  picture?: string | null;
  totals: ReportTotals;
  series: Array<{ date: string; totals: ReportTotals }>;
}

interface Report {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  columns: string[];
  totals: ReportTotals;
  previousTotals: ReportTotals;
  percentageChange: ReportTotals;
  series: Array<{ date: string; totals: ReportTotals }>;
  channels: ReportChannel[];
}

const chartColors = ['purple', 'green', 'blue'] as const;

const useReportChannels = () => {
  const fetch = useFetch();

  return useSWR(
    'report-channels',
    async () => {
      const { integrations } = await (await fetch('/integrations/list')).json();

      return (integrations || []).filter((integration: any) => !integration.refreshNeeded);
    },
    { revalidateOnFocus: false, fallbackData: [] }
  );
};

const useReport = (query: string) => {
  const fetch = useFetch();

  return useSWR<Report>(
    `/analytics/report?${query}`,
    async (url: string) => (await fetch(url)).json(),
    { revalidateOnFocus: false }
  );
};

const MetricCard: FC<{
  column: string;
  label: string;
  report: Report;
  index: number;
}> = ({ column, label, report, index }) => {
  const series = useMemo(
    () =>
      report.series.map((point) => ({
        date: point.date,
        total: point.totals[column] || 0,
      })),
    [report, column]
  );

  return (
    <div className="flex flex-col bg-newTableHeader border border-newTableBorder rounded-[12px] overflow-hidden">
      <div className="flex items-center justify-between px-[16px] pt-[14px] pb-[8px]">
        <div className="text-[14px] text-textColor">{label}</div>
        <TrendIndicator value={report.percentageChange[column] || 0} />
      </div>
      <div className="px-[16px] pb-[8px] text-[28px] font-[600] text-textColor">
        {(report.totals[column] || 0).toLocaleString()}
      </div>
      <div className="h-[90px]">
        <ChartSocial
          data={series as any}
          color={chartColors[index % chartColors.length]}
        />
      </div>
    </div>
  );
};

export const ReportComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();

  const [from, setFrom] = useState(
    dayjs().subtract(29, 'day').format('YYYY-MM-DD')
  );
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { data: channels } = useReportChannels();

  const query = useMemo(
    () =>
      new URLSearchParams({
        from,
        to,
        ...(selected.length ? { integrations: selected.join(',') } : {}),
      }).toString(),
    [from, to, selected]
  );

  const { data: report, isLoading, mutate } = useReport(query);

  const labels: Record<string, string> = {
    followers: t('report_followers', 'Followers'),
    followersGained: t('report_followers_gained', 'Followers gained'),
    reach: t('report_reach', 'Reach'),
    engagement: t('report_engagement', 'Engagement'),
    postsPublished: t('report_posts_published', 'Posts published'),
  };

  const toggle = useCallback((id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }, []);

  const exportCsv = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`/analytics/report?${query}&format=csv`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `postiz-report-${from}-${to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }, [query, from, to]);

  const backfill = useCallback(async () => {
    const ids = selected.length
      ? selected
      : (report?.channels || []).map((channel) => channel.id);

    setBusy(true);
    try {
      for (const id of ids) {
        await fetch(`/analytics/report/backfill?integration=${id}&days=30`, {
          method: 'POST',
        });
      }
      await mutate();
      toaster.show(
        t('report_backfill_done', 'History filled for the selected channels'),
        'success'
      );
    } finally {
      setBusy(false);
    }
  }, [selected, report, mutate]);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-end gap-[16px] bg-newBgColorInner p-[16px] rounded-[12px]">
        <label className="flex flex-col gap-[6px] text-[13px] text-textColor">
          {t('report_from', 'From')}
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className="bg-newTableHeader border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-textColor"
          />
        </label>
        <label className="flex flex-col gap-[6px] text-[13px] text-textColor">
          {t('report_to', 'To')}
          <input
            type="date"
            value={to}
            min={from}
            max={dayjs().format('YYYY-MM-DD')}
            onChange={(event) => setTo(event.target.value)}
            className="bg-newTableHeader border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-textColor"
          />
        </label>
        <div className="flex-1 min-w-[200px]" />
        <Button onClick={exportCsv} loading={busy}>
          {t('report_export_csv', 'Export CSV')}
        </Button>
        <Button secondary={true} onClick={backfill} loading={busy}>
          {t('report_backfill', 'Fill history')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-[12px] bg-newBgColorInner p-[16px] rounded-[12px]">
        {(channels || []).map((channel: any) => (
          <div
            key={channel.id}
            className={clsx(
              'flex items-center gap-[8px] px-[12px] py-[8px] rounded-[8px] border',
              selected.includes(channel.id)
                ? 'border-[#612bd3]'
                : 'border-newTableBorder'
            )}
          >
            <Checkbox
              disableForm={true}
              checked={selected.includes(channel.id)}
              onChange={() => toggle(channel.id)}
            />
            <span className="text-[13px] text-textColor">{channel.name}</span>
          </div>
        ))}
        {!channels?.length && (
          <div className="text-[13px] text-textColor">
            {t('report_no_channels', 'No channels connected yet')}
          </div>
        )}
      </div>

      {isLoading || !report ? (
        <LoadingComponent />
      ) : (
        <>
          <div className="text-[13px] text-textColor">
            {t('report_compared_to', 'Compared to')} {report.previousFrom} -{' '}
            {report.previousTo}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-[16px]">
            {report.columns.map((column, index) => (
              <MetricCard
                key={column}
                column={column}
                label={labels[column] || column}
                report={report}
                index={index}
              />
            ))}
          </div>

          <div className="bg-newBgColorInner rounded-[12px] overflow-x-auto">
            <table className="w-full text-[13px] text-textColor">
              <thead>
                <tr className="bg-newTableHeader">
                  <th className="text-start p-[12px]">
                    {t('report_channel', 'Channel')}
                  </th>
                  {report.columns.map((column) => (
                    <th key={column} className="text-end p-[12px]">
                      {labels[column] || column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.channels.map((channel) => (
                  <tr key={channel.id} className="border-t border-newTableBorder">
                    <td className="p-[12px]">{channel.name}</td>
                    {report.columns.map((column) => (
                      <td key={column} className="text-end p-[12px]">
                        {(channel.totals[column] || 0).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
