'use client';

import React, { FC, Fragment, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Input } from '@gitroom/react/form/input';
import { FormProvider, useForm } from 'react-hook-form';
import { array, object, string } from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { Select } from '@gitroom/react/form/select';
import { PickPlatforms } from '@gitroom/frontend/components/launches/helpers/pick.platform.component';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';
import { Checkbox } from '@gitroom/react/form/checkbox';

// Mirrors WEBHOOK_EVENTS in libraries/nestjs-libraries/src/dtos/webhooks -
// that module pulls node-only deps (crypto, undici) and can't be bundled here.
const WEBHOOK_EVENTS = [
  'post.published',
  'post.failed',
  'post.deleted',
  'comment.received',
];
const DEFAULT_WEBHOOK_EVENTS = ['post.published'];

export const Webhooks: FC = () => {
  const fetch = useFetch();
  const user = useUser();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const list = useCallback(async () => {
    return (await fetch('/webhooks')).json();
  }, []);
  const { data, mutate } = useSWR('webhooks', list);
  const addWebhook = useCallback(
    (data?: any) => () => {
      modal.openModal({
        title: data ? t('update_webhook', 'Update webhook') : t('add_webhook', 'Add webhook'),
        withCloseButton: true,
        children: <AddOrEditWebhook data={data} reload={mutate} />,
      });
    },
    [t]
  );
  const showDeliveries = useCallback(
    (data: any) => () => {
      modal.openModal({
        title: t('webhook_deliveries', 'Webhook deliveries'),
        withCloseButton: true,
        children: <WebhookDeliveries id={data.id} />,
      });
    },
    [t]
  );
  const deleteHook = useCallback(
    (data: any) => async () => {
      if (
        await deleteDialog(
          t(
            'are_you_sure_you_want_to_delete',
            `Are you sure you want to delete ${data.name}?`,
            { name: data.name }
          )
        )
      ) {
        await fetch(`/webhooks/${data.id}`, {
          method: 'DELETE',
        });
        mutate();
        toaster.show(t('webhook_deleted_successfully', 'Webhook deleted successfully'), 'success');
      }
    },
    []
  );

  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">
        {t('webhooks', 'Webhooks')} ({data?.length || 0}/{user?.tier?.webhooks})
      </h3>
      <div className="text-customColor18 mt-[4px]">
        {t(
          'webhooks_are_a_way_to_get_notified_when_something_happens_in_postiz_via_an_http_request',
          'Webhooks are a way to get notified when something happens in Postiz via\n        an HTTP request.'
        )}
      </div>
      <div className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div className="grid grid-cols-[1fr,1fr,1fr,1fr,1fr,1fr] w-full gap-y-[10px]">
              <div>{t('name', 'Name')}</div>
              <div>{t('url', 'URL')}</div>
              <div>{t('events', 'Events')}</div>
              <div>{t('deliveries', 'Deliveries')}</div>
              <div>{t('edit', 'Edit')}</div>
              <div>{t('delete', 'Delete')}</div>
              {data?.map((p: any) => (
                <Fragment key={p.id}>
                  <div className="flex flex-col justify-center">{p.name}</div>
                  <div className="flex flex-col justify-center">{p.url}</div>
                  <div className="flex flex-col justify-center text-customColor18">
                    {(p.events?.length ? p.events : DEFAULT_WEBHOOK_EVENTS).join(
                      ', '
                    )}
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button secondary={true} onClick={showDeliveries(p)}>
                        {t('view', 'View')}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button onClick={addWebhook(p)}>
                        {t('edit', 'Edit')}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button onClick={deleteHook(p)}>
                        {t('delete', 'Delete')}
                      </Button>
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>
          )}
          <div>
            <Button
              onClick={addWebhook()}
              className={clsx((data?.length || 0) > 0 && 'my-[16px]')}
            >
              {t('add_a_webhook', 'Add a webhook')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
const details = object().shape({
  name: string().required(),
  url: string().url().required(),
  integrations: array(),
  events: array().of(string()).min(1),
});
const getWebhookOptions = (t: (key: string, fallback: string) => string) => [
  {
    label: t('all_integrations', 'All integrations'),
    value: 'all',
  },
  {
    label: t('specific_integrations', 'Specific integrations'),
    value: 'specific',
  },
];
export const AddOrEditWebhook: FC<{
  data?: any;
  reload: () => void;
}> = (props) => {
  const { data, reload } = props;
  const fetch = useFetch();
  const t = useT();
  const options = getWebhookOptions(t);
  const [allIntegrations, setAllIntegrations] = useState(
    (data?.integrations?.length || 0) > 0 ? options[1] : options[0]
  );
  const modal = useModals();
  const toast = useToaster();
  const form = useForm({
    resolver: yupResolver(details),
    values: {
      name: data?.name || '',
      url: data?.url || '',
      integrations: data?.integrations?.map((p: any) => p.integration) || [],
      events: data?.events?.length ? data.events : DEFAULT_WEBHOOK_EVENTS,
    },
  });
  const integrations = form.watch('integrations');
  const events = form.watch('events');
  const toggleEvent = useCallback(
    (event: string) => () => {
      const current: string[] = form.getValues('events') || [];
      form.setValue(
        'events',
        current.includes(event)
          ? current.filter((e) => e !== event)
          : [...current, event],
        { shouldValidate: true }
      );
    },
    []
  );
  // The secret is only ever readable right after it is generated - the list
  // endpoint never returns it again.
  const showSecret = useCallback(
    (secret: string) => {
      modal.openModal({
        title: t('webhook_signing_secret', 'Webhook signing secret'),
        withCloseButton: true,
        children: <WebhookSecret secret={secret} />,
      });
    },
    [t]
  );
  const rotateSecret = useCallback(async () => {
    if (
      !(await deleteDialog(
        t(
          'rotate_secret_confirm',
          'Rotating invalidates the current secret. Continue?'
        ),
        t('rotate', 'Rotate')
      ))
    ) {
      return;
    }

    const { secret } = await (
      await fetch(`/webhooks/${data.id}/secret`, { method: 'POST' })
    ).json();
    showSecret(secret);
  }, [data]);
  const integration = useCallback(async () => {
    return (await fetch('/integrations/list')).json();
  }, []);
  const changeIntegration = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const findValue = options.find(
        (option) => option.value === e.target.value
      )!;
      setAllIntegrations(findValue);
      if (findValue.value === 'all') {
        form.setValue('integrations', []);
      }
    },
    []
  );
  const { data: dataList, isLoading } = useSWR('integrations', integration, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
  const callBack = useCallback(
    async (values: any) => {
      const response = await (
        await fetch('/webhooks', {
          method: data?.id ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...(data?.id
              ? {
                  id: data.id,
                }
              : {}),
            ...values,
          }),
        })
      ).json();

      if (response?.secret) {
        showSecret(response.secret);
      }

      toast.show(
        data?.id
          ? t('webhook_updated_successfully', 'Webhook updated successfully')
          : t('webhook_added_successfully', 'Webhook added successfully'),
        'success'
      );
      modal.closeAll();
      reload();
    },
    [data, integrations]
  );
  const sendTest = useCallback(async () => {
    const url = form.getValues('url');
    toast.show(t('webhook_sent', 'Webhook send'), 'success');
    try {
      await fetch(`/webhooks/send?url=${encodeURIComponent(url)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            id: 'cm6tcts4f0005qcwit25cis26',
            content: 'This is the first post to instagram',
            publishDate: '2025-02-06T13:09:00.000Z',
            releaseURL: 'https://facebook.com/release/release',
            state: 'PUBLISHED',
            integration: {
              id: 'cm6s4uyou0001i2r47pxix6z1',
              name: 'test',
              providerIdentifier: 'instagram',
              picture: 'https://uploads.gitroom.com/F6LSCD8wrrQ.jpeg',
              type: 'social',
            },
          },
          {
            id: 'cm6tcts4f0005qcwit25cis26',
            content: 'This is the second post to facebook',
            publishDate: '2025-02-06T13:09:00.000Z',
            releaseURL: 'https://facebook.com/release2/release2',
            state: 'PUBLISHED',
            integration: {
              id: 'cm6s4uyou0001i2r47pxix6z1',
              name: 'test2',
              providerIdentifier: 'facebook',
              picture: 'https://uploads.gitroom.com/F6LSCD8wrrQ.jpeg',
              type: 'social',
            },
          },
        ]),
      });
    } catch (e: any) {
      /** empty **/
    }
  }, []);

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(callBack)}>
        <div className="relative flex gap-[20px] flex-col flex-1 rounded-[4px] pt-0">
          <div>
            <Input
              label="Name"
              translationKey="label_name"
              {...form.register('name')}
            />
            <Input
              label="URL"
              translationKey="label_url"
              {...form.register('url')}
            />
            <Select
              value={allIntegrations.value}
              name="integrations"
              label="Integrations"
              translationKey="label_integrations"
              disableForm={true}
              onChange={changeIntegration}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {allIntegrations.value === 'specific' && dataList && !isLoading && (
              <PickPlatforms
                integrations={dataList.integrations}
                selectedIntegrations={integrations as any[]}
                onChange={(e) => form.setValue('integrations', e)}
                singleSelect={false}
                toolTip={true}
                isMain={true}
              />
            )}
            <div className="mt-[16px] flex flex-col gap-[10px]">
              <div>{t('events_to_send', 'Events to send')}</div>
              {WEBHOOK_EVENTS.map((event) => (
                <Checkbox
                  key={event}
                  disableForm={true}
                  name={event}
                  label={event}
                  checked={events?.includes(event)}
                  onChange={toggleEvent(event)}
                />
              ))}
            </div>
            {!!data?.id && (
              <div className="mt-[16px]">
                <Button type="button" secondary={true} onClick={rotateSecret}>
                  {t('rotate_signing_secret', 'Rotate signing secret')}
                </Button>
              </div>
            )}
            <div className="flex gap-[10px]">
              <Button
                type="submit"
                className="mt-[24px]"
                disabled={
                  !form.formState.isValid ||
                  (allIntegrations.value === 'specific' &&
                    !integrations?.length)
                }
              >
                {t('save', 'Save')}
              </Button>
              <Button
                type="button"
                secondary={true}
                className="mt-[24px]"
                onClick={sendTest}
                disabled={
                  !form.formState.isValid ||
                  (allIntegrations.value === 'specific' &&
                    !integrations?.length)
                }
              >
                {t('send_test', 'Send Test')}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
};

export const WebhookSecret: FC<{ secret: string }> = ({ secret }) => {
  const t = useT();

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="text-customColor18">
        {t(
          'webhook_secret_shown_once',
          'Copy it now - this is the only time it is shown. Postiz signs every request with it and sends the result in the X-Postiz-Signature header, together with X-Postiz-Timestamp and X-Postiz-Event.'
        )}
      </div>
      <div className="bg-sixth border-fifth border rounded-[4px] p-[12px] break-all select-all">
        {secret}
      </div>
    </div>
  );
};

export const WebhookDeliveries: FC<{ id: string }> = ({ id }) => {
  const fetch = useFetch();
  const t = useT();
  const load = useCallback(async () => {
    return (await fetch(`/webhooks/${id}/deliveries`)).json();
  }, [id]);
  const { data, isLoading } = useSWR(`webhook-deliveries-${id}`, load);

  if (isLoading) {
    return <div>{t('loading', 'Loading')}</div>;
  }

  if (!data?.length) {
    return (
      <div className="text-customColor18">
        {t('no_deliveries_yet', 'No deliveries yet')}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[1fr,1fr,1fr,1fr,2fr] w-full gap-y-[10px]">
      <div>{t('date', 'Date')}</div>
      <div>{t('event', 'Event')}</div>
      <div>{t('status', 'Status')}</div>
      <div>{t('attempts', 'Attempts')}</div>
      <div>{t('error', 'Error')}</div>
      {data.map((delivery: any) => (
        <Fragment key={delivery.id}>
          <div>{dayjs(delivery.createdAt).format('DD/MM/YYYY HH:mm')}</div>
          <div>{delivery.event}</div>
          <div>
            {delivery.success
              ? t('success', 'Success')
              : t('failed', 'Failed')}
            {!!delivery.statusCode && ` (${delivery.statusCode})`}
          </div>
          <div>{delivery.attempts}</div>
          <div className="break-all text-customColor18">
            {delivery.error || '-'}
          </div>
        </Fragment>
      ))}
    </div>
  );
};
