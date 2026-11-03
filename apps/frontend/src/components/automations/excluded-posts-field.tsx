'use client';

import { useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { readIntegrationMediaResponse } from './hooks/use-flows';

export function ExcludedPostsField({
  integrationId,
  value,
  onChange,
}: {
  integrationId: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useT();
  const fetch = useFetch();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [manualId, setManualId] = useState('');
  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite(
    (index, previous) => {
      if (!open || !integrationId || (index && !previous?.nextCursor))
        return null;
      const cursor = index
        ? `?cursor=${encodeURIComponent(previous.nextCursor)}`
        : '';
      return `/flows/integrations/${encodeURIComponent(
        integrationId
      )}/posts${cursor}`;
    },
    async (url: string) =>
      readIntegrationMediaResponse(await fetch(url), 'posts')
  );
  const posts = [
    ...new Map(
      (data || []).flatMap((page) => page.items).map((post) => [post.id, post])
    ).values(),
  ];
  const toggle = (id: string) =>
    onChange(
      value.includes(id)
        ? value.filter((item) => item !== id)
        : value.length < 100
        ? [...value, id]
        : value
    );
  const id = manualId.trim();
  return (
    <fieldset className="mt-4 rounded-lg border border-newTableBorder p-3 text-textColor">
      <legend className="px-1 text-sm font-semibold">
        {t('flow_excluded_posts', 'Excluded posts')} ({value.length}/100)
      </legend>
      <p className="mb-3 text-xs text-tableText">
        {t(
          'flow_excluded_posts_hint',
          'Ignore comments on these posts and Reels, including ads. This does not delete posts or cancel executions already started.'
        )}
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {value.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => toggle(id)}
            aria-label={`${t(
              'flow_remove_exclusion',
              'Remove exclusion'
            )}: ${id}`}
            className="rounded border border-newTableBorder px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-btnPrimary"
          >
            {posts.find((post) => post.id === id)?.caption?.slice(0, 40) || id}{' '}
            ×
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-sm text-btnPrimary focus-visible:ring-2 focus-visible:ring-btnPrimary"
      >
        {t('flow_choose_excluded_posts', 'Choose posts to ignore')}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <label className="block text-xs">
            {t('flow_search_loaded_posts', 'Search loaded posts')}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 w-full rounded border border-newTableBorder bg-newBgColorInner p-2 focus-visible:ring-2 focus-visible:ring-btnPrimary"
            />
          </label>
          {error && (
            <div role="alert" className="text-xs">
              {t(
                'instagram_posts_load_failed',
                'Could not load Instagram posts. Check the account connection and try again.'
              )}
              <button
                type="button"
                onClick={() => void mutate().catch(() => undefined)}
                className="ml-2 underline"
              >
                {t('try_again', 'Try Again')}
              </button>
            </div>
          )}
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {posts
              .filter((post) =>
                `${post.caption || ''} ${post.id}`
                  .toLocaleLowerCase()
                  .includes(search.toLocaleLowerCase())
              )
              .map((post) => (
                <label
                  key={post.id}
                  className="flex cursor-pointer items-center gap-2 rounded border border-newTableBorder p-2"
                >
                  <input
                    type="checkbox"
                    checked={value.includes(post.id)}
                    disabled={!value.includes(post.id) && value.length >= 100}
                    onChange={() => toggle(post.id)}
                  />
                  {(post.thumbnailUrl || post.mediaUrl) && (
                    <img
                      src={post.thumbnailUrl || post.mediaUrl}
                      alt=""
                      className="h-12 w-12 rounded object-cover"
                    />
                  )}
                  <span className="min-w-0 text-xs">
                    <span className="block truncate">
                      {post.caption || t('no_caption', '(no caption)')}
                    </span>
                    <span className="text-tableText">{post.id}</span>
                  </span>
                </label>
              ))}
          </div>
          {isValidating && (
            <p role="status" className="text-xs">
              {t('loading_posts', 'Loading posts...')}
            </p>
          )}
          {!isValidating && !error && !posts.length && (
            <p className="text-xs">{t('no_posts_found', 'No posts found.')}</p>
          )}
          {data?.[data.length - 1]?.nextCursor && (
            <button
              type="button"
              disabled={isValidating}
              onClick={() => void setSize(size + 1).catch(() => undefined)}
              className="text-sm text-btnPrimary"
            >
              {t('load_more', 'Load more')}
            </button>
          )}
          <label className="block text-xs">
            {t(
              'flow_excluded_media_id',
              'Or add an Instagram media ID (including ads)'
            )}
            <input
              value={manualId}
              maxLength={64}
              onChange={(e) => setManualId(e.target.value)}
              className="mt-1 w-full rounded border border-newTableBorder bg-newBgColorInner p-2 focus-visible:ring-2 focus-visible:ring-btnPrimary"
            />
          </label>
          <button
            type="button"
            disabled={
              !id || /\s/.test(id) || value.includes(id) || value.length >= 100
            }
            onClick={() => {
              toggle(id);
              setManualId('');
            }}
            className="rounded bg-btnPrimary px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {t('add', 'Add')}
          </button>
        </div>
      )}
    </fieldset>
  );
}
