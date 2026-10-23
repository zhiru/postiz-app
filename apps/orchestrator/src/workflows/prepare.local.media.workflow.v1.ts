import { proxyActivities } from '@temporalio/workflow';
import type { LocalMediaActivity } from '../activities/local.media.activity';
const { prepareLocalMediaV1 } = proxyActivities<LocalMediaActivity>({
  startToCloseTimeout: '25 minutes',
  taskQueue: 'main',
  retry: { maximumAttempts: 1 },
});
const { failLocalMediaV1 } = proxyActivities<LocalMediaActivity>({
  startToCloseTimeout: '1 minute',
  taskQueue: 'main',
  retry: { maximumAttempts: 5 },
});
export async function prepareLocalMediaWorkflowV1({
  mediaId,
}: {
  mediaId: string;
}) {
  try {
    await prepareLocalMediaV1(mediaId);
  } catch {
    await failLocalMediaV1(mediaId);
  }
}
