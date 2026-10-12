'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import copy from 'copy-to-clipboard';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type CredentialCategory =
  | 'networks'
  | 'ai'
  | 'email'
  | 'storage'
  | 'limits'
  | 'flags'
  | 'urls'
  | 'monitoring';

interface CredentialKey {
  key: string;
  secret: boolean;
  class: 'live' | 'restart' | 'rebuild';
  writable: boolean;
  frontend: boolean;
  source: 'panel' | 'env' | 'none';
  value: string;
}

interface CredentialGroup {
  name: string;
  category: CredentialCategory;
  docs?: string;
  redirectUris: string[];
  keys: CredentialKey[];
}

interface CredentialsResponse {
  groups: CredentialGroup[];
  bootstrap: { key: string; present: boolean }[];
  restartPending: string[];
}

// same order the settings are grouped in on screen
const CATEGORIES: CredentialCategory[] = [
  'networks',
  'ai',
  'email',
  'storage',
  'limits',
  'flags',
  'urls',
  'monitoring',
];

const useCredentials = () => {
  const fetch = useFetch();
  return useSWR<CredentialsResponse>(
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

const RestartButton: FC<{ pending: number }> = ({ pending }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [restarting, setRestarting] = useState(false);

  const restart = useCallback(async () => {
    if (
      !(await deleteDialog(
        t(
          'restart_services_confirm',
          'This restarts the backend, the orchestrator and the frontend of this instance. Anything being published right now may fail and the app is unavailable for a few seconds.'
        ),
        t('yes_restart', 'Yes, restart'),
        t('restart_services', 'Restart services'),
        t('no_cancel', 'No, cancel')
      ))
    ) {
      return;
    }
    setRestarting(true);
    try {
      const res = await fetch('/admin/restart', { method: 'POST' });
      if (!res.ok) {
        toaster.show(
          (await res.json())?.message ||
            t('could_not_restart', 'Could not restart the services'),
          'warning'
        );
        return;
      }
      toaster.show(t('restarting_services', 'Restarting the services'), 'success');
    } finally {
      setRestarting(false);
    }
  }, []);

  return (
    <Button
      secondary={!pending}
      loading={restarting}
      onClick={restart}
      className="rounded-[4px] whitespace-nowrap"
    >
      {t('restart_services', 'Restart services')}
      {!!pending && ` (${pending})`}
    </Button>
  );
};

const SourceLabel: FC<{ source: CredentialKey['source'] }> = ({ source }) => {
  const t = useT();
  return (
    <div className="text-[12px] opacity-70">
      {source === 'panel'
        ? t('credential_source_panel', 'Set in the panel')
        : source === 'env'
        ? t('credential_source_env', 'From .env')
        : t('credential_source_none', 'Not set')}
    </div>
  );
};

const ClassBadge: FC<{ item: CredentialKey }> = ({ item }) => {
  const t = useT();
  if (item.class === 'rebuild') {
    return (
      <div className="text-[11px] text-amber-400 whitespace-nowrap">
        {t('credential_needs_rebuild', 'Needs a frontend rebuild')}
      </div>
    );
  }
  if (item.class === 'restart') {
    return (
      <div className="text-[11px] text-amber-400 whitespace-nowrap">
        {t('credential_needs_restart', 'Needs a restart')}
      </div>
    );
  }
  return (
    <div className="text-[11px] opacity-60 whitespace-nowrap">
      {t('credential_applies_now', 'Applies right away')}
    </div>
  );
};

const CredentialGroupCard: FC<{
  group: CredentialGroup;
  onSaved: (data: CredentialsResponse) => void;
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
          className="grid grid-cols-[220px_1fr_150px_120px_auto] gap-[8px] items-center text-[13px]"
        >
          <div className="flex flex-col">
            <div className="font-mono truncate">{k.key}</div>
            {k.frontend && (
              <div className="text-[11px] opacity-60">
                {t('credential_also_in_env', 'Keep it in the .env too')}
              </div>
            )}
          </div>
          {k.writable ? (
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
          ) : (
            <div className="font-mono opacity-70 truncate">
              {k.value || t('credential_empty', 'empty')}
            </div>
          )}
          <ClassBadge item={k} />
          <SourceLabel source={k.source} />
          {k.writable && k.source === 'panel' ? (
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
      {group.keys.some((k) => k.writable) && (
        <div>
          <Button
            onClick={save}
            disabled={saving || Object.keys(values).length === 0}
          >
            {t('save', 'Save')}
          </Button>
        </div>
      )}
    </div>
  );
};

const BootstrapCard: FC<{ bootstrap: CredentialsResponse['bootstrap'] }> = ({
  bootstrap,
}) => {
  const t = useT();
  return (
    <div className="border border-newTableBorder rounded-[8px] p-[16px] bg-newBgColorInner flex flex-col gap-[12px]">
      <div className="text-[16px] font-[600]">
        {t('credential_bootstrap', 'Startup settings (.env only)')}
      </div>
      <div className="text-[13px] opacity-70">
        {t(
          'credential_bootstrap_description',
          'These are read before the app can reach the database, or they protect the panel itself, so they can never be set from here.'
        )}
      </div>
      {bootstrap.map((item) => (
        <div
          key={item.key}
          className="grid grid-cols-[220px_1fr] gap-[8px] items-center text-[13px]"
        >
          <div className="font-mono truncate">{item.key}</div>
          <div
            className={
              item.present ? 'text-[12px] text-green-500' : 'text-[12px] text-red-400'
            }
          >
            {item.present
              ? t('credential_bootstrap_ok', 'Set')
              : t('credential_bootstrap_missing', 'Missing')}
          </div>
        </div>
      ))}
    </div>
  );
};

export const AdminCredentialsComponent: FC = () => {
  const t = useT();
  const user = useUser();
  const { data, isLoading, error, mutate } = useCredentials();

  const categoryLabels: Record<CredentialCategory, string> = useMemo(
    () => ({
      networks: t('credential_category_networks', 'Social networks'),
      ai: t('credential_category_ai', 'AI'),
      email: t('credential_category_email', 'E-mail'),
      storage: t('credential_category_storage', 'Storage'),
      limits: t('credential_category_limits', 'Limits'),
      flags: t('credential_category_flags', 'Flags'),
      urls: t('credential_category_urls', 'Public URLs'),
      monitoring: t('credential_category_monitoring', 'Sentry and analytics'),
    }),
    [t]
  );

  if (!user?.isSuperAdmin) {
    return (
      <div className="opacity-70">
        {t('super_admin_only', 'Only instance super admins can see this page.')}
      </div>
    );
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
      <div className="flex items-start gap-[12px]">
        <div className="flex-1">
          <div className="text-[24px] font-[600]">
            {t('instance_settings', 'Instance settings')}
          </div>
          <div className="text-[13px] opacity-70">
            {t(
              'instance_settings_description',
              'Runtime settings of this instance. They override the .env; leave a field empty to keep the current value. Secrets are only ever shown masked.'
            )}
          </div>
        </div>
        <RestartButton pending={data.restartPending.length} />
      </div>

      {!!data.restartPending.length && (
        <div className="border border-amber-500 text-amber-400 rounded-[8px] p-[12px] text-[13px]">
          {t(
            'restart_pending',
            'These settings were changed but are only read when the services start:'
          )}{' '}
          <span className="font-mono">{data.restartPending.join(', ')}</span>
        </div>
      )}

      {CATEGORIES.map((category) => {
        const groups = data.groups.filter((g) => g.category === category);
        if (!groups.length) {
          return null;
        }
        return (
          <div key={category} className="flex flex-col gap-[12px]">
            <div className="text-[12px] uppercase opacity-60">
              {categoryLabels[category]}
            </div>
            {groups.map((group) => (
              <CredentialGroupCard
                key={group.name}
                group={group}
                onSaved={(next) => mutate(next, { revalidate: false })}
              />
            ))}
          </div>
        );
      })}

      <BootstrapCard bootstrap={data.bootstrap} />
    </div>
  );
};
