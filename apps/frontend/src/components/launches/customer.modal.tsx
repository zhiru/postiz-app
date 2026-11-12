'use client';

import { FC, useId, useRef, useState } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

function useChannelGroups() {
  const fetch = useFetch();
  return useSWR<{ id: string; name: string }[]>(
    '/integrations/customers',
    async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Could not load channel groups');
      return response.json();
    }
  );
}

export const CustomerModal: FC<{
  integration: { id: string; customer?: { name: string } | null };
  onClose: () => void;
}> = ({ integration, onClose }) => {
  const t = useT();
  const fetch = useFetch();
  const modal = useModals();
  const fieldId = useId();
  const { data, error, isLoading, mutate } = useChannelGroups();
  const [customer, setCustomer] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const savingRef = useRef(false);
  const name = customer.trim();
  const query = name.toLocaleLowerCase();
  const matching = data?.filter((group) =>
    group.name.toLocaleLowerCase().includes(query)
  );
  const existing = data?.some((group) => group.name === name);

  async function saveCustomer(name: string) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      const response = await fetch(
        `/integrations/${integration.id}/customer-name`,
        {
          method: 'PUT',
          body: JSON.stringify({ name }),
        }
      );
      if (!response.ok) throw new Error('Could not save channel group');
      void mutate();
      modal.closeAll();
      onClose();
    } catch {
      setSaveFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!error && data && name && name !== integration.customer?.name) {
          void saveCustomer(name);
        }
      }}
    >
      <p className="text-sm text-textColor opacity-70">
        {t(
          'channel_group_hint',
          'Groups organize channels in the calendar within the current organization.'
        )}
      </p>
      <label htmlFor={fieldId}>
        {t('channel_group_search', 'Search for or name a group')}
      </label>
      <input
        id={fieldId}
        value={customer}
        onChange={(event) => setCustomer(event.target.value)}
        autoComplete="off"
        disabled={saving}
        className="bg-newBgColorInner h-[42px] border-newTableBorder border rounded-[8px] text-textColor px-4"
      />
      {isLoading && <p role="status">{t('loading', 'Loading...')}</p>}
      {error && (
        <p role="alert">
          {t('channel_group_load_error', 'Could not load groups.')}
        </p>
      )}
      {!error &&
        data &&
        (matching?.length ? (
          <ul className="max-h-48 overflow-y-auto rounded-md border border-newTableBorder">
            {matching.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  disabled={saving}
                  aria-pressed={
                    (name || integration.customer?.name) === group.name
                  }
                  onClick={() => setCustomer(group.name)}
                  className="w-full px-4 py-2 text-start hover:bg-boxHover aria-pressed:bg-boxHover"
                >
                  {group.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="text-sm opacity-70">
            {data.length
              ? t('channel_group_no_matches', 'No matching groups.')
              : t(
                  'channel_group_empty',
                  'There are no groups yet. Enter a name to create the first one.'
                )}
          </p>
        ))}
      {saveFailed && (
        <p role="alert">
          {t(
            'channel_group_save_error',
            'Could not save the group. Try again.'
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={
            saving ||
            !data ||
            !!error ||
            !name ||
            name === integration.customer?.name
          }
        >
          {name && data && !existing
            ? t('channel_group_create', 'Create group and move channel')
            : t('save', 'Save')}
        </Button>
        {integration.customer?.name && (
          <Button
            secondary
            disabled={saving}
            onClick={() => void saveCustomer('')}
          >
            {t('channel_group_remove', 'Remove from group')}
          </Button>
        )}
      </div>
    </form>
  );
};
