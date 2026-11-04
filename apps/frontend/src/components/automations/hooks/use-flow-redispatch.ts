'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export const useFlowRedispatch = (flowId: string, executionId: string, enabled: boolean) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error('Redispatch blocked');
    return response.json();
  }, [fetch]);
  return useSWR<{ configurationToken: string; publicReply: boolean; directMessage: boolean }>(
    enabled ? `/flows/${flowId}/executions/${executionId}/redispatch` : null,
    load,
    { shouldRetryOnError: false, revalidateOnFocus: false }
  );
};
