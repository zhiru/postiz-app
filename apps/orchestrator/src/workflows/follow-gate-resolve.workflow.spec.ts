jest.mock('@temporalio/workflow', () => {
  const activities = Object.fromEntries(
    [
      'getFlowWithNodes',
      'getPendingPostback',
      'consumePendingPostback',
      'checkIgFollowStatus',
      'sendFinalDm',
      'sendAlreadyFollowedGate',
      'updateExecution',
      'appendExecutionLog',
    ].map((name) => [name, jest.fn()])
  );
  return { proxyActivities: () => activities, activities };
});
import { followGateResolveWorkflow } from './follow-gate-resolve.workflow';
const { activities } = jest.requireMock('@temporalio/workflow');

const pending = {
  id: 'pending',
  status: 'PENDING',
  flowId: 'flow',
  originExecutionId: 'execution',
  integrationId: 'integration',
  organizationId: 'org',
  igSenderId: 'person',
  attemptCount: 0,
  maxAttempts: 3,
  kind: 'initial',
};

describe('follow-gate history and pause regressions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    activities.getPendingPostback.mockResolvedValue(pending);
    activities.getFlowWithNodes.mockResolvedValue({
      id: 'flow',
      status: 'ACTIVE',
    });
    activities.checkIgFollowStatus.mockResolvedValue(true);
  });

  it('cancels visibly when paused after the opening DM and before the postback', async () => {
    activities.getFlowWithNodes.mockResolvedValue({
      id: 'flow',
      status: 'PAUSED',
    });
    await followGateResolveWorkflow({ pendingPostbackId: 'pending' });
    expect(activities.updateExecution).toHaveBeenCalledWith(
      'execution',
      expect.objectContaining({
        status: 'CANCELLED',
        error: expect.stringMatching(/paused/i),
      })
    );
    expect(activities.sendFinalDm).not.toHaveBeenCalled();
    expect(activities.sendAlreadyFollowedGate).not.toHaveBeenCalled();
    expect(activities.consumePendingPostback).not.toHaveBeenCalled();
  });

  it('records an uncertain final delivery as FAILED instead of leaving WAITING_POSTBACK', async () => {
    activities.sendFinalDm.mockRejectedValue(
      new Error('Delivery confirmation unavailable. Automatic resend blocked.')
    );
    await followGateResolveWorkflow({ pendingPostbackId: 'pending' });
    expect(activities.sendFinalDm).toHaveBeenCalledTimes(1);
    expect(activities.updateExecution).toHaveBeenCalledWith(
      'execution',
      expect.objectContaining({
        status: 'FAILED',
        error: expect.stringMatching(/confirmation unavailable/i),
        completedAt: expect.any(Date),
      })
    );
    expect(activities.consumePendingPostback).not.toHaveBeenCalled();
    expect(activities.updateExecution).not.toHaveBeenCalledWith(
      'execution',
      expect.objectContaining({ status: 'COMPLETED' })
    );
  });

  it('records an uncertain follow-gate reminder as FAILED without claiming completion', async () => {
    activities.checkIgFollowStatus.mockResolvedValue(false);
    activities.sendAlreadyFollowedGate.mockRejectedValue(
      new Error('Delivery confirmation unavailable.')
    );
    await followGateResolveWorkflow({ pendingPostbackId: 'pending' });
    expect(activities.sendAlreadyFollowedGate).toHaveBeenCalledWith('pending', {
      exhausted: false,
    });
    expect(activities.updateExecution).toHaveBeenCalledWith(
      'execution',
      expect.objectContaining({ status: 'FAILED' })
    );
    expect(activities.sendFinalDm).not.toHaveBeenCalled();
    expect(activities.consumePendingPostback).not.toHaveBeenCalled();
  });

  it('does not send again for an already consumed postback', async () => {
    activities.getPendingPostback.mockResolvedValue({
      ...pending,
      status: 'CONSUMED',
    });
    await followGateResolveWorkflow({ pendingPostbackId: 'pending' });
    expect(activities.sendFinalDm).not.toHaveBeenCalled();
    expect(activities.sendAlreadyFollowedGate).not.toHaveBeenCalled();
    expect(activities.updateExecution).not.toHaveBeenCalled();
  });

  it('marks the origin execution complete only after confirmed final delivery and consumption', async () => {
    await followGateResolveWorkflow({ pendingPostbackId: 'pending' });
    expect(activities.sendFinalDm).toHaveBeenCalledWith('pending');
    expect(activities.consumePendingPostback).toHaveBeenCalledWith('pending');
    expect(activities.updateExecution).toHaveBeenCalledWith(
      'execution',
      expect.objectContaining({ status: 'COMPLETED' })
    );
    expect(activities.sendFinalDm.mock.invocationCallOrder[0]).toBeLessThan(
      activities.consumePendingPostback.mock.invocationCallOrder[0]
    );
    expect(
      activities.consumePendingPostback.mock.invocationCallOrder[0]
    ).toBeLessThan(activities.updateExecution.mock.invocationCallOrder[
      activities.updateExecution.mock.calls.findIndex(([, data]: [string, { status: string }]) => data.status === 'COMPLETED')
    ]);
  });
});
