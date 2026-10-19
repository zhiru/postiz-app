import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import type { PostsSyncActivity } from '../activities/posts-sync.activity';

const activities = proxyActivities<PostsSyncActivity>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '30 seconds',
    maximumInterval: '2 minutes',
  },
});

export async function scheduleExternalPostsSyncV1() {
  // Roll over the workflow history every day without changing existing workflows.
  for (let i = 0; i < 96; i++) {
    try {
      await activities.requestExternalPostsSync();
    } catch {
      /* retry at the next interval */
    }
    await sleep('15 minutes');
  }
  await continueAsNew<typeof scheduleExternalPostsSyncV1>();
}

export async function syncExternalPostsWorkflowV1(input: {
  organizationId: string;
  id: string;
  full?: boolean;
  cursor?: string;
}) {
  const { organizationId, id } = input;
  try {
    const state =
      input.full === undefined
        ? await activities.prepareExternalPostsSync(organizationId, id)
        : { full: input.full, cursor: input.cursor };
    let cursor = state.cursor;
    for (let page = 0; page < (state.full ? 50 : 3); page++) {
      const result = await activities.syncExternalPostsPage(
        organizationId,
        id,
        state.full,
        cursor
      );
      cursor = result.nextCursor;
      if (!cursor) {
        await activities.finishExternalPostsSync(
          organizationId,
          id,
          state.full
        );
        return;
      }
    }
    if (state.full) {
      // continueAsNew throws a control-flow sentinel, so keep it outside catch.
      input = { organizationId, id, full: true, cursor };
    } else {
      await activities.finishExternalPostsSync(organizationId, id, false);
      return;
    }
  } catch (error) {
    await activities.failExternalPostsSync(organizationId, id);
    throw error;
  }
  await continueAsNew<typeof syncExternalPostsWorkflowV1>(input);
}
