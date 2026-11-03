'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSyncExternalStore } from 'react';

const subscribeHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
};
const getHash = () => window.location.hash;
const getServerHash = () => '';

// The execution ID identifies the selected comment in this flow's history.
export const useFlowHistory = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hash = useSyncExternalStore(subscribeHash, getHash, getServerHash);
  const selectedExecutionId = searchParams.get('executionId') || null;
  const showHistory =
    searchParams.get('history') === '1' || !!selectedExecutionId;

  const historyHref = (open: boolean, executionId: string | null = null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('executionId');
    params.delete('history');
    if (open) params.set('history', '1');
    if (open && executionId) params.set('executionId', executionId);
    const query = params.toString();
    return `${pathname}${query ? `?${query}` : ''}${hash}`;
  };

  return {
    selectedExecutionId,
    showHistory,
    historyHref,
    navigateHistory: (open: boolean, executionId: string | null = null) => {
      router.push(historyHref(open, executionId), { scroll: false });
    },
  };
};
