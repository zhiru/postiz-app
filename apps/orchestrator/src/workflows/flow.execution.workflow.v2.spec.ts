jest.mock('@temporalio/workflow', () => {
  const activities = Object.fromEntries(
    [
      'getFlowWithNodes',
      'replyToComment',
      'checkIgFollowStatus',
      'evaluateCondition',
      'updateExecution',
      'appendExecutionLog',
      'sendFlowSequenceMessageV2',
      'flowSequenceTimeV2',
    ].map((n) => [n, jest.fn()])
  );
  return {
    activities,
    proxyActivities: () => activities,
    defineSignal: (n: string) => n,
    setHandler: jest.fn(),
    condition: jest.fn(),
    sleep: jest.fn(),
  };
});
import { flowExecutionWorkflowV2 } from './flow.execution.workflow.v2';
const {
  activities: a,
  condition,
  setHandler,
  sleep,
} = jest.requireMock('@temporalio/workflow');
const node = (id: string, type: string, config: any) => ({
  id,
  type,
  data: JSON.stringify(config),
});
const setup = (triggerType = 'comment_on_post') => {
  const nodes = [
    node('t', 'TRIGGER', { executionVersion: 2, triggerType }),
    node('a', 'SEND_DM', { message: 'Invitation' }),
    node('w', 'DELAY', { mode: 'reply', timeoutHours: 24 }),
    node('b', 'SEND_DM', { message: 'Reminder' }),
  ];
  a.getFlowWithNodes.mockResolvedValue({
    id: 'f',
    organizationId: 'org',
    integrationId: 'i',
    status: 'ACTIVE',
    nodes,
    edges: nodes
      .slice(1)
      .map((n, i) => ({ sourceNodeId: nodes[i].id, targetNodeId: n.id })),
  });
};
const input = {
  executionId: 'e',
  flowId: 'f',
  integrationId: 'i',
  triggerType: 'comment_on_post' as const,
  igCommentId: 'c',
  igCommenterId: 'u',
  receivedAt: 100,
};
describe('flowExecutionWorkflowV2', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setup();
    a.flowSequenceTimeV2.mockResolvedValue(150);
  });
  it('sends the invitation before waiting, then sends a separate reminder after reply', async () => {
    condition.mockImplementation(async () => {
      expect(a.sendFlowSequenceMessageV2).toHaveBeenCalledTimes(1);
      setHandler.mock.calls[0][1]({
        nodeId: 'w',
        eventId: 'reply',
        at: 200,
        text: 'Yes',
      });
      return true;
    });
    await flowExecutionWorkflowV2(input);
    expect(
      a.sendFlowSequenceMessageV2.mock.calls.map((c: any) => c[0].message)
    ).toEqual(['Invitation', 'Reminder']);
    expect(a.sendFlowSequenceMessageV2.mock.calls[0][0].commentId).toBe('c');
    expect(a.sendFlowSequenceMessageV2.mock.calls[1][0].interactionAt).toBe(
      200
    );
  });
  it('does not send a reminder when nobody responds', async () => {
    condition.mockResolvedValue(false);
    await flowExecutionWorkflowV2(input);
    expect(a.sendFlowSequenceMessageV2).toHaveBeenCalledTimes(1);
    expect(a.updateExecution).toHaveBeenLastCalledWith(
      'e',
      expect.objectContaining({ status: 'CANCELLED' })
    );
  });
  it('cancels if paused during a delay', async () => {
    const value = await a.getFlowWithNodes();
    value.nodes[2].data = JSON.stringify({ duration: 1, unit: 'minutes' });
    sleep.mockImplementation(async () => {
      a.getFlowWithNodes.mockResolvedValue({ ...value, status: 'PAUSED' });
    });
    await flowExecutionWorkflowV2({
      ...input,
      triggerType: 'story_reply',
      igSenderId: 'u',
    });
    expect(a.sendFlowSequenceMessageV2).toHaveBeenCalledTimes(1);
  });
  it('does not reuse an older unseen message to release a later reply wait', async () => {
    const value = await a.getFlowWithNodes();
    value.nodes.push(
      node('w2', 'DELAY', { mode: 'reply', timeoutHours: 24 }),
      node('c', 'SEND_DM', { message: 'Third' })
    );
    value.edges.push(
      { sourceNodeId: 'b', targetNodeId: 'w2' },
      { sourceNodeId: 'w2', targetNodeId: 'c' }
    );
    a.flowSequenceTimeV2.mockResolvedValueOnce(150).mockResolvedValueOnce(300);
    condition.mockImplementationOnce(async (predicate: any) => {
      setHandler.mock.calls[0][1]({
        nodeId: 'w',
        eventId: 'first',
        at: 200,
        text: 'Yes',
      });
      return predicate();
    });
    condition.mockImplementationOnce(async (predicate: any) => {
      setHandler.mock.calls[0][1]({
        nodeId: 'w2',
        eventId: 'old-unseen',
        at: 250,
        text: 'Old',
      });
      return predicate();
    });
    await flowExecutionWorkflowV2(input);
    expect(a.sendFlowSequenceMessageV2).toHaveBeenCalledTimes(2);
    expect(a.updateExecution).toHaveBeenLastCalledWith(
      'e',
      expect.objectContaining({ status: 'CANCELLED' })
    );
  });
  it('records unknown delivery as failed and never claims completion', async () => {
    a.sendFlowSequenceMessageV2.mockRejectedValue(
      new Error('Delivery confirmation unavailable')
    );
    await flowExecutionWorkflowV2(input);
    expect(a.updateExecution).toHaveBeenLastCalledWith(
      'e',
      expect.objectContaining({ status: 'FAILED' })
    );
    expect(a.sendFlowSequenceMessageV2).toHaveBeenCalledTimes(1);
  });
});
