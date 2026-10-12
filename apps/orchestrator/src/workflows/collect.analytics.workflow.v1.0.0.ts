import { proxyActivities, sleep } from '@temporalio/workflow';
import { IntegrationsActivity } from '@gitroom/orchestrator/activities/integrations.activity';

const { collectDailyAnalytics } = proxyActivities<IntegrationsActivity>({
  startToCloseTimeout: '2 hours',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '10 minutes',
  },
});

// Fills the daily analytics table that feeds the cross channel report. Each run
// asks every connected channel for a single day, which is the only window where
// a provider that answers with one aggregated value is still describing one day.
// Writes are upserts keyed on channel + day + metric, so a repeated run is a
// no-op rather than a double count.
export async function collectAnalyticsWorkflowV1_0_0() {
  while (true) {
    await collectDailyAnalytics();
    await sleep('24 hours');
  }
}
