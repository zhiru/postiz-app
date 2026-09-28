'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import copy from 'copy-to-clipboard';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface CredentialKey {
  key: string;
  secret: boolean;
  source: 'panel' | 'env' | 'none';
  value: string;
}

interface CredentialGroup {
  name: string;
  docs?: string;
  redirectUris: string[];
  keys: CredentialKey[];
}

const useCredentials = () => {
  const fetch = useFetch();
  return useSWR<CredentialGroup[]>(
    '/admin/credentials',
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Failed to load credentials');
      }
      return res.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

const CredentialGroupCard: FC<{
  group: CredentialGroup;
  onSaved: (groups: CredentialGroup[]) => void;
}> = ({ group, onSaved }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [values, setValues] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const configured = group.keys.every((k) => k.source !== 'none');

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/admin/credentials', {
        method: 'PUT',
        body: JSON.stringify({ values }),
      });
      if (!res.ok) {
        toaster.show(
          t('could_not_save_credentials', 'Could not save the credentials'),
          'warning'
        );
        return;
      }
      setValues({});
      onSaved(await res.json());
      toaster.show(t('credentials_saved', 'Credentials saved'), 'success');
    } finally {
      setSaving(false);
    }
  }, [values]);

  const sourceLabel = (source: CredentialKey['source']) =>
    source === 'panel'
      ? t('credential_source_panel', 'Set in the panel')
      : source === 'env'
      ? t('credential_source_env', 'From .env')
      : t('credential_source_none', 'Not set');

  return (
    <div className="border border-newTableBorder rounded-[8px] p-[16px] bg-newBgColorInner flex flex-col gap-[12px]">
      <div className="flex items-center gap-[8px]">
        <div className="text-[16px] font-[600] flex-1">{group.name}</div>
        <div
          className={
            configured ? 'text-[12px] text-green-500' : 'text-[12px] opacity-70'
          }
        >
          {configured
            ? t('credential_configured', 'Configured')
            : t('credential_missing', 'Missing keys')}
        </div>
        {!!group.docs && (
          <a
            href={group.docs}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] underline opacity-70"
          >
            {t('developer_portal', 'Developer portal')}
          </a>
        )}
      </div>
      {group.redirectUris.map((uri) => (
        <div key={uri} className="flex items-center gap-[8px] text-[12px]">
          <div className="opacity-70 whitespace-nowrap">
            {t('redirect_uri', 'Redirect URI')}
          </div>
          <div className="flex-1 min-w-0 truncate font-mono">{uri}</div>
          <Button
            className="!h-[24px] rounded-[4px] text-[12px]"
            secondary={true}
            onClick={() => {
              copy(uri);
              toaster.show(t('copied', 'Copied'), 'success');
            }}
          >
            {t('copy', 'Copy')}
          </Button>
        </div>
      ))}
      {group.keys.map((k) => (
        <div
          key={k.key}
          className="grid grid-cols-[220px_1fr_120px_auto] gap-[8px] items-center text-[13px]"
        >
          <div className="font-mono truncate">{k.key}</div>
          <input
            type={k.secret ? 'password' : 'text'}
            autoComplete="off"
            className="bg-newBgColor border border-newTableBorder rounded-[4px] h-[32px] px-[8px]"
            placeholder={k.value || t('credential_empty', 'empty')}
            value={values[k.key] ?? ''}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [k.key]: e.target.value }))
            }
          />
          <div className="text-[12px] opacity-70">{sourceLabel(k.source)}</div>
          {k.source === 'panel' ? (
            <Button
              className="!h-[24px] rounded-[4px] text-[12px]"
              secondary={true}
              onClick={() => setValues((prev) => ({ ...prev, [k.key]: null }))}
            >
              {values[k.key] === null
                ? t('credential_will_reset', 'Will use .env')
                : t('credential_reset', 'Use .env')}
            </Button>
          ) : (
            <div />
          )}
        </div>
      ))}
      <div>
        <Button
          onClick={save}
          disabled={saving || Object.keys(values).length === 0}
        >
          {t('save', 'Save')}
        </Button>
      </div>
    </div>
  );
};

export const AdminCredentialsComponent: FC = () => {
  const t = useT();
  const user = useUser();
  const { data, isLoading, error, mutate } = useCredentials();

  if (!user?.isSuperAdmin) {
    return <div className="opacity-70">{t('super_admin_only', 'Only instance super admins can see this page.')}</div>;
  }

  if (isLoading) {
    return <LoadingComponent />;
  }

  if (error || !data) {
    return (
      <div className="opacity-70">
        {t('could_not_load_credentials', 'Could not load the credentials')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <div className="text-[24px] font-[600]">
          {t('integration_credentials', 'Integration credentials')}
        </div>
        <div className="text-[13px] opacity-70">
          {t(
            'integration_credentials_description',
            'Keys of the developer apps of each network. They apply without restarting and override the .env; leave a field empty to keep the current value.'
          )}
        </div>
      </div>
      {data.map((group) => (
        <CredentialGroupCard
          key={group.name}
          group={group}
          onSaved={(groups) => mutate(groups, { revalidate: false })}
        />
      ))}
    </div>
  );
};
