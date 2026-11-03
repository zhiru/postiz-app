'use client';

import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type Recipient = {
  target: string;
  status: 'configured' | 'accepted' | 'confirmed' | 'rejected' | 'unknown';
};

function useNeuralTalkRecipients(postId: string, enabled: boolean) {
  const fetch = useFetch();
  const user = useUser();
  return useSWR<{ integrationId: string; recipients: Recipient[] }>(
    enabled && user?.id
      ? [
          '/posts',
          postId,
          'neuraltalk-recipients',
          user.id,
          user.orgId,
          user.profileId,
        ]
      : null,
    async () => {
      const response = await fetch(
        `/posts/${encodeURIComponent(postId)}/neuraltalk-recipients`
      );
      if (!response.ok) throw new Error('Recipient preview unavailable');
      return response.json();
    }
  );
}

// Resolve saved IDs through the same authenticated provider function as the editor.
function useRecipientNames(integrationId: string | undefined, ids: string[]) {
  const fetch = useFetch();
  const user = useUser();
  return useSWR<{ items: Array<{ id: string; name: string }> }>(
    user?.id && integrationId && ids.length
      ? [
          'neuraltalk-preview-names',
          user.id,
          user.orgId,
          user.profileId,
          integrationId,
          ids,
        ]
      : null,
    async () => {
      const response = await fetch('/integrations/function', {
        method: 'POST',
        body: JSON.stringify({
          id: integrationId,
          name: 'destinations',
          data: { ids },
        }),
      });
      if (!response.ok) throw new Error('Recipient names unavailable');
      const result = await response.json();
      if (!Array.isArray(result?.items))
        throw new Error('Recipient names unavailable');
      return result;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
}

export function NeuralTalkRecipients({
  postId,
  providerIdentifier,
}: {
  postId: string;
  providerIdentifier: string;
}) {
  const t = useT();
  const { data, error, isLoading } = useNeuralTalkRecipients(
    postId,
    providerIdentifier === 'neuraltalk'
  );
  const { data: names } = useRecipientNames(
    error ? undefined : data?.integrationId,
    data?.recipients.map(({ target }) => target) || []
  );
  const user = useUser();
  if (providerIdentifier !== 'neuraltalk' || !user?.id) return null;
  const labels: Record<Recipient['status'], string> = {
    configured: t(
      'neuraltalk_recipient_configured',
      'Configured destination — delivery not confirmed'
    ),
    accepted: t(
      'neuraltalk_recipient_accepted',
      'Message registered in NeuralTalk — device delivery not confirmed'
    ),
    confirmed: t(
      'neuraltalk_recipient_confirmed',
      'Send confirmed by provider — device delivery not confirmed'
    ),
    rejected: t(
      'neuraltalk_recipient_rejected',
      'Send rejected — delivery not confirmed'
    ),
    unknown: t(
      'neuraltalk_recipient_unknown',
      'Send result unknown — delivery not confirmed'
    ),
  };
  return (
    <section className="rounded-lg border border-newTableBorder p-3 text-sm">
      <h3 className="font-semibold">
        {t('neuraltalk_preview_recipients', 'NeuralTalk recipients')}
      </h3>
      <p className="text-textItemBlur">
        {t(
          'neuraltalk_recipients_persisted',
          'Saved destinations for this post. A configured destination does not confirm delivery.'
        )}
      </p>
      {isLoading && (
        <p role="status">
          {t('neuraltalk_recipients_loading', 'Loading recipients…')}
        </p>
      )}
      {error && (
        <p role="status">
          {t(
            'neuraltalk_recipients_unavailable',
            'Recipients could not be loaded.'
          )}
        </p>
      )}
      {!error &&
        data &&
        (data.recipients.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {data.recipients.map(({ target, status }) => (
              <li key={target} className="break-words">
                <span className="font-medium">
                  {names?.items
                    .find((item) => item.id === target)
                    ?.name?.trim() ||
                    (target.startsWith('group:')
                      ? t('neuraltalk_recipient_group', 'Group #{{id}}', {
                          id: target.split(':')[1],
                        })
                      : t('neuraltalk_recipient_contact', 'Contact #{{id}}', {
                          id: target.split(':')[1],
                        }))}
                </span>
                {' · '}
                {labels[status]}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {t(
              'neuraltalk_recipients_empty',
              'No saved destinations for this post.'
            )}
          </p>
        ))}
    </section>
  );
}
