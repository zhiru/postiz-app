import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

@Injectable()
export class InfiniteWorkflowRegister implements OnModuleInit {
  constructor(private _temporalService: TemporalService) {}

  async onModuleInit(): Promise<void> {
    if (!!process.env.RUN_CRON) {
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('missingPostWorkflow', {
            workflowId: 'missing-post-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}

      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('commentsPollWorkflowV100', {
            workflowId: 'comments-poll-workflow-v1-0-0',
            taskQueue: 'main',
            args: [
              {
                // Meta rate limits are per hour, so a conservative default:
                // one pass every 15 minutes over the last 7 days of posts.
                intervalMs:
                  Number(process.env.COMMENTS_POLL_INTERVAL_MINUTES || 15) *
                  60 *
                  1000,
                sinceDays: Number(process.env.COMMENTS_POLL_DAYS || 7),
              },
            ],
          });
      } catch (err) {}

      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('collectAnalyticsWorkflowV1_0_0', {
            workflowId: 'collect-analytics-workflow-v1-0-0',
            taskQueue: 'main',
          });
      } catch (err) {}
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [InfiniteWorkflowRegister],
  get exports() {
    return this.providers;
  },
})
export class InfiniteWorkflowRegisterModule {}
