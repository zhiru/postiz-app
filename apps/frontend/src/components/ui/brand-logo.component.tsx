'use client';
import { ReactNode, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

const useBranding = () => {
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

export const BrandLogo = ({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) => {
  const { data } = useBranding();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!data?.logoUrl || failedUrl === data.logoUrl) return <>{children}</>;
  return (
    <img
      src={data.logoUrl}
      alt={data.name}
      referrerPolicy="no-referrer"
      className={
        compact
          ? 'w-[48px] h-[48px] object-contain'
          : 'w-[160px] h-[40px] object-contain'
      }
      onError={() => setFailedUrl(data.logoUrl)}
    />
  );
};
