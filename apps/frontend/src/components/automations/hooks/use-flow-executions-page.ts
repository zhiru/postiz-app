'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export interface FlowExecutionListItem {
  id: string;
  igCommenterName: string | null;
  igCommenterId: string;
  commentText: string;
  status: string;
  startedAt: string;
}

export interface FlowExecutionListQuery {
  page: number;
  limit: number;
  search: string;
  status: string;
  since: string;
  until: string;
  order: 'asc' | 'desc';
}

export const useFlowExecutionsPage = (
  flowId: string,
  query: FlowExecutionListQuery,
  enabled = true
) => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Unable to load flow executions');
      return response.json();
    },
    [fetch]
  );
  const params = new URLSearchParams({ paginated: 'true' });
  Object.entries(query).forEach(([key, value]) => {
    if (value !== '') params.set(key, String(value));
  });
  return useSWR<{ items: FlowExecutionListItem[]; total: number }>(
    enabled ? `/flows/${flowId}/executions?${params}` : null,
    load
  );
};
