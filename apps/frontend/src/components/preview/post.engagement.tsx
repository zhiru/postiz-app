'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';

type PostData = {
  checkedAt: string | null;
  commentsComplete?: boolean;
  metricsCheckedAt?: string;
  metricsAvailable?: boolean;
  metrics: Array<{ label: string; data: Array<{ total: string }> }>;
};
type Comment = {
  id: string;
  parentCommentId?: string;
  authorName?: string;
  content: string;
  publishedAt: string;
  reply?: string;
};

const usePostComments = (postId: string, page: number) => {
  const fetch = useFetch();
  const user = useUser();
  const scope = `${user?.orgId}:${user?.profileId}`;
  const load = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not load post data');
    return res.json();
  };
  const comments = useSWR<{ comments: Comment[]; count: number }>(
    [`${scope}:post-comments:${postId}:${page}`],
    () =>
      load(
        `/social-comments?postId=${encodeURIComponent(postId)}&page=${page}`
      ),
    { refreshInterval: 60_000, revalidateOnFocus: true }
  );
  return comments;
};

const usePostData = (postId: string) => {
  const fetch = useFetch();
  const user = useUser();
  const scope = `${user?.orgId}:${user?.profileId}`;
  const load = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not load post data');
    return res.json();
  };
  return useSWR<PostData>(
    [`${scope}:post-engagement:${postId}`],
    () => load(`/social-comments/posts/${encodeURIComponent(postId)}/data`),
    { refreshInterval: 60_000, revalidateOnFocus: true }
  );
};

const AuthenticatedPostEngagement = ({ postId }: { postId: string }) => {
  const t = useT();
  const fetch = useFetch();
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const comments = usePostComments(postId, page);
  const engagement = usePostData(postId);
  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(false);
    try {
      const res = await fetch(
        `/social-comments/posts/${encodeURIComponent(postId)}/sync`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error('Could not refresh post data');
      await engagement.mutate(await res.json(), false);
      await comments.mutate();
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <section className="rounded-[12px] border border-newTableBorder bg-newBgColorInner p-[20px] space-y-[16px]">
      <div className="flex items-center justify-between gap-[12px] flex-wrap">
        <h2 className="font-semibold">
          {t('post_network_data', 'Post data and social comments')}
        </h2>
        <Button
          secondary
          loading={refreshing}
          disabled={refreshing}
          onClick={refresh}
        >
          {t('refresh_post_now', 'Refresh now')}
        </Button>
      </div>
      <p className="text-[12px] text-textItemBlur">
        {t(
          'post_refresh_schedule',
          'Published posts are checked automatically in batches, including historical posts. Refresh now checks this post directly.'
        )}
      </p>
      {engagement.data?.checkedAt && (
        <p className="text-[12px]">
          {t('last_updated', 'Last updated')}:{' '}
          {new Date(engagement.data.checkedAt).toLocaleString()}
        </p>
      )}
      {(refreshError || comments.error || engagement.error) && (
        <p role="alert" className="text-red-400">
          {t(
            'post_refresh_failed',
            'Could not refresh post data. Check the account connection and try again shortly. Existing data is preserved.'
          )}
        </p>
      )}
      {engagement.data?.commentsComplete === false && (
        <p className="text-[12px] text-textItemBlur">
          {t(
            'post_comments_sync_partial',
            'A large comment history is being imported in batches. Already imported comments are shown below; the next check continues where it stopped.'
          )}
        </p>
      )}
      {!!engagement.data?.metrics?.length && (
        <div className="flex flex-wrap gap-[12px]">
          {engagement.data.metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-[8px] border border-newTableBorder p-[12px]"
            >
              <div className="text-[12px] text-textItemBlur">
                {t(metric.label.toLowerCase(), metric.label)}
              </div>
              <div className="text-[20px] font-semibold">
                {metric.data[metric.data.length - 1]?.total ?? '—'}
              </div>
            </div>
          ))}
        </div>
      )}
      {engagement.data?.metricsCheckedAt && (
        <p className="text-[12px] text-textItemBlur">
          {t('post_metrics_updated', 'Metrics updated')}:{' '}
          {new Date(engagement.data.metricsCheckedAt).toLocaleString()}
        </p>
      )}
      {engagement.data?.checkedAt && !engagement.data.metricsAvailable && (
        <p className="text-[12px] text-textItemBlur">
          {t(
            'post_insights_unavailable',
            'The network did not return updated metrics. Comments are synchronized independently.'
          )}
        </p>
      )}
      <h3 className="font-semibold">
        {t('network_comments', 'Social network comments')}{' '}
        {comments.data ? `(${comments.data.count})` : ''}
      </h3>
      {comments.isLoading && <p>{t('loading', 'Loading...')}</p>}
      {comments.data?.count === 0 && (
        <p className="text-textItemBlur">
          {t(
            'no_synced_comments',
            'No comments synchronized yet. Use Refresh now to check the network.'
          )}
        </p>
      )}
      <div className="space-y-[12px]">
        {comments.data?.comments.map((comment) => (
          <article
            key={comment.id}
            className="border-t border-newTableBorder pt-[12px] break-words"
          >
            <div className="text-[13px] font-semibold">
              {comment.authorName || t('instagram_user', 'Instagram user')}
            </div>
            <time
              className="text-[12px] text-textItemBlur"
              dateTime={comment.publishedAt}
            >
              {new Date(comment.publishedAt).toLocaleString()}
            </time>
            {comment.parentCommentId && (
              <div className="text-[12px] text-textItemBlur">
                {t('comment_reply', 'Reply to a comment')}
              </div>
            )}
            <p className="whitespace-pre-wrap">{comment.content}</p>
          </article>
        ))}
      </div>
      {(comments.data?.count || 0) > 20 && (
        <div className="flex gap-[8px] items-center">
          <Button
            secondary
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            {t('previous', 'Previous')}
          </Button>
          <span>{page}</span>
          <Button
            secondary
            disabled={page * 20 >= (comments.data?.count || 0)}
            onClick={() => setPage(page + 1)}
          >
            {t('next', 'Next')}
          </Button>
        </div>
      )}
    </section>
  );
};

export const PostEngagement = ({ postId }: { postId: string }) => {
  const user = useUser();
  return user?.id ? <AuthenticatedPostEngagement postId={postId} /> : null;
};
