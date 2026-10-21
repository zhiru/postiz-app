'use client';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export interface AccountConnectionResult {
  id: string;
  status: string;
}
export const AccountConnectionResults = ({
  results,
  pages,
}: {
  results: AccountConnectionResult[];
  pages: Array<{ id: string; name?: string; username?: string }>;
}) => {
  const t = useT();
  const messages: Record<string, string> = {
    limit_reached: t(
      'channel_account_limit',
      'The channel limit for your plan has been reached.'
    ),
    connected: t('channel_account_connected', 'Connected'),
    already_connected: t(
      'channel_account_existing',
      'Already connected — kept unchanged'
    ),
    unavailable: t(
      'channel_account_unavailable',
      'Unavailable here. Check whether this account is connected to another profile or needs reconnection.'
    ),
    failed: t(
      'channel_account_failed',
      'Could not connect. You can select this account and try again.'
    ),
    rate_limited: t(
      'channel_connection_rate_limit',
      'The provider is temporarily limiting requests. Wait a few minutes and reconnect the channel.'
    ),
    reauthorize: t(
      'channel_authorization_expired',
      'This authorization expired or was revoked. Connect through Meta again.'
    ),
  };
  return (
    <ul role="status" className="flex flex-col gap-2 text-sm">
      {results.map((result) => {
        const page = pages.find((page) => page.id === result.id);
        return (
          <li
            key={result.id}
            className="rounded-lg border border-[var(--new-border)] p-3"
          >
            <strong>
              {page?.username ? `@${page.username}` : page?.name || result.id}
            </strong>
            : {messages[result.status] || messages.failed}
          </li>
        );
      })}
    </ul>
  );
};
