'use client';

import React, { useEffect, useMemo, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import useSWR from 'swr';
import { useDebounce } from 'use-debounce';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useCurrentProfile } from '@gitroom/frontend/hooks/use-current-profile.hook';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { MultiSelect } from '@gitroom/react/form/multi.select';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type {
  NeuralTalkDestination,
  NeuralTalkDestinationPage,
} from '@gitroom/nestjs-libraries/dtos/integrations/neuraltalk.dto';

const useNeuralTalkDestinations = (query: string) => {
  const { get } = useCustomProviderFunction();
  const { integration } = useIntegration();
  const { profile } = useCurrentProfile();
  return useSWRInfinite<NeuralTalkDestinationPage>(
    (index, previous: NeuralTalkDestinationPage | null) =>
      !integration?.id || (previous && !previous.hasMore)
        ? null
        : [
            'neuraltalk-destinations',
            profile?.id,
            integration.id,
            query,
            index + 1,
          ],
    async ([, , , search, page]: [string, string, string, string, number]) => {
      const result = await get('destinations', { query: search, page });
      if (
        !Array.isArray(result?.items) ||
        typeof result?.hasMore !== 'boolean'
      ) {
        throw new Error('Could not load destinations');
      }
      return result;
    },
    {
      revalidateOnFocus: false,
      revalidateFirstPage: false,
      shouldRetryOnError: false,
    }
  );
};

const useSelectedDestinations = (ids: string[]) => {
  const { get } = useCustomProviderFunction();
  const { integration } = useIntegration();
  const { profile } = useCurrentProfile();
  return useSWR<NeuralTalkDestinationPage>(
    integration?.id && ids.length
      ? ['neuraltalk-selected-destinations', profile?.id, integration.id, ids]
      : null,
    async () => {
      const result = await get('destinations', { ids });
      if (!Array.isArray(result?.items))
        throw new Error('Could not load selected recipients');
      return result;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
};

export const NeuralTalkDestinations = () => {
  const t = useT();
  const form = useSettings();
  const targets: string[] = form.watch('targets') || [];
  const [search, setSearch] = useState('');
  const [query] = useDebounce(search.trim(), 300);
  const { data, error, isValidating, size, setSize, mutate } =
    useNeuralTalkDestinations(query);
  const [known, setKnown] = useState<Record<string, NeuralTalkDestination>>({});
  const { data: selectedData } = useSelectedDestinations(
    targets.filter((id) => !known[id])
  );
  const items = useMemo(
    () =>
      Array.from(
        new Map(
          (data || [])
            .flatMap((page) => page.items)
            .map((item) => [item.id, item])
        ).values()
      ),
    [data]
  );
  useEffect(() => {
    setKnown((previous) => ({
      ...previous,
      ...Object.fromEntries(
        [...items, ...(selectedData?.items || [])].map((item) => [
          item.id,
          item,
        ])
      ),
    }));
  }, [items, selectedData]);
  const select = (values: Array<string | number>) => {
    if (values.length > 50) return;
    form.setValue('targets', values.map(String), {
      shouldDirty: true,
      shouldValidate: true,
    });
  };
  const label = (item: NeuralTalkDestination) =>
    `${item.name} · ${
      item.kind === 'group'
        ? t('neuraltalk_group', 'Group')
        : t('neuraltalk_contact', 'Contact')
    }`;

  return (
    <div className="flex flex-col gap-3 py-3">
      <p className="text-sm text-textColor/70">
        {t(
          'neuraltalk_message_help',
          'The text, links, images and videos in this post will be sent as messages to the selected destinations through this inbox. Save a draft, schedule or send using the same editor.'
        )}
      </p>
      <Input
        disableForm
        removeError
        type="search"
        name="neuraltalk-destination-search"
        label={t('neuraltalk_search_destinations', 'Search contacts or groups')}
        aria-label={t(
          'neuraltalk_search_destinations',
          'Search contacts or groups'
        )}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <MultiSelect
        className="[&_input:focus-visible]:ring-2 [&_input:focus-visible]:ring-btnPrimary"
        name="targets"
        label={t('neuraltalk_destinations', 'Recipients')}
        value={targets}
        onChange={select}
        options={items.map((item) => ({ value: item.id, label: label(item) }))}
      />
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 text-sm text-red-400"
        >
          <span>
            {t(
              'neuraltalk_destinations_failed',
              'Could not load recipients. Check the inbox connection.'
            )}
          </span>
          <Button onClick={() => void mutate()} disabled={isValidating}>
            {t('retry', 'Retry')}
          </Button>
        </div>
      )}
      {isValidating && (
        <p role="status" className="text-sm">
          {t('loading', 'Loading...')}
        </p>
      )}
      {!isValidating && !error && !items.length && (
        <p role="status" className="text-sm text-textColor/70">
          {t(
            'neuraltalk_no_destinations',
            'No contacts or groups found in this inbox.'
          )}
        </p>
      )}
      {data?.[data.length - 1]?.hasMore && (
        <Button onClick={() => void setSize(size + 1)} disabled={isValidating}>
          {t('load_more', 'Load more')}
        </Button>
      )}
      <p className="text-sm" aria-live="polite">
        {t('neuraltalk_selected_count', 'Selected: {{count}} of 50', {
          count: targets.length,
        })}
      </p>
      {targets.length >= 50 && (
        <p role="status" className="text-sm text-textColor/70">
          {t('neuraltalk_target_limit', 'Select up to 50 recipients per post.')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {targets.map((id) => (
          <button
            key={id}
            type="button"
            className="max-w-full rounded-lg border border-newTableBorder bg-newBgColorInner px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-btnPrimary"
            onClick={() => select(targets.filter((target) => target !== id))}
            aria-label={t('neuraltalk_remove_destination', 'Remove {{name}}', {
              name: known[id]?.name || id,
            })}
          >
            <span className="break-words">
              {known[id] ? label(known[id]) : id}
            </span>
            <span aria-hidden="true" className="ms-2">
              ×
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
