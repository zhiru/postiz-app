import { proxyActivities, sleep } from '@temporalio/workflow';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';

const { searchForMissingThreeHoursPostsForkV114 } =
  proxyActivities<PostActivity>({
    startToCloseTimeout: '10 minute',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });

export async function missingPostWorkflowV2() {
  await searchForMissingThreeHoursPostsForkV114();
  while (true) {
    await sleep('1 hour');
    await searchForMissingThreeHoursPostsForkV114();
  }
}
