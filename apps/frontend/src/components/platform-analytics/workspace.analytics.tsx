'use client';
import { useState } from 'react';
import { fromUtc } from '../layout/set.timezone';
import useSWR from 'swr';
import { useDebounce } from 'use-debounce';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '../layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { PlatformIconBadge } from '../launches/helpers/platform-icon.helper';
import { Pagination } from '../ui/pagination';
import { useModals } from '../layout/new-modal';
import { PostPreviewFrame } from '../launches/calendar';
import { useProfilePermissions } from '../../hooks/use-profile-permissions';

type InsightPost = {
  id: string;
  content: string;
  publishDate: string;
  format: string;
  thumbnail: string | null;
  thumbnailVideo?: boolean;
  channelPicture: string | null;
  channelName: string;
  integrationId: string;
  platform: string;
  metrics: Record<string, number | null>;
  engagementRate: {
    value: number | null;
    formula: string | null;
    denominator?: string | null;
  };
  updatedAt: string | null;
  manualRefreshAfter?: string | null;
  status: string;
  source: string | null;
};
type InsightResult = {
  total: number;
  posts: InsightPost[];
  topReactions: InsightPost[];
  topComments: InsightPost[];
  summary: {
    availablePosts: number;
    metrics: Record<string, number | null>;
    coverage: Record<string, { known: number; total: number }>;
  };
  weekdays: number[];
  channels: Array<{ id: string; name: string; posts: number }>;
};
const useInsights = (path: string) => {
  const fetch = useFetch();
  const user = useUser();
  return useSWR(
    [`${user?.orgId}:${user?.profileId}:insights`, path],
    async () => {
      const response = await fetch(path);
      if (!response.ok)
        throw new Error(
          response.status === 400 ? 'NARROW_PERIOD' : 'UNAVAILABLE'
        );
      return response.json();
    },
    { refreshInterval: 60000, revalidateOnFocus: true }
  );
};
const count = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat().format(n);
const Thumb = ({ post }: { post: InsightPost }) => (
  <div className="relative h-12 w-12 shrink-0 rounded-lg overflow-hidden bg-newSettings">
    {post.thumbnail &&
      (/\.(mp4|mov|webm)(?:$|[?#])/i.test(post.thumbnail) ? (
        <video
          src={post.thumbnail}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          className="h-full w-full object-cover"
        />
      ) : (
        <SafeImage
          src={post.thumbnail}
          alt=""
          className="h-full w-full object-cover"
        />
      ))}
    <span className="absolute bottom-0 right-0">
      <PlatformIconBadge identifier={post.platform} />
    </span>
  </div>
);
const InsightHistory = ({ id }: { id: string }) => {
  const t = useT();
  const [cursor, setCursor] = useState('');
  const { data, error } = useInsights(
    `/analytics/posts/${encodeURIComponent(id)}${
      cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    }`
  );
  return (
    <div className="overflow-auto max-h-[65vh] space-y-3">
      <p>
        {t(
          'insights_history_note',
          'Observed snapshots, not interactions gained per day. Unknown values are shown as —.'
        )}
      </p>
      {error ? (
        <p role="alert">
          {t('insights_error', 'Could not load insights. Try again.')}
        </p>
      ) : !data ? (
        <p role="status">{t('loading', 'Loading…')}</p>
      ) : (
        <>
          <p>{data.post.content}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(
              data.post.metrics as Record<string, number | null>
            ).map(([key, value]) => (
              <div
                key={key}
                className="rounded-lg border border-newTableBorder p-3"
              >
                <p className="text-sm text-textItemBlur">
                  {t(`insights_${key}`, key)}
                </p>
                <p className="text-xl">{count(value)}</p>
                <p className="text-xs text-textItemBlur">
                  {data.post.metricCollectedAt?.[key]
                    ? fromUtc(data.post.metricCollectedAt[key]).format('L LT')
                    : '—'}
                </p>
              </div>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th>{t('insights_updated', 'Collected at')}</th>
                <th>{t('status', 'Status')}</th>
                <th>{t('insights_reactions', 'Reactions')}</th>
                <th>{t('insights_comments', 'Comments')}</th>
                <th>{t('insights_views', 'Views')}</th>
                <th>{t('insights_source', 'Source')}</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((s: any, i: number) => (
                <tr key={i} className="border-t border-newTableBorder">
                  <td>{fromUtc(s.capturedAt).format('L LT')}</td>
                  <td>{t(`insights_status_${s.status}`, String(s.status))}</td>
                  <td>{count(s.metrics.reactions)}</td>
                  <td>{count(s.metrics.comments)}</td>
                  <td>{count(s.metrics.views)}</td>
                  <td>{s.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.historyNextCursor && (
            <Button onClick={() => setCursor(data.historyNextCursor)}>
              {t('insights_older', 'Older observations')}
            </Button>
          )}
        </>
      )}
    </div>
  );
};
export const WorkspaceAnalytics = () => {
  const t = useT(),
    fetch = useFetch(),
    modal = useModals();
  const { canWrite } = useProfilePermissions();
  const [days, setDays] = useState('30'),
    [channel, setChannel] = useState(''),
    [format, setFormat] = useState('all'),
    [search, setSearch] = useState(''),
    [sort, setSort] = useState('reactions'),
    [page, setPage] = useState(0),
    [limit, setLimit] = useState(20),
    [ranking, setRanking] = useState('reactions'),
    [busy, setBusy] = useState(''),
    [notice, setNotice] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);
  const params = new URLSearchParams({
    date: days,
    integrationId: channel,
    format,
    q: debouncedSearch,
    sort,
    dir: 'desc',
    page: String(page),
    limit: String(limit),
  }).toString();
  const { data, error, isLoading, mutate } = useInsights(
    `/analytics/posts?${params}`
  ) as {
    data: InsightResult | undefined;
    error: Error | undefined;
    isLoading: boolean;
    mutate: () => Promise<any>;
  };
  const channels = useInsights('/integrations/list');
  const change =
    (setter: (value: string) => void) =>
    (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      setter(e.target.value);
      setPage(0);
    };
  const preview = (post: InsightPost) =>
    modal.openModal({
      title: t('preview_publication', 'View publication'),
      size: '80vw',
      height: '80vh',
      fullScreen: true,
      children: <PostPreviewFrame postId={post.id} share={canWrite} />,
    });
  const history = (post: InsightPost) =>
    modal.openModal({
      title: t('insights_history', 'Metrics history'),
      size: '80vw',
      height: '80vh',
      fullScreen: true,
      children: <InsightHistory id={post.id} />,
    });
  const refresh = async (post: InsightPost) => {
    setBusy(post.id);
    setNotice('');
    try {
      const r = await fetch(
        `/analytics/posts/${encodeURIComponent(post.id)}/refresh`,
        { method: 'POST' }
      );
      if (!r.ok) throw new Error();
      const result = await r.json();
      setNotice(
        result.status === 'available'
          ? t('insights_refreshed', 'Metrics updated.')
          : t(
              'insights_refresh_limited',
              'Collection completed or deferred. Check the status and last successful collection; unavailable metrics remain unknown.'
            )
      );
      await mutate();
    } catch {
      setNotice(t('insights_error', 'Could not load insights. Try again.'));
    } finally {
      setBusy('');
    }
  };
  const csv = async () => {
    try {
      const r = await fetch(`/analytics/posts/export?${params}`);
      if (!r.ok) throw new Error();
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'post-insights.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotice(t('insights_error', 'Could not load insights. Try again.'));
    }
  };
  const options =
    'rounded-lg bg-newSettings border border-newTableBorder px-3 py-2 focus-visible:ring-2 focus-visible:ring-btnPrimary';
  return (
    <section
      className="p-5 space-y-5 min-w-0"
      aria-label={t('insights_title', 'Post insights')}
    >
      <div>
        <h2 className="text-2xl font-semibold">
          {t('insights_title', 'Post insights')}
        </h2>
        <p className="text-sm text-textItemBlur mt-2">
          {t(
            'insights_scope_note',
            'Latest known totals for posts published in the selected period. Not interactions gained during the period. — means unknown, not zero.'
          )}
        </p>
        <p className="text-sm text-textItemBlur">
          {t(
            'insights_story_note',
            'Stories are collected while available on the network. Saved observations remain in history; expired metrics and media cannot be recovered retroactively.'
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <select
          className={options}
          aria-label={t('insights_period', 'Period')}
          value={days}
          onChange={change(setDays)}
        >
          {[1, 7, 30, 90, 366].map((d) => (
            <option key={d} value={d}>
              {d} {t('insights_days', 'days')}
            </option>
          ))}
        </select>
        <select
          className={options}
          aria-label={t('insights_channel', 'Channel')}
          value={channel}
          onChange={change(setChannel)}
        >
          <option value="">{t('insights_all_channels', 'All channels')}</option>
          {channels.data?.integrations?.map((i: any) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <select
          className={options}
          aria-label={t('post_format', 'Format')}
          value={format}
          onChange={change(setFormat)}
        >
          {[
            ['all', 'insights_all_formats', 'All formats'],
            ['post', 'insights_feed', 'Feed'],
            ['story', 'insights_stories', 'Stories'],
            ['video', 'insights_reels', 'Reels / videos'],
            ['carousel', 'insights_carousels', 'Carousels'],
          ].map(([value, key, label]) => (
            <option key={value} value={value}>
              {t(key, label)}
            </option>
          ))}
        </select>
        <input
          type="search"
          className={`${options} flex-1 min-w-[180px]`}
          aria-label={t('insights_search', 'Search posts')}
          placeholder={t('insights_search', 'Search posts')}
          value={search}
          onChange={change(setSearch)}
        />
        <select
          className={options}
          aria-label={t('insights_sort', 'Sort by')}
          value={sort}
          onChange={change(setSort)}
        >
          {[
            ['reactions', 'insights_reactions', 'Reactions'],
            ['insights_comments', 'comments', 'Comments'],
            ['views', 'insights_views', 'Views'],
            ['reach', 'insights_reach', 'Reach'],
            ['impressions', 'insights_impressions', 'Impressions'],
            ['engagement', 'insights_rate', 'Engagement rate'],
            ['published', 'insights_date', 'Publication date'],
          ].map(([v, k, l]) => (
            <option key={v} value={v}>
              {t(k, l)}
            </option>
          ))}
        </select>
        <Button onClick={csv}>{t('insights_export', 'Export CSV')}</Button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error ? (
        <p role="alert">
          {error.message === 'NARROW_PERIOD'
            ? t(
                'insights_narrow',
                'More than 5,000 posts: select a shorter period or one channel. No partial totals are shown.'
              )
            : t('insights_error', 'Could not load insights. Try again.')}
        </p>
      ) : isLoading ? (
        <p role="status">{t('loading', 'Loading…')}</p>
      ) : (
        data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {['reactions', 'comments', 'views', 'reach', 'impressions'].map(
                (k) => (
                  <div
                    key={k}
                    className="rounded-xl border border-newTableBorder bg-newBgColorInner p-4"
                  >
                    <p className="text-textItemBlur text-sm">
                      {t(`insights_${k}`, k)}
                    </p>
                    <p className="text-2xl font-semibold mt-2">
                      {count(data.summary.metrics[k])}
                    </p>
                    <p className="text-xs text-textItemBlur">
                      {data.summary.coverage[k].known}/{data.total}{' '}
                      {t('insights_known_posts', 'posts with data')}
                    </p>
                  </div>
                )
              )}
            </div>
            <div className="rounded-xl border border-newTableBorder p-4">
              <div className="flex justify-between items-center gap-3">
                <h3 className="font-semibold">
                  {t('insights_top', 'Top 4 posts')}
                </h3>
                <select
                  className={options}
                  aria-label={t('insights_ranking', 'Ranking metric')}
                  value={ranking}
                  onChange={(e) => setRanking(e.target.value)}
                >
                  <option value="reactions">
                    {t('insights_reactions', 'Reactions')}
                  </option>
                  <option value="comments">
                    {t('insights_comments', 'Comments')}
                  </option>
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
                {(ranking === 'reactions'
                  ? data.topReactions
                  : data.topComments
                ).map((post, i) => (
                  <button
                    type="button"
                    key={post.id}
                    onClick={() => preview(post)}
                    className="rounded-xl bg-newSettings p-3 text-start hover:bg-boxHover focus-visible:ring-2 focus-visible:ring-btnPrimary"
                  >
                    <div className="flex gap-3 items-center">
                      <Thumb post={post} />
                      <span className="font-semibold">
                        #{i + 1} · {count(post.metrics[ranking])}
                      </span>
                    </div>
                    <p className="line-clamp-2 mt-3 text-sm">{post.content}</p>
                    <p className="text-xs text-textItemBlur mt-2">
                      {post.channelName}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-newTableBorder p-4">
              <h3>{t('insights_posting_days', 'Posting days (UTC)')}</h3>
              <div className="flex items-end gap-3 h-28 mt-3">
                {data.weekdays.map((n, i) => (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center justify-end h-full gap-1 text-xs"
                  >
                    <span>{n}</span>
                    <div
                      className="w-full rounded bg-btnPrimary"
                      style={{
                        height: Math.max(
                          2,
                          (n / Math.max(1, ...data.weekdays)) * 65
                        ),
                      }}
                    />
                    <span>
                      {
                        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
                          (d, j) => t(`dow_${j}`, d)
                        )[i]
                      }
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-newTableBorder p-4">
              <h3>
                {t(
                  'insights_channels_distribution',
                  'Published posts by channel'
                )}
              </h3>
              <div className="space-y-3 mt-3">
                {data.channels.map((channel) => (
                  <div key={channel.id}>
                    <div className="flex justify-between text-sm">
                      <span>{channel.name}</span>
                      <span>{channel.posts}</span>
                    </div>
                    <div className="h-2 rounded bg-newSettings mt-1">
                      <div
                        className="h-full rounded bg-btnPrimary"
                        style={{
                          width: `${
                            data.total ? (channel.posts / data.total) * 100 : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-sm text-textItemBlur">
              {t(
                'insights_formula',
                'Engagement = (reactions + comments) ÷ reach × 100; falls back to impressions, then views. The denominator appears on each row. Missing numerator or denominator means unknown.'
              )}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-textItemBlur">
                  <tr>
                    {[
                      ['insights_post', 'Post'],
                      ['insights_date', 'Publication date'],
                      ['insights_reactions', 'Reactions'],
                      ['insights_comments', 'Comments'],
                      ['insights_views', 'Views'],
                      ['insights_impressions', 'Impressions'],
                      ['insights_rate', 'Engagement rate'],
                      ['insights_updated', 'Collected at'],
                      ['insights_actions', 'Actions'],
                    ].map(([k, l]) => (
                      <th key={k} className="text-start p-3">
                        {t(k, l)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.posts.map((post) => (
                    <tr
                      key={post.id}
                      className="border-t border-newTableBorder"
                    >
                      <td className="p-3">
                        <button
                          type="button"
                          className="flex items-center gap-3 text-start max-w-sm focus-visible:ring-2 focus-visible:ring-btnPrimary"
                          onClick={() => preview(post)}
                        >
                          <Thumb post={post} />
                          <span className="min-w-0">
                            <span className="line-clamp-2">
                              {post.content ||
                                t('insights_no_caption', 'No caption')}
                            </span>
                            <span className="flex items-center gap-2 mt-2 text-xs text-textItemBlur">
                              {post.channelPicture && (
                                <SafeImage
                                  src={post.channelPicture}
                                  alt=""
                                  className="h-5 w-5 rounded-full"
                                />
                              )}
                              {post.channelName} ·{' '}
                              {t(`insights_format_${post.format}`, post.format)}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {fromUtc(post.publishDate).format('L LT')}
                      </td>
                      <td className="p-3">{count(post.metrics.reactions)}</td>
                      <td className="p-3">{count(post.metrics.comments)}</td>
                      <td className="p-3">{count(post.metrics.views)}</td>
                      <td className="p-3">{count(post.metrics.impressions)}</td>
                      <td
                        className="p-3"
                        title={post.engagementRate.formula || ''}
                      >
                        {post.engagementRate.value == null
                          ? '—'
                          : `${post.engagementRate.value.toFixed(2)}%`}
                        <small className="block">
                          {t('insights_base', 'Base')}:{' '}
                          {post.engagementRate.denominator
                            ? t(
                                `insights_${post.engagementRate.denominator}`,
                                post.engagementRate.denominator
                              )
                            : '—'}
                        </small>
                      </td>
                      <td className="p-3 text-xs">
                        {post.updatedAt
                          ? fromUtc(post.updatedAt).format('L LT')
                          : '—'}
                        <span className="block text-textItemBlur">
                          {t(`insights_status_${post.status}`, post.status)} ·{' '}
                          {post.source
                            ? t(`insights_source_${post.source}`, post.source)
                            : '—'}
                        </span>
                        {post.manualRefreshAfter && (
                          <span className="block mt-1 text-textItemBlur">
                            {t(
                              'insights_retry_after',
                              'Next manual check after'
                            )}
                            : {fromUtc(post.manualRefreshAfter).format('L LT')}
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => history(post)}>
                            {t('insights_history', 'Metrics history')}
                          </Button>
                          <Button
                            disabled={!!busy}
                            onClick={() => refresh(post)}
                          >
                            {busy === post.id
                              ? t('loading', 'Loading…')
                              : t('insights_refresh', 'Refresh metrics')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.total && (
                <p className="p-5">
                  {t(
                    'insights_empty',
                    'No published posts match these filters.'
                  )}
                </p>
              )}
            </div>
            <Pagination
              current={page}
              totalPages={Math.ceil(data.total / limit)}
              setPage={setPage}
              total={data.total}
              pageSize={limit}
              setPageSize={(n) => {
                setLimit(n);
                setPage(0);
              }}
            />
          </>
        )
      )}
    </section>
  );
};
