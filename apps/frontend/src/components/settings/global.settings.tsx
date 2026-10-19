'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dynamic from 'next/dynamic';
import OrganizationNameComponent from '@gitroom/frontend/components/settings/organization-name.component';
import AuthenticationComponent from '@gitroom/frontend/components/settings/authentication.component';
import EmailNotificationsComponent from '@gitroom/frontend/components/settings/email-notifications.component';
import ShortlinkPreferenceComponent from '@gitroom/frontend/components/settings/shortlink-preference.component';
import ShareZernioWithProfilesComponent from '@gitroom/frontend/components/settings/share-zernio-with-profiles.component';
import LanguagePreferenceComponent from '@gitroom/frontend/components/settings/language-preference.component';
import DeleteAccountComponent from '@gitroom/frontend/components/settings/delete-account.component';

const MetricComponent = dynamic(
  () => import('@gitroom/frontend/components/settings/metric.component'),
  {
    ssr: false,
  }
);

export const GlobalSettings = () => {
  const t = useT();
  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">{t('global_settings', 'Global Settings')}</h3>
      <OrganizationNameComponent />
      <AuthenticationComponent />
      <MetricComponent />
      <EmailNotificationsComponent />
      <LanguagePreferenceComponent />
      <ShortlinkPreferenceComponent />
      <ShareZernioWithProfilesComponent />
      <DeleteAccountComponent />
    </div>
  );
};
