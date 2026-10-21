'use client';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export const useBranding = () => {
  const fetch = useFetch();
  return useSWR<{ name: string; logoUrl: string | null }>(
    '/public/branding',
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Could not load branding');
      return res.json();
    },
    {
      revalidateOnFocus: true,
      refreshInterval: 60_000,
      shouldRetryOnError: false,
    }
  );
};
