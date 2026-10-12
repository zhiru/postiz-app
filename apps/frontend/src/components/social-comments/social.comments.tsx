'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Select } from '@gitroom/react/form/select';
import { Textarea } from '@gitroom/react/form/textarea';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const STATUSES = ['RECEIVED', 'PENDING_APPROVAL', 'REPLIED', 'IGNORED'];

const useComments = (status: string, page: number) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (status) {
      params.set('status', status);
    }

    return (await fetch(`/social-comments?${params.toString()}`)).json();
  }, [status, page]);

  return useSWR(`social-comments-${status}-${page}`, load);
};

const useAutoReply = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/social-comments/auto-reply')).json();
  }, []);

  return useSWR('social-comments-auto-reply', load);
};

export const SocialComments: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, mutate, isLoading } = useComments(status, page);
  const { data: autoReply, mutate: mutateAutoReply } = useAutoReply();

  const changeAutoReply = useCallback(async () => {
    const next = !autoReply?.autoReplyComments;
    await fetch('/social-comments/auto-reply', {
      method: 'POST',
      body: JSON.stringify({ autoReplyComments: next }),
    });
    mutateAutoReply();
    toaster.show(t('saved', 'Saved'), 'success');
  }, [autoReply]);

  const changeStatus = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setStatus(e.target.value);
      setPage(1);
    },
    []
  );

  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">{t('comments_inbox', 'Comments inbox')}</h3>
      <div className="text-customColor18 mt-[4px]">
        {t(
          'comments_inbox_description',
          'Comments people left on your published posts. A reply suggested by an automation waits here until somebody approves it.'
        )}
      </div>

      <div className="my-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[16px]">
        <Checkbox
          disableForm={true}
          name="autoReplyComments"
          checked={!!autoReply?.autoReplyComments}
          onChange={changeAutoReply}
          label={t(
            'auto_reply_without_approval',
            'Send suggested replies automatically, without approval'
          )}
        />

        <div className="w-[260px]">
          <Select
            label="Status"
            translationKey="label_status"
            name="status"
            disableForm={true}
            value={status}
            onChange={changeStatus}
          >
            <option value="">{t('all', 'All')}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`comment_status_${value.toLowerCase()}`, value) as string}
              </option>
            ))}
          </Select>
        </div>

        {isLoading ? (
          <div>{t('loading', 'Loading')}</div>
        ) : !data?.comments?.length ? (
          <div className="text-customColor18">
            {t('no_comments_yet', 'No comments yet')}
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {data.comments.map((comment: any) => (
              <SocialComment key={comment.id} comment={comment} reload={mutate} />
            ))}
          </div>
        )}

        {(data?.count || 0) > 20 && (
          <div className="flex gap-[10px]">
            <Button
              secondary={true}
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              {t('previous', 'Previous')}
            </Button>
            <Button
              secondary={true}
              disabled={page * 20 >= (data?.count || 0)}
              onClick={() => setPage(page + 1)}
            >
              {t('next', 'Next')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export const SocialComment: FC<{ comment: any; reload: () => void }> = ({
  comment,
  reload,
}) => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const [message, setMessage] = useState(comment.suggestedReply || '');
  const [sending, setSending] = useState(false);

  const send = useCallback(async () => {
    if (!message.trim()) {
      return;
    }

    setSending(true);
    try {
      await fetch(`/social-comments/${comment.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      toaster.show(t('reply_sent', 'Reply sent'), 'success');
      reload();
    } finally {
      setSending(false);
    }
  }, [comment, message]);

  return (
    <div className="bg-customColor2 border-fifth border rounded-[4px] p-[16px] flex flex-col gap-[8px]">
      <div className="flex gap-[10px] items-center">
        {!!comment.integration?.picture && (
          <img
            src={comment.integration.picture}
            className="w-[24px] h-[24px] rounded-full"
            alt={comment.integration.name}
          />
        )}
        <div>{comment.authorName || t('unknown', 'Unknown')}</div>
        <div className="text-customColor18">
          {dayjs(comment.publishedAt).format('DD/MM/YYYY HH:mm')}
        </div>
        <div
          className={clsx(
            'text-customColor18',
            comment.status === 'PENDING_APPROVAL' && 'text-orange-400'
          )}
        >
          {
            t(
              `comment_status_${comment.status.toLowerCase()}`,
              comment.status
            ) as string
          }
        </div>
      </div>

      <div>{comment.content}</div>

      {comment.status === 'REPLIED' ? (
        <div className="text-customColor18">
          {t('replied_with', 'Replied')}: {comment.reply}
        </div>
      ) : (
        <>
          {!!comment.suggestedReply && (
            <div className="text-customColor18">
              {t('suggested_reply', 'Suggested reply')} —{' '}
              {t(
                'approve_to_send',
                'edit it if you want, then approve to send it'
              )}
            </div>
          )}
          <Textarea
            name={`reply-${comment.id}`}
            label=""
            disableForm={true}
            value={message}
            onChange={(e: any) => setMessage(e.target.value)}
          />
          <div>
            <Button onClick={send} disabled={sending || !message.trim()}>
              {comment.suggestedReply
                ? t('approve_and_send', 'Approve and send')
                : t('reply', 'Reply')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
