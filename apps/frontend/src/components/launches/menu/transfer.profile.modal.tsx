'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { Select } from '@gitroom/react/form/select';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useProfilesList } from '@gitroom/frontend/components/settings/profile-persona.hooks';

export const TransferProfileModal: FC<{
  id: string;
  close: () => void;
  onSave: () => void;
}> = ({ id, close, onSave }) => {
  const t = useT();
  const fetch = useFetch();
  const toast = useToaster();
  const user = useUser();
  const { data } = useProfilesList();
  const [profileId, setProfileId] = useState('');
  const [loading, setLoading] = useState(false);
  const profiles = useMemo(
    () => (data || []).filter((p) => p.id !== user?.profileId),
    [data, user?.profileId]
  );

  const save = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/integrations/${id}/profile`, {
        method: 'PUT',
        body: JSON.stringify({ profileId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.show(
          body?.message ||
            t('channel_move_profile_error', 'Could not move the channel'),
          'warning'
        );
        return;
      }
      toast.show(t('channel_moved_profile', 'Channel moved'), 'success');
      onSave();
      close();
    } finally {
      setLoading(false);
    }
  }, [id, profileId, t]);

  return (
    <div className="flex flex-col gap-[16px]">
      <Select
        name="profileId"
        disableForm={true}
        label={t('destination_profile', 'Destination profile')}
        value={profileId}
        onChange={(e) => setProfileId(e.target.value)}
      >
        <option value="">
          {t('select_profile', 'Select a profile')}
        </option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Button onClick={save} disabled={!profileId} loading={loading}>
        {t('move_channel', 'Move channel')}
      </Button>
    </div>
  );
};
