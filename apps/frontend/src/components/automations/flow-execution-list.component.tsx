'use client';

import { FC, useState } from 'react';
import Link from 'next/link';
import { useDebounce } from 'use-debounce';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { Pagination } from '@gitroom/frontend/components/ui/pagination';
import {
  FlowExecutionListItem,
  useFlowExecutionsPage,
} from './hooks/use-flow-executions-page';

const STATUSES = [
  'RUNNING',
  'WAITING_POSTBACK',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];
const STATUS_CLASSES: Record<string, string> = {
  COMPLETED: 'bg-green-500/15 text-green-700 dark:text-green-400',
  FAILED: 'bg-red-500/15 text-red-700 dark:text-red-400',
  RUNNING: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  WAITING_POSTBACK: 'bg-yellow-500/15 text-yellow-800 dark:text-yellow-400',
};
const controlClass =
  'h-10 rounded-lg border border-newTableBorder bg-newBgColorInner px-3 text-sm text-textColor focus-visible:ring-2 focus-visible:ring-btnPrimary';

export const FlowExecutionList: FC<{
  flowId: string;
  onSelect: (id: string) => void;
  executionHref?: (id: string) => string;
}> = ({ flowId, onSelect, executionHref }) => {
  const t = useT();
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search.trim(), 300);
  const [status, setStatus] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [view, setView] = useState<'list' | 'cards'>('list');
  const [pageSize, setPageSize] = useState(20);
  // Associate the page with its filters so a change never requests an old page
  // of the new result set, including after the debounced search settles.
  const filterKey = JSON.stringify([
    flowId,
    debouncedSearch,
    status,
    since,
    until,
    order,
    pageSize,
  ]);
  const [pagination, setPagination] = useState({ key: filterKey, page: 0 });
  const page = pagination.key === filterKey ? pagination.page : 0;
  const setPage = (next: number) =>
    setPagination({ key: filterKey, page: next });
  const after = until ? new Date(`${until}T00:00:00`) : null;
  after?.setDate(after.getDate() + 1);
  const invalidRange = Boolean(since && until && since > until);
  const { data, error, isLoading, mutate } = useFlowExecutionsPage(
    flowId,
    {
      page: page + 1,
      limit: pageSize,
      search: debouncedSearch,
      status,
      since:
        !invalidRange && since
          ? new Date(`${since}T00:00:00`).toISOString()
          : '',
      until: !invalidRange && after ? after.toISOString() : '',
      order,
    },
    !invalidRange
  );
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  if (pagination.key !== filterKey) {
    setPagination({ key: filterKey, page: 0 });
  } else if (data && page >= totalPages) {
    setPagination({ key: filterKey, page: totalPages - 1 });
  }

  const statusBadge = (execution: FlowExecutionListItem) => (
    <span
      className={`inline-block rounded px-2 py-1 text-xs ${
        STATUS_CLASSES[execution.status] || 'bg-btnSimple text-textItemBlur'
      }`}
    >
      {t(
        `flow_execution_status_${execution.status.toLowerCase()}`,
        execution.status
      )}
    </span>
  );
  const hasFilters = Boolean(
    search || status || since || until || order !== 'desc'
  );
  const selectExecution = (
    event: React.MouseEvent<HTMLAnchorElement>,
    executionId: string
  ) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(executionId);
  };

  return (
    <div className="p-4 text-textColor">
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="flex flex-1 min-w-[180px] flex-col gap-1 text-sm">
          {t('flow_comments_search', 'Search comments or people')}
          <input
            type="search"
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={controlClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('status', 'Status')}
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={controlClass}
          >
            <option value="">
              {t('flow_comments_all_statuses', 'All statuses')}
            </option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`flow_execution_status_${value.toLowerCase()}`, value)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('flow_comments_since', 'Started from')}
          <input
            type="date"
            value={since}
            max={until || '9999-12-30'}
            onChange={(event) => setSince(event.target.value)}
            className={controlClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('flow_comments_until', 'Started through')}
          <input
            type="date"
            value={until}
            min={since || undefined}
            max="9999-12-30"
            onChange={(event) => setUntil(event.target.value)}
            className={controlClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('flow_comments_order', 'Order')}
          <select
            value={order}
            onChange={(event) => setOrder(event.target.value as 'asc' | 'desc')}
            className={controlClass}
          >
            <option value="desc">
              {t('flow_comments_newest', 'Newest first')}
            </option>
            <option value="asc">
              {t('flow_comments_oldest', 'Oldest first')}
            </option>
          </select>
        </label>
        {hasFilters && (
          <Button
            secondary
            className="rounded-lg focus-visible:ring-2 focus-visible:ring-btnPrimary"
            onClick={() => {
              setSearch('');
              setStatus('');
              setSince('');
              setUntil('');
              setOrder('desc');
            }}
          >
            {t('clear_filters', 'Clear filters')}
          </Button>
        )}
      </div>
      <div
        role="group"
        aria-label={t('flow_comments_view', 'Comment view')}
        className="flex flex-wrap gap-2 mb-3"
      >
        {(['list', 'cards'] as const).map((mode) => (
          <Button
            key={mode}
            secondary={view !== mode}
            aria-pressed={view === mode}
            className="rounded-lg focus-visible:ring-2 focus-visible:ring-btnPrimary"
            onClick={() => setView(mode)}
          >
            {mode === 'list'
              ? t('flow_comments_compact', 'Compact list')
              : t('flow_comments_cards', 'Cards')}
          </Button>
        ))}
      </div>
      {invalidRange ? (
        <p role="alert">
          {t(
            'flow_comments_invalid_dates',
            'The end date must be on or after the start date.'
          )}
        </p>
      ) : error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 py-4">
          <p>{t('flow_comments_load_failed', 'Unable to load comments.')}</p>
          <Button secondary onClick={() => void mutate()}>
            {t('flow_comments_retry', 'Try again')}
          </Button>
        </div>
      ) : isLoading ? (
        <p role="status" className="py-4 text-textItemBlur">
          {t('loading_executions', 'Loading...')}
        </p>
      ) : (
        data && (
          <>
            <Pagination
              current={page}
              totalPages={totalPages}
              setPage={setPage}
              total={data.total}
              pageSize={pageSize}
              setPageSize={setPageSize}
              position="top"
            />
            {data.items.length === 0 ? (
              <p role="status" className="py-4 text-textItemBlur">
                {hasFilters
                  ? t(
                      'flow_comments_no_matches',
                      'No comments match these filters.'
                    )
                  : t('no_executions', 'No executions yet')}
              </p>
            ) : view === 'list' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-textItemBlur">
                    <tr>
                      <th scope="col" className="p-2">
                        {t('commenter', 'Commenter')}
                      </th>
                      <th scope="col" className="p-2">
                        {t('comment', 'Comment')}
                      </th>
                      <th scope="col" className="p-2">
                        {t('status', 'Status')}
                      </th>
                      <th scope="col" className="p-2">
                        {t('started_at', 'Started At')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((execution) => (
                      <tr
                        key={execution.id}
                        className="border-t border-newTableBorder hover:bg-boxHover cursor-pointer"
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest('a'))
                            return;
                          onSelect(execution.id);
                        }}
                      >
                        <td className="p-2">
                          {executionHref ? (
                            <Link
                              href={executionHref(execution.id)}
                              scroll={false}
                              className="text-left rounded focus-visible:ring-2 focus-visible:ring-btnPrimary"
                              onClick={(event) =>
                                selectExecution(event, execution.id)
                              }
                            >
                              {execution.igCommenterName ||
                                execution.igCommenterId}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              className="text-left rounded focus-visible:ring-2 focus-visible:ring-btnPrimary"
                              onClick={(event) => {
                                event.stopPropagation();
                                onSelect(execution.id);
                              }}
                              aria-label={t(
                                'flow_comments_open',
                                'Open comment by {{name}}',
                                {
                                  name:
                                    execution.igCommenterName ||
                                    execution.igCommenterId,
                                }
                              )}
                            >
                              {execution.igCommenterName ||
                                execution.igCommenterId}
                            </button>
                          )}
                        </td>
                        <td
                          className="p-2 max-w-[240px] truncate text-textItemBlur"
                          title={execution.commentText}
                        >
                          {execution.commentText}
                        </td>
                        <td className="p-2">{statusBadge(execution)}</td>
                        <td className="p-2 whitespace-nowrap text-textItemBlur">
                          <time dateTime={execution.startedAt}>
                            {new Date(execution.startedAt).toLocaleString()}
                          </time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {data.items.map((execution) => (
                  <li key={execution.id} className="min-w-0">
                    {executionHref ? (
                      <Link
                        href={executionHref(execution.id)}
                        scroll={false}
                        onClick={(event) =>
                          selectExecution(event, execution.id)
                        }
                        className="flex h-full w-full flex-col items-start gap-3 rounded-lg border border-newTableBorder bg-newBgColorInner p-4 text-left hover:bg-boxHover focus-visible:ring-2 focus-visible:ring-btnPrimary"
                      >
                        <span className="font-semibold break-all">
                          {execution.igCommenterName || execution.igCommenterId}
                        </span>
                        {statusBadge(execution)}
                        <span
                          className="whitespace-pre-wrap break-words text-sm text-textItemBlur w-full line-clamp-4"
                          title={execution.commentText}
                        >
                          {execution.commentText}
                        </span>
                        <time
                          dateTime={execution.startedAt}
                          className="mt-auto text-xs text-textItemBlur"
                        >
                          {new Date(execution.startedAt).toLocaleString()}
                        </time>
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelect(execution.id)}
                        className="flex h-full w-full flex-col items-start gap-3 rounded-lg border border-newTableBorder bg-newBgColorInner p-4 text-left hover:bg-boxHover focus-visible:ring-2 focus-visible:ring-btnPrimary"
                        aria-label={t(
                          'flow_comments_open',
                          'Open comment by {{name}}',
                          {
                            name:
                              execution.igCommenterName ||
                              execution.igCommenterId,
                          }
                        )}
                      >
                        <span className="font-semibold break-all">
                          {execution.igCommenterName || execution.igCommenterId}
                        </span>
                        {statusBadge(execution)}
                        <span
                          className="whitespace-pre-wrap break-words text-sm text-textItemBlur w-full line-clamp-4"
                          title={execution.commentText}
                        >
                          {execution.commentText}
                        </span>
                        <time
                          dateTime={execution.startedAt}
                          className="mt-auto text-xs text-textItemBlur"
                        >
                          {new Date(execution.startedAt).toLocaleString()}
                        </time>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Pagination
              current={page}
              totalPages={totalPages}
              setPage={setPage}
              total={data.total}
              pageSize={pageSize}
              setPageSize={setPageSize}
            />
          </>
        )
      )}
    </div>
  );
};
