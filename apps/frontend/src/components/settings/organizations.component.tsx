'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Input } from '@gitroom/react/form/input';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { CreateOrganization } from '@gitroom/frontend/components/layout/organization.selector';

export type UserOrganization = {
  id: string;
  name: string;
  users: { role: 'SUPERADMIN' | 'ADMIN' | 'USER'; disabled: boolean }[];
};

export const useOrganizations = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/user/organizations')).json();
  }, []);

  return useSWR<UserOrganization[]>('organizations', load, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
    revalidateOnReconnect: false,
  });
};

const errorMessage = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => ({ message: '' }));
  const message = Array.isArray(body.message) ? body.message[0] : body.message;
  return message || fallback;
};

const RenameOrganization: FC<{
  org: UserOrganization;
  onDone: () => void;
}> = ({ org, onDone }) => {
  const t = useT();
  const fetch = useFetch();
  const modals = useModals();
  const toaster = useToaster();
  const [name, setName] = useState(org.name);
  const [loading, setLoading] = useState(false);
  const save = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/user/organizations/${org.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        toaster.show(
          await errorMessage(
            response,
            t('could_not_rename_organization', 'Could not rename organization')
          ),
          'warning'
        );
        return;
      }
      toaster.show(t('organization_renamed', 'Organization renamed'), 'success');
      modals.closeAll();
      onDone();
    } finally {
      setLoading(false);
    }
  }, [name, org.id]);
  return (
    <div className="relative flex gap-[10px] flex-col flex-1 p-[16px] pt-0">
      <Input
        value={name}
        disableForm={true}
        removeError={true}
        onChange={(e) => setName(e.target.value)}
        name="name"
        label={t('organization_name', 'Organization name')}
        placeholder={t('organization_name', 'Organization name')}
      />
      <Button
        type="button"
        className="mt-[18px]"
        onClick={save}
        disabled={loading || !name.trim()}
      >
        {t('save', 'Save')}
      </Button>
    </div>
  );
};

export const OrganizationsComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const user = useUser();
  const modals = useModals();
  const toaster = useToaster();
  const { data, mutate } = useOrganizations();
  const impersonating = !!user?.impersonate;

  const roleLabel = (role?: UserOrganization['users'][0]['role']) =>
    role === 'SUPERADMIN'
      ? t('super_admin', 'Super Admin')
      : role === 'ADMIN'
      ? t('admin', 'Admin')
      : t('user', 'User');

  const switchOrg = useCallback(
    (org: UserOrganization) => async () => {
      await fetch('/user/change-org', {
        method: 'POST',
        body: JSON.stringify({ id: org.id }),
      });
      window.location.reload();
    },
    []
  );

  const openCreate = useCallback(() => {
    modals.openModal({
      classNames: {
        modal: 'bg-transparent text-textColor',
      },
      title: t('create_new_organization', 'Create New Organization'),
      withCloseButton: true,
      children: <CreateOrganization />,
    });
  }, [t]);

  const openRename = useCallback(
    (org: UserOrganization) => () => {
      modals.openModal({
        classNames: {
          modal: 'bg-transparent text-textColor',
        },
        title: t('rename_organization', 'Rename organization'),
        withCloseButton: true,
        children: <RenameOrganization org={org} onDone={() => mutate()} />,
      });
    },
    [t, mutate]
  );

  const remove = useCallback(
    (org: UserOrganization) => async () => {
      if (
        !(await deleteDialog(
          t(
            'delete_organization_confirm',
            'This organization, its channels and posts will be deleted. This action cannot be undone, are you sure?'
          ),
          t('yes_delete_organization', 'Yes, delete this organization')
        ))
      ) {
        return;
      }
      const response = await fetch(`/user/organizations/${org.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        toaster.show(
          await errorMessage(
            response,
            t('could_not_delete_organization', 'Could not delete organization')
          ),
          'warning'
        );
        return;
      }
      window.location.reload();
    },
    [t]
  );

  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">{t('organizations', 'Organizations')}</h3>
      <div className="text-customColor18 mt-[4px]">
        {t(
          'organizations_description',
          'Each organization has its own channels, calendar, team and API key. Use one per brand to keep them apart.'
        )}
      </div>
      <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[24px]">
        <div className="flex flex-col gap-[16px]">
          {(data || []).map((org) => {
            const role = org.users?.[0]?.role;
            const isCurrent = org.id === user?.orgId;
            const isOwner = role === 'SUPERADMIN';
            return (
              <div key={org.id} className="flex items-center gap-[12px]">
                <div className="flex-1 min-w-0 truncate">{org.name}</div>
                <div className="flex-1 text-customColor18">
                  {roleLabel(role)}
                  {isCurrent
                    ? ` · ${t('current_organization', 'Current')}`
                    : ''}
                </div>
                <div className="flex-1 flex justify-end gap-[8px]">
                  {!isCurrent && (
                    <Button
                      className="!h-[24px] rounded-[4px] text-[12px]"
                      onClick={switchOrg(org)}
                      secondary={true}
                    >
                      {t('switch', 'Switch')}
                    </Button>
                  )}
                  {isOwner && !impersonating && (
                    <Button
                      className="!h-[24px] rounded-[4px] text-[12px]"
                      onClick={openRename(org)}
                      secondary={true}
                    >
                      {t('rename', 'Rename')}
                    </Button>
                  )}
                  {isOwner && !impersonating && (data || []).length > 1 && (
                    <Button
                      className="!bg-red-800 !h-[24px] rounded-[4px] text-[12px]"
                      onClick={remove(org)}
                    >
                      {t('delete', 'Delete')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {!impersonating && (
          <div>
            <Button onClick={openCreate}>
              {t('create_new_organization', 'Create New Organization')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
