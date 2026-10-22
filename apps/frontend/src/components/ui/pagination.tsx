'use client';

import { FC, useMemo } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

export const Pagination: FC<{
  current: number;
  totalPages: number;
  setPage: (page: number) => void;
  total?: number;
  pageSize?: number;
  setPageSize?: (size: number) => void;
  pageSizes?: number[];
  loading?: boolean;
  position?: 'top' | 'bottom';
}> = ({
  current,
  totalPages,
  setPage,
  total,
  pageSize,
  setPageSize,
  pageSizes = [10, 20, 50, 100],
  loading = false,
  position = 'bottom',
}) => {
  const t = useT();
  const pages = Math.max(1, totalPages);
  const visible = useMemo(() => {
    const selected = new Set([0, pages - 1]);
    const start = Math.max(0, Math.min(current - 2, pages - 5));
    for (let page = start; page < Math.min(pages, start + 5); page++)
      selected.add(page);
    const result: (number | string)[] = [];
    [...selected]
      .sort((a, b) => a - b)
      .forEach((page, i, all) => {
        if (i && page - all[i - 1] > 1) result.push(`gap-${page}`);
        result.push(page);
      });
    return result;
  }, [current, pages]);
  const buttonClass =
    'h-[36px] min-w-[36px] px-2 flex items-center justify-center rounded-[8px] border border-newTableBorder hover:bg-boxHover focus-visible:ring-2 focus-visible:ring-btnPrimary disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <nav
      aria-label={t(
        position === 'top' ? 'pagination_top' : 'pagination_bottom',
        position === 'top' ? 'Pagination (top)' : 'Pagination (bottom)'
      )}
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 py-3 text-[13px] text-textColor"
    >
      {total !== undefined && pageSize && (
        <span
          className="text-textItemBlur"
          role={position === 'bottom' ? 'status' : undefined}
        >
          {t(
            'listing_showing_range',
            'Showing {{start}}–{{end}} of {{total}}',
            {
              start: total ? current * pageSize + 1 : 0,
              end: Math.min((current + 1) * pageSize, total),
              total,
            }
          )}
        </span>
      )}
      <div className="flex items-center gap-1 mobile:order-3 mobile:justify-center mobile:w-full">
        <button
          type="button"
          className={buttonClass}
          aria-label={t('previous_page', 'Previous page')}
          disabled={loading || current <= 0}
          onClick={() => setPage(current - 1)}
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        {visible.map((page) =>
          typeof page === 'number' ? (
            <button
              key={page}
              type="button"
              aria-label={t('listing_page_number', 'Page {{page}}', {
                page: page + 1,
              })}
              aria-current={page === current ? 'page' : undefined}
              disabled={loading}
              onClick={() => setPage(page)}
              className={clsx(
                buttonClass,
                'mobile:hidden',
                page === current && 'bg-btnPrimary border-btnPrimary text-white'
              )}
            >
              {page + 1}
            </button>
          ) : (
            <span key={page} className="px-1 mobile:hidden" aria-hidden="true">
              …
            </span>
          )
        )}
        <span className="hidden mobile:block px-3">
          {current + 1} / {pages}
        </span>
        <button
          type="button"
          className={buttonClass}
          aria-label={t('next_page', 'Next page')}
          disabled={loading || current >= pages - 1}
          onClick={() => setPage(current + 1)}
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>
      {setPageSize && pageSize && (
        <label className="flex items-center gap-2 whitespace-nowrap text-textItemBlur">
          {t('items_per_page', 'Items per page')}
          <select
            aria-label={t('items_per_page', 'Items per page')}
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            className="h-[36px] min-w-[72px] px-2 rounded-[8px] border border-newTableBorder bg-newBgColorInner text-textColor focus-visible:ring-2 focus-visible:ring-btnPrimary"
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      )}
    </nav>
  );
};
