'use client';

import React, { FC, useEffect, useRef, useState } from 'react';
import useSWRMutation from 'swr/mutation';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type {
  NeuralTalkAccount,
  NeuralTalkInbox,
} from '@gitroom/nestjs-libraries/dtos/integrations/neuraltalk.dto';

type Connection = {
  baseUrl?: string;
  apiToken?: string;
  useSavedConnection?: boolean;
  savedIntegrationId?: string;
  saveAsDefault?: boolean;
  accountId?: string;
  inboxId?: string;
};

const useNeuralTalkRequest = <T,>(path: string) => {
  const fetch = useFetch();
  return useSWRMutation<T, Error, string, Connection>(
    `/integrations/neuraltalk/${path}`,
    async (url, { arg }) => {
      const response = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });
      if (!response.ok) throw new Error('Connection failed');
      return response.json();
    },
    { populateCache: false }
  );
};

const useDefaultConnection = () => {
  const fetch = useFetch();
  return useSWR<{
    configured: boolean;
    baseUrl?: string;
    connections: { id: string; name: string }[];
  }>(
    '/integrations/neuraltalk/default-connection',
    async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Connection lookup failed');
      return response.json();
    },
    { revalidateOnMount: true }
  );
};

export const NeuralTalkAccountModal: FC<{
  onComplete: () => void;
  onCancel: () => void;
}> = ({ onComplete, onCancel }) => {
  const t = useT();
  const fetch = useFetch();
  const defaults = useDefaultConnection();
  const [source, setSource] = useState<string | null>(null);
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const selectedSource =
    source ??
    (defaults.data?.configured
      ? 'default'
      : defaults.data?.connections?.[0]?.id || 'new');
  const [baseUrl, setBaseUrl] = useState('https://chat.neuraltalk.com.br');
  const [apiToken, setApiToken] = useState('');
  const [accounts, setAccounts] = useState<NeuralTalkAccount[] | null>(null);
  const [account, setAccount] = useState<NeuralTalkAccount | null>(null);
  const [inboxes, setInboxes] = useState<NeuralTalkInbox[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);
  const accountsRequest = useNeuralTalkRequest<{
    accounts: NeuralTalkAccount[];
  }>('accounts');
  const inboxesRequest = useNeuralTalkRequest<{ inboxes: NeuralTalkInbox[] }>(
    'inboxes'
  );
  const connectRequest = useNeuralTalkRequest<{ id: string }>('connect');

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      if (!cancelled.current) setFailed(true);
    } finally {
      inFlight.current = false;
      if (!cancelled.current) setBusy(false);
    }
  };
  const credentials: Connection =
    selectedSource === 'default'
      ? { useSavedConnection: true }
      : selectedSource !== 'new'
      ? { savedIntegrationId: selectedSource }
      : { baseUrl: baseUrl.trim(), apiToken: apiToken.trim() };
  const cancel = () => {
    cancelled.current = true;
    setApiToken('');
    onCancel();
  };
  const label = account
    ? t('neuraltalk_choose_inbox', 'Choose an inbox')
    : t('neuraltalk_choose_account', 'Choose an account');
  const normalizedSearch = search
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
  const matches = (name: string) =>
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  const options = account ? inboxes : accounts || [];

  return (
    <div className="flex flex-col gap-4 text-textColor" aria-busy={busy}>
      <p className="text-sm text-textColor/70">
        {t(
          'neuraltalk_connection_intro',
          'Connect your NeuralTalk account and inbox. Choose contacts or groups when composing each post.'
        )}
      </p>
      {!accounts ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await accountsRequest.trigger({
                ...credentials,
                saveAsDefault: selectedSource !== 'default' && saveAsDefault,
              });
              if (!Array.isArray(result?.accounts))
                throw new Error('Invalid accounts');
              if (!cancelled.current) {
                setSource(selectedSource);
                setAccounts(result.accounts);
                setSearch('');
              }
            });
          }}
        >
          {defaults.data && (
            <label className="flex flex-col gap-2">
              {t('neuraltalk_connection_source', 'Connection')}
              <select
                aria-label={t('neuraltalk_connection_source', 'Connection')}
                className="rounded-lg border border-newTableBorder bg-newBgColorInner p-3"
                value={selectedSource}
                disabled={busy}
                onChange={(event) => {
                  setSource(event.target.value);
                  setApiToken('');
                }}
              >
                {defaults.data.configured && (
                  <option value="default">
                    {t('neuraltalk_saved_default', 'Saved default connection')}
                  </option>
                )}
                {(defaults.data.connections || []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
                <option value="new">
                  {t('neuraltalk_new_connection', 'Use another token')}
                </option>
              </select>
            </label>
          )}
          {selectedSource === 'default' && (
            <>
              <p>{defaults.data?.baseUrl}</p>
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const response = await fetch(
                      '/integrations/neuraltalk/default-connection',
                      { method: 'DELETE' }
                    );
                    if (!response.ok)
                      throw new Error('Could not remove default');
                    setSource('new');
                    await defaults.mutate();
                  })
                }
              >
                {t('neuraltalk_remove_default', 'Remove saved default')}
              </Button>
            </>
          )}
          {selectedSource === 'new' && (
            <>
              <Input
                disableForm
                required
                type="url"
                name="neuraltalk-url"
                label={t('neuraltalk_instance_url', 'NeuralTalk URL')}
                aria-label={t('neuraltalk_instance_url', 'NeuralTalk URL')}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={busy}
              />
              <Input
                disableForm
                required
                type="password"
                autoComplete="new-password"
                name="neuraltalk-token"
                label={t('neuraltalk_api_token', 'API access token')}
                aria-label={t('neuraltalk_api_token', 'API access token')}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                disabled={busy}
              />
            </>
          )}
          {selectedSource !== 'default' && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={saveAsDefault}
                disabled={busy}
                onChange={(event) => setSaveAsDefault(event.target.checked)}
              />
              {t('neuraltalk_save_default', 'Save as default for this profile')}
            </label>
          )}
          <Button
            type="submit"
            disabled={
              busy ||
              defaults.isLoading ||
              (selectedSource === 'new' &&
                (!baseUrl.trim() || !apiToken.trim()))
            }
            loading={busy}
          >
            {t('continue', 'Continue')}
          </Button>
        </form>
      ) : (
        <>
          <h3 className="text-base font-semibold">{label}</h3>
          {account && <p className="text-sm">{account.name}</p>}
          <Input
            disableForm
            removeError
            type="search"
            name="neuraltalk-search"
            label={t('search', 'Search')}
            aria-label={t('search', 'Search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {options
              .filter((item) => matches(item.name))
              .map((item) => (
                <button
                  type="button"
                  key={item.id}
                  disabled={
                    busy || ('available' in item && item.available === false)
                  }
                  className="rounded-lg border border-newTableBorder bg-newBgColorInner p-3 text-start hover:bg-newColColor focus-visible:ring-2 focus-visible:ring-btnPrimary disabled:opacity-50"
                  onClick={() =>
                    void run(async () => {
                      if (!account) {
                        const result = await inboxesRequest.trigger({
                          ...credentials,
                          accountId: item.id,
                        });
                        if (!Array.isArray(result?.inboxes))
                          throw new Error('Invalid inboxes');
                        if (!cancelled.current) {
                          setAccount(item);
                          setInboxes(result.inboxes);
                          setSearch('');
                        }
                      } else {
                        const result = await connectRequest.trigger({
                          ...credentials,
                          accountId: account.id,
                          inboxId: item.id,
                        });
                        if (!result?.id) throw new Error('Invalid connection');
                        if (!cancelled.current) {
                          setApiToken('');
                          onComplete();
                        }
                      }
                    })
                  }
                >
                  <span className="block font-medium">{item.name}</span>
                  {'available' in item && item.available === false && (
                    <span className="block text-xs text-red-400">
                      {t(
                        'neuraltalk_inbox_unavailable',
                        'Sending is unavailable in this inbox'
                      )}
                    </span>
                  )}
                  {'supportsGroups' in item && (
                    <span className="block text-xs text-textColor/70">
                      {item.supportsGroups
                        ? t(
                            'neuraltalk_contacts_and_groups',
                            'Contacts and groups'
                          )
                        : t('neuraltalk_contacts_only', 'Contacts')}
                    </span>
                  )}
                </button>
              ))}
            {!options.some((item) => matches(item.name)) && (
              <p role="status" className="py-4 text-sm text-textColor/70">
                {t(
                  'neuraltalk_no_options',
                  'No accessible results found. Check your account permissions or search.'
                )}
              </p>
            )}
          </div>
        </>
      )}
      {busy && (
        <p role="status" className="text-sm">
          {t('loading', 'Loading...')}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-red-400">
          {t(
            'neuraltalk_connection_failed',
            'Could not connect. Check the URL, token and account permissions, then try again.'
          )}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-newTableBorder pt-4">
        {accounts && (
          <Button
            disabled={busy}
            onClick={() => {
              setFailed(false);
              setSearch('');
              if (account) {
                setAccount(null);
                setInboxes([]);
              } else {
                setAccounts(null);
              }
            }}
          >
            {t('back', 'Back')}
          </Button>
        )}
        <Button onClick={cancel} className="!bg-btnSimple !text-textColor">
          {t('cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
};
