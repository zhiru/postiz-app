import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  sleep,
} from '@temporalio/workflow';
import type { FlowActivity } from '../activities/flow.activity';
import type { FlowExecutionInput } from './flow.execution.workflow';

const read = proxyActivities<FlowActivity>({
  taskQueue: 'main',
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3 },
});
const send = proxyActivities<FlowActivity>({
  taskQueue: 'main',
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
});
export const flowMessageReplyV2 = defineSignal<
  [{ nodeId: string; eventId: string; at: number; text: string }]
>('flow-message-reply-v2');

export async function flowExecutionWorkflowV2(
  input: FlowExecutionInput & { receivedAt: number }
) {
  let waitingNode: string | undefined;
  let waitingStartedAt = 0;
  let reply: { at: number; text: string } | undefined;
  const seen = new Set<string>();
  setHandler(flowMessageReplyV2, (event) => {
    if (
      event.nodeId !== waitingNode ||
      seen.has(event.eventId) ||
      !Number.isFinite(event.at) ||
      event.at <= input.receivedAt ||
      event.at < waitingStartedAt ||
      seen.size >= 100
    )
      return;
    seen.add(event.eventId);
    reply = { at: event.at, text: event.text };
  });
  const flow = await read.getFlowWithNodes(input.flowId);
  if (
    !flow ||
    flow.status !== 'ACTIVE' ||
    flow.integrationId !== input.integrationId
  ) {
    await read.updateExecution(input.executionId, {
      status: 'CANCELLED',
      error: 'Automation paused or unavailable.',
      completedAt: new Date(),
    });
    return;
  }
  const trigger = flow.nodes.find((n) => n.type === 'TRIGGER');
  if (!trigger) throw new Error('Trigger missing');
  const cfg = (n: any) => JSON.parse(n.data || '{}');
  const triggerConfig = cfg(trigger);
  let messageText =
    input.commentText || input.messageText || input.reaction || '';
  let interactionAt: number | undefined =
    input.triggerType === 'story_reply' ? input.receivedAt : undefined;
  let privateSent = false;
  let cancelled = false;
  const recipientId = input.igSenderId || input.igCommenterId || '';
  const interpolate = (text: string) =>
    text.replace(
      /\{(commenter_name|comment_text|media_id)\}/g,
      (_, key) =>
        ((
          {
            commenter_name:
              input.igCommenterName || input.igSenderName || recipientId,
            comment_text: messageText,
            media_id: input.igMediaId || input.igStoryId || '',
          } as Record<string, string>
        )[key] || '')
    );
  const finish = (
    status: 'COMPLETED' | 'CANCELLED' | 'FAILED',
    error?: string
  ) =>
    read.updateExecution(input.executionId, {
      status,
      error,
      completedAt: new Date(),
    });
  const visit = async (id: string, path: Set<string>): Promise<void> => {
    if (cancelled) return;
    if (path.has(id) || path.size >= 50)
      throw new Error('Invalid automation graph');
    const node = flow.nodes.find((n) => n.id === id);
    if (!node) throw new Error('Node unavailable');
    const active = await read.getFlowWithNodes(input.flowId);
    if (!active || active.status !== 'ACTIVE') {
      cancelled = true;
      await finish('CANCELLED', 'Automation paused.');
      return;
    }
    const data = cfg(node);
    if (node.type === 'DELAY' && data.mode === 'reply') {
      waitingStartedAt = await read.flowSequenceTimeV2();
      waitingNode = id;
    } else waitingNode = undefined;
    reply = undefined;
    await read.updateExecution(input.executionId, { currentNodeId: id });
    await read.appendExecutionLog(input.executionId, {
      nodeId: id,
      nodeType: node.type,
      status: waitingNode ? 'awaiting_reply' : 'entered',
      timestamp: new Date().toISOString(),
    });
    if (node.type === 'TRIGGER') {
      if (
        data.keywords?.length &&
        !(await read.evaluateCondition(node.data || '{}', messageText))
      )
        return;
      if (data.requireFollow) {
        if (input.triggerType !== 'story_reply')
          throw new Error(
            'Use the original engine for the comment follow gate.'
          );
        if (
          !(await read.checkIgFollowStatus(
            input.integrationId,
            flow.organizationId,
            recipientId,
            'story_reply'
          ))
        ) {
          await send.sendFlowSequenceMessageV2({
            flowId: input.flowId,
            executionId: input.executionId,
            integrationId: input.integrationId,
            organizationId: flow.organizationId,
            nodeId: id,
            recipientId,
            interactionAt,
            message: interpolate(
              data.followGateMessage ||
                'Olá! Me siga e responda o story novamente para receber o conteúdo.'
            ),
          });
          return;
        }
      }
    } else if (node.type === 'SEND_DM') {
      if (!interactionAt && privateSent)
        throw new Error('Wait for a reply before sending another message.');
      await send.sendFlowSequenceMessageV2({
        flowId: input.flowId,
        executionId: input.executionId,
        integrationId: input.integrationId,
        organizationId: flow.organizationId,
        nodeId: id,
        recipientId,
        commentId: interactionAt ? undefined : input.igCommentId,
        interactionAt,
        message: interpolate(data.message || data.template || ''),
        media: data.media,
        buttonText: data.buttonText,
        buttonUrl: data.buttonUrl,
      });
      if (!interactionAt) privateSent = true;
    } else if (
      node.type === 'REPLY_COMMENT' &&
      input.igCommentId &&
      input.igMediaId
    ) {
      const choices = data.messages?.length
        ? data.messages
        : [data.message || data.template || ''];
      const text = interpolate(choices[0]);
      if (text)
        await send.replyToComment(
          input.integrationId,
          flow.organizationId,
          input.igCommentId,
          input.igMediaId,
          text,
          input.flowId,
          `${input.executionId}:${id}`
        );
    } else if (node.type === 'DELAY') {
      if (data.mode === 'reply') {
        const answered = await condition(
          () => !!reply,
          Math.min(72, Math.max(1, data.timeoutHours || 24)) * 3600_000
        );
        waitingNode = undefined;
        if (!answered || !reply) {
          cancelled = true;
          await finish('CANCELLED', 'No reply received before the timeout.');
          return;
        }
        interactionAt = (reply as { at: number }).at;
        messageText = (reply as { text: string }).text;
      } else {
        const multiplier = (
          { seconds: 1000, minutes: 60_000, hours: 3600_000 } as Record<
            string,
            number
          >
        )[data.unit || 'seconds'];
        if (
          !multiplier ||
          !Number.isFinite(data.duration) ||
          data.duration < 0 ||
          data.duration * multiplier > 23 * 3600_000
        )
          throw new Error('Invalid delay');
        await sleep(data.duration * multiplier);
      }
    }
    await read.appendExecutionLog(input.executionId, {
      nodeId: id,
      nodeType: node.type,
      status: 'completed',
      timestamp: new Date().toISOString(),
    });
    let edges = flow.edges.filter((e) => e.sourceNodeId === id);
    if (node.type === 'CONDITION') {
      const matched = await read.evaluateCondition(
        node.data || '{}',
        messageText
      );
      edges = edges.filter(
        (e) => e.sourceHandle === (matched ? 'match' : 'no_match')
      );
    }
    for (const edge of edges)
      await visit(edge.targetNodeId, new Set([...path, id]));
  };
  try {
    if (triggerConfig.executionVersion !== 2)
      throw new Error('Sequence engine not enabled');
    await visit(trigger.id, new Set());
    if (!cancelled) await finish('COMPLETED');
  } catch {
    await finish(
      'FAILED',
      'Sequence stopped. Check the failed step and delivery history before retrying.'
    );
  }
}
