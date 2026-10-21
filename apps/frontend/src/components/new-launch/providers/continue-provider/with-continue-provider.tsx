'use client';

import { FC, ReactNode, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';

const SWR_OPTIONS = {
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  revalidateOnFocus: false,
  revalidateIfStale: false,
  revalidateOnMount: true,
  revalidateOnReconnect: false,
  refreshInterval: 0,
};

export interface ContinueProviderProps {
  onSave: (data: any) => Promise<void>;
  existingId: string[];
  initialData?: any[];
  isSaving?: boolean;
  onCancel?: () => void;
  multiple?: boolean;
}

export interface EmptyStateMessage {
  key: string;
  text: string;
}

export interface ContinueProviderConfig<TItem, TSelection> {
  allowMultiple?: boolean;
  getSearchText?: (item: TItem) => string;
  endpoint: string;
  swrKey: string;
  titleKey: string;
  titleDefault: string;
  emptyStateMessages: EmptyStateMessage[];
  getSelectionValue: (item: TItem) => TSelection;
  transformSaveData: (selection: TSelection) => any;
  renderItem: (item: TItem, isSelected: boolean) => ReactNode;
  isSelected: (item: TItem, selection: TSelection | null) => boolean;
  getItemId: (item: TItem) => string;
}

export function withContinueProvider<TItem, TSelection>(
  config: ContinueProviderConfig<TItem, TSelection>
): FC<ContinueProviderProps> {
  const {
    allowMultiple,
    getSearchText,
    endpoint,
    swrKey,
    titleKey,
    titleDefault,
    emptyStateMessages,
    getSelectionValue,
    transformSaveData,
    renderItem,
    isSelected,
    getItemId,
  } = config;

  return function ContinueProviderComponent(props: ContinueProviderProps) {
    const { onSave, existingId, initialData, isSaving, onCancel, multiple } = props;
    const call = useCustomProviderFunction();
    const t = useT();
    const [query, setQuery] = useState('');
    const [selections, setSelections] = useState<TSelection[]>([]);
    const multi = !!multiple && !!allowMultiple;
    const selected = (item: TItem) =>
      selections.some((selection) => isSelected(item, selection));

    const loadData = useCallback(async () => {
      // Skip fetch if initial data was provided
      if (initialData) {
        return initialData;
      }
      try {
        return await call.get(endpoint);
      } catch (e) {
        // Handle error silently
      }
    }, [initialData]);

    const { data, isLoading } = useSWR(
      initialData ? null : swrKey,
      loadData,
      SWR_OPTIONS
    );

    const resolvedData = initialData || data;

    const handleSelect = useCallback(
      (item: TItem) => () => {
        if (isSaving) return;
        setSelections((current) =>
          !multi
            ? [getSelectionValue(item)]
            : current.some((selection) => isSelected(item, selection))
            ? current.filter((selection) => !isSelected(item, selection))
            : [...current, getSelectionValue(item)]
        );
      },
      [multi, isSaving]
    );

    const handleSave = useCallback(async () => {
      if (selections.length && !isSaving) {
        await onSave(
          multi
            ? { accounts: selections.map(transformSaveData) }
            : transformSaveData(selections[0])
        );
      }
    }, [onSave, selections, isSaving, multi]);

    const filteredData = useMemo(() => {
      return (
        (resolvedData as TItem[])?.filter(
          (item) => !existingId.includes(getItemId(item))
        ) || []
      );
    }, [resolvedData, existingId]);

    if (!isLoading && !resolvedData?.length) {
      return (
        <div className="text-center flex flex-col justify-center items-center text-[18px] leading-[26px] h-[300px]">
          {onCancel && (
            <Button secondary onClick={onCancel}>
              {t('cancel', 'Cancel')}
            </Button>
          )}
          {emptyStateMessages.map((msg, index) => (
            <span key={msg.key}>
              {t(msg.key, msg.text)}
              {index < emptyStateMessages.length - 1 && (
                <>
                  <br />
                  <br />
                </>
              )}
            </span>
          ))}
        </div>
      );
    }

    const normalize = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/@/g, '')
        .trim();
    const visibleData = getSearchText
      ? filteredData.filter((item) =>
          normalize(getSearchText(item)).includes(normalize(query))
        )
      : filteredData;

    return (
      <div className="flex min-h-0 min-w-0 flex-col gap-4">
        <div>{t(titleKey, titleDefault)}</div>
        {getSearchText && (
          <label className="flex flex-col gap-2 text-sm">
            {t('channel_search', 'Search by name or @username')}
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t(
                'channel_search_placeholder',
                'Type a name or @username'
              )}
              className="w-full min-w-0 rounded-lg border border-[var(--new-border)] bg-[var(--new-bgColor)] px-4 py-3 text-textColor focus-visible:ring-2 focus-visible:ring-[var(--new-btn-primary)]"
            />
          </label>
        )}
        {multi && selections.length >= 50 && (
          <p role="status" className="text-sm">
            {t(
              'channel_selection_limit',
              'Select up to 50 accounts per batch.'
            )}
          </p>
        )}
        <div className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain max-h-[45vh] pr-1">
          <div
            className={clsx(
              'grid gap-2',
              getSearchText ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3'
            )}
          >
            {visibleData.map((item) => (
              <button
                type="button"
                key={getItemId(item)}
                aria-pressed={selected(item)}
                disabled={
                  isSaving ||
                  (multi && selections.length >= 50 && !selected(item))
                }
                className={clsx(
                  'flex min-w-0 w-full gap-3 rounded-lg border p-3 text-textColor focus-visible:ring-2 focus-visible:ring-[var(--new-btn-primary)] disabled:opacity-50',
                  getSearchText ? 'items-center text-left' : 'flex-col items-center text-center',
                  selected(item)
                    ? 'border-[var(--new-btn-primary)] bg-[var(--new-box-hover)]'
                    : 'border-[var(--new-border)] hover:bg-[var(--new-box-hover)]'
                )}
                onClick={handleSelect(item)}
              >
                {renderItem(item, selected(item))}
                {getSearchText && (
                  <span aria-hidden="true" className="ml-auto shrink-0 text-xl">
                    {selected(item) ? (multi ? '☑' : '●') : multi ? '☐' : '○'}
                  </span>
                )}
              </button>
            ))}
          </div>
          {!isLoading && !visibleData.length && (
            <p role="status" className="py-8 text-center text-sm">
              {t(
                'channel_search_empty',
                'No accounts found. Try another name or @username.'
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--new-border)] pt-4">
          {onCancel && (
            <Button secondary onClick={onCancel} disabled={isSaving}>
              {t('cancel', 'Cancel')}
            </Button>
          )}
          <Button
            disabled={!selections.length || isSaving}
            loading={isSaving}
            onClick={handleSave}
          >
            {multi
              ? t('channel_connect_selected', 'Connect selected ({{count}})', {
                  count: selections.length,
                })
              : t('save', 'Save')}
          </Button>
        </div>
      </div>
    );
  };
}
