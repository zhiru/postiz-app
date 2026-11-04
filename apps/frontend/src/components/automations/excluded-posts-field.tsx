'use client';

import { useState } from 'react';
import { Modal } from '@mantine/core';
import useSWRInfinite from 'swr/infinite';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { readIntegrationMediaResponse } from './hooks/use-flows';

export function ExcludedPostsField({
  integrationId,
  value,
  onChange,
  enabled,
  onEnabledChange,
}: {
  integrationId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const t = useT();
  const fetch = useFetch();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [manualId, setManualId] = useState('');
  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite(
    (index, previous) => {
      if (!integrationId || (index && !previous?.nextCursor)) return null;
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
        {t('flow_excluded_posts', 'Excluded posts')}
      </legend>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs">{enabled ? value.length : 0}/100</span>
        <button
          type="button"
          role="switch"
          aria-label={t('flow_excluded_posts', 'Excluded posts')}
          aria-checked={enabled}
          onClick={() => onEnabledChange(!enabled)}
          className={`relative w-[44px] h-[24px] shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-btnPrimary ${
            enabled ? 'bg-btnPrimary' : 'bg-newTextColor/30'
          }`}
        >
          <span
            className={`absolute top-[2px] w-[20px] h-[20px] rounded-full bg-white transition-all ${
              enabled ? 'left-[22px]' : 'left-[2px]'
            }`}
          />
        </button>
      </div>
      {enabled && (
        <>
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
                {posts.find((post) => post.id === id)?.caption?.slice(0, 40) ||
                  id}{' '}
                ×
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-[6px] mb-[8px]">
            {posts.slice(0, 4).map((post) => (
              <ExcludedPostCard
                key={post.id}
                post={post}
                selected={value.includes(post.id)}
                disabled={!value.includes(post.id) && value.length >= 100}
                onClick={() => toggle(post.id)}
              />
            ))}
          </div>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
            className="text-[13px] text-btnPrimary hover:opacity-80 font-medium focus-visible:ring-2 focus-visible:ring-btnPrimary"
          >
            {t('wizard_show_all_posts', 'Mostrar Todos')}
          </button>
          <Modal
            opened={open}
            onClose={() => setOpen(false)}
            title={t('flow_excluded_posts', 'Excluded posts')}
            closeButtonLabel={t('close', 'Close')}
            size={700}
            centered
            zIndex={2000}
            classNames={{
              modal: 'bg-newBgColorInner text-textColor rounded-[12px]',
            }}
          >
            <div className="max-h-[65vh] overflow-y-auto space-y-3">
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
              <div className="grid grid-cols-3 gap-[10px] max-h-96 overflow-y-auto">
                {posts
                  .filter((post) =>
                    `${post.caption || ''} ${post.id}`
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase())
                  )
                  .map((post) => (
                    <ExcludedPostCard
                      key={post.id}
                      post={post}
                      selected={value.includes(post.id)}
                      disabled={!value.includes(post.id) && value.length >= 100}
                      onClick={() => toggle(post.id)}
                      showCaption
                    />
                  ))}
              </div>
              {isValidating && (
                <p role="status" className="text-xs">
                  {t('loading_posts', 'Loading posts...')}
                </p>
              )}
              {!isValidating && !error && !posts.length && (
                <p className="text-xs">
                  {t('no_posts_found', 'No posts found.')}
                </p>
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
                  !id ||
                  /\s/.test(id) ||
                  value.includes(id) ||
                  value.length >= 100
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
            <div className="mt-4 border-t border-fifth pt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[6px] bg-btnPrimary px-[20px] py-[8px] text-[13px] text-white hover:opacity-80 focus-visible:ring-2 focus-visible:ring-btnPrimary"
              >
                {t('confirm', 'Confirmar')}
              </button>
            </div>
          </Modal>
        </>
      )}
    </fieldset>
  );
}

function ExcludedPostCard({
  post,
  selected,
  disabled,
  onClick,
  showCaption = false,
}: {
  post: {
    id: string;
    caption?: string;
    thumbnailUrl?: string;
    mediaUrl?: string;
    mediaType?: string;
  };
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  showCaption?: boolean;
}) {
  const thumb = post.thumbnailUrl || post.mediaUrl;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`${post.caption || post.id} — ${post.id}`}
      disabled={disabled}
      onClick={onClick}
      className={`relative rounded-[6px] overflow-hidden border-2 text-left focus-visible:ring-2 focus-visible:ring-btnPrimary disabled:opacity-50 ${
        selected
          ? 'border-btnPrimary'
          : 'border-transparent hover:border-btnPrimary/50'
      }`}
    >
      <div className="relative aspect-square">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-sixth flex items-center justify-center p-2 text-xs">
            {post.caption || post.id}
          </div>
        )}
        {post.mediaType === 'VIDEO' && (
          <div className="absolute top-[4px] right-[4px]" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
              <rect x="2" y="2" width="20" height="20" rx="3" />
              <polygon points="10,8 16,12 10,16" fill="#000" />
            </svg>
          </div>
        )}
        {selected && (
          <div
            className="absolute inset-0 bg-btnPrimary/20 flex items-center justify-center"
            aria-hidden="true"
          >
            <span className="rounded-full bg-btnPrimary text-white w-6 h-6 flex items-center justify-center">
              ×
            </span>
          </div>
        )}
      </div>
      {showCaption && (
        <div className="p-[8px] bg-sixth">
          <p className="text-[11px] truncate">{post.caption || post.id}</p>
        </div>
      )}
    </button>
  );
}
