import {
  continueAsNew,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import { CommentsActivity } from '@gitroom/orchestrator/activities/comments.activity';

const { pollComments } = proxyActivities<CommentsActivity>({
  startToCloseTimeout: '30 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

// Polling cadence and how far back to look. Both are read by the caller and
// passed in, so the workflow itself stays deterministic.
export async function commentsPollWorkflowV100({
  intervalMs,
  sinceDays,
}: {
  intervalMs: number;
  sinceDays: number;
}) {
  let loops = 0;
  await pollComments({ sinceDays });

  while (true) {
    await sleep(intervalMs);

    // Keep the history small - the new run polls immediately, so the cadence
    // is kept across the restart
    if (++loops >= 24 || workflowInfo().historyLength > 1000) {
      return await continueAsNew<typeof commentsPollWorkflowV100>({
        intervalMs,
        sinceDays,
      });
    }

    await pollComments({ sinceDays });
  }
}
