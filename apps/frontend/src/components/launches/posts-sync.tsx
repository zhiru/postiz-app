'use client';

import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const PostsSync = ({
  integrationId,
  onSynchronized,
}: {
  integrationId: string;
  onSynchronized: () => void;
}) => {
  const fetch = useFetch();
  const t = useT();
  const [submitting, setSubmitting] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const response = await fetch(`/integrations/${integrationId}/posts-sync`);
    if (!response.ok) throw new Error('Could not load synchronization status');
    return response.json() as Promise<{
      lastSuccessAt: string | null;
      historyCompletedAt: string | null;
      runningSince: string | null;
      error: string | null;
    }>;
  }, [fetch, integrationId]);
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR(`posts-sync-${integrationId}`, load, { refreshInterval: 5000 });

  useEffect(() => {
    if (data?.lastSuccessAt) onSynchronized();
  }, [data?.lastSuccessAt, onSynchronized]);
  useEffect(() => {
    setQueued(false);
  }, [data?.runningSince, data?.lastSuccessAt, data?.error]);

  const sync = useCallback(async () => {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        `/integrations/${integrationId}/posts-sync`,
        { method: 'POST' }
      );
      if (!response.ok) throw new Error();
      setQueued(true);
      await mutate();
    } catch {
      setError(
        t(
          'posts_sync_request_failed',
          'Could not start synchronization. Check the channel connection and try again.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  }, [fetch, integrationId, mutate, t]);

  return (
    <div className="flex flex-col gap-4 text-textColor">
      <p>
        {t(
          'posts_sync_description',
          'Import the available profile history, including posts published directly on the social platform. Updates run automatically every 15 minutes.'
        )}
      </p>
      <p>
        {data?.runningSince
          ? t(
              'posts_sync_running',
              'Synchronization in progress… You can close this window.'
            )
          : queued
          ? t('posts_sync_queued', 'Synchronization queued…')
          : data?.lastSuccessAt
          ? `${t('posts_sync_last_success', 'Last synchronized')}: ${new Date(
              data.lastSuccessAt
            ).toLocaleString()}`
          : t('posts_sync_not_yet', 'No completed synchronization yet.')}
      </p>
      {data?.historyCompletedAt && (
        <p>
          {t(
            'posts_sync_history_complete',
            'Initial history import completed.'
          )}
        </p>
      )}
      {(error || data?.error || loadError) && (
        <p role="alert">
          {error ||
            data?.error ||
            t(
              'posts_sync_status_failed',
              'Could not load synchronization status.'
            )}
        </p>
      )}
      <Button
        onClick={sync}
        loading={submitting}
        disabled={submitting || !!data?.runningSince}
      >
        {t('posts_sync_now', 'Synchronize now')}
      </Button>
    </div>
  );
};
