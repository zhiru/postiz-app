jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/flows/flows.service',
  () => ({ FlowsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/flows/unmatched-comment.service',
  () => ({ UnmatchedCommentService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/social/instagram-messaging.service',
  () => ({ InstagramMessagingService: class {} })
);
jest.mock('@temporalio/workflow', () => {
  const activities = Object.fromEntries(
    [
      'getFlowWithNodes',
      'replyToComment',
      'sendDirectMessage',
      'sendStoryDirectMessage',
      'checkIgFollowStatus',
      'evaluateCondition',
      'updateExecution',
      'appendExecutionLog',
      'createPendingPostback',
      'sendOpeningDmWithPostback',
    ].map((name) => [name, jest.fn()])
  );
  return { proxyActivities: () => activities, sleep: jest.fn(), activities };
});

import { Logger } from '@nestjs/common';
import { FlowActivity } from './flow.activity';
import { AutomationDeliveryService } from '@gitroom/nestjs-libraries/database/prisma/flows/automation-delivery.service';
import {
  flowExecutionWorkflow,
  FlowExecutionInput,
} from '../workflows/flow.execution.workflow';
const { activities, sleep } = jest.requireMock('@temporalio/workflow');

const input: FlowExecutionInput = {
  executionId: 'execution',
  flowId: 'flow',
  integrationId: 'integration',
  triggerType: 'comment_on_post',
  igCommentId: 'comment',
  igCommenterId: 'person',
  igMediaId: 'media',
  commentText: 'CATALOGO',
};
const node = (id: string, type: string, data: object = {}) => ({
  id,
  type,
  data: JSON.stringify(data),
});

describe('FlowActivity delivery guards and workflow replay', () => {
  let activity: FlowActivity;
  let rows: Map<string, any>;
  let flow: any;
  let flows: any;
  let provider: any;
  let messaging: any;
  const pending = {
    id: 'pending',
    flowId: 'flow',
    originExecutionId: 'execution',
    integrationId: 'integration',
    organizationId: 'org',
    igSenderId: 'person',
    igCommentId: 'comment',
    snapshotFinalDm: 'Final DM',
    openingDmMessage: 'Opening DM',
    payload: 'signed-payload',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    rows = new Map();
    const model = {
      create: jest.fn(async ({ data }) => {
        if (rows.has(data.key)) throw { code: 'P2002' };
        rows.set(data.key, { ...data });
        return data;
      }),
      findUnique: jest.fn(async ({ where }) => rows.get(where.key)),
      update: jest.fn(async ({ where, data }) => {
        Object.assign(rows.get(where.key), data);
        return rows.get(where.key);
      }),
    };
    flow = {
      id: 'flow',
      status: 'ACTIVE',
      deletedAt: null,
      organizationId: 'org',
      integrationId: 'integration',
      nodes: [],
      edges: [],
    };
    flows = {
      getFlowById: jest.fn(async () => ({ ...flow })),
      getPendingPostback: jest.fn(async () => pending),
      updateExecution: jest.fn(),
      appendExecutionLog: jest.fn(),
      createPendingPostback: jest.fn(async () => pending),
    };
    provider = {
      replyToComment: jest.fn(async () => ({ id: 'public-reply' })),
      sendPrivateReply: jest.fn(async () => ({ messageId: 'private-reply' })),
    };
    messaging = {
      sendDmWithToken: jest.fn(async () => ({ messageId: 'final-dm' })),
      sendStoryReply: jest.fn(async () => ({ messageId: 'story-dm' })),
    };
    activity = new FlowActivity(
      flows,
      {
        getIntegrationById: jest.fn(async () => ({
          id: 'integration',
          organizationId: 'org',
          profileId: 'profile',
          internalId: 'ig-account',
          providerIdentifier: 'instagram-standalone',
          token: 'ig-token',
        })),
      } as any,
      { getSocialIntegration: jest.fn(() => provider) } as any,
      messaging,
      {} as any,
      { decrypt: jest.fn() } as any,
      new AutomationDeliveryService({
        model: { automationDelivery: model },
      } as any)
    );
    for (const name of Object.keys(activities)) {
      activities[name].mockImplementation((...args: unknown[]) =>
        (activity as any)[name](...args)
      );
    }
    sleep.mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const graph = (...nodes: any[]) => {
    flow.nodes = [node('trigger', 'TRIGGER'), ...nodes];
    flow.edges = flow.nodes.slice(1).map((n: any, i: number) => ({
      sourceNodeId: flow.nodes[i].id,
      targetNodeId: n.id,
    }));
  };

  it('sends each distinct public action once when the same execution is replayed', async () => {
    graph(
      node('reply-1', 'REPLY_COMMENT', { message: 'First' }),
      node('reply-2', 'REPLY_COMMENT', { message: 'Second' })
    );
    await flowExecutionWorkflow(input);
    await flowExecutionWorkflow(input);
    expect(provider.replyToComment).toHaveBeenCalledTimes(2);
    expect(
      provider.replyToComment.mock.calls.map((call: any[]) => call[2])
    ).toEqual(['First', 'Second']);
    expect([...rows.keys()]).toEqual([
      JSON.stringify(['integration', 'comment', 'public', 'execution:reply-1']),
      JSON.stringify(['integration', 'comment', 'public', 'execution:reply-2']),
    ]);
  });

  it('combines DM nodes into one private reply and does not resend on replay', async () => {
    graph(
      node('dm-1', 'SEND_DM', { message: 'First' }),
      node('dm-2', 'SEND_DM', { message: 'Second' })
    );
    await flowExecutionWorkflow(input);
    await flowExecutionWorkflow(input);
    expect(provider.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(provider.sendPrivateReply.mock.calls[0][3]).toBe('First\n\nSecond');
    expect(
      rows.has(JSON.stringify(['integration', 'comment', 'private']))
    ).toBe(true);
  });

  it('deduplicates Story deliveries by event identity and permits a distinct event', async () => {
    await activity.sendStoryDirectMessage(
      'integration',
      'org',
      'person',
      'Message',
      undefined,
      undefined,
      'story-event-1',
      'flow'
    );
    await activity.sendStoryDirectMessage(
      'integration',
      'org',
      'person',
      'Message',
      undefined,
      undefined,
      'story-event-1',
      'flow'
    );
    await activity.sendStoryDirectMessage(
      'integration',
      'org',
      'person',
      'Message',
      undefined,
      undefined,
      'story-event-2',
      'flow'
    );
    expect(messaging.sendStoryReply).toHaveBeenCalledTimes(2);
  });

  it('blocks a public reply when the automation is paused during a delay', async () => {
    graph(
      node('wait', 'DELAY', { duration: 5, unit: 'minutes' }),
      node('reply', 'REPLY_COMMENT', { message: 'After delay' })
    );
    sleep.mockImplementation(async () => {
      flow.status = 'PAUSED';
    });
    await expect(flowExecutionWorkflow(input)).rejects.toThrow('paused');
    expect(sleep).toHaveBeenCalledWith(300000);
    expect(provider.replyToComment).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
    expect(flows.updateExecution).not.toHaveBeenCalledWith(
      'execution',
      expect.objectContaining({ status: 'COMPLETED' })
    );
  });

  it('blocks the final DM if paused after the opening private reply', async () => {
    await activity.sendOpeningDmWithPostback('pending');
    flow.status = 'PAUSED';
    await expect(activity.sendFinalDm('pending')).rejects.toThrow();
    expect(provider.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(messaging.sendDmWithToken).not.toHaveBeenCalled();
    expect(messaging.sendStoryReply).not.toHaveBeenCalled();
  });

  it('never repeats an uncertain final DM, including a retried activity', async () => {
    messaging.sendDmWithToken.mockRejectedValue(
      Object.assign(new Error('secret-token'), { outcome: 'unknown' })
    );
    await expect(activity.sendFinalDm('pending')).rejects.not.toThrow(
      'secret-token'
    );
    await expect(activity.sendFinalDm('pending')).rejects.toThrow(
      'confirmation'
    );
    expect(messaging.sendDmWithToken).toHaveBeenCalledTimes(1);
    expect(
      rows.get(JSON.stringify(['integration', 'execution', 'final'])).status
    ).toBe('UNKNOWN');
  });
  it('blocks queued private actions after DM is disabled while preserving public replies', async () => {
    flow.nodes = [node('trigger', 'TRIGGER', { enableDm: false })];
    await activity.replyToComment(
      'integration',
      'org',
      'comment',
      'media',
      'Public only',
      'flow',
      'public-action'
    );
    await expect(
      activity.sendDirectMessage(
        'integration',
        'org',
        'person',
        'Old DM',
        'comment',
        undefined,
        undefined,
        'flow'
      )
    ).rejects.toThrow('Private messages disabled');
    await expect(
      activity.sendStoryDirectMessage(
        'integration',
        'org',
        'person',
        'Old story DM',
        undefined,
        undefined,
        'event',
        'flow'
      )
    ).rejects.toThrow('Private messages disabled');
    await expect(activity.sendOpeningDmWithPostback('pending')).rejects.toThrow(
      'Private messages disabled'
    );
    await expect(activity.sendFinalDm('pending')).rejects.toThrow();
    await expect(
      activity.sendAlreadyFollowedGate('pending', { exhausted: false })
    ).rejects.toThrow();
    expect(provider.replyToComment).toHaveBeenCalledTimes(1);
    expect(provider.sendPrivateReply).not.toHaveBeenCalled();
    expect(messaging.sendDmWithToken).not.toHaveBeenCalled();
    expect(messaging.sendStoryReply).not.toHaveBeenCalled();
  });
});
