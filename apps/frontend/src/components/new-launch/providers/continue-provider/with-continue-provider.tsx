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
}

export interface EmptyStateMessage {
  key: string;
  text: string;
}

export interface ContinueProviderConfig<TItem, TSelection> {
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
    const { onSave, existingId, initialData, isSaving, onCancel } = props;
    const call = useCustomProviderFunction();
    const t = useT();
    const [query, setQuery] = useState('');
    const [selection, setSelection] = useState<TSelection | null>(null);

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
        setSelection(getSelectionValue(item));
      },
      []
    );

    const handleSave = useCallback(async () => {
      if (selection && !isSaving) {
        await onSave(transformSaveData(selection));
      }
    }, [onSave, selection, isSaving]);

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
          {onCancel && <Button secondary onClick={onCancel}>{t('cancel', 'Cancel')}</Button>}
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
      value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/@/g, '').trim();
    const visibleData = getSearchText
      ? filteredData.filter((item) => normalize(getSearchText(item)).includes(normalize(query)))
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
              placeholder={t('channel_search_placeholder', 'Type a name or @username')}
              className="w-full min-w-0 rounded-lg border border-[var(--new-border)] bg-[var(--new-bgColor)] px-4 py-3 text-textColor focus-visible:ring-2 focus-visible:ring-[var(--new-btn-primary)]"
            />
          </label>
        )}
        <div className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain max-h-[45vh] pr-1">
          <div className={clsx('grid gap-2', getSearchText ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3')}>
            {visibleData.map((item) => (
              <button
                type="button"
                key={getItemId(item)}
                aria-pressed={isSelected(item, selection)}
                disabled={isSaving}
                className={clsx(
                  'flex min-w-0 w-full gap-3 rounded-lg border p-3 text-textColor focus-visible:ring-2 focus-visible:ring-[var(--new-btn-primary)] disabled:opacity-50',
                  getSearchText ? 'items-center text-left' : 'flex-col items-center text-center',
                  isSelected(item, selection)
                    ? 'border-[var(--new-btn-primary)] bg-[var(--new-box-hover)]'
                    : 'border-[var(--new-border)] hover:bg-[var(--new-box-hover)]'
                )}
                onClick={handleSelect(item)}
              >
                {renderItem(item, isSelected(item, selection))}
                {getSearchText && (
                  <span aria-hidden="true" className="ml-auto shrink-0 text-xl">
                    {isSelected(item, selection) ? '●' : '○'}
                  </span>
                )}
              </button>
            ))}
          </div>
          {!isLoading && !visibleData.length && (
            <p role="status" className="py-8 text-center text-sm">
              {t('channel_search_empty', 'No accounts found. Try another name or @username.')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--new-border)] pt-4">
          {onCancel && (
            <Button secondary onClick={onCancel} disabled={isSaving}>
              {t('cancel', 'Cancel')}
            </Button>
          )}
          <Button disabled={!selection || isSaving} loading={isSaving} onClick={handleSave}>
            {t('save', 'Save')}
          </Button>
        </div>
      </div>
    );
  };
}
