'use client';
import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { useCurrentProfile } from '@gitroom/frontend/hooks/use-current-profile.hook';
import { continueProviderList } from '../new-launch/providers/continue-provider/list';
import {
  AccountConnectionResult,
  AccountConnectionResults,
} from './account-connection-results';

const options = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  shouldRetryOnError: false,
};
const useAccountSelectionData = (
  url: string | null,
  profileId: string | null
) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch(url!);
    if (!response.ok) {
      throw new Error(
        response.status === 429
          ? 'PROVIDER_RATE_LIMIT'
          : response.status === 412
          ? 'AUTHORIZATION_EXPIRED'
          : 'CONNECTION_FAILED'
      );
    }
    return response.json();
  }, [url, fetch]);
  return useSWR(url ? [url, profileId] : null, load, options);
};

export const ReusableAccountModal = ({
  provider,
  onAuthorize,
  onClose,
}: {
  provider: string;
  onAuthorize: () => void;
  onClose: () => void;
}) => {
  const t = useT();
  const fetch = useFetch();
  const { profile, isLoading: profileLoading } = useCurrentProfile();
  const [source, setSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<AccountConnectionResult[]>([]);
  const [saveError, setSaveError] = useState(false);
  const sources = useAccountSelectionData(
    profileLoading ? null : `/integrations/provider/${provider}/authorizations`,
    profile?.id || null
  );
  const accounts = useAccountSelectionData(
    source ? `/integrations/provider/${source}/accounts` : null,
    profile?.id || null
  );
  const Provider =
    continueProviderList[provider as keyof typeof continueProviderList];
  const save = async (data: any) => {
    if (saving || !source) return;
    setSaving(true);
    setSaveError(false);
    try {
      const response = await fetch(
        `/integrations/provider/${source}/accounts`,
        { method: 'POST', body: JSON.stringify(data) }
      );
      if (!response.ok) throw new Error('Connection failed');
      const next = (await response.json()).results as AccountConnectionResult[];
      setResults((previous) => [
        ...previous.filter(
          (old) => !next.some((result) => result.id === old.id)
        ),
        ...next,
      ]);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };
  const completed = results
    .filter((result) =>
      ['connected', 'already_connected'].includes(result.status)
    )
    .map((result) => result.id);
  const done = results.length > 0 && completed.length === results.length;
  const error = accounts.error || sources.error;
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <p className="text-sm opacity-80">
        {t(
          'channel_reuse_help',
          'Select several accounts using an existing authorization. Open Meta only to authorize another user, change permissions, or renew expired access.'
        )}
      </p>
      {!source &&
        sources.data?.map((authorization: { id: string; name: string }) => (
          <Button
            key={authorization.id}
            secondary
            onClick={() => {
              setResults([]);
              setSource(authorization.id);
            }}
          >
            {t('channel_reuse_from', 'Use authorization from {{name}}', {
              name: authorization.name,
            })}
          </Button>
        ))}
      {(profileLoading || sources.isLoading || accounts.isLoading) && (
        <p role="status">
          {t('channel_loading_accounts', 'Loading authorized accounts…')}
        </p>
      )}
      {error && (
        <p role="alert">
          {error.message === 'PROVIDER_RATE_LIMIT'
            ? t(
                'channel_connection_rate_limit',
                'The provider is temporarily limiting requests. Wait a few minutes and reconnect the channel.'
              )
            : error.message === 'AUTHORIZATION_EXPIRED'
            ? t(
                'channel_authorization_expired',
                'This authorization expired or was revoked. Connect through Meta again.'
              )
            : t(
                'channel_connection_network_error',
                'We could not finish connecting. Check your connection and start again from the calendar.'
              )}
        </p>
      )}
      {saveError && (
        <p role="alert">
          {t(
            'channel_connection_save_error',
            'We could not confirm that the account was saved. Check the calendar before connecting it again.'
          )}
        </p>
      )}
      {!!results.length && (
        <AccountConnectionResults
          results={results}
          pages={accounts.data || []}
        />
      )}
      {accounts.data && Provider && !done && (
        <Provider
          key={JSON.stringify(results)}
          multiple
          initialData={accounts.data}
          existingId={completed}
          onSave={save}
          isSaving={saving}
          onCancel={onClose}
        />
      )}
      {done && <Button onClick={onClose}>{t('done', 'Done')}</Button>}
      <div className="flex flex-wrap gap-3 border-t border-[var(--new-border)] pt-4">
        {source && <Button secondary disabled={saving} onClick={() => { setSource(null); setResults([]); setSaveError(false); }}>
          {t('channel_change_authorization', 'Choose another saved authorization')}
        </Button>}
        <Button secondary disabled={saving} onClick={onAuthorize}>
          {t('channel_authorize_meta', 'Connect or renew through Meta')}
        </Button>
        {!accounts.data && (
          <Button secondary onClick={onClose}>
            {t('cancel', 'Cancel')}
          </Button>
        )}
      </div>
    </div>
  );
};
