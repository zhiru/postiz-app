'use client';

import React, { FC, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { isVideo } from '@gitroom/helpers/utils/has.extension';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@gitroom/frontend/components/ui/icons';

type PreviewMedia = {
  id: string;
  path: string;
  name: string;
  originalName?: string | null;
};
export type MediaPreviewPage = {
  results: PreviewMedia[];
  pages: number;
  total: number;
};

export const MediaPreview: FC<{
  initialMedia: PreviewMedia;
  initialPage: number;
  initialData: MediaPreviewPage;
  pageSize: number;
  cacheKey: string;
  loadPage: (page: number) => Promise<MediaPreviewPage>;
  onPageChange: (page: number) => void;
  onClose: () => void;
}> = ({
  initialMedia,
  initialPage,
  initialData,
  pageSize,
  cacheKey,
  loadPage,
  onPageChange,
  onClose,
}) => {
  const t = useT();
  const toaster = useToaster();
  const directory = useMediaDirectory();
  const dialog = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState({
    page: initialPage,
    media: initialMedia,
    data: initialData,
  });
  const [busy, setBusy] = useState(false);
  const turning = useRef(false);
  const mounted = useRef(true);
  const { mutate } = useSWRConfig();
  const [failedPath, setFailedPath] = useState<string | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const { data, page } = current;
  const index = data.results.findIndex((item) => item.id === current.media.id);
  const canPrevious = !busy && index >= 0 && (index > 0 || page > 0);
  const canNext =
    !busy &&
    index >= 0 &&
    (index < data.results.length - 1 || page < data.pages - 1);
  const step = async (direction: -1 | 1) => {
    if (turning.current || (direction === -1 ? !canPrevious : !canNext)) return;
    const media = data.results[index + direction];
    if (media) {
      setCurrent({ page, media, data });
      return;
    }
    turning.current = true;
    setBusy(true);
    const nextPage = page + direction;
    try {
      const next = await mutate<MediaPreviewPage>(
        `${cacheKey}-${nextPage}`,
        () => loadPage(nextPage),
        { populateCache: true, revalidate: false }
      );
      if (!next?.results.length) throw new Error('Empty media page');
      if (!mounted.current) return;
      setCurrent({
        page: nextPage,
        data: next,
        media: next.results[direction === 1 ? 0 : next.results.length - 1],
      });
      onPageChange(nextPage);
    } catch {
      if (mounted.current)
        toaster.show(
          t(
            'media_preview_load_error',
            'Could not load the next media page. Try again.'
          ),
          'warning'
        );
    } finally {
      turning.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const name = current.media.originalName || current.media.name;
  const url = directory.set(current.media.path);
  const buttonClass =
    'flex h-[44px] min-w-[44px] items-center justify-center rounded-[8px] bg-newColColor px-3 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-btnPrimary';
  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={t('media_preview', 'Media preview')}
      aria-busy={busy}
      tabIndex={-1}
      className="flex min-w-0 flex-col gap-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key === 'Tab') {
          const controls = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), video[controls]'
            ) || []
          );
          const first = controls[0],
            last = controls[controls.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last ||
              document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            first?.focus();
          }
          return;
        }
        if (
          event.altKey ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          (event.target as HTMLElement).closest(
            'video, input, textarea, [contenteditable="true"]'
          )
        )
          return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const rtl = document.documentElement.dir === 'rtl';
        step(event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : -1);
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1 truncate" title={name}>
          {name}
        </div>
        <button
          type="button"
          className={buttonClass}
          onClick={onClose}
          aria-label={t('close_media_preview', 'Close preview')}
        >
          ×
        </button>
      </div>
      <div className="flex h-[65vh] min-h-[180px] items-center justify-center overflow-hidden rounded-[8px] bg-black/40">
        {isVideo(current.media.path) ? (
          <video
            key={url}
            src={url}
            controls
            autoPlay
            className="max-h-full max-w-full object-contain"
          />
        ) : failedPath === current.media.path ? (
          <p role="status">
            {t(
              'media_preview_unavailable',
              'This media could not be displayed.'
            )}
          </p>
        ) : (
          <img
            key={url}
            src={url}
            alt={name}
            onError={() => setFailedPath(current.media.path)}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className={buttonClass}
          onClick={() => step(-1)}
          disabled={!canPrevious}
          aria-label={t('previous_media', 'Previous media')}
        >
          <ChevronLeftIcon size={20} className="rtl:rotate-180" />
        </button>
        <div
          role="status"
          aria-live="polite"
          className="text-center text-sm text-textItemBlur"
        >
          {busy
            ? t('loading', 'Loading...')
            : t('media_preview_position', '{{current}} of {{total}}', {
                current: current.page * pageSize + Math.max(0, index) + 1,
                total: data?.total || initialData.total,
              })}
        </div>
        <button
          type="button"
          className={buttonClass}
          onClick={() => step(1)}
          disabled={!canNext}
          aria-label={t('next_media', 'Next media')}
        >
          <ChevronRightIcon size={20} className="rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
};
