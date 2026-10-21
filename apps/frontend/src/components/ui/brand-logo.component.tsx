'use client';
import { ReactNode, useState, useEffect, useRef } from 'react';
import { useBranding } from '@gitroom/frontend/hooks/use-branding.hook';

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

export const BrandMetadata = (): null => {
  const { data } = useBranding();
  const titleState = useRef({ source: '', applied: '' });
  useEffect(() => {
    if (!data) return;
    const update = () => {
      const state = titleState.current;
      if (document.title !== state.applied) state.source = document.title;
      const page = state.source.replace(
        /^(?:Robô MultiPost|Postiz|Gitroom)(?=\s|$)\s*[-–—:]?\s*/,
        ''
      );
      const title = page ? `${data.name} ${page}` : data.name;
      state.applied = title;
      if (document.title !== title) document.title = title;
      const icons = Array.from(
        document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
      );
      if (!icons.length) {
        const icon = document.createElement('link');
        icon.rel = 'icon';
        document.head.appendChild(icon);
        icons.push(icon);
      }
      const href = data.logoUrl || '/favicon.ico';
      for (const icon of icons) {
        if (icon.getAttribute('href') !== href) {
          icon.removeAttribute('type');
          icon.href = href;
        }
      }
    };
    update();
    // Next replaces page metadata on navigation; retain the configured brand.
    const observer = new MutationObserver(update);
    observer.observe(document.head, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'rel'],
    });
    return () => observer.disconnect();
  }, [data?.name, data?.logoUrl]);
  return null;
};
