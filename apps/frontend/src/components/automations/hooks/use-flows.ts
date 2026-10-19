'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export const useFlows = () => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => {
      return await (await fetch(path)).json();
    },
    [fetch]
  );

  return useSWR('/flows', load);
};

export const useFlow = (id: string) => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => {
      return await (await fetch(path)).json();
    },
    [fetch]
  );

  return useSWR(`/flows/${id}`, load);
};

export const useFlowExecutions = (id: string) => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => {
      return await (await fetch(path)).json();
    },
    [fetch]
  );

  return useSWR(`/flows/${id}/executions`, load);
};

export const useFlowExecution = (flowId: string, executionId: string | null) => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => {
      return await (await fetch(path)).json();
    },
    [fetch]
  );

  return useSWR(
    executionId ? `/flows/${flowId}/executions/${executionId}` : null,
    load
  );
};

export const readIntegrationMediaResponse = async (
  response: Response,
  field: 'posts' | 'stories'
) => {
  if (!response.ok) throw new Error('Unable to load Instagram media');
  const data = await response.json();
  const items = Array.isArray(data) ? data : data?.[field];
  const nextCursor = Array.isArray(data) ? null : data?.nextCursor ?? null;
  if (
    !Array.isArray(items) ||
    items.some((item) => !item || typeof item.id !== 'string') ||
    (nextCursor !== null && typeof nextCursor !== 'string')
  ) {
    throw new Error('Invalid Instagram media response');
  }
  return { items, nextCursor };
};

export const useIntegrationPosts = (integrationId: string | null) => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => {
      const { items } = await readIntegrationMediaResponse(await fetch(path), 'posts');
      return items;
    },
    [fetch]
  );

  return useSWR(
    integrationId ? `/flows/integrations/${integrationId}/posts` : null,
    load
  );
};

export const useIntegrationStories = (integrationId: string | null) => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => {
      const { items } = await readIntegrationMediaResponse(await fetch(path), 'stories');
      return items;
    },
    [fetch]
  );

  return useSWR(
    integrationId ? `/flows/integrations/${integrationId}/stories` : null,
    load
  );
};
